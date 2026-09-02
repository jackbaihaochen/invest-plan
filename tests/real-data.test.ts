import { describe, expect, it } from 'vitest'
import { at, parseCsv, toAmount } from '../src/domain/csv'
import { parseSnapshot } from '../src/domain/holdings'
import { coverageEnd, parseTransactions, totalNet } from '../src/domain/transactions'
import {
  SNAPSHOT_FILE, hasRealFiles, realJpHistoryCsv, realSnapshotCsv, realUsHistoryCsv,
} from './fixtures'

/**
 * 本物の CSV が `rakuten-private/` にあるときだけ走る。**期待値をここに書かない**
 * —— 書いたら本物の残高がリポジトリに入る。代わりに、ファイルが自分で名乗っている
 * 合計と、解析結果を突き合わせる。券商が書式を変えたらこれが落ちる。
 */
describe.skipIf(!hasRealFiles())('本物の CSV（コミットしない）', () => {
  it('明細の評価損益の合計が、ファイル自身が書いている合計と一致する', () => {
    const snap = parseSnapshot(realSnapshotCsv(), SNAPSHOT_FILE)
    const rows = parseCsv(realSnapshotCsv())
    const total = rows.find((r) => at(r, 0) === '資産合計')
    expect(total).toBeDefined()
    const stated = toAmount(at(total!, 6)) // 評価損益[円]
    expect(snap.positions.reduce((a, p) => a + p.gainJpy, 0)).toBe(stated)
  })

  it('時価と預り金の合計が資産合計とほぼ一致する（外貨行の丸めぶんだけ）', () => {
    const snap = parseSnapshot(realSnapshotCsv(), SNAPSHOT_FILE)
    const sum = snap.positions.reduce((a, p) => a + p.marketValueJpy, 0)
    expect(Math.abs(sum + snap.cashJpy - snap.totalJpy)).toBeLessThan(100)
    expect(snap.positions.length).toBeGreaterThan(0)
    expect(snap.asOf).toBe('2026-08-29')
  })

  it('全行の取引区分が分類済み（未知の区分があれば投げて落ちる）', () => {
    const jp = parseTransactions(realJpHistoryCsv(), 'JP')
    const us = parseTransactions(realUsHistoryCsv(), 'US')
    expect(jp.length).toBeGreaterThan(0)
    expect(us.length).toBeGreaterThan(0)
    // 外貨ファイルは外部との出入りを持たない。列順を取り違えるとここが崩れる。
    expect(totalNet(us)).toBe(0)
    expect(coverageEnd([...jp, ...us])).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
