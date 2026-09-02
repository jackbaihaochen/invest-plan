import { describe, expect, it } from 'vitest'
import { parseSnapshot } from '../src/domain/holdings'
import { categoryTotals, nisaUsage, staleShare } from '../src/domain/valuation'
import { SNAPSHOT_FILE, snapshotCsv } from './fixtures'

const snap = parseSnapshot(snapshotCsv(), SNAPSHOT_FILE)

describe('分類の集計', () => {
  it('種別ごとの時価が CSV の合計段と一致する', () => {
    const by = Object.fromEntries(categoryTotals(snap).map((c) => [c.kind, c.marketValueJpy]))
    expect(by['投資信託']).toBe(4_680_000)
    expect(by['米国株式']).toBe(408_000) // 合計段は 408,006、明細の丸めで 6 円差
    expect(by['金・プラチナ']).toBe(950_000)
    expect(by['国内株式']).toBe(316_000)
    expect(by['外貨建MMF']).toBe(5_240)
  })

  it('日次で追えない割合は 19.9%（金 14.9% + 国内株 5.0%）', () => {
    expect(staleShare(snap)).toBeCloseTo(0.199, 3)
  })

  it('NISA 枠は取得価額で数える — 時価で数えると3割過大になる', () => {
    const nisa = nisaUsage(snap)
    expect(nisa.usedJpy).toBe(3_859_000)
    expect(nisa.share).toBeCloseTo(0.214, 3)

    const atMarket = snap.positions
      .filter((p) => p.account.startsWith('NISA'))
      .reduce((a, p) => a + p.marketValueJpy, 0)
    expect(atMarket).toBe(5_041_000)
    expect(atMarket / nisa.usedJpy).toBeGreaterThan(1.3)
  })
})
