import { type Plan, monthsToGoal } from './projection'
import type { Txn } from './types'

export interface Point {
  on: string
  /** 横軸に使うミリ秒。日付の間隔が不揃いなので、順番ではなく時間で置く。 */
  t: number
  jpy: number
}

const at = (on: string, jpy: number): Point => ({ on, t: Date.parse(on), jpy })

/** 取り込んだ時点の総資産。過去の評価額はどの CSV にも無いので、今日から貯める。 */
export interface ValuePoint {
  on: string
  totalJpy: number
}

/**
 * 実測の資産曲線。取り込みのたびに1点ずつ伸びる。
 * 今のスナップショットは保存済みの点より優先する（取り込み直後はまだ保存前）。
 */
export function valueSeries(
  stored: readonly ValuePoint[], current: { asOf: string | null; totalJpy: number } | null,
): Point[] {
  const by = new Map(stored.map((p) => [p.on, p.totalJpy]))
  if (current && current.asOf !== null) by.set(current.asOf, current.totalJpy)
  return [...by]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([on, jpy]) => at(on, jpy))
}

/**
 * 累計投入の推移。外部との出入りだけを足していく。
 *
 * これは元本であって資産ではない。過去の評価額は CSV のどこにも無いので
 * 復元できない。線の名前を間違えると、2025年1月の資産が 616万だったと
 * 読ませてしまう。呼び出し側は必ず「投入」として出すこと。
 */
export function principalSeries(txns: readonly Txn[]): Point[] {
  const flows = txns
    .filter((t) => t.netJpy !== 0)
    .sort((a, b) => a.settledOn.localeCompare(b.settledOn))
  const out: Point[] = []
  let cum = 0
  for (const t of flows) {
    cum += t.netJpy
    const last = out[out.length - 1]
    // 同じ日に複数件あるなら最後の値だけ残す。線は日単位で十分。
    if (last && last.on === t.settledOn) out[out.length - 1] = at(t.settledOn, cum)
    else out.push(at(t.settledOn, cum))
  }
  return out
}

/**
 * これからの見通し。月末拠出で複利を回す。projection.ts の閉じた式と
 * 同じ前提で刻むので、線の終点と「到達は何年何月」が食い違わない。
 */
export function projectionSeries(
  plan: Plan, presentJpy: number, monthlyJpy: number, from: Date, maxMonths = 600,
): Point[] {
  const n = monthsToGoal(plan, presentJpy, monthlyJpy)
  const stop = Math.min(Number.isFinite(n) ? Math.ceil(n) : maxMonths, maxMonths)
  const r = plan.annualRate / 12
  const out: Point[] = []
  let v = presentJpy
  for (let i = 0; i <= stop; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1)
    out.push(at(d.toLocaleDateString('sv-SE'), v))
    v = v * (1 + r) + monthlyJpy
  }
  return out
}

/**
 * 目標日に間に合わせるのに必要な毎月の投入額。
 *
 *   PMT = (GOAL - PV(1+r)^n) * r / ((1+r)^n - 1)
 *
 * 「5年7ヶ月遅れている」だけでは手の打ちようがない。いくら入れれば
 * 追いつくのかは、この逆算でしか出ない。
 */
export function requiredMonthly(plan: Plan, presentJpy: number, months: number): number {
  if (months <= 0) return Infinity
  const r = plan.annualRate / 12
  if (r <= 0) return Math.max(0, (plan.goalJpy - presentJpy) / months)
  const g = Math.pow(1 + r, months)
  return Math.max(0, ((plan.goalJpy - presentJpy * g) * r) / (g - 1))
}

/**
 * 実績の年率（金額加重・XIRR）。外部との出入りと期末評価額だけで解く。
 * 口座内の売買と分配金は口座の中に留まるので、外部フローには数えない。
 *
 * asOf が無いときは null を返す。今日で代用すると、何ヶ月も前の評価額を
 * 今日の値として割り引くことになり、静かに間違った利回りが出る。
 */
export function moneyWeightedReturn(
  txns: readonly Txn[], terminalJpy: number, asOf: string | null,
): number | null {
  if (asOf === null) return null
  const flows = txns
    .filter((t) => t.netJpy !== 0 && t.settledOn <= asOf)
    .map((t) => ({ t: Date.parse(t.settledOn), amt: -t.netJpy }))
  if (flows.length === 0) return null
  flows.push({ t: Date.parse(asOf), amt: terminalJpy })

  const t0 = Math.min(...flows.map((f) => f.t))
  const years = (t: number) => (t - t0) / (365.25 * 864e5)
  const npv = (rate: number) => flows.reduce((a, f) => a + f.amt / Math.pow(1 + rate, years(f.t)), 0)

  let lo = -0.9999
  let hi = 10
  // 符号が変わらない組み合わせでは解が無い。端点を返すと嘘の利回りになる。
  if (npv(lo) < 0 || npv(hi) > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (npv(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
