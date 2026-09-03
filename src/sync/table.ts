import type { Entry } from '../domain/contribution'
import type { ValuePoint } from '../domain/growth'
import type { Dataset } from '../domain/model'
import type { PriceRow } from '../domain/prices'
import type { Flow, Position, Snapshot, Txn } from '../domain/types'

/**
 * Dataset と「表」の相互変換。
 *
 * サーバ（Apps Script）にドメインを一切教えないための層。向こうは
 * `{ header, rows }` を受け取ってシートに書くだけで、列の意味を知らない。
 * おかげでサーバは薄いままだし、スプレッドシートを直接開いても読める。
 *
 * 列の順序を変えるときは COLUMNS を直すこと。古い行は header を見て読むので、
 * 列を足す・並べ替えるぶんには過去のデータを壊さない。
 */
export interface Table {
  header: string[]
  rows: unknown[][]
}

export interface Tables {
  txns: Table
  positions: Table
  entries: Table
  values: Table
  /** 基準価額メールから毎日1行ずつ増える。書くのはトリガー、読むのは画面。 */
  prices: Table
  meta: Table
}

const COLUMNS = {
  txns: ['settledOn', 'tradedOn', 'type', 'account', 'security', 'quantity', 'unitPrice',
    'receivedJpy', 'paidJpy', 'currency', 'flow', 'netJpy', 'source'] as const,
  positions: ['kind', 'ticker', 'name', 'account', 'quantity', 'quantityUnit', 'price',
    'priceUnit', 'marketValueJpy', 'gainJpy', 'costJpy'] as const,
  entries: ['id', 'on', 'amountJpy', 'note', 'dismissed'] as const,
  values: ['on', 'totalJpy'] as const,
  prices: ['on', 'fund', 'navJpy'] as const,
  meta: ['key', 'value'] as const,
}

const toTable = <T extends object>(cols: readonly string[], items: readonly T[]): Table => ({
  header: [...cols],
  rows: items.map((it) => cols.map((c) => (it as Record<string, unknown>)[c] ?? '')),
})

/** header を見て読む。列が増えても減っても、知っている列だけ拾う。 */
function fromTable(table: Table | undefined): Record<string, unknown>[] {
  if (!table || !Array.isArray(table.rows)) return []
  const header = table.header ?? []
  return table.rows.map((row) => {
    const out: Record<string, unknown> = {}
    header.forEach((name, i) => { out[name] = row[i] })
    return out
  })
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => (v === '' || v == null ? null : num(v))
const str = (v: unknown): string => (v == null ? '' : String(v))

export function datasetToTables(data: Dataset): Tables {
  const snap = data.snapshot
  const meta: { key: string; value: string }[] = [
    { key: 'asOf', value: snap?.asOf ?? '' },
    { key: 'cashJpy', value: String(snap?.cashJpy ?? '') },
    { key: 'totalJpy', value: String(snap?.totalJpy ?? '') },
    { key: 'fx', value: snap ? JSON.stringify(snap.fx) : '' },
    { key: 'hasSnapshot', value: snap ? '1' : '' },
  ]
  return {
    txns: toTable(COLUMNS.txns, data.txns),
    positions: toTable(COLUMNS.positions, snap?.positions ?? []),
    entries: toTable(COLUMNS.entries, data.entries.map((e) => ({ ...e, dismissed: e.dismissed ? '1' : '' }))),
    values: toTable(COLUMNS.values, data.valuePoints),
    prices: toTable(COLUMNS.prices, data.prices),
    meta: toTable(COLUMNS.meta, meta),
  }
}

export function tablesToDataset(tables: Partial<Tables>): Dataset {
  const metaRows = fromTable(tables.meta)
  const meta = new Map(metaRows.map((r) => [str(r['key']), str(r['value'])]))

  const positions: Position[] = fromTable(tables.positions).map((r) => ({
    kind: str(r['kind']),
    ticker: str(r['ticker']),
    name: str(r['name']),
    account: str(r['account']),
    quantity: num(r['quantity']),
    quantityUnit: str(r['quantityUnit']),
    price: numOrNull(r['price']),
    priceUnit: str(r['priceUnit']),
    marketValueJpy: num(r['marketValueJpy']),
    gainJpy: num(r['gainJpy']),
    costJpy: num(r['costJpy']),
  }))

  let fx: Record<string, number> = {}
  try {
    const raw = meta.get('fx')
    if (raw) fx = JSON.parse(raw) as Record<string, number>
  } catch {
    fx = {} // 壊れていても読み込み全体は落とさない
  }

  // asOf は読めなければ null のまま。今日に倒さない（古い評価額を今日の値に見せない）。
  const snapshot: Snapshot | null = meta.get('hasSnapshot')
    ? {
      asOf: meta.get('asOf') || null,
      positions,
      cashJpy: num(meta.get('cashJpy')),
      totalJpy: num(meta.get('totalJpy')),
      fx,
    }
    : null

  const txns: Txn[] = fromTable(tables.txns).map((r) => ({
    settledOn: str(r['settledOn']),
    tradedOn: str(r['tradedOn']) || null,
    type: str(r['type']),
    account: str(r['account']),
    security: str(r['security']),
    quantity: numOrNull(r['quantity']),
    unitPrice: numOrNull(r['unitPrice']),
    receivedJpy: num(r['receivedJpy']),
    paidJpy: num(r['paidJpy']),
    currency: str(r['currency']) === 'USD' ? 'USD' : 'JPY',
    flow: str(r['flow']) as Flow,
    netJpy: num(r['netJpy']),
    source: str(r['source']) === 'US' ? 'US' : 'JP',
  }))

  const entries: Entry[] = fromTable(tables.entries).map((r) => ({
    id: str(r['id']),
    on: str(r['on']),
    amountJpy: num(r['amountJpy']),
    note: str(r['note']),
    ...(r['dismissed'] ? { dismissed: true } : {}),
  }))

  const valuePoints: ValuePoint[] = fromTable(tables.values)
    .map((r) => ({ on: str(r['on']), totalJpy: num(r['totalJpy']) }))
    .filter((v) => v.on !== '')

  const prices: PriceRow[] = fromTable(tables.prices)
    .map((r) => ({ on: str(r['on']), fund: str(r['fund']), navJpy: num(r['navJpy']) }))
    .filter((p) => p.on !== '' && p.fund !== '' && p.navJpy > 0)

  return { snapshot, txns, entries, valuePoints, prices, problems: [] }
}
