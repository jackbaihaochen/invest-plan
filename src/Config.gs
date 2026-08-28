/**
 * 1億円投資ダッシュボード — 設定・共通ユーティリティ
 *
 * データは Google Sheets に保存する。日付は必ず 'yyyy-MM-dd' 文字列で持つ
 * （Date オブジェクトのまま持つとタイムゾーンで1日ずれるため）。
 */

var TZ = 'Asia/Tokyo';

var SHEETS = {
  SETTINGS: 'Settings',
  ACCOUNTS: 'Accounts',
  INSTRUMENTS: 'Instruments',
  PRICES: 'Prices',
  TRANSACTIONS: 'Transactions',
  HOLDINGS: 'Holdings',
  MANUAL: 'ManualBalances',
  SNAPSHOTS: 'Snapshots',
  EMAIL_LOG: 'EmailLog',
  GFINANCE: '_gfinance'
};

var HEADERS = {
  Settings: ['key', 'value', 'note'],
  Accounts: ['account_id', 'name', 'type', 'tracking_mode'],
  Instruments: ['instrument_id', 'account_id', 'name', 'kind', 'nav_key', 'ticker', 'currency'],
  Prices: ['date', 'instrument_id', 'price', 'currency', 'source'],
  Transactions: ['date', 'account_id', 'instrument_id', 'type', 'amount_jpy', 'units', 'nisa_bucket', 'gmail_message_id', 'raw_subject'],
  Holdings: ['instrument_id', 'units', 'last_calibrated_at', 'source'],
  ManualBalances: ['date', 'account_id', 'balance_jpy', 'note'],
  Snapshots: ['date', 'total_jpy', 'principal_jpy', 'gain_jpy', 'rakuten_fund_jpy', 'rakuten_stock_jpy', 'crypto_jpy', 'manual_jpy', 'estimated'],
  EmailLog: ['gmail_message_id', 'processed_at', 'handler'],
  _gfinance: ['ticker', 'value', 'formula_note']
};

/** 投資信託の基準価額は「1万口あたり」で表示される。 */
var FUND_UNIT_BASIS = 10000;

// ---------------------------------------------------------------- spreadsheet

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('SPREADSHEET_ID スクリプトプロパティが未設定です。README のセットアップ手順を参照してください。');
  }
  return active;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シートがありません: ' + name + '（setupSheets() を実行してください）');
  return sh;
}

/** シート全体を {header: value} の配列として読む。 */
function readRows_(name) {
  var values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    var obj = {};
    for (var j = 0; j < head.length; j++) obj[head[j]] = row[j];
    obj._rowIndex = i + 1;
    out.push(obj);
  }
  return out;
}

/** 行オブジェクトの配列をシート末尾に追記する。 */
function appendRows_(name, objs) {
  if (!objs.length) return 0;
  var sh = sheet_(name);
  var head = HEADERS[name];
  var rows = objs.map(function (o) {
    return head.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
  return rows.length;
}

/** ヘッダーを残して中身を全消去する。 */
function clearBody_(name) {
  var sh = sheet_(name);
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  }
}

// ------------------------------------------------------------------ settings

function getSettings_() {
  var rows = readRows_(SHEETS.SETTINGS);
  var s = {};
  rows.forEach(function (r) {
    var v = r.value;
    if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) v = Number(v);
    s[r.key] = v;
  });
  return {
    goal: Number(s.goal || 100000000),
    monthlyTarget: Number(s.monthly_target || 400000),
    expectedReturn: Number(s.expected_return || 0.07),
    volatility: Number(s.volatility || 0.15),
    inflation: Number(s.inflation || 0.01),
    taxRate: Number(s.tax_rate || 0.20315),
    nisaLifetimeCap: Number(s.nisa_lifetime_cap || 18000000),
    startDate: String(s.start_date || '2025-06-01'),
    notifyEmail: String(s.notify_email || Session.getActiveUser().getEmail()),
    baselinePrincipal: Number(s.baseline_principal || 0),
    staleDays: Number(s.stale_days || 60)
  };
}

