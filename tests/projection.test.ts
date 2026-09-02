import { describe, expect, it } from 'vitest'
import {
  daysSooner,
  goalDate,
  monthsBehindPlan,
  splitMonths,
  wholeMonthsToGoal,
} from '../src/domain/projection'

// 2026/08/29 時点の楽天証券 資産合計。
const NOW = ***
const PLAN = { goalJpy: 100_000_000, annualRate: 0.07 }
const FROM = new Date(2026, 8, 1) // 2026-09

/**
 * ここには照合できる証券会社の数字がない。だから「遅れ何年」「何日早まる」は
 * 手で再計算できる値に釘を打っておく。複利の取り決め（月利 = 年率/12、期末拠出）を
 * 後から変えたらここが落ちる。
 */
describe('1億円までの見通し', () => {
  it('計画どおり 40万/月 なら 10年5ヶ月・2037年2月', () => {
    expect(wholeMonthsToGoal(PLAN, NOW, 400_000)).toBe(125)
    expect(splitMonths(125)).toEqual({ years: 10, months: 5 })
    expect(goalDate(PLAN, NOW, 400_000, FROM)).toEqual({ year: 2037, month: 2 })
  })

  it('実績ペース 17万/月 なら 16年1ヶ月・2042年10月', () => {
    expect(wholeMonthsToGoal(PLAN, NOW, 170_000)).toBe(193)
    expect(splitMonths(193)).toEqual({ years: 16, months: 1 })
    expect(goalDate(PLAN, NOW, 170_000, FROM)).toEqual({ year: 2042, month: 10 })
  })

  it('遅れは実績と計画の差として出す', () => {
    expect(monthsBehindPlan(PLAN, NOW, 170_000, 400_000)).toBe(68) // 5年8ヶ月
    expect(splitMonths(68)).toEqual({ years: 5, months: 8 })
  })

  it('1回の追加投入が到達日を何日早めるか', () => {
    const base = *** // 直近6ヶ月の純入金 月平均
    expect(daysSooner(PLAN, NOW, base, 50_000)).toBeCloseTo(6.2, 1)
    expect(daysSooner(PLAN, NOW, base, 250_000)).toBeCloseTo(30.8, 1)
    // きりのいい 17万ペースだと 30.9 日。基準ペースが違えば答えも違う。
    expect(daysSooner(PLAN, NOW, 170_000, 250_000)).toBeCloseTo(30.9, 1)
  })

  it('基準ペースが低いほど1回の追加が効く — 環を現実的な値に置く根拠', () => {
    // 同じ5万が、17万ペースなら6.2日、40万ペースなら3.2日にしかならない。
    // 届かない目標を環に置くと、手を動かしても数字が動かなくなる。
    const atReal = daysSooner(PLAN, NOW, ***, 50_000)
    const atPlan = daysSooner(PLAN, NOW, 400_000, 50_000)
    expect(atPlan).toBeCloseTo(3.2, 1)
    expect(atReal).toBeGreaterThan(atPlan * 1.9)
  })

  it('資産が目標を超えていれば 0ヶ月、増えも減りもしない', () => {
    expect(wholeMonthsToGoal(PLAN, 100_000_000, 0)).toBe(0)
    expect(daysSooner(PLAN, 100_000_000, 0, 50_000)).toBe(0)
  })

  it('拠出も利回りもゼロなら到達しない', () => {
    expect(wholeMonthsToGoal({ goalJpy: 1e8, annualRate: 0 }, NOW, 0)).toBe(Infinity)
    expect(goalDate({ goalJpy: 1e8, annualRate: 0 }, NOW, 0, FROM)).toBeNull()
  })
})
