import {
  type Entry, type Resolved, meanRecentNet, medianRecentNet, monthContribution, resolveEntries,
} from './contribution'
import {
  type Point, type ValuePoint, moneyWeightedReturn, principalSeries, valueSeries,
} from './growth'
import { parseSnapshot } from './holdings'
import { type Plan, goalDate, monthsBehindPlan, wholeMonthsToGoal } from './projection'
import { coverageEnd, monthlyNet, parseTransactions, totalNet } from './transactions'
import type { Snapshot, Txn } from './types'
import { type CategoryTotal, categoryTotals, nisaUsage, staleShare } from './valuation'

export interface Sources {
  snapshot?: { name: string; text: string }
  historyJp?: { name: string; text: string }
  historyUs?: { name: string; text: string }
  entries: readonly Entry[]
  valuePoints: readonly ValuePoint[]
  plan: Plan
  plannedMonthlyJpy: number
  ringTargetJpy: number | null
}

export interface Model {
  snapshot: Snapshot | null
  txns: Txn[]
  /** 取引履歴が事実として押さえている最終日。手動記録との継ぎ目。 */
  coverageEnd: string | null
  resolved: Resolved[]
  monthly: Map<string, number>

  thisMonth: {
    ym: string
    totalJpy: number
    confirmedJpy: number
    pendingJpy: number
    targetJpy: number
    remainingJpy: number
    daysLeft: number
  }

  totalAssetsJpy: number
  netInflowJpy: number
  /** 総資産 − 累計純入金。実現益と配当を含むので、含み益とは別物。 */
  totalReturnJpy: number
  /** CSV の評価損益。まだ売っていない分だけ。 */
  unrealizedJpy: number

  /** 直近6ヶ月の純入金の平均。到達日の見通しに使う。 */
  recentPaceJpy: number
  atPaceMonths: number
  atPlanMonths: number
  behindMonths: number
  atPaceDate: { year: number; month: number } | null
  atPlanDate: { year: number; month: number } | null

  /** 累計投入の推移。元本であって資産ではない。 */
  principal: Point[]
  /** 実測の資産。取り込んだ回数ぶんしか点が無い。 */
  values: Point[]
  /** 実績の年率（金額加重）。評価日が不明なら null。 */
  mwr: number | null

  categories: CategoryTotal[]
  staleShare: number
  nisa: { usedJpy: number; limitJpy: number; share: number }

  problems: string[]
}

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export function buildModel(src: Sources, now = new Date()): Model {
  const problems: string[] = []

  let snapshot: Snapshot | null = null
  if (src.snapshot) {
    try {
      snapshot = parseSnapshot(src.snapshot.text, src.snapshot.name)
    } catch (e) {
      problems.push(`保有商品 CSV を読めません: ${(e as Error).message}`)
    }
  }

  const txns: Txn[] = []
  for (const [source, file] of [['JP', src.historyJp], ['US', src.historyUs]] as const) {
    if (!file) continue
    try {
      txns.push(...parseTransactions(file.text, source))
    } catch (e) {
      problems.push(`${source} の取引履歴を読めません: ${(e as Error).message}`)
    }
  }

  const end = coverageEnd(txns)
  const resolved = resolveEntries(src.entries, txns, end)
  const monthly = monthlyNet(txns)

  const ym = ymOf(now)
  const month = monthContribution(ym, txns, resolved)
  const targetJpy = src.ringTargetJpy ?? medianRecentNet(monthly)
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate()

  // 資産の締めはスナップショットの日付。取引履歴の締めとは別で、
  // スナップショットより後の入金はまだ評価額に入っていないので足す。
  const assetsAsOf = snapshot?.asOf ?? null
  const addedSinceSnapshot = resolved
    .filter((r) => r.status === 'pending' && (assetsAsOf === null || r.entry.on > assetsAsOf))
    .reduce((a, r) => a + r.entry.amountJpy, 0)

  const totalAssetsJpy = (snapshot?.totalJpy ?? 0) + addedSinceSnapshot
  const netInflowJpy = totalNet(txns) + month.pendingJpy
  const unrealizedJpy = snapshot?.positions.reduce((a, p) => a + p.gainJpy, 0) ?? 0

  // 見通しは実際に積み上がった速度（平均）、環は勝てる目標（中央値）。別の問い。
  const recentPaceJpy = meanRecentNet(monthly)
  const atPaceMonths = wholeMonthsToGoal(src.plan, totalAssetsJpy, recentPaceJpy)
  const atPlanMonths = wholeMonthsToGoal(src.plan, totalAssetsJpy, src.plannedMonthlyJpy)

  return {
    snapshot, txns, coverageEnd: end, resolved, monthly,
    thisMonth: {
      ym, ...month, targetJpy,
      remainingJpy: Math.max(0, targetJpy - month.totalJpy),
      daysLeft,
    },
    totalAssetsJpy,
    netInflowJpy,
    totalReturnJpy: totalAssetsJpy - netInflowJpy,
    unrealizedJpy,
    recentPaceJpy,
    atPaceMonths,
    atPlanMonths,
    behindMonths: monthsBehindPlan(src.plan, totalAssetsJpy, recentPaceJpy, src.plannedMonthlyJpy),
    atPaceDate: goalDate(src.plan, totalAssetsJpy, recentPaceJpy, now),
    atPlanDate: goalDate(src.plan, totalAssetsJpy, src.plannedMonthlyJpy, now),
    principal: principalSeries(txns),
    values: valueSeries(src.valuePoints, snapshot),
    mwr: snapshot ? moneyWeightedReturn(txns, snapshot.totalJpy, snapshot.asOf) : null,
    categories: snapshot ? categoryTotals(snapshot) : [],
    staleShare: snapshot ? staleShare(snapshot) : 0,
    nisa: snapshot ? nisaUsage(snapshot) : { usedJpy: 0, limitJpy: 18_000_000, share: 0 },
    problems,
  }
}
