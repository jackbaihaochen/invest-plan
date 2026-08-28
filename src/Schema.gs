/**
 * シート初期化とマスタデータ投入。
 *
 * 初回に setupSheets() を1度だけ実行する。既存シートは壊さない（無ければ作る）。
 */

function setupSheets() {
  var ss = ss_();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var head = HEADERS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  seedSettings_();
  seedAccounts_();
  seedInstruments_();
  seedGoogleFinance_();
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  return 'セットアップ完了。次に backfillAll() を実行してください。';
}

function seedSettings_() {
  if (readRows_(SHEETS.SETTINGS).length) return;
  appendRows_(SHEETS.SETTINGS, [
    { key: 'goal', value: 100000000, note: '目標額（円）' },
    { key: 'monthly_target', value: 400000, note: '月次積立目標（円）' },
    { key: 'expected_return', value: 0.07, note: '想定年利（名目・米ドル建て）' },
    { key: 'volatility', value: 0.15, note: '想定年率ボラティリティ（モンテカルロ用）' },
    { key: 'inflation', value: 0.01, note: '想定インフレ率（実質価値の併記用）' },
    { key: 'tax_rate', value: 0.20315, note: '特定口座の譲渡益課税' },
    { key: 'nisa_lifetime_cap', value: 18000000, note: 'NISA生涯投資枠' },
    { key: 'start_date', value: '2025-06-01', note: 'トラッキング開始日' },
    { key: 'baseline_principal', value: 0, note: 'トラッキング開始以前に投入済みの元本' },
    { key: 'stale_days', value: 60, note: '手動口座がこの日数を超えたら「古い」と表示' },
    { key: 'notify_email', value: '', note: '空ならスクリプト実行者のアドレス' }
  ]);
}

function seedAccounts_() {
  if (readRows_(SHEETS.ACCOUNTS).length) return;
  appendRows_(SHEETS.ACCOUNTS, [
    { account_id: 'rakuten', name: '楽天証券', type: 'brokerage', tracking_mode: 'auto_email' },
    { account_id: 'nomura', name: '野村證券（持株会）', type: 'esop', tracking_mode: 'manual' },
    { account_id: 'bitflyer', name: 'bitFlyer', type: 'crypto', tracking_mode: 'auto_api' },
    { account_id: 'yucho', name: 'ゆうちょ銀行', type: 'bank', tracking_mode: 'manual' }
  ]);
}

/**
 * nav_key は「基準価額メールと約定メールの両方に共通して現れる部分文字列」。
 * 照合時に normalizeName_() を通すので、ここでは読みやすい表記で置いてよい。
 */
function seedInstruments_() {
  if (readRows_(SHEETS.INSTRUMENTS).length) return;
  appendRows_(SHEETS.INSTRUMENTS, [
    { instrument_id: 'fund_alcan', account_id: 'rakuten', name: 'eMAXIS Slim 全世界株式（オール・カントリー）', kind: 'fund', nav_key: 'eMAXIS Slim 全世界株式(オール・カントリー)', ticker: '', currency: 'JPY' },
    { instrument_id: 'fund_slim_sp500', account_id: 'rakuten', name: 'eMAXIS Slim 米国株式（S&P500）', kind: 'fund', nav_key: 'eMAXIS Slim 米国株式(S&P500)', ticker: '', currency: 'JPY' },
    { instrument_id: 'fund_rakuten_sp500', account_id: 'rakuten', name: '楽天・プラス・S&P500インデックス・ファンド', kind: 'fund', nav_key: '楽天・プラス・S&P500インデックス・ファンド', ticker: '', currency: 'JPY' },
    { instrument_id: 'fund_rakuten_nasdaq', account_id: 'rakuten', name: '楽天・プラス・NASDAQ-100インデックス・ファンド', kind: 'fund', nav_key: '楽天・プラス・NASDAQ-100インデックス・ファンド', ticker: '', currency: 'JPY' },
    { instrument_id: 'fund_fangplus', account_id: 'rakuten', name: 'iFreeNEXT FANG+インデックス', kind: 'fund', nav_key: 'iFreeNEXT FANG+インデックス', ticker: '', currency: 'JPY' },
    { instrument_id: 'fund_hsbc_india', account_id: 'rakuten', name: 'HSBC インド・インフラ株式オープン', kind: 'fund', nav_key: 'HSBC インド・インフラ株式オープン', ticker: '', currency: 'JPY' },
    { instrument_id: 'us_aapl', account_id: 'rakuten', name: 'アップル', kind: 'us_stock', nav_key: '', ticker: 'NASDAQ:AAPL', currency: 'USD' },
    { instrument_id: 'us_goog', account_id: 'rakuten', name: 'アルファベット クラスC', kind: 'us_stock', nav_key: '', ticker: 'NASDAQ:GOOG', currency: 'USD' },
    { instrument_id: 'us_crcl', account_id: 'rakuten', name: 'サークル・インターネット・グループ', kind: 'us_stock', nav_key: '', ticker: 'NYSE:CRCL', currency: 'USD' },
    { instrument_id: 'jp_4385', account_id: 'rakuten', name: 'メルカリ', kind: 'jp_stock', nav_key: '', ticker: 'TYO:4385', currency: 'JPY' },
    { instrument_id: 'btc', account_id: 'bitflyer', name: 'ビットコイン', kind: 'crypto', nav_key: '', ticker: 'BTC_JPY', currency: 'JPY' },
    { instrument_id: 'bitflyer_jpy', account_id: 'bitflyer', name: 'bitFlyer 円残高', kind: 'cash', nav_key: '', ticker: '', currency: 'JPY' }
  ]);
}

