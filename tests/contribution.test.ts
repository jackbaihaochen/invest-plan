import { describe, expect, it } from 'vitest'
import {
  type Entry,
  meanRecentNet,
  medianRecentNet,
  monthContribution,
  resolveEntries,
} from '../src/domain/contribution'
import { coverageEnd, monthlyNet, parseTransactions, totalNet } from '../src/domain/transactions'
import { jpHistoryCsv, usHistoryCsv } from './fixtures'

const txns = [...parseTransactions(jpHistoryCsv(), 'JP'), ...parseTransactions(usHistoryCsv(), 'US')]
const end = coverageEnd(txns) // 2026-08-26（外貨側のほうが新しい）

const entry = (id: string, on: string, amountJpy: number): Entry => ({ id, on, amountJpy, note: '' })

describe('手動記録と CSV の継ぎ目', () => {
  it('両ファイルを合わせても純入金は変わらない（外貨側は外部との出入りを持たない）', () => {
    expect(totalNet(txns)).toBe(***)
  })

  it('CSV が届いていない期間の記録は暫定として数える', () => {
    const [r] = resolveEntries([entry('a', '2026-09-05', 60_000)], txns, end)
    expect(r?.status).toBe('pending')
    expect(monthContribution('2026-09', txns, [r!]).totalJpy).toBe(60_000)
  })

  it('CSV に対応行が現れたら記録は退き、二重に数えない', () => {
    // 2026/8/10 に「入金(クレジットカード決済ご利用分)」10万がある。
    const resolved = resolveEntries([entry('a', '2026-08-10', 100_000)], txns, end)
    expect(resolved[0]?.status).toBe('confirmed')
    expect(resolved[0]?.matched?.type).toBe('入金(クレジットカード決済ご利用分)')

    const m = monthContribution('2026-08', txns, resolved)
    expect(m.confirmedJpy).toBe(100_000)
    expect(m.pendingJpy).toBe(0)
    expect(m.totalJpy).toBe(100_000) // 足し算していたら 20万になる
  })

  it('受渡日が数日ずれていても同じ入金として拾う', () => {
    const resolved = resolveEntries([entry('a', '2026-08-08', 100_000)], txns, end)
    expect(resolved[0]?.status).toBe('confirmed')
  })

  it('CSV が届いている期間なのに対応行がなければ赤く出す（数えない）', () => {
    const resolved = resolveEntries([entry('a', '2026-08-10', 77_777)], txns, end)
    expect(resolved[0]?.status).toBe('unmatched')
    expect(monthContribution('2026-08', txns, resolved).totalJpy).toBe(100_000)
  })

  it('同じ CSV 行を二つの記録が取り合わない', () => {
    // 8月の入金は10万ちょうど1件。同額を二度記録したら片方は対応行を失う。
    const resolved = resolveEntries(
      [entry('a', '2026-08-10', 100_000), entry('b', '2026-08-10', 100_000)], txns, end,
    )
    expect(resolved.map((r) => r.status)).toEqual(['confirmed', 'unmatched'])
    expect(monthContribution('2026-08', txns, resolved).totalJpy).toBe(100_000)
  })

  it('取り下げた記録は数えないし警告も出さない', () => {
    const dismissed: Entry = { ...entry('a', '2026-08-10', 77_777), dismissed: true }
    const resolved = resolveEntries([dismissed], txns, end)
    expect(resolved[0]?.status).toBe('dismissed')
    expect(monthContribution('2026-08', txns, resolved).totalJpy).toBe(100_000)
  })

  it('見通しには平均、環には中央値 — 問いが違うので同じ数を使わない', () => {
    const monthly = monthlyNet(txns)
    const last6 = [...monthly.values()].slice(-6)
    expect(last6).toEqual([150_000, 200_000, 155_587, 310_000, 110_000, 100_000])

    // 平均は「実際どれだけ積み上がったか」。突出した 31万の月も含める。
    expect(meanRecentNet(monthly)).toBeCloseTo(***, 0)
    // 中央値は「今月勝てる目標はどこか」。最高の月を目標にすると大半の月で負ける。
    expect(medianRecentNet(monthly)).toBe(152_793.5)
  })
})