function setSetting_(key, value, note) {
  var sh = sheet_(SHEETS.SETTINGS);
  var rows = readRows_(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) {
      sh.getRange(rows[i]._rowIndex, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value, note || '']);
}

// ---------------------------------------------------------------- text utils

/**
 * ファンド名の照合キーを作る。
 *
 * 楽天証券のメールは全角と半角が混在する（「eMAXIS　Slim」の全角スペース、
 * 「Ｓ＆Ｐ５００」の全角英数、「（）」の全角括弧）。NFKC 正規化で半角に寄せ、
 * 空白を全て落とし、大文字化して比較する。
 *
 *   'eMAXIS　Slim　米国株式（Ｓ＆Ｐ５００）' -> 'EMAXISSLIM米国株式(S&P500)'
 */
function normalizeName_(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .toUpperCase();
}

/**
 * 正規化済みテキストに nav_key が含まれる instrument を返す。
 *
 * 完全一致にしないのは、同じファンドでもメールごとに後置文字列が違うため:
 *   基準価額メール: 'eMAXIS Slim 全世界株式（オール・カントリー） (三菱ＵＦＪ…)'
 *   約定メール:     'eMAXIS Slim 全世界株式(オール・カントリー)(オルカン)'
 * 共通の前半部分を nav_key に置き、包含判定する。
 * 複数該当した場合は nav_key が最長のものを採用する。
 */
function matchInstrument_(rawName, instruments) {
  var norm = normalizeName_(rawName);
  var best = null;
  for (var i = 0; i < instruments.length; i++) {
    var key = instruments[i].navKey;
    if (!key) continue;
    if (norm.indexOf(key) !== -1) {
      if (!best || key.length > best.navKey.length) best = instruments[i];
    }
  }
  return best;
}

/** 「19,215円」「100,000円」→ 数値。マイナスや符号も扱う。 */
function parseYen_(s) {
  var m = String(s).replace(/[,\s　]/g, '').match(/(-?\+?[\d.]+)/);
  if (!m) return null;
  var n = Number(m[1].replace('+', ''));
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------- date utils

function todayStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function dateStr_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** 'yyyy-MM-dd' -> Date (JST 正午。DST/境界事故を避けるため正午に置く) */
function parseDateStr_(s) {
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
}

/**
 * 「08月27日」のように年が無い日付を、基準となる日付から補完する。
 * 12月のメールを1月に受信するような年跨ぎを考慮する。
 */
function resolveYear_(month, day, referenceDate) {
  var refY = Number(Utilities.formatDate(referenceDate, TZ, 'yyyy'));
  var refM = Number(Utilities.formatDate(referenceDate, TZ, 'MM'));
  var year = refY;
  if (month === 12 && refM === 1) year = refY - 1;
  else if (month === 1 && refM === 12) year = refY + 1;
  return Utilities.formatString('%s-%s-%s',
    year,
    ('0' + month).slice(-2),
    ('0' + day).slice(-2));
}

function addMonthsStr_(dateStr, months) {
  var d = parseDateStr_(dateStr);
  d.setMonth(d.getMonth() + months);
  return dateStr_(d);
}

function monthKey_(dateStr) {
  return String(dateStr).slice(0, 7);
}

function yen_(n) {
  return Math.round(Number(n) || 0).toLocaleString('ja-JP');
}

// ------------------------------------------------------------- email log

function loadProcessedIds_() {
  var set = {};
  readRows_(SHEETS.EMAIL_LOG).forEach(function (r) { set[String(r.gmail_message_id)] = true; });
  return set;
}

function logProcessed_(ids, handler) {
  if (!ids.length) return;
  var now = new Date();
  appendRows_(SHEETS.EMAIL_LOG, ids.map(function (id) {
    return { gmail_message_id: id, processed_at: now, handler: handler };
  }));
}
