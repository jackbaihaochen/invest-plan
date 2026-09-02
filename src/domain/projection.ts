/**
 * 1億円に届くまでの見通し。
 *
 * 複利は「月利 = 年率/12、拠出は期末」で通す。閉じた式を使うのは
 * 「あと何ヶ月」を連続量として出すため —— 追加投入が到達日を何日縮めるかは
 * 月単位の刻みでは出せない。表示するときだけ月に切り上げる。
 *
 *   PV(1+r)^n + PMT((1+r)^n − 1)/r = GOAL
 *   n = ln((GOAL + PMT/r) / (PV + PMT/r)) / ln(1+r)
 */
export interface Plan {
  goalJpy: number
  annualRate: number
}

/** 到達までの月数（小数）。届かない組み合わせでは Infinity。 */
export function monthsToGoal(plan: Plan, presentJpy: number, monthlyJpy: number): number {
  if (presentJpy >= plan.goalJpy) return 0
  const r = plan.annualRate / 12
  if (r <= 0) {
    return monthlyJpy <= 0 ? Infinity : (plan.goalJpy - presentJpy) / monthlyJpy
  }
  const base = presentJpy + monthlyJpy / r
  if (base <= 0) return Infinity
  return Math.log((plan.goalJpy + monthlyJpy / r) / base) / Math.log(1 + r)
}

/** 表示用に切り上げた月数。124.7ヶ月 → 125ヶ月 = 10年5ヶ月。 */
export function wholeMonthsToGoal(plan: Plan, presentJpy: number, monthlyJpy: number): number {
  const n = monthsToGoal(plan, presentJpy, monthlyJpy)
  return Number.isFinite(n) ? Math.ceil(n) : Infinity
}

/** 到達年月。from は基準日（既定は今日）。 */
export function goalDate(
  plan: Plan, presentJpy: number, monthlyJpy: number, from = new Date(),
): { year: number; month: number } | null {
  const n = wholeMonthsToGoal(plan, presentJpy, monthlyJpy)
  if (!Number.isFinite(n)) return null
  const d = new Date(from.getFullYear(), from.getMonth() + n, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

const DAYS_PER_MONTH = 365.25 / 12

/**
 * 追加で extraJpy を一度だけ入れると到達日が何日早まるか。
 *
 * この数字が仕組みの要。基準ペースが低いほど1回の追加が効くので、
 * 環の目標を現実的な値に置くほど手を動かす動機が強くなる。
 */
export function daysSooner(
  plan: Plan, presentJpy: number, monthlyJpy: number, extraJpy: number,
): number {
  const before = monthsToGoal(plan, presentJpy, monthlyJpy)
  const after = monthsToGoal(plan, presentJpy + extraJpy, monthlyJpy)
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0
  return (before - after) * DAYS_PER_MONTH
}

/** 「16年1ヶ月」の組み立て。 */
export function splitMonths(months: number): { years: number; months: number } {
  if (!Number.isFinite(months)) return { years: Infinity, months: 0 }
  return { years: Math.floor(months / 12), months: Math.round(months % 12) }
}

/**
 * 計画どおりの到達日に対して、実績ペースだと何ヶ月遅れているか。
 * 先頭に出す数字はこれ —— 進捗バーではなく「どれだけ遅れているか」。
 */
export function monthsBehindPlan(
  plan: Plan, presentJpy: number, actualMonthlyJpy: number, plannedMonthlyJpy: number,
): number {
  const actual = wholeMonthsToGoal(plan, presentJpy, actualMonthlyJpy)
  const planned = wholeMonthsToGoal(plan, presentJpy, plannedMonthlyJpy)
  if (!Number.isFinite(actual) || !Number.isFinite(planned)) return Infinity
  return actual - planned
}
