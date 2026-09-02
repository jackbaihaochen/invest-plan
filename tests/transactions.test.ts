import { describe, expect, it } from 'vitest'
import {
  UnknownTxnTypeError,
  coverageEnd,
  monthlyNet,
  parseTransactions,
  totalNet,
} from '../src/domain/transactions'
import { jpHistoryCsv, usHistoryCsv } from './fixtures'

const jp = parseTransactions(jpHistoryCsv(), 'JP')
const us = parseTransactions(usHistoryCsv(), 'US')
const all = [...jp, ...us]

describe('取引履歴の取り込み', () => {
  it('両ファイルを全行読む', () => {
    expect(jp).toHaveLength(161)
    expect(us).toHaveLength(54)
  })

  it('外貨ファイルは取引区分と口座区分の列順が逆 — 名前で引けているか', () => {
    // 位置を JP から流用すると、取引区分に「特定」が入ってしまう。
    const types = new Set(us.map((t) => t.type))
    expect(types.has('米国株式積立購入')).toBe(true)
    expect(types.has('特定')).toBe(false)
    expect(new Set(us.map((t) => t.account))).toContain('特定')
  })

  it('純入金は全期間で 4,895,587 円', () => {
    expect(totalNet(jp)).toBe(4_895_587)
  })

  it('外貨ファイルは外部との出入りをひとつも含まない', () => {
    expect(totalNet(us)).toBe(0)
    expect(us.every((t) => t.flow === 'internal' || t.flow === 'income')).toBe(true)
  })

  it('振替出金は金の定額積立であって取り崩しではない', () => {
    const gold = jp.filter((t) => t.type === '振替出金')
    expect(gold).toHaveLength(20)
    expect(gold.every((t) => t.flow === 'internal' && t.netJpy === 0)).toBe(true)
    expect(gold.reduce((a, t) => a + t.paidJpy, 0)).toBe(1_000_000)
  })

  it('円と外貨をまたぐ振替は対で現れ、両側とも投入に数えない', () => {
    // 同じ移動が、外貨側で出金・円側で入金として二度記録される。
    // 為替の丸めで 1 円ずれるが、どちらも internal なので合計に影響しない。
    const out = us.find((t) => t.settledOn === '2025-08-27' && t.type === '振替出金')
    const back = jp.find((t) => t.settledOn === '2025-08-27' && t.type === '振替入金')
    expect(out?.paidJpy).toBe(12_345)
    expect(back?.receivedJpy).toBe(12_346)
    expect([out, back].every((t) => t?.flow === 'internal' && t.netJpy === 0)).toBe(true)
  })

  it('配当・分配金・利金は資産を増やすが投入ではない', () => {
    const income = all.filter((t) => t.flow === 'income')
    expect(income).toHaveLength(27) // 外株配当金 20、投信分配金 3、国内株式配当金 2、利金 2
    expect(income.every((t) => t.netJpy === 0)).toBe(true)
  })

  it('二つのファイルは同じ売買を重複して持たない', () => {
    // 円貨決済と外貨決済は交わらない二本の流れ。だから合算しても二重計上にならない。
    // 振替は例外で、上のテストのとおり対で現れる。
    const trade = (t: { type: string }) => /購入|買付|売却|解約/.test(t.type)
    const key = (t: { settledOn: string; type: string }) => `${t.settledOn} ${t.type}`
    const jpTrades = new Set(jp.filter(trade).map(key))
    expect(us.filter(trade).map(key).filter((k) => jpTrades.has(k))).toEqual([])
  })

  it('CSV が押さえている最終日は受渡日の最大値（ダウンロード日ではない）', () => {
    expect(coverageEnd(jp)).toBe('2026-08-15')
    expect(coverageEnd(us)).toBe('2026-08-26')
  })

  it('月次の純入金 — 取り崩した月は負のまま出す', () => {
    const m = monthlyNet(jp)
    expect(m.get('2026-08')).toBe(100_000)
    expect(m.get('2026-06')).toBe(310_000)
    expect(m.get('2025-11')).toBe(-250_000)
    expect([...m.keys()][0]).toBe('2024-03')
  })

  it('入金の種類ごとに、正しい月へ振り分ける', () => {
    // 同じ月に種類の違う入金が並ぶ。取引区分と受渡日の対応がずれたらここが落ちる。
    // （本物のデータでは「毎月15万 = カード10万 + 楽天キャッシュ5万」という
    //   本人の申告と突き合わせる裏づけになっていた。作り物では自分の生成器を
    //   見ているだけなので、その意味での裏づけにはならない。）
    const inMonth = (ym: string, type: string) =>
      jp.filter((t) => t.settledOn.startsWith(ym) && t.type === type)
        .reduce((a, t) => a + t.receivedJpy, 0)
    expect(inMonth('2026-07', '入金(クレジットカード決済ご利用分)')).toBe(100_000)
    expect(inMonth('2026-07', '入金(楽天ペイ残高ご利用分)')).toBe(50_000)
    expect(inMonth('2026-08', '入金(楽天ペイ残高ご利用分)')).toBe(0)
  })

  it('未知の取引区分は黙って分類せず投げる', () => {
    const csv = ['受渡日,約定日,取引区分,口座区分,対象証券名',
                 '"2026/8/1","2026/8/1","謎の取引","-","-"'].join('\n')
    expect(() => parseTransactions(csv, 'JP')).toThrow(UnknownTxnTypeError)
  })
})
