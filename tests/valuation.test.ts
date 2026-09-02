import { describe, expect, it } from 'vitest'
import { parseSnapshot } from '../src/domain/holdings'
import { categoryTotals, nisaUsage, staleShare } from '../src/domain/valuation'
import { SNAPSHOT_FILE, snapshotCsv } from './fixtures'

const snap = parseSnapshot(snapshotCsv(), SNAPSHOT_FILE)

describe('分類の集計', () => {
  it('種別ごとの時価が CSV の合計段と一致する', () => {
    const by = Object.fromEntries(categoryTotals(snap).map((c) => [c.kind, c.marketValueJpy]))
    expect(by['投資信託']).toBe(***)
    expect(by['米国株式']).toBe(***) // 合計段は ***、明細の丸めで 6 円差
    expect(by['金・プラチナ']).toBe(***)
    expect(by['国内株式']).toBe(***)
    expect(by['外貨建MMF']).toBe(***)
  })

  it('日次で追えない割合は 15.4%（金 13.0% + 国内株 2.4%）', () => {
    expect(staleShare(snap)).toBeCloseTo(0.154, 3)
  })

  it('NISA 枠は取得価額で数える — 時価で数えると3割過大になる', () => {
    const nisa = nisaUsage(snap)
    expect(nisa.usedJpy).toBe(***)
    expect(nisa.share).toBeCloseTo(0.438, 3)

    const atMarket = snap.positions
      .filter((p) => p.account.startsWith('NISA'))
      .reduce((a, p) => a + p.marketValueJpy, 0)
    expect(atMarket).toBe(***)
    expect(atMarket / nisa.usedJpy).toBeGreaterThan(1.3)
  })
})
