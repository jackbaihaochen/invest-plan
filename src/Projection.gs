/**
 * 将来予測の計算。
 *
 * すべて月次複利。年利 r の月利は r/12 として扱う（一般的な積立シミュレータと同じ）。
 * ここは決定論的な計算のみ。確率的なファンチャートはブラウザ側で回す
 * （スライダー操作のたびに GAS を呼ぶと遅く、実行時間の割当も消費するため）。
 */

var MAX_PROJECTION_MONTHS = 1200; // 100年で打ち切り

/** n ヶ月後の資産額。毎月末に monthly を積み立てる前提。 */
function futureValue_(current, monthly, annualRate, months) {
  var r = annualRate / 12;
  var v = current;
  for (var i = 0; i < months; i++) v = v * (1 + r) + monthly;
  return v;
}

/**
 * 目標到達までの月数。到達しない場合は null。
 * 反復で解くのは monthly=0 や r=0 でも破綻しないため。
 */
function monthsToGoal_(current, monthly, annualRate, goal) {
  if (current >= goal) return 0;
  var r = annualRate / 12;
  var v = current;
  for (var m = 1; m <= MAX_PROJECTION_MONTHS; m++) {
    v = v * (1 + r) + monthly;
    if (v >= goal) return m;
  }
  return null;
}

/** n ヶ月で目標に届かせるのに必要な月次積立額。 */
function requiredMonthly_(current, annualRate, months, goal) {
  if (months <= 0) return null;
  var r = annualRate / 12;
  if (r === 0) return (goal - current) / months;
  var f = Math.pow(1 + r, months);
  var pmt = (goal - current * f) / ((f - 1) / r);
  return Math.max(0, pmt);
}

/**
 * Coast FIRE ライン。
 * 「今後1円も積み立てなくても、n ヶ月後に目標へ届く現在額」。
 */
function coastAmount_(annualRate, months, goal) {
  return goal / Math.pow(1 + annualRate / 12, months);
}

/** 月数を「N年Mヶ月」に整形する。 */
function humanMonths_(months) {
  if (months === null || months === undefined) return '到達しません';
  var y = Math.floor(months / 12), m = months % 12;
  if (y && m) return y + '年' + m + 'ヶ月';
  if (y) return y + '年';
  return m + 'ヶ月';
}

/** 今日から n ヶ月後の 'yyyy-MM' */
function etaMonthLabel_(months) {
  if (months === null || months === undefined) return '—';
  return addMonthsStr_(todayStr_(), months).slice(0, 7);
}

/** インフレ調整後の実質価値。 */
function realValue_(nominal, inflation, months) {
  return nominal / Math.pow(1 + inflation / 12, months);
}