/**
 * GAS からは GOOGLEFINANCE() を直接呼べないため、中継シートに数式を置いて
 * 計算結果の「値」だけを読む。
 */
function seedGoogleFinance_() {
  var sh = sheet_(SHEETS.GFINANCE);
  if (sh.getLastRow() > 1) return;
  var tickers = readRows_(SHEETS.INSTRUMENTS)
    .filter(function (r) { return r.ticker && r.kind !== 'crypto'; })
    .map(function (r) { return r.ticker; });
  tickers.push('CURRENCY:USDJPY');

  var rows = tickers.map(function (t) { return [t, '', 'GOOGLEFINANCE 自動取得']; });
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  for (var i = 0; i < tickers.length; i++) {
    sh.getRange(i + 2, 2).setFormula('=IFERROR(GOOGLEFINANCE(A' + (i + 2) + '),"")');
  }
}

// ------------------------------------------------------------------- loaders

function loadInstruments_() {
  return readRows_(SHEETS.INSTRUMENTS).map(function (r) {
    return {
      id: String(r.instrument_id),
      accountId: String(r.account_id),
      name: String(r.name),
      kind: String(r.kind),
      navKey: normalizeName_(r.nav_key),
      ticker: String(r.ticker || ''),
      currency: String(r.currency || 'JPY')
    };
  }).filter(function (r) { return r.id; });
}

function loadAccounts_() {
  return readRows_(SHEETS.ACCOUNTS).map(function (r) {
    return {
      id: String(r.account_id),
      name: String(r.name),
      type: String(r.type),
      trackingMode: String(r.tracking_mode)
    };
  }).filter(function (r) { return r.id; });
}

function loadHoldings_() {
  var map = {};
  readRows_(SHEETS.HOLDINGS).forEach(function (r) {
    if (r.instrument_id) map[String(r.instrument_id)] = Number(r.units) || 0;
  });
  return map;
}

function setHolding_(instrumentId, units, source) {
  var sh = sheet_(SHEETS.HOLDINGS);
  var rows = readRows_(SHEETS.HOLDINGS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].instrument_id) === instrumentId) {
      sh.getRange(rows[i]._rowIndex, 2, 1, 3).setValues([[units, new Date(), source]]);
      return;
    }
  }
  appendRows_(SHEETS.HOLDINGS, [{
    instrument_id: instrumentId, units: units, last_calibrated_at: new Date(), source: source
  }]);
}

/**
 * 価格を {instrumentId: [{date, price}, ...]} （日付昇順）で返す。
 */
function loadPriceSeries_() {
  var series = {};
  readRows_(SHEETS.PRICES).forEach(function (r) {
    var id = String(r.instrument_id);
    if (!id) return;
    if (!series[id]) series[id] = [];
    series[id].push({ date: String(r.date), price: Number(r.price) });
  });
  Object.keys(series).forEach(function (id) {
    series[id].sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  });
  return series;
}

/** その日以前で最も新しい価格を返す（休場日・約定日のNAV欠損を吸収する）。 */
function priceAsOf_(series, instrumentId, dateStr) {
  var arr = series[instrumentId];
  if (!arr || !arr.length) return null;
  var found = null;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].date <= dateStr) found = arr[i]; else break;
  }
  return found ? found.price : null;
}
