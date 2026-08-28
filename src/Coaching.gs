/**
 * 監督ロジック。
 *
 * 中心となる指標は「実際のペースでの到達予定」と「目標ペースでの到達予定」の差。
 * 進捗率よりも、この“遅れ年数”のほうが行動を変える力が強い。
 */

/** 月次の投入額 {'yyyy-MM': 円}。投信の積立に加え、手入力の拠出も含む。 */
function contributionsByMonth_() {
  var byMonth = {};
  readRows_(SHEETS.TRANSACTIONS).forEach(function (r) {
    if (String(r.type) !== 'buy') return;
    var k = monthKey_(r.date);
    byMonth[k] = (byMonth[k] || 0) + (Number(r.amount_jpy) || 0);
  });
  return byMonth;
}

/**
 * メールに出てこない投入（個別株の買付、持株会の拠出など）を記録する。
 * instrument_id を空にすることで、口数計算には影響せず投入額だけに効く。
 */
function logContribution(dateStr, accountId, amount, note) {
  var amt = Number(amount);
  if (!amt || isNaN(amt)) throw new Error('金額を指定してください。');
  appendRows_(SHEETS.TRANSACTIONS, [{
    date: dateStr || todayStr_(),
    account_id: accountId || 'rakuten',
    instrument_id: '',
    type: 'buy',
    amount_jpy: Math.round(amt),
    units: '',
    nisa_bucket: '',
    gmail_message_id: 'manual:' + Utilities.getUuid(),
    raw_subject: note || '手入力の投入'
  }]);
  return { date: dateStr || todayStr_(), amount: Math.round(amt) };
}

function prevMonthKey_(key, back) {
  var p = key.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1 - back, 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

/**
 * 直近 n ヶ月（当月を除く完了済みの月）の平均投入額。
 * 当月を含めると月初は必ず「ペースが落ちた」と誤判定するため除外する。
 */
function trailingAverage_(byMonth, months) {
  var cur = monthKey_(todayStr_());
  var sum = 0;
  for (var i = 1; i <= months; i++) sum += byMonth[prevMonthKey_(cur, i)] || 0;
  return sum / months;
}

/** 目標達成が続いている月数（当月を除く直近の完了月から遡る）。 */
function streak_(byMonth, target) {
  var cur = monthKey_(todayStr_());
  var n = 0;
  for (var i = 1; i <= 240; i++) {
    var k = prevMonthKey_(cur, i);
    if ((byMonth[k] || 0) >= target) n++; else break;
  }
  return n;
}

function milestones_(total, goal) {
  return [20000000, 30000000, 50000000, 75000000, goal].map(function (m) {
    return { amount: m, reached: total >= m, label: (m / 10000).toLocaleString('ja-JP') + '万円' };
  });
}

function nisaUsage_() {
  var used = { つみたて投資枠: 0, 成長投資枠: 0, その他: 0 };
  readRows_(SHEETS.TRANSACTIONS).forEach(function (r) {
    if (String(r.type) !== 'buy') return;
    var b = String(r.nisa_bucket || '');
    var amt = Number(r.amount_jpy) || 0;
    if (b.indexOf('つみたて') !== -1) used['つみたて投資枠'] += amt;
    else if (b.indexOf('成長') !== -1) used['成長投資枠'] += amt;
    else used['その他'] += amt;
  });
  return used;
}

/**
 * ダッシュボードとメールが使う指標一式。
 */
function computeCoaching() {
  var cfg = getSettings_();
  var snaps = loadSnapshots_();
  var latest = snaps.length ? snaps[snaps.length - 1] : null;
  var total = latest ? latest.total : 0;

  var byMonth = contributionsByMonth_();
  var curKey = monthKey_(todayStr_());
  var thisMonth = byMonth[curKey] || 0;
  var pace = trailingAverage_(byMonth, 6);

  var targetEta = monthsToGoal_(total, cfg.monthlyTarget, cfg.expectedReturn, cfg.goal);
  var paceEta = monthsToGoal_(total, pace, cfg.expectedReturn, cfg.goal);
  var delay = (paceEta === null || targetEta === null) ? null : paceEta - targetEta;

  // 目標期日は「40万円/月なら到達する時期」を基準にする。
  var horizon = targetEta || 120;

  var prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  var monthAgo = null;
  for (var i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].date <= addMonthsStr_(todayStr_(), -1)) { monthAgo = snaps[i]; break; }
  }

  return {
    asOf: latest ? latest.date : todayStr_(),
    goal: cfg.goal,
    total: total,
    pct: cfg.goal ? (total / cfg.goal) * 100 : 0,
    remaining: Math.max(0, cfg.goal - total),

    fund: latest ? latest.fund : 0,
    stock: latest ? latest.stock : 0,
    crypto: latest ? latest.crypto : 0,
    manualTotal: latest ? latest.manual : 0,
    principal: latest ? latest.principal : 0,
    gain: latest ? latest.gain : 0,
    gainPct: latest && latest.principal ? (latest.gain / latest.principal) * 100 : 0,
    estimated: latest ? latest.estimated : false,

    changeDay: prev ? total - prev.total : 0,
    changeMonth: monthAgo ? total - monthAgo.total : 0,

    monthlyTarget: cfg.monthlyTarget,
    thisMonth: thisMonth,
    thisMonthPct: cfg.monthlyTarget ? (thisMonth / cfg.monthlyTarget) * 100 : 0,
    thisMonthShort: Math.max(0, cfg.monthlyTarget - thisMonth),
    pace: pace,
    streak: streak_(byMonth, cfg.monthlyTarget),

    targetEtaMonths: targetEta,
    targetEtaLabel: etaMonthLabel_(targetEta),
    targetEtaHuman: humanMonths_(targetEta),
    paceEtaMonths: paceEta,
    paceEtaLabel: etaMonthLabel_(paceEta),
    paceEtaHuman: humanMonths_(paceEta),
    delayMonths: delay,
    delayHuman: delay === null ? '—' : humanMonths_(Math.abs(delay)),
    delayDirection: delay === null ? 'unknown' : (delay > 0 ? 'behind' : (delay < 0 ? 'ahead' : 'on_track')),

    requiredMonthly: requiredMonthly_(total, cfg.expectedReturn, horizon, cfg.goal),
    coastAmount: coastAmount_(cfg.expectedReturn, horizon, cfg.goal),
    coastReached: total >= coastAmount_(cfg.expectedReturn, horizon, cfg.goal),

    goalRealValue: realValue_(cfg.goal, cfg.inflation, horizon),
    inflation: cfg.inflation,
    taxRate: cfg.taxRate,
    nisa: nisaUsage_(),
    nisaCap: cfg.nisaLifetimeCap,

    milestones: milestones_(total, cfg.goal),
    manualAccounts: manualFreshness_(),
    expectedReturn: cfg.expectedReturn,
    volatility: cfg.volatility,
    byMonth: byMonth
  };
}
