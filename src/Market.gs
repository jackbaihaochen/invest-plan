/**
 * 市況データの取得。
 *   株価・為替: Sheets の GOOGLEFINANCE（無料・API キー不要）
 *   BTC:        bitFlyer 公開ティッカー + 読み取り専用 Private API
 */

var BITFLYER_BASE = 'https://api.bitflyer.com';
var FX_USDJPY = 'fx_usdjpy';

/**
 * _gfinance シートの GOOGLEFINANCE 計算結果を Prices に書き込む。
 * GAS からは数式を直接評価できないため、中継シート経由で値だけを読む。
 */
function refreshMarketPrices() {
  var sh = sheet_(SHEETS.GFINANCE);
  SpreadsheetApp.flush();

  var last = sh.getLastRow();
  if (last < 2) return { prices: 0 };
  var values = sh.getRange(2, 1, last - 1, 2).getValues();

  var quote = {};
  values.forEach(function (row) {
    var ticker = String(row[0]).trim();
    var v = Number(row[1]);
    if (ticker && v && !isNaN(v)) quote[ticker] = v;
  });

  var today = todayStr_();
  var existing = {};
  readRows_(SHEETS.PRICES).forEach(function (r) {
    existing[String(r.date) + '|' + String(r.instrument_id)] = true;
  });

  var out = [];
  function put(instrumentId, price, currency) {
    if (!price) return;
    var k = today + '|' + instrumentId;
    if (existing[k]) return;
    existing[k] = true;
    out.push({ date: today, instrument_id: instrumentId, price: price, currency: currency, source: 'googlefinance' });
  }

  loadInstruments_().forEach(function (i) {
    if (i.ticker && quote[i.ticker]) put(i.id, quote[i.ticker], i.currency);
  });
  put(FX_USDJPY, quote['CURRENCY:USDJPY'], 'JPY');

  appendRows_(SHEETS.PRICES, out);
  return { prices: out.length };
}

/** 直近の USD/JPY。取得できなければ null。 */
function getUsdJpy_() {
  var series = loadPriceSeries_();
  return priceAsOf_(series, FX_USDJPY, todayStr_());
}

// ------------------------------------------------------------------ bitFlyer

function bfHeaders_(method, path, body) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('BITFLYER_API_KEY');
  var secret = props.getProperty('BITFLYER_API_SECRET');
  if (!key || !secret) return null;

  var ts = String(Math.floor(Date.now() / 1000));
  var text = ts + method + path + (body || '');
  var raw = Utilities.computeHmacSha256Signature(text, secret);
  var sign = raw.map(function (b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');

  return { 'ACCESS-KEY': key, 'ACCESS-TIMESTAMP': ts, 'ACCESS-SIGN': sign };
}

function getBtcPrice_() {
  var res = UrlFetchApp.fetch(BITFLYER_BASE + '/v1/ticker?product_code=BTC_JPY', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var j = JSON.parse(res.getContentText());
  return Number(j.ltp) || null;
}

/**
 * bitFlyer の残高を取得して Holdings と Prices を更新する。
 * API キーは「資産」参照権限のみを付与すること（送金・注文権限は不要）。
 */
function refreshBitflyer() {
  var price = getBtcPrice_();
  if (price) {
    var existing = {};
    readRows_(SHEETS.PRICES).forEach(function (r) {
      existing[String(r.date) + '|' + String(r.instrument_id)] = true;
    });
    if (!existing[todayStr_() + '|btc']) {
      appendRows_(SHEETS.PRICES, [{
        date: todayStr_(), instrument_id: 'btc', price: price,
        currency: 'JPY', source: 'bitflyer_ticker'
      }]);
    }
  }

  var path = '/v1/me/getbalance';
  var headers = bfHeaders_('GET', path, '');
  if (!headers) {
    Logger.log('bitFlyer API キー未設定のためスキップ（スクリプトプロパティ BITFLYER_API_KEY / BITFLYER_API_SECRET）');
    return { skipped: true, btcPrice: price };
  }

  var res = UrlFetchApp.fetch(BITFLYER_BASE + path, {
    method: 'get', headers: headers, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('bitFlyer 残高取得に失敗: ' + res.getResponseCode() + ' ' + res.getContentText());
    return { error: res.getResponseCode(), btcPrice: price };
  }

  var balances = JSON.parse(res.getContentText());
  var btc = 0, jpy = 0;
  balances.forEach(function (b) {
    if (b.currency_code === 'BTC') btc = Number(b.amount) || 0;
    if (b.currency_code === 'JPY') jpy = Number(b.amount) || 0;
  });
  setHolding_('btc', btc, 'bitflyer_api');
  setHolding_('bitflyer_jpy', jpy, 'bitflyer_api');
  return { btc: btc, jpy: jpy, btcPrice: price };
}
