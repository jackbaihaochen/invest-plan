/**
 * Gmail からの取り込み。
 *
 * すべて冪等: 処理済みの Gmail message id を EmailLog に記録し、
 * Prices は (date, instrument_id)、Transactions は (message_id, instrument_id)
 * で重複を弾く。同じ関数を何度実行しても行は増えない。
 */

var RAKUTEN_SEC = 'service@rakuten-sec.co.jp';

/** GmailApp の検索件数上限（1回の実行あたり）。 */
var MAX_THREADS = 300;

function searchMessages_(query, limit) {
  var threads = GmailApp.search(query, 0, limit || MAX_THREADS);
  var msgs = [];
  GmailApp.getMessagesForThreads(threads).forEach(function (arr) {
    arr.forEach(function (m) { msgs.push(m); });
  });
  return msgs;
}

// --------------------------------------------------------------- 基準価額メール

function ingestNav(lookbackDays) {
  var q = 'from:' + RAKUTEN_SEC + ' subject:投信基準価額メール';
  if (lookbackDays) q += ' newer_than:' + lookbackDays + 'd';

  var instruments = loadInstruments_();
  var processed = loadProcessedIds_();

  // 既存の (date, instrument) を控えて二重登録を防ぐ。
  var existing = {};
  readRows_(SHEETS.PRICES).forEach(function (r) {
    existing[String(r.date) + '|' + String(r.instrument_id)] = true;
  });

  var msgs = searchMessages_(q);
  var newPrices = [];
  var handledIds = [];
  var unmatched = {};

  msgs.forEach(function (m) {
    var id = m.getId();
    if (processed[id]) return;
    var parsed = parseNavEmail_(m.getBody() || m.getPlainBody(), m.getDate());
    parsed.rows.forEach(function (row) {
      var inst = matchInstrument_(row.name, instruments);
      if (!inst) { unmatched[row.name] = (unmatched[row.name] || 0) + 1; return; }
      var key = parsed.baseDate + '|' + inst.id;
      if (existing[key]) return;
      existing[key] = true;
      newPrices.push({
        date: parsed.baseDate, instrument_id: inst.id,
        price: row.price, currency: 'JPY', source: 'rakuten_nav_mail'
      });
    });
    handledIds.push(id);
  });

  appendRows_(SHEETS.PRICES, newPrices);
  logProcessed_(handledIds, 'ingestNav');

  var names = Object.keys(unmatched);
  if (names.length) {
    Logger.log('未照合のファンド名（Instruments の nav_key を確認）: ' + names.join(' / '));
  }
  return { emails: handledIds.length, prices: newPrices.length, unmatched: names };
}

// ----------------------------------------------------------------- 約定メール

function ingestTransactions(lookbackDays) {
  var q = 'from:' + RAKUTEN_SEC + ' subject:積立購入が完了';
  if (lookbackDays) q += ' newer_than:' + lookbackDays + 'd';

  var instruments = loadInstruments_();
  var processed = loadProcessedIds_();
  var series = loadPriceSeries_();

  var existing = {};
  readRows_(SHEETS.TRANSACTIONS).forEach(function (r) {
    existing[String(r.gmail_message_id) + '|' + String(r.instrument_id)] = true;
  });

  var msgs = searchMessages_(q);
  var rows = [];
  var handledIds = [];
  var unmatched = {};

  msgs.forEach(function (m) {
    var id = m.getId();
    if (processed[id]) return;
    var recs = parseTxEmail_(m.getBody() || m.getPlainBody(), m.getDate(), instruments);
    recs.forEach(function (r) {
      var inst = matchInstrument_(r.name, instruments);
      if (!inst) { unmatched[r.name] = true; return; }
      var key = id + '|' + inst.id;
      if (existing[key]) return;
      existing[key] = true;

      // 約定メールに口数は載らない。約定日の基準価額から逆算する。
      // 基準価額は1万口あたりなので 10000 倍する。
      var nav = priceAsOf_(series, inst.id, r.execDate);
      var units = nav ? (r.amount / nav) * FUND_UNIT_BASIS : '';

      rows.push({
        date: r.execDate, account_id: inst.accountId, instrument_id: inst.id,
        type: 'buy', amount_jpy: r.amount, units: units,
        nisa_bucket: r.nisaBucket, gmail_message_id: id, raw_subject: m.getSubject()
      });
    });
    handledIds.push(id);
  });

  rows.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  appendRows_(SHEETS.TRANSACTIONS, rows);
  logProcessed_(handledIds, 'ingestTransactions');
  return { emails: handledIds.length, transactions: rows.length, unmatched: Object.keys(unmatched) };
}

