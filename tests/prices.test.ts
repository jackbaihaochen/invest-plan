import { describe, expect, it } from 'vitest'
import { parseSnapshot } from '../src/domain/holdings'
import { type PriceRow, normalizeFund, reprice } from '../src/domain/prices'
import { categoryTotals } from '../src/domain/valuation'
import { SNAPSHOT_FILE, snapshotCsv } from './fixtures'

const snap = parseSnapshot(snapshotCsv(), SNAPSHOT_FILE) // asOf 2026-08-29

/**
 * 実際に届く基準価額メールのファンド名。楽天証券のメール本文から写した表記ゆれで、
 * 全角スペース・全角括弧・末尾の委託会社名がそのまま入っている。
 * 商品名は公開情報なので、そのまま置いてよい。
 */
const EMAIL_NAMES = {
  alcan: 'eMAXIS　Slim　全世界株式（オール・カントリー） (三菱ＵＦＪアセットマネジメント)',
  sp500: 'eMAXIS　Slim　米国株式（S&P500） (三菱ＵＦＪアセットマネジメント)',
  fang: 'iFreeNEXT　FANG+インデックス (大和アセットマネジメント)',
  rakutenSp: '楽天・プラス・S&P500インデックス・ファンド (楽天投信投資顧問)',
  hsbc: 'HSBC　インド・インフラ株式オープン (ＨＳＢＣアセットマネジメント)',
}

const on = '2026-09-02' // スナップショット(8/29)より新しい
const rows = (over: Partial<Record<keyof typeof EMAIL_NAMES, number>> = {}): PriceRow[] =>
  Object.entries({ alcan: 39_000, sp500: 46_000, ...over })
    .map(([k, navJpy]) => ({ on, fund: EMAIL_NAMES[k as keyof typeof EMAIL_NAMES], navJpy }))

describe('メールの名前と CSV の名前を突き合わせる', () => {
  it('全角・委託会社名・愛称の違いを越えて同じ鍵になる', () => {
    expect(normalizeFund(EMAIL_NAMES.alcan))
      .toBe(normalizeFund('eMAXIS Slim 全世界株式(オール・カントリー)(オルカン)'))
    expect(normalizeFund(EMAIL_NAMES.sp500))
      .toBe(normalizeFund('eMAXIS Slim 米国株式(S&P500)'))
    expect(normalizeFund(EMAIL_NAMES.rakutenSp))
      .toBe(normalizeFund('楽天・プラス・Ｓ＆Ｐ５００インデックス・ファンド(楽天・プラス・Ｓ＆Ｐ５００)'))
  })

  it('別のファンドは別の鍵のまま', () => {
    expect(normalizeFund(EMAIL_NAMES.alcan)).not.toBe(normalizeFund(EMAIL_NAMES.sp500))
    expect(normalizeFund(EMAIL_NAMES.fang)).not.toBe(normalizeFund(EMAIL_NAMES.hsbc))
  })
})

describe('基準価額での付け替え', () => {
  it('口数 × 基準価額 ÷ 1万 で評価額を出す', () => {
    const r = reprice(snap, rows())!
    const p = r.snapshot.positions.find((x) => x.name.includes('全世界株式'))!
    expect(p.marketValueJpy).toBe(Math.round((p.quantity * 39_000) / 10_000))
    // 取得原価は動かないので、損益は新しい時価から出し直す
    expect(p.gainJpy).toBe(p.marketValueJpy - p.costJpy)
  })

  it('同じファンドを同じ枠に2ロット持っていても、両方に同じ値段が付く', () => {
    const r = reprice(snap, rows())!
    const lots = r.snapshot.positions.filter((p) => p.name.includes('米国株式(S&P500)'))
    expect(lots).toHaveLength(2) // 作り物の夹具に入れてある重複ロット
    for (const p of lots) expect(p.marketValueJpy).toBe(Math.round((p.quantity * 46_000) / 10_000))
  })

  it('総資産と評価日が付け替え後の値になる', () => {
    const r = reprice(snap, rows())!
    expect(r.pricedOn).toBe(on)
    expect(r.snapshot.asOf).toBe(on)
    const sum = r.snapshot.positions.reduce((a, p) => a + p.marketValueJpy, 0)
    expect(r.snapshot.totalJpy).toBe(sum + snap.cashJpy)
  })

  it('当日値になった割合を返す — 投信以外は据え置きなので 1 にはならない', () => {
    const r = reprice(snap, rows())!
    expect(r.repricedShare).toBeGreaterThan(0.5)
    expect(r.repricedShare).toBeLessThan(1)
  })

  it('値段が来ていないファンドは据え置き、名前を missing に出す', () => {
    // 全世界株式ぶんしか送らない
    const only = rows().filter((p) => p.fund === EMAIL_NAMES.alcan)
    const r = reprice(snap, only)!
    const sp = r.snapshot.positions.find((p) => p.name.includes('米国株式(S&P500)'))!
    const before = snap.positions.find((p) => p.name.includes('米国株式(S&P500)'))!
    expect(sp.marketValueJpy).toBe(before.marketValueJpy) // 触っていない
    expect(r.missing.some((n) => n.includes('米国株式(S&P500)'))).toBe(true)
  })

  it('鍵が衝突したら値段を捨てる — 取り違えて付けるより据え置くほうがいい', () => {
    // 括弧の中だけが違う別ファンドは、正規化すると同じ鍵になる。
    // ここで片方を選ぶと、黙って**別のファンドの値段**を付けることになる。
    const collide: PriceRow[] = [
      ...rows(),
      { on, fund: 'eMAXIS　Slim　全世界株式（除く日本） (三菱ＵＦＪアセットマネジメント)', navJpy: 12_345 },
    ]
    const r = reprice(snap, collide)!
    const p = r.snapshot.positions.find((x) => x.name.includes('全世界株式'))!
    const before = snap.positions.find((x) => x.name.includes('全世界株式'))!
    expect(p.marketValueJpy).toBe(before.marketValueJpy)
    expect(r.ambiguous).toHaveLength(2)
    expect(r.ambiguous.some((n) => n.includes('除く日本'))).toBe(true)
  })

  it('CSV のほうが新しければ触らない — 古い値段で新しい数字を上書きしない', () => {
    const old = rows().map((p) => ({ ...p, on: '2026-08-27' })) // asOf は 08-29
    const r = reprice(snap, old)!
    expect(r.pricedOn).toBeNull()
    expect(r.snapshot.totalJpy).toBe(snap.totalJpy)
    expect(r.snapshot.asOf).toBe('2026-08-29')
  })

  it('値段がまったく無ければ何もしない', () => {
    const r = reprice(snap, [])!
    expect(r.pricedOn).toBeNull()
    expect(r.repricedShare).toBe(0)
  })

  it('付け替えた投信だけが「当日値」を名乗る', () => {
    const r = reprice(snap, rows())!
    const by = Object.fromEntries(categoryTotals(r.snapshot, r).map((c) => [c.kind, c.livePrice]))
    expect(by['投資信託']).toBe(true)
    expect(by['米国株式']).toBe(false) // 値段を取る仕組みが無い
    expect(by['金・プラチナ']).toBe(false)
  })
})
