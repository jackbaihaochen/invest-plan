import { describe, expect, it } from 'vitest'
import { parseSnapshot } from '../src/domain/holdings'
import { SNAPSHOT_FILE, snapshotCsv } from './fixtures'

const snap = parseSnapshot(snapshotCsv(), SNAPSHOT_FILE)
const sum = (f: (p: (typeof snap.positions)[number]) => number) =>
  snap.positions.reduce((a, p) => a + f(p), 0)

describe('保有商品詳細の取り込み', () => {
  it('CP932 のまま読めて 26 ポジションになる', () => {
    expect(snap.positions).toHaveLength(26)
    expect(snap.asOf).toBe('2026-08-29')
  })

  it('評価損益は CSV 記載の合計と完全に一致する', () => {
    // ここがずれたら列の対応がずれている。丸め誤差の逃げ道を作らない。
    expect(sum((p) => p.gainJpy)).toBe(***)
  })

  it('時価と預り金の合計が資産合計に一致する（米株行の丸めぶんだけ差が出る）', () => {
    expect(sum((p) => p.marketValueJpy)).toBe(***)
    expect(snap.cashJpy).toBe(***)
    expect(snap.totalJpy).toBe(***)
    expect(sum((p) => p.marketValueJpy) + snap.cashJpy - snap.totalJpy).toBe(-6)
  })

  it('取得原価は 時価 − 評価損益 で出す（種別ごとに掛け目が違うので推定しない）', () => {
    // 掛け目を推定した実装は外貨建MMF で *** のところ 4,900 万を出した。
    const mmf = snap.positions.find((p) => p.kind === '外貨建MMF')
    expect(mmf?.costJpy).toBe(***)
    const nisa = snap.positions.filter((p) => p.account.startsWith('NISA'))
    expect(nisa.reduce((a, p) => a + p.costJpy, 0)).toBe(***)
  })

  it('ヘッダの単位列の重複に潰されず、数量と価格の単位を別々に取る', () => {
    const gold = snap.positions.find((p) => p.kind === '金・プラチナ')
    expect(gold?.quantity).toBeCloseTo(***, 5)
    expect(gold?.quantityUnit).toBe('g')
    expect(gold?.priceUnit).toBe('円')
    const usd = snap.positions.find((p) => p.ticker === 'NVDA')
    expect(usd?.quantityUnit).toBe('株')
    expect(usd?.priceUnit).toBe('USD')
  })

  it('銘柄と口座の組は一意ではない — 同じファンドが同じ枠に2ロットある', () => {
    const key = (p: { name: string; account: string }) => `${p.name} ${p.account}`
    const counts = new Map<string, number>()
    for (const p of snap.positions) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1)
    expect([...counts.values()].filter((n) => n > 1)).toEqual([2])
  })

  it('参考為替レートを拾う', () => {
    expect(snap.fx['米ドル']).toBe(160.06)
  })
})
