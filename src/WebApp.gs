/**
 * Web アプリのエントリポイント。
 *
 * デプロイ設定は必ず「次のユーザーとして実行: 自分」＋「アクセスできるユーザー: 自分のみ」。
 * 資産額を URL を知っただけの他人に見せないため。
 */

function doGet() {
  return HtmlService.createTemplateFromFile('ui/index')
    .evaluate()
    .setTitle('1億円プロジェクト')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ------------------------------------------------------- クライアント向け API

/** ダッシュボードが必要とするデータを一度にまとめて返す。 */
function getDashboard() {
  var c = computeCoaching();
  var snaps = loadSnapshots_();

  // 描画点が多すぎても読めないので、直近2年ぶんに絞る。
  var cutoff = addMonthsStr_(todayStr_(), -24);
  var series = snaps.filter(function (s) { return s.date >= cutoff; });

  var byMonth = c.byMonth;
  var months = Object.keys(byMonth).sort();
  var contribSeries = months.slice(-18).map(function (m) {
    return { month: m, amount: byMonth[m] };
  });

  delete c.byMonth;
  return {
    coaching: c,
    series: series.map(function (s) {
      return { date: s.date, total: s.total, principal: s.principal, estimated: s.estimated };
    }),
    breakdown: [
      { key: 'fund', label: '楽天証券 投資信託', value: c.fund },
      { key: 'stock', label: '楽天証券 株式', value: c.stock },
      { key: 'crypto', label: 'bitFlyer', value: c.crypto },
      { key: 'manual', label: '手動口座（持株会・ゆうちょ）', value: c.manualTotal }
    ].filter(function (b) { return b.value > 0; }),
    contributions: contribSeries,
    accounts: c.manualAccounts
  };
}

function saveManualBalance(accountId, balance, note) {
  setManualBalance(accountId, balance, note);
  return getDashboard();
}

function saveContribution(dateStr, accountId, amount, note) {
  logContribution(dateStr, accountId, amount, note);
  rebuildSnapshots();
  return getDashboard();
}

function uploadHoldingsCsv(csvText) {
  var result = importHoldingsCsv(csvText);
  return { result: result, dashboard: getDashboard() };
}

/** 画面の「今すぐ更新」ボタン。 */
function refreshNow() {
  dailyIngest();
  return getDashboard();
}
