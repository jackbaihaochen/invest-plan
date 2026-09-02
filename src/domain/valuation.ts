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
 * 日次で価格を追える種別。
 * 投資信託は基準価額メール、米国株は GOOGLEFINANCE、MMF は為替。
 * 金・プラチナは情報源がなく、国内株は TYO: が実測で空を返すので、
 * どちらも最後に取れた価格のまま据え置く。
 */
const LIVE_PRICE_KINDS = new Set(['投資信託', '米国株式', '外貨建MMF'])

export function categoryTotals(snap: Snapshot): CategoryTotal[] {
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
      livePrice: LIVE_PRICE_KINDS.has(kind),
    }))
    .sort((a, b) => b.marketValueJpy - a.marketValueJpy)
}

/** 価格を日次で追えない部分の割合。画面に「うち X% は N月N日時点」と出すため。 */
export function staleShare(snap: Snapshot): number {
  return categoryTotals(snap).filter((c) => !c.livePrice).reduce((a, c) => a + c.share, 0)
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
