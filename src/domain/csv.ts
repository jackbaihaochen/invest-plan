/**
 * 楽天証券の CSV は CP932。ブラウザ・Node どちらも TextDecoder が shift_jis を
 * 持っているので、外部ライブラリなしで読める。
 */
export function decodeCp932(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder('shift_jis').decode(bytes)
}

/** RFC4180 相当。引用符の中の改行とカンマ、"" によるエスケープを保持する。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') { quoted = true; continue }
    if (c === ',') { row.push(cell); cell = ''; continue }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
      continue
    }
    cell += c
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

/**
 * 位置で読むためのアクセサ。
 *
 * 明細表のヘッダには ［単位］ が4回出てくるので、名前で索引を作ると列が潰れる。
 * 位置で読むのが正しく、その代わり範囲外を静かに '' にしないよう明示する。
 */
export function at(row: readonly string[], i: number): string {
  const v = row[i]
  return v === undefined ? '' : v.trim()
}

/** "+44,440" "1,234円" "-" "" → number。数値でなければ null。 */
export function toNumber(raw: string | undefined): number | null {
  const v = (raw ?? '').replace(/[",\s円%％]/g, '').replace(/^\+/, '')
  if (v === '' || v === '-') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 同上だが、欠損を 0 として扱ってよい金額欄用。 */
export function toAmount(raw: string | undefined): number {
  return toNumber(raw) ?? 0
}

/** "2026/8/18" → "2026-08-18"。楽天の日付欄はゼロ埋めされていない。 */
export function toIsoDate(raw: string | undefined): string | null {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec((raw ?? '').trim())
  if (!m) return null
  return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
}
