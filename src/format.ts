export const yen = (n: number): string =>
  `${n < 0 ? '-' : ''}${Math.round(Math.abs(n)).toLocaleString('ja-JP')} 円`

export const yenShort = (n: number): string => {
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(2)} 亿`
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('ja-JP')} 万`
  return `${sign}${Math.round(a).toLocaleString('ja-JP')}`
}

export const pct = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`

export const span = (months: number): string =>
  Number.isFinite(months)
    ? `${Math.floor(months / 12)}年${Math.round(months % 12)}个月`
    : '—'

export const ymd = (iso: string): string => iso.replace(/-/g, '/')

export const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-')
  return `${y}/${m}`
}
