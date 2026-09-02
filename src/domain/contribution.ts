import type { Txn } from './types'

/** 手で記録した一回の投入。証券会社の記録が追いつくまでの仮の値。 */
export interface Entry {
  id: string
  /** 入金した日 YYYY-MM-DD。買った日ではなく金を移した日。 */
  on: string
  amountJpy: number
  note: string
  /** CSV と食い違うと分かったうえで無視すると決めたもの。 */
  dismissed?: boolean
}

export type EntryStatus =
  | 'pending'    // CSV がまだ届いていない期間 — 暫定値として数える
  | 'confirmed'  // CSV に対応する入金行があった — 以後は CSV の行を使い、これは数えない
  | 'unmatched'  // CSV が届いている期間なのに対応行がない — 数えず、赤く出す
  | 'dismissed'

export interface Resolved {
  entry: Entry
  status: EntryStatus
  /** confirmed のとき、対応した CSV 側の入金行。 */
  matched?: Txn
}

/** 受渡日は入金日と数日ずれることがある。この幅で対応行を探す。 */
const MATCH_WINDOW_DAYS = 5

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

/**
 * 手動記録と CSV を突き合わせる。**足し算はしない。**
 *
 * CSV にはすでに全ての入金が入っている。手動記録は CSV が追いつくまでの
 * 仮置きであって、二つ目のデータ源ではない。だから境目 (coverageEnd) で切り、
 * 手前は CSV、その先は手動記録を使う。
 */
export function resolveEntries(
  entries: readonly Entry[],
  txns: readonly Txn[],
  coverageEnd: string | null,
): Resolved[] {
  const inflows = txns.filter((t) => t.flow === 'inflow')
  const claimed = new Set<Txn>()

  return entries.map((entry) => {
    if (entry.dismissed) return { entry, status: 'dismissed' as const }
    if (coverageEnd === null || entry.on > coverageEnd) {
      return { entry, status: 'pending' as const }
    }
    // 金額が一致し、受渡日が近い行。積立の定期入金と取り違えないよう日付の近い順。
    const match = inflows
      .filter((t) => !claimed.has(t))
      .filter((t) => t.receivedJpy === entry.amountJpy)
      .filter((t) => daysApart(t.settledOn, entry.on) <= MATCH_WINDOW_DAYS)
      .sort((a, b) => daysApart(a.settledOn, entry.on) - daysApart(b.settledOn, entry.on))[0]
    if (match) {
      claimed.add(match)
      return { entry, status: 'confirmed' as const, matched: match }
    }
    return { entry, status: 'unmatched' as const }
  })
}

/**
 * その月の投入額。CSV が押さえている範囲は CSV、その先だけ手動記録。
 *
 *   Σ(CSV の入金/出金, 当月かつ coverageEnd まで)
 * + Σ(手動記録, 当月かつ coverageEnd より後)
 */
export function monthContribution(
  ym: string,
  txns: readonly Txn[],
  resolved: readonly Resolved[],
): { totalJpy: number; confirmedJpy: number; pendingJpy: number } {
  const confirmedJpy = txns
    .filter((t) => t.settledOn.startsWith(ym))
    .reduce((sum, t) => sum + t.netJpy, 0)
  const pendingJpy = resolved
    .filter((r) => r.status === 'pending' && r.entry.on.startsWith(ym))
    .reduce((sum, r) => sum + r.entry.amountJpy, 0)
  return { totalJpy: confirmedJpy + pendingJpy, confirmedJpy, pendingJpy }
}

/**
 * 直近 n ヶ月の純入金の平均。到達日の見通しに使う。
 * 実際に積み上がった速度そのものなので、突出した月も含める。
 */
export function meanRecentNet(monthly: ReadonlyMap<string, number>, n = 6): number {
  const recent = [...monthly.values()].slice(-n)
  if (recent.length === 0) return 0
  return recent.reduce((a, b) => a + b, 0) / recent.length
}

/**
 * 直近 n ヶ月の純入金の中央値。環の目標に使う。
 *
 * 見通しに平均、環に中央値と使い分けるのは、問いが違うから。
 * 見通しは「実際どれだけ積み上がっているか」、環は「今月勝てる目標はどこか」。
 * 環に最高の月を置くと大半の月で負けて、赤いだけの棒になる。
 */
export function medianRecentNet(monthly: ReadonlyMap<string, number>, n = 6): number {
  const recent = [...monthly.values()].slice(-n).sort((a, b) => a - b)
  if (recent.length === 0) return 0
  const mid = recent.length / 2
  return recent.length % 2 === 1
    ? recent[Math.floor(mid)]!
    : (recent[mid - 1]! + recent[mid]!) / 2
}