// ------------------------------------------------------------------- 配当入金

function ingestDividends(lookbackDays) {
  var q = 'from:' + RAKUTEN_SEC + ' subject:配当金の入金';
  if (lookbackDays) q += ' newer_than:' + lookbackDays + 'd';

  var processed = loadProcessedIds_();
  var usdJpy = getUsdJpy_() || 150;
  var msgs = searchMessages_(q);
  var rows = [];
  var handledIds = [];

  msgs.forEach(function (m) {
    var id = m.getId();
    if (processed[id]) return;
    handledIds.push(id);
    var d = parseDividendEmail_(m.getBody() || m.getPlainBody());
    if (!d || !d.amount) return;
    rows.push({
      date: dateStr_(m.getDate()), account_id: 'rakuten', instrument_id: '',
      type: 'dividend',
      amount_jpy: d.currency === 'USD' ? Math.round(d.amount * usdJpy) : Math.round(d.amount),
      units: '', nisa_bucket: '', gmail_message_id: id, raw_subject: m.getSubject()
    });
  });

  appendRows_(SHEETS.TRANSACTIONS, rows);
  logProcessed_(handledIds, 'ingestDividends');
  return { emails: handledIds.length, dividends: rows.length };
}

// ------------------------------------------------------------------- 一括実行

/**
 * 全履歴を遡って取り込む。初回セットアップ時に1度だけ実行する。
 *
 * 基準価額を先に入れてから約定を入れること（口数の逆算に基準価額が要る）。
 */
function backfillAll() {
  var nav = ingestNav(null);
  var tx = ingestTransactions(null);
  var div = ingestDividends(null);
  recalcUnitsFromTransactions();
  rebuildSnapshots();
  var msg = Utilities.formatString(
    'バックフィル完了\n  基準価額: %s件（メール%s通）\n  約定: %s件\n  配当: %s件',
    nav.prices, nav.emails, tx.transactions, div.dividends);
  if (nav.unmatched.length) msg += '\n  ⚠ 未照合ファンド: ' + nav.unmatched.join(' / ');
  Logger.log(msg);
  return msg;
}

/** 日次トリガーから呼ぶ差分取り込み。 */
function dailyIngest() {
  ingestNav(14);
  ingestTransactions(30);
  ingestDividends(30);
  refreshMarketPrices();
  refreshBitflyer();
  recalcUnitsFromTransactions();
  takeSnapshot();
}

/**
 * Transactions の口数を積み上げて Holdings を再計算する。
 *
 * CSV で較正済み（source='rakuten_csv'）の銘柄は上書きしない。実口数のほうが
 * 逆算値より正確なため。CSV 較正日以降の約定だけを加算する。
 */
function recalcUnitsFromTransactions() {
  var instruments = loadInstruments_();
  var byId = {};
  instruments.forEach(function (i) { if (i.kind === 'fund') byId[i.id] = i; });

  var calibrated = {};
  readRows_(SHEETS.HOLDINGS).forEach(function (r) {
    if (String(r.source) === 'rakuten_csv' && r.last_calibrated_at) {
      calibrated[String(r.instrument_id)] = {
        units: Number(r.units) || 0,
        since: dateStr_(new Date(r.last_calibrated_at))
      };
    }
  });

  var series = loadPriceSeries_();
  var totals = {};
  Object.keys(byId).forEach(function (id) {
    totals[id] = calibrated[id] ? calibrated[id].units : 0;
  });

  readRows_(SHEETS.TRANSACTIONS).forEach(function (r) {
    var id = String(r.instrument_id);
    if (!byId[id] || String(r.type) !== 'buy') return;
    var d = String(r.date);
    if (calibrated[id] && d <= calibrated[id].since) return;
    var units = Number(r.units);
    if (!units) {
      var nav = priceAsOf_(series, id, d);
      units = nav ? (Number(r.amount_jpy) / nav) * FUND_UNIT_BASIS : 0;
    }
    totals[id] += units;
  });

  Object.keys(totals).forEach(function (id) {
    if (totals[id] > 0) {
      setHolding_(id, totals[id], calibrated[id] ? 'csv+mail' : 'derived_from_mail');
    }
  });
  return totals;
}
