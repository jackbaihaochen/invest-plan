import {
  type Entry, type Resolved, meanRecentNet, medianRecentNet, monthContribution, resolveEntries,
} from './contribution'
import {
  type Point, type ValuePoint, moneyWeightedReturn, principalSeries, valueSeries,
} from './growth'
import { parseSnapshot } from './holdings'
import { type Plan, goalDate, monthsBehindPlan, wholeMonthsToGoal } from './projection'
import { coverageEnd, monthlyNet, parseTransactions, totalNet } from './transactions'
import { type Repriced, type PriceRow, reprice } from './prices'
import type { Snapshot, Txn } from './types'
import { type CategoryTotal, categoryTotals, nisaUsage } from './valuation'

/**
 * 解析済みのデータ。モデルはここから組む。
 *
 * 生の CSV を受け取らないのは、第3段階で Sheet から来るのが行だからで、
 * その経路では CSV というものが存在しない。取り込み経路は datasetFromFiles が
 * 受け持ち、モデルは「どこから来たか」を知らない。
 */
export interface Dataset {
  snapshot: Snapshot | null
  txns: Txn[]
  entries: readonly Entry[]
  valuePoints: readonly ValuePoint[]
  /** 基準価額メールが積み上げた日次の価格。投資信託の評価額をこれで付け替える。 */
  prices: readonly PriceRow[]
  /** 解析に失敗したファイルの説明。握り潰さず画面に出す。 */
  problems: string[]
}

export const EMPTY_DATASET: Dataset = {
  snapshot: null, txns: [], entries: [], valuePoints: [], prices: [], problems: [],
}

/** 中身が何も無いか。「サーバは空か」を判断して移行の分岐に使う。 */
export const isEmptyDataset = (d: Dataset): boolean =>
  d.snapshot === null && d.txns.length === 0
  && d.entries.length === 0 && d.valuePoints.length === 0

export interface RawFiles {
  snapshot?: { name: string; text: string }
  historyJp?: { name: string; text: string }
  historyUs?: { name: string; text: string }
}

export interface Options {
  plan: Plan
  plannedMonthlyJpy: number
  ringTargetJpy: number | null
}

/** 楽天の CSV を解析して Dataset にする。失敗は problems に落とし、例外にしない。 */
export function datasetFromFiles(
  files: RawFiles, entries: readonly Entry[], valuePoints: readonly ValuePoint[],
): Dataset {
  const problems: string[] = []

  let snapshot: Snapshot | null = null
  if (files.snapshot) {
    try {
      snapshot = parseSnapshot(files.snapshot.text, files.snapshot.name)
    } catch (e) {
      problems.push(`保有商品 CSV を読めません: ${(e as Error).message}`)
    }
  }

  const txns: Txn[] = []
  for (const [source, file] of [['JP', files.historyJp], ['US', files.historyUs]] as const) {
    if (!file) continue
    try {
      txns.push(...parseTransactions(file.text, source))
    } catch (e) {
      problems.push(`${source} の取引履歴を読めません: ${(e as Error).message}`)
    }
  }

  return { snapshot, txns, entries, valuePoints, prices: [], problems }
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
  /** 基準価額での付け替えの結果。いつの値段で、どれだけが当日値かを画面に出す。 */
  repriced: Repriced | null
  /** その日の値段が付いていない割合。1 − repricedShare。 */
  staleShare: number
  nisa: { usedJpy: number; limitJpy: number; share: number }

  problems: string[]
}

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export function buildModel(data: Dataset, opts: Options, now = new Date()): Model {
  const { txns } = data
  const problems = [...data.problems]

  // 投資信託だけ、届いている中でいちばん新しい基準価額に付け替える。
  // 以降の計算はすべてこの付け替え後のスナップショットを見る —— 見出しの総資産と
  // グラフの最終点が別々の数字になるのを防ぐため。
  const repriced = reprice(data.snapshot, data.prices)
  const snapshot = repriced?.snapshot ?? data.snapshot

  const end = coverageEnd(txns)
  const resolved = resolveEntries(data.entries, txns, end)
  const monthly = monthlyNet(txns)

  const ym = ymOf(now)
  const month = monthContribution(ym, txns, resolved)
  const targetJpy = opts.ringTargetJpy ?? medianRecentNet(monthly)
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
  const atPaceMonths = wholeMonthsToGoal(opts.plan, totalAssetsJpy, recentPaceJpy)
  const atPlanMonths = wholeMonthsToGoal(opts.plan, totalAssetsJpy, opts.plannedMonthlyJpy)

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
    behindMonths: monthsBehindPlan(opts.plan, totalAssetsJpy, recentPaceJpy, opts.plannedMonthlyJpy),
    atPaceDate: goalDate(opts.plan, totalAssetsJpy, recentPaceJpy, now),
    atPlanDate: goalDate(opts.plan, totalAssetsJpy, opts.plannedMonthlyJpy, now),
    principal: principalSeries(txns),
    values: valueSeries(data.valuePoints, snapshot),
    mwr: snapshot ? moneyWeightedReturn(txns, snapshot.totalJpy, snapshot.asOf) : null,
    categories: snapshot ? categoryTotals(snapshot, repriced) : [],
    repriced,
    staleShare: repriced ? 1 - repriced.repricedShare : (snapshot ? 1 : 0),
    nisa: snapshot ? nisaUsage(snapshot) : { usedJpy: 0, limitJpy: 18_000_000, share: 0 },
    problems,
  }
}
