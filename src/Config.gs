/**
 * Apps Script 固有の設定と Sheets アクセス。
 *
 * 日付整形・名称正規化・メール解析・予測計算は Shared.gs にある
 * （ブラウザでも動く必要があるため）。ここには Apps Script の API に
 * 依存するものだけを置く。
 *
 * 日付は必ず 'yyyy-MM-dd' 文字列で持つ（Date のままだと TZ で1日ずれる）。
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
