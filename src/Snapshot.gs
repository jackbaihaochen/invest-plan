/**
 * 資産評価とスナップショット。
 *
 * 基準価額メールが約1年分あるので、投信部分は過去に遡って実際の評価額を
 * 復元できる。株式・BTC・手動口座は過去の数量／残高が分からないため、
 * 最も古い既知の値で横引きし、その日のスナップショットに estimated=TRUE を立てる。
 */

/**
 * 指定日の資産内訳を計算する。
 * @param {string} dateStr        評価日
 * @param {Object} unitsByInst    {instrument_id: 口数}
 * @param {Object} series         loadPriceSeries_() の結果
 * @param {Object} manual         {account_id: {balance}}
 */
function valueAt_(dateStr, unitsByInst, series, manual, instruments) {
  var b = { fund: 0, stock: 0, crypto: 0, manual: 0, priced: 0, unpriced: 0 };
  var usdJpy = priceAsOf_(series, FX_USDJPY, dateStr);

  instruments.forEach(function (i) {
    var units = Number(unitsByInst[i.id]) || 0;
    if (!units) return;

    if (i.kind === 'cash') { b.crypto += units; b.priced++; return; }

    var p = priceAsOf_(series, i.id, dateStr);
    if (!p) { b.unpriced++; return; }
    b.priced++;

    if (i.kind === 'fund') b.fund += (units / FUND_UNIT_BASIS) * p;
    else if (i.kind === 'crypto') b.crypto += units * p;
    else if (i.kind === 'us_stock') b.stock += units * p * (usdJpy || 0);
    else b.stock += units * p;
  });

  Object.keys(manual).forEach(function (a) { b.manual += manual[a].balance; });
  b.total = b.fund + b.stock + b.crypto + b.manual;
  return b;
}

/**
 * 投信の買付累計（元本）を日付順の累積で返す。
 *
 * 評価損益は「投信の評価額 − 投信の元本」で出すので、ここでは投信以外の
 * 買付（個別株や持株会の拠出）を含めない。月次の投入額としての合計は
 * Coaching.gs の contributionsByMonth_() が別に集計する。
 */
function principalTimeline_() {
  var cfg = getSettings_();
  var fundIds = {};
  loadInstruments_().forEach(function (i) { if (i.kind === 'fund') fundIds[i.id] = true; });
  var buys = [];
  readRows_(SHEETS.TRANSACTIONS).forEach(function (r) {
    if (String(r.type) !== 'buy') return;
    if (!fundIds[String(r.instrument_id)]) return;
    buys.push({ date: String(r.date), amount: Number(r.amount_jpy) || 0 });
  });
  buys.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return { baseline: cfg.baselinePrincipal, buys: buys };
}

function principalAsOf_(timeline, dateStr) {
  var p = timeline.baseline;
  for (var i = 0; i < timeline.buys.length; i++) {
    if (timeline.buys[i].date <= dateStr) p += timeline.buys[i].amount; else break;
  }
  return p;
}

/** 今日のスナップショットを記録（同日分があれば上書き）。 */
function takeSnapshot() {
  var today = todayStr_();
  var instruments = loadInstruments_();
  var series = loadPriceSeries_();
  var units = loadHoldings_();
  var manual = manualBalancesAsOf_(today);
  var b = valueAt_(today, units, series, manual, instruments);
  var principal = principalAsOf_(principalTimeline_(), today);

  var row = {
    date: today,
    total_jpy: Math.round(b.total),
    principal_jpy: Math.round(principal),
    gain_jpy: Math.round(b.fund - principal),
    rakuten_fund_jpy: Math.round(b.fund),
    rakuten_stock_jpy: Math.round(b.stock),
    crypto_jpy: Math.round(b.crypto),
    manual_jpy: Math.round(b.manual),
    estimated: b.unpriced > 0
  };

  var sh = sheet_(SHEETS.SNAPSHOTS);
  var rows = readRows_(SHEETS.SNAPSHOTS);
  var head = HEADERS.Snapshots;
  var vals = head.map(function (h) { return row[h]; });
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].date) === today) {
      sh.getRange(rows[i]._rowIndex, 1, 1, head.length).setValues([vals]);
      return row;
    }
  }
  appendRows_(SHEETS.SNAPSHOTS, [row]);
  return row;
}

