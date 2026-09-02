import { describe, expect, it } from 'vitest'
import {
  moneyWeightedReturn, principalSeries, projectionSeries, requiredMonthly, valueSeries,
} from '../src/domain/growth'
import { EMPTY, withValuePoint } from '../src/store'
import { monthsToGoal } from '../src/domain/projection'
import { parseSnapshot } from '../src/domain/holdings'
import { parseTransactions, totalNet } from '../src/domain/transactions'
import { SNAPSHOT_FILE, jpHistoryCsv, snapshotCsv, usHistoryCsv } from './fixtures'

const txns = [...parseTransactions(jpHistoryCsv(), 'JP'), ...parseTransactions(usHistoryCsv(), 'US')]
const snap = parseSnapshot(snapshotCsv(), SNAPSHOT_FILE)
const plan = { goalJpy: 100_000_000, annualRate: 0.07 }

describe('累計投入の推移', () => {
  const s = principalSeries(txns)

  it('終点は純入金の総額と一致する', () => {
    expect(s[s.length - 1]?.jpy).toBe(totalNet(txns))
    expect(s[s.length - 1]?.jpy).toBe(***)
  })

  it('同じ日は1点にまとめる', () => {
    expect(new Set(s.map((p) => p.on)).size).toBe(s.length)
  })

  it('単調に増えるとは限らない — 取り崩した日は下がる', () => {
    // 2025/10〜2026/02 に 178万の引き出しがある。線を単調と決めつけない。
    const drops = s.filter((p, i) => i > 0 && p.jpy < s[i - 1]!.jpy)
    expect(drops.length).toBeGreaterThan(0)
  })
})

describe('見通しの線', () => {
  const from = new Date(2026, 8, 1)

  it('線の終点と閉じた式の到達月が食い違わない', () => {
    const s = projectionSeries(plan, ***, ***, from)
    expect(s.length - 1).toBe(Math.ceil(monthsToGoal(plan, ***, ***)))
    expect(s[s.length - 1]!.jpy).toBeGreaterThanOrEqual(plan.goalJpy)
    expect(s[0]!.jpy).toBe(***)
  })

  it('届かない条件でも打ち切って返す', () => {
    const s = projectionSeries({ goalJpy: 1e8, annualRate: 0 }, 1_000_000, 0, from, 24)
    expect(s).toHaveLength(25)
  })
})

describe('必要な毎月の投入額', () => {
  it('逆算した額で回すと、ちょうどその月数で届く', () => {
    const months = 120
    const pmt = requiredMonthly(plan, ***, months)
    expect(monthsToGoal(plan, ***, pmt)).toBeCloseTo(months, 6)
  })

  it('複利だけで届くなら 0（マイナスを返さない）', () => {
    expect(requiredMonthly(plan, 90_000_000, 240)).toBe(0)
  })
})

describe('実績の年率', () => {
  it('外部フローと期末評価額から金額加重で解く', () => {
    const r = moneyWeightedReturn(txns, snap.totalJpy, snap.asOf)
    expect(r).toBeCloseTo(0.2258, 4)
  })

  it('評価日が不明なら計算しない — 今日で代用しない', () => {
    expect(moneyWeightedReturn(txns, snap.totalJpy, null)).toBeNull()
  })

  it('解が無い組み合わせでは端点ではなく null を返す', () => {
    expect(moneyWeightedReturn(txns, 0, snap.asOf)).toBeNull()
  })
})

describe('実測の資産曲線', () => {
  it('取り込むたびに1点ずつ増え、同じ日は上書きする', () => {
    const file = { name: SNAPSHOT_FILE, text: snapshotCsv(), importedAt: '' }
    const once = withValuePoint(EMPTY, file)
    expect(once.valuePoints).toEqual([{ on: '2026-08-29', totalJpy: *** }])
    // 同じファイルをもう一度落としても点は増えない
    expect(withValuePoint(once, file).valuePoints).toEqual(once.valuePoints)
  })

  it('日付を読めないファイルは記録しない — 時系列に置き場所がない', () => {
    const file = { name: 'snapshot.csv', text: snapshotCsv(), importedAt: '' }
    expect(withValuePoint(EMPTY, file).valuePoints).toEqual([])
  })

  it('取り込み直後はまだ保存前なので、今のスナップショットを優先する', () => {
    const s = valueSeries(
      [{ on: '2026-08-29', totalJpy: 1 }],
      { asOf: '2026-08-29', totalJpy: *** },
    )
    expect(s).toHaveLength(1)
    expect(s[0]?.jpy).toBe(***)
  })
})
