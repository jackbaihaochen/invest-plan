import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * `apps-script/server.gs` は Apps Script でしか動かないので、ここでは**純関数だけ**を
 * 切り出して回す。Utilities は実測に合わせたスタブ（body.data はバイト配列、中身は UTF-8）。
 *
 * 夹具は 2026-09-04 の実行ログで実際に見た並びをそのまま写したもの。
 * ファンド名は tests/prices.test.ts に既に出ているものと同じ。
 */
const src = readFileSync(new URL('../apps-script/server.gs', import.meta.url), 'utf8')

const Utilities = {
  base64DecodeWebSafe() { throw new Error('base64 は通ってはいけない') },
  newBlob(d: unknown) {
    if (!Array.isArray(d)) throw new Error('newBlob にバイト配列以外が渡った: ' + typeof d)
    return { getDataAsString: (cs: string) => { seenCharset = cs; return Buffer.from(d).toString('utf8') } }
  },
}
let seenCharset: string | null = null

const gs = new Function('Utilities', 'console', `${src}
  return { decodeBody, parsePrices, parsePriceDate, dumpLines, textLines }`)(
  Utilities, { log() {}, warn() {} },
) as {
  decodeBody(p: unknown): string
  parsePrices(t: string): { fund: string; navJpy: number }[]
  parsePriceDate(t: string): string | null
  dumpLines(t: string): string
  textLines(t: string): string[]
}

/** 実物と同じ形の HTML。1 ファンドあたり 名前<br>(委託会社) / 基準価額 / 前日比 / 率 / 年率。 */
function mail(rows: [string, string, string, string, string, string][]) {
  const cells = rows
    .map(([name, co, nav, diff, pct, ret]) =>
      `<tr><td>${name}<br>${co}</td><td>${nav}</td><td>${diff}</td><td>${pct}</td><td>${ret}</td></tr>`)
    .join('')
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"><html><body>`
    + `<p>基準価額のお知らせ</p><p>■基準価額メール対象ファンド一覧</p>`
    + `<table><tr><td>ファンド名(委託会社)</td><td>基準価額</td><td>前営業日比率</td>`
    + `<td>金額(%)</td><td>リターン(年率)</td></tr>${cells}</table>`
    + `<p>・基準価額は09月03日時点の数値を表示しております。</p></body></html>`
}

const REAL = mail([
  ['HSBC インド・インフラ株式オープン', '(ＨＳＢＣアセットマネジメント)', '19,016円', '-308円', '(-1.59％)', '5.45％'],
  ['eMAXIS Slim 全世界株式（オール・カントリー）', '(三菱ＵＦＪアセットマネジメント)', '38,285円', '-299円', '(-0.77％)', '32.91％'],
  ['eMAXIS Slim 米国株式（S&amp;P500）', '(三菱ＵＦＪアセットマネジメント)', '44,779円', '-238円', '(-0.53％)', '30.25％'],
  ['iFreeNEXT FANG+インデックス', '(大和アセットマネジメント)', '99,198円', '-859円', '(-0.86％)', '30.24％'],
])

describe('decodeBody', () => {
  const part = (data: string) => ({
    mimeType: 'multipart/mixed',
    parts: [{
      mimeType: 'text/html',
      // ヘッダは iso-2022-jp と言うが、実際のバイト列は UTF-8。実測済み。
      headers: [{ name: 'Content-Type', value: 'text/html; charset=iso-2022-jp' }],
      body: { data: Array.from(Buffer.from(data, 'utf8')) },
    }],
  })

  it('バイト配列をそのまま渡す（base64 として読まない）', () => {
    expect(gs.decodeBody(part(REAL))).toBe(REAL)
  })

  it('ヘッダの charset を信じず UTF-8 で読む', () => {
    seenCharset = null
    gs.decodeBody(part(REAL))
    expect(seenCharset).toBe('UTF-8')
  })

  it('添付の part は選ばない', () => {
    const p = part(REAL)
    p.parts.unshift({ mimeType: 'application/pdf', headers: [], body: { attachmentId: 'x' } } as never)
    expect(gs.decodeBody(p)).toBe(REAL)
  })

  it('text/plain と text/html を両方つながない（同じ値段を二度拾わない）', () => {
    const p = part(REAL)
    p.parts.unshift({
      mimeType: 'text/plain', headers: [],
      body: { data: Array.from(Buffer.from('eMAXIS Slim 全世界株式（オール・カントリー）\n(三菱ＵＦＪアセットマネジメント)\n38,285円\n', 'utf8')) },
    })
    expect(gs.parsePrices(gs.decodeBody(p))).toHaveLength(1)
  })
})

describe('parsePrices —— 実メールの並び', () => {
  it('4 本すべて、名前と値段が正しく組む', () => {
    expect(gs.parsePrices(REAL)).toEqual([
      { fund: 'HSBC インド・インフラ株式オープン (ＨＳＢＣアセットマネジメント)', navJpy: 19016 },
      { fund: 'eMAXIS Slim 全世界株式（オール・カントリー） (三菱ＵＦＪアセットマネジメント)', navJpy: 38285 },
      { fund: 'eMAXIS Slim 米国株式（S&P500） (三菱ＵＦＪアセットマネジメント)', navJpy: 44779 },
      { fund: 'iFreeNEXT FANG+インデックス (大和アセットマネジメント)', navJpy: 99198 },
    ])
  })

  it('前営業日比（符号つきの円）を値段と間違えない', () => {
    expect(gs.parsePrices(REAL).map((r) => r.navJpy)).not.toContain(308)
  })

  it('見出しの「基準価額」をファンド名にしない', () => {
    expect(gs.parsePrices(REAL).map((r) => r.fund)).not.toContain('基準価額')
  })

  it('注意書きの中の金額は拾わない', () => {
    const t = REAL + '<p>※基準価額は1万口当たりで表示しています。</p><p>10,000円</p>'
    expect(gs.parsePrices(t)).toHaveLength(4)
  })

  it('名前が見つからなければ値段を捨てる —— 取り違えるより取らない', () => {
    expect(gs.parsePrices('<table><tr><td>38,285円</td></tr></table>')).toEqual([])
  })

  it('&amp; を & に戻す（S&P500）', () => {
    expect(gs.parsePrices(REAL)[2]!.fund).toContain('S&P500')
  })
})

describe('parsePriceDate', () => {
  it('本文の「基準価額は09月03日時点」から取る', () => {
    expect(gs.parsePriceDate(REAL)).toBe('2026-09-03')
  })

  it('日付が無ければ null（呼ぶ側が当日にフォールバックする）', () => {
    expect(gs.parsePriceDate('<p>なにもない</p>')).toBeNull()
  })
})

describe('dumpLines', () => {
  it('値段の手前から行番号つきで出す', () => {
    const out = gs.dumpLines(REAL)
    expect(out).toContain('1| 基準価額のお知らせ')
    expect(out).toContain('| 19,016円')
    expect(out.split('\n').length).toBeLessThanOrEqual(31) // 見出し + 30 行
  })
})
