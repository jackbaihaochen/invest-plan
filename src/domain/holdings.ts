import { at, parseCsv, toAmount, toIsoDate, toNumber } from './csv'
import type { Position, Snapshot } from './types'

/**
 * assetbalance(all)_*.csv を読む。
 *
 * ファイルは多段構成: 合計段 → 空行 → 「■ 保有商品詳細 (すべて）」 → 明細表 →
 * 「■参考為替レート」。明細表のヘッダ行は1列目が「種別」であることで見つける。
 *
 * 明細のヘッダには ［単位］ が4回現れるため、名前で索引を作ってはいけない。
 * 位置で読む（列順は下の COL）。
 */
const COL = {
  kind: 0, ticker: 1, name: 2, account: 3,
  quantity: 4, quantityUnit: 5,
  avgCost: 6, avgCostUnit: 7,
  price: 8, priceUnit: 9,
  marketValueJpy: 14, marketValueFx: 15,
  gainJpy: 16, gainPct: 17,
} as const

const MIN_COLS = COL.gainPct + 1

export function parseSnapshot(text: string, fileName = ''): Snapshot {
  const rows = parseCsv(text)
  const headerIdx = rows.findIndex((r) => at(r, 0) === '種別')
  if (headerIdx === -1) throw new Error('保有商品詳細のヘッダ行（1列目が「種別」）が見つかりません')

  const positions: Position[] = []
  for (const row of rows.slice(headerIdx + 1)) {
    const kind = at(row, COL.kind)
    if (kind === '') break                       // 明細段の終わり（空行）
    if (kind.startsWith('■')) break
    if (row.length < MIN_COLS) continue
    const marketValueJpy = toAmount(at(row, COL.marketValueJpy))
    const gainJpy = toAmount(at(row, COL.gainJpy))
    positions.push({
      kind,
      ticker: at(row, COL.ticker) === '-' ? '' : at(row, COL.ticker),
      name: at(row, COL.name),
      account: at(row, COL.account),
      quantity: toAmount(at(row, COL.quantity)),
      quantityUnit: at(row, COL.quantityUnit),
      price: toNumber(at(row, COL.price)),
      priceUnit: at(row, COL.priceUnit),
      marketValueJpy,
      gainJpy,
      costJpy: marketValueJpy - gainJpy,
    })
  }

  return {
    asOf: asOfFrom(fileName),
    positions,
    cashJpy: summaryValue(rows, '預り金合計') ?? 0,
    totalJpy: summaryValue(rows, '資産合計') ?? 0,
    fx: parseFx(rows),
  }
}

/** 合計段は「ラベル, 金額, ...」の1行。明細段の前にあるものだけ見る。 */
function summaryValue(rows: string[][], label: string): number | null {
  const headerIdx = rows.findIndex((r) => at(r, 0) === '種別')
  const limit = headerIdx === -1 ? rows.length : headerIdx
  for (let i = 0; i < limit; i++) {
    const row = rows[i]
    if (row && at(row, 0) === label) return toNumber(at(row, 1))
  }
  return null
}

/** 「■参考為替レート」段: 米ドル,160.06,円/USD,(08/29 05:59) */
function parseFx(rows: string[][]): Record<string, number> {
  const fx: Record<string, number> = {}
  for (const row of rows) {
    if (!at(row, 2).startsWith('円/')) continue
    const rate = toNumber(at(row, 1))
    if (rate !== null) fx[at(row, 0)] = rate
  }
  return fx
}

/** 明細に日付欄がないので、ファイル名の 20260829 から取る。 */
function asOfFrom(fileName: string): string {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(fileName)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return toIsoDate(new Date().toLocaleDateString('en-CA').replace(/-/g, '/')) ?? ''
}
