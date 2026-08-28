/**
 * 保有数の較正と、手動口座の残高入力。
 *
 * 約定メールからの口数は逆算値なので誤差が乗る。楽天証券の「保有商品一覧」
 * CSV を1度取り込んで実口数で上書きすると、以後の積み上げが正確になる。
 */

var QTY_HEADERS = ['保有数量', '数量', '保有口数', '口数', '残高数量', '保有株数'];
var COST_HEADERS = ['取得金額', '取得価額', '簿価', '取得総額'];
var UNIT_COST_HEADERS = ['平均取得価額', '取得単価', '平均取得単価', '取得価額単価'];
var NAME_HEADERS = ['銘柄名', 'ファンド名', '銘柄', '商品名', 'ファンド'];

function splitCsvLine_(line) {
  var out = [], cur = '', q = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(function (s) { return s.trim(); });
}

function num_(s) {
  var v = String(s).replace(/["',\s円]/g, '');
  if (!v || isNaN(Number(v))) return null;
  return Number(v);
}

function findHeaderIdx_(cells, candidates) {
  for (var i = 0; i < cells.length; i++) {
    var c = normalizeName_(cells[i]);
    for (var j = 0; j < candidates.length; j++) {
      if (c === normalizeName_(candidates[j])) return i;
    }
  }
  return -1;
}

/**
 * 保有商品一覧 CSV のテキストを取り込む。
 *
 * 楽天証券の CSV は投資信託・国内株式・外国株式でセクションが分かれ、
 * それぞれにヘッダ行がある。ヘッダ行を見つけるたびに列位置を取り直す。
 */
function importHoldingsCsv(csvText) {
  var instruments = loadInstruments_();
  var lines = String(csvText).split(/\r?\n/).filter(function (l) { return l.trim(); });

  var nameIdx = -1, qtyIdx = -1, costIdx = -1, unitCostIdx = -1;
  var matched = [], skipped = [], costTotal = 0, sawCost = false;

  lines.forEach(function (line) {
    var cells = splitCsvLine_(line);
    if (cells.length < 2) return;

    var n = findHeaderIdx_(cells, NAME_HEADERS);
    var q = findHeaderIdx_(cells, QTY_HEADERS);
    if (n !== -1 && q !== -1) {
      nameIdx = n; qtyIdx = q;
      costIdx = findHeaderIdx_(cells, COST_HEADERS);
      unitCostIdx = findHeaderIdx_(cells, UNIT_COST_HEADERS);
      return;
    }
    if (nameIdx === -1) return;

    var rawName = cells[nameIdx];
    if (!rawName) return;
    var inst = matchInstrument_(rawName, instruments);
    var qty = num_(cells[qtyIdx]);
    if (!inst || qty === null) {
      if (rawName && qty !== null) skipped.push(rawName);
      return;
    }

    setHolding_(inst.id, qty, 'rakuten_csv');
    matched.push({ id: inst.id, name: inst.name, units: qty });

    var cost = costIdx !== -1 ? num_(cells[costIdx]) : null;
    if (cost === null && unitCostIdx !== -1) {
      var u = num_(cells[unitCostIdx]);
      // 投信の平均取得価額は1万口あたり。株式は1株あたり。
      if (u !== null) cost = inst.kind === 'fund' ? (qty / FUND_UNIT_BASIS) * u : qty * u;
    }
    if (cost !== null) { costTotal += cost; sawCost = true; }
  });

  if (!matched.length) {
    throw new Error(
      'CSV から保有銘柄を読み取れませんでした。ヘッダ行に「' + NAME_HEADERS.join('/') +
      '」と「' + QTY_HEADERS.join('/') + '」に相当する列が必要です。');
  }

  // 元本の基準を CSV の取得金額に合わせる。
  // principal(d) = baseline + 取込済み買付累計(d) が較正時点で CSV と一致するようにする。
  if (sawCost) {
    var today = todayStr_();
    var tracked = 0;
    readRows_(SHEETS.TRANSACTIONS).forEach(function (r) {
      if (String(r.type) === 'buy' && String(r.date) <= today) tracked += Number(r.amount_jpy) || 0;
    });
    setSetting_('baseline_principal', Math.max(0, Math.round(costTotal - tracked)));
  }

  recalcUnitsFromTransactions();
  rebuildSnapshots();
  return { matched: matched, skipped: skipped, costTotal: sawCost ? Math.round(costTotal) : null };
}

// --------------------------------------------------------------- 手動口座残高

function setManualBalance(accountId, balance, note) {
  var amount = Number(balance);
  if (!accountId || isNaN(amount)) throw new Error('口座と金額を指定してください。');
  appendRows_(SHEETS.MANUAL, [{
    date: todayStr_(), account_id: String(accountId),
    balance_jpy: Math.round(amount), note: note || ''
  }]);
  takeSnapshot();
  return { accountId: accountId, balance: Math.round(amount) };
}

/** 指定日以前で最新の手動残高を口座ごとに返す。 */
function manualBalancesAsOf_(dateStr) {
  var latest = {};
  readRows_(SHEETS.MANUAL).forEach(function (r) {
    var d = String(r.date), a = String(r.account_id);
    if (d > dateStr) return;
    if (!latest[a] || d >= latest[a].date) {
      latest[a] = { date: d, balance: Number(r.balance_jpy) || 0, note: String(r.note || '') };
    }
  });
  return latest;
}

/**
 * 過去日を評価するときに使う「最も古い既知の手動残高」。
 * 手動口座は履歴が無いので、記録開始より前は最初の値で横引きする（推定値扱い）。
 */
function earliestManualBalances_() {
  var earliest = {};
  readRows_(SHEETS.MANUAL).forEach(function (r) {
    var d = String(r.date), a = String(r.account_id);
    if (!earliest[a] || d < earliest[a].date) {
      earliest[a] = { date: d, balance: Number(r.balance_jpy) || 0 };
    }
  });
  return earliest;
}

/** 手動口座が stale_days を超えて未更新かどうか。 */
function manualFreshness_() {
  var cfg = getSettings_();
  var latest = manualBalancesAsOf_(todayStr_());
  var out = [];
  loadAccounts_().forEach(function (a) {
    if (a.trackingMode !== 'manual') return;
    var rec = latest[a.id];
    var days = rec
      ? Math.floor((parseDateStr_(todayStr_()) - parseDateStr_(rec.date)) / 86400000)
      : null;
    out.push({
      accountId: a.id, name: a.name,
      balance: rec ? rec.balance : 0,
      updated: rec ? rec.date : null,
      ageDays: days,
      stale: days === null || days > cfg.staleDays
    });
  });
  return out;
}
