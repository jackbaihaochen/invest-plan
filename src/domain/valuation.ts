import { type Repriced, normalizeFund } from './prices'
import type { Position, Snapshot } from './types'

export interface CategoryTotal {
  kind: string
  marketValueJpy: number
  costJpy: number
  share: number
  /** この種別の価格を日次で追えるか。追えないものは時点を明示する。 */
  livePrice: boolean
}

/**
 * 「この種別は日次で追える」という固定の一覧は持たない。
 *
 * 以前は 投資信託・米国株式・外貨建MMF を live と決め打ちしていたが、実装されたのは
 * 投資信託の基準価額メールだけで、米国株と MMF には値段を取る仕組みが無い。
 * **持っていない鮮度を画面が主張していた** —— ファイル名から日付を読めないときに
 * 今日へ倒していたのと同じ種類の嘘。実際に付け替えたかどうかだけを見る。
 */
export function categoryTotals(snap: Snapshot, repriced?: Repriced | null): CategoryTotal[] {
  const fresh = new Set(
    repriced?.pricedOn
      ? snap.positions
        .filter((p) => p.kind === '投資信託'
          && !repriced.missing.includes(p.name)
          && !repriced.ambiguous.some((a) => normalizeFund(a) === normalizeFund(p.name)))
        .map((p) => p.kind)
      : [],
  )
  const by = new Map<string, { marketValueJpy: number; costJpy: number }>()
  for (const p of snap.positions) {
    const t = by.get(p.kind) ?? { marketValueJpy: 0, costJpy: 0 }
    t.marketValueJpy += p.marketValueJpy
    t.costJpy += p.costJpy
    by.set(p.kind, t)
  }
  const total = [...by.values()].reduce((a, t) => a + t.marketValueJpy, 0)
  return [...by]
    .map(([kind, t]) => ({
      kind,
      ...t,
      share: total === 0 ? 0 : t.marketValueJpy / total,
      livePrice: fresh.has(kind),
    }))
    .sort((a, b) => b.marketValueJpy - a.marketValueJpy)
}

export const NISA_LIFETIME_LIMIT = 18_000_000

/** NISA 生涯投資枠は取得価額で消費される。時価で見ると3割ほど過大に出る。 */
export function nisaUsage(snap: Snapshot): { usedJpy: number; limitJpy: number; share: number } {
  const usedJpy = snap.positions
    .filter((p) => p.account.startsWith('NISA'))
    .reduce((a, p) => a + p.costJpy, 0)
  return { usedJpy, limitJpy: NISA_LIFETIME_LIMIT, share: usedJpy / NISA_LIFETIME_LIMIT }
}

export function accountTotals(snap: Snapshot): { account: string; marketValueJpy: number }[] {
  const by = new Map<string, number>()
  for (const p of snap.positions) {
    by.set(p.account, (by.get(p.account) ?? 0) + p.marketValueJpy)
  }
  return [...by]
    .map(([account, marketValueJpy]) => ({ account, marketValueJpy }))
    .sort((a, b) => b.marketValueJpy - a.marketValueJpy)
}

export function positionsSorted(snap: Snapshot): Position[] {
  return [...snap.positions].sort((a, b) => b.marketValueJpy - a.marketValueJpy)
}