/**
 * 全履歴のスナップショットを再構築する。
 *
 * 過去の投信口数は「現在の口数 − その日より後の買付口数」で正確に遡れる。
 * 株式・BTC・現金は履歴が無いので現在数量を横引きする（推定）。
 */
function rebuildSnapshots() {
  var instruments = loadInstruments_();
  var series = loadPriceSeries_();
  var currentUnits = loadHoldings_();
  var timeline = principalTimeline_();
  var earliestManual = earliestManualBalances_();

  var fundIds = {};
  instruments.forEach(function (i) { if (i.kind === 'fund') fundIds[i.id] = true; });

  // 投信の日付軸 = 基準価額が存在する日。
  var dateSet = {};
  Object.keys(series).forEach(function (id) {
    if (!fundIds[id]) return;
    series[id].forEach(function (p) { dateSet[p.date] = true; });
  });
  dateSet[todayStr_()] = true;
  var dates = Object.keys(dateSet).sort();
  if (!dates.length) return { snapshots: 0 };

  var buysByInst = [];
  readRows_(SHEETS.TRANSACTIONS).forEach(function (r) {
    if (String(r.type) !== 'buy') return;
    var u = Number(r.units) || 0;
    if (!u) return;
    buysByInst.push({ date: String(r.date), id: String(r.instrument_id), units: u });
  });

  // 手動残高はループの外で1度だけ読む（日付ごとにシートを読むと遅い）。
  var manualRows = readRows_(SHEETS.MANUAL).map(function (r) {
    return { date: String(r.date), account: String(r.account_id), balance: Number(r.balance_jpy) || 0 };
  }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  var out = dates.map(function (d) {
    var units = {};
    Object.keys(currentUnits).forEach(function (id) { units[id] = currentUnits[id]; });
    // その日より後に買った分を差し引くと、その日時点の口数になる。
    buysByInst.forEach(function (t) {
      if (t.date > d && units[t.id] !== undefined) units[t.id] -= t.units;
    });
    Object.keys(units).forEach(function (id) { if (units[id] < 0) units[id] = 0; });

    // 手動口座はその日以前の最新記録。無ければ最古の記録で横引き（推定扱い）。
    var asOf = {};
    for (var k = 0; k < manualRows.length; k++) {
      if (manualRows[k].date > d) break;
      asOf[manualRows[k].account] = { date: manualRows[k].date, balance: manualRows[k].balance };
    }
    var useManual = {};
    Object.keys(earliestManual).forEach(function (a) {
      useManual[a] = asOf[a] || earliestManual[a];
    });

    var b = valueAt_(d, units, series, useManual, instruments);
    var principal = principalAsOf_(timeline, d);
    var backfilled = !Object.keys(asOf).length && Object.keys(earliestManual).length > 0;

    return {
      date: d,
      total_jpy: Math.round(b.total),
      principal_jpy: Math.round(principal),
      gain_jpy: Math.round(b.fund - principal),
      rakuten_fund_jpy: Math.round(b.fund),
      rakuten_stock_jpy: Math.round(b.stock),
      crypto_jpy: Math.round(b.crypto),
      manual_jpy: Math.round(b.manual),
      estimated: b.unpriced > 0 || backfilled
    };
  });

  clearBody_(SHEETS.SNAPSHOTS);
  appendRows_(SHEETS.SNAPSHOTS, out);
  return { snapshots: out.length, from: dates[0], to: dates[dates.length - 1] };
}

function loadSnapshots_() {
  return readRows_(SHEETS.SNAPSHOTS).map(function (r) {
    return {
      date: String(r.date),
      total: Number(r.total_jpy) || 0,
      principal: Number(r.principal_jpy) || 0,
      gain: Number(r.gain_jpy) || 0,
      fund: Number(r.rakuten_fund_jpy) || 0,
      stock: Number(r.rakuten_stock_jpy) || 0,
      crypto: Number(r.crypto_jpy) || 0,
      manual: Number(r.manual_jpy) || 0,
      estimated: r.estimated === true || String(r.estimated).toUpperCase() === 'TRUE'
    };
  }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}
