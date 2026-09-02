import { describe, expect, it } from 'vitest'
import { datasetFromFiles, isEmptyDataset } from '../src/domain/model'
import { datasetToTables, tablesToDataset } from '../src/sync/table'
import { SNAPSHOT_FILE, jpHistoryCsv, snapshotCsv, usHistoryCsv } from './fixtures'

const entries = [
  { id: 'a', on: '2026-09-01', amountJpy: 50_000, note: 'オルカン 買い増し' },
  { id: 'b', on: '2026-09-02', amountJpy: 30_000, note: '', dismissed: true },
]
const valuePoints = [{ on: '2026-08-29', totalJpy: 6_365_266 }]

const data = datasetFromFiles({
  snapshot: { name: SNAPSHOT_FILE, text: snapshotCsv() },
  historyJp: { name: 'jp.csv', text: jpHistoryCsv() },
  historyUs: { name: 'us.csv', text: usHistoryCsv() },
}, entries, valuePoints)

describe('Sheet との相互変換', () => {
  const back = tablesToDataset(datasetToTables(data))

  it('往復しても取引が一件も欠けず、値も変わらない', () => {
    expect(back.txns).toHaveLength(data.txns.length)
    expect(back.txns).toEqual(data.txns)
  })

  it('往復しても持仓と合計段が変わらない', () => {
    expect(back.snapshot?.positions).toEqual(data.snapshot?.positions)
    expect(back.snapshot?.totalJpy).toBe(data.snapshot?.totalJpy)
    expect(back.snapshot?.cashJpy).toBe(data.snapshot?.cashJpy)
    expect(back.snapshot?.asOf).toBe('2026-08-29')
    expect(back.snapshot?.fx['米ドル']).toBe(160.06)
  })

  it('取り下げ済みの記録は取り下げ済みのまま戻る', () => {
    expect(back.entries[0]).toEqual(entries[0])
    expect(back.entries[1]?.dismissed).toBe(true)
  })

  it('実測点も往復する', () => {
    expect(back.valuePoints).toEqual(valuePoints)
  })

  it('列が増えても、知っている列だけ読んで壊れない', () => {
    const t = datasetToTables(data)
    t.txns.header.push('あとから足した列')
    t.txns.rows.forEach((r) => r.push('無視されるはず'))
    expect(tablesToDataset(t).txns).toEqual(data.txns)
  })

  it('Sheets が日付を Date にしてしまっても文字列として読み戻す', () => {
    const t = datasetToTables(data)
    const i = t.values.header.indexOf('on')
    t.values.rows[0]![i] = new Date('2026-08-29T00:00:00Z')
    // サーバ側で ISO に戻す約束だが、素通りしても数値化して壊さないことを見る
    expect(tablesToDataset(t).valuePoints[0]?.totalJpy).toBe(6_365_266)
  })

  it('空の表からは空の Dataset が出る — 移行の判定に使う', () => {
    const empty = tablesToDataset({})
    expect(isEmptyDataset(empty)).toBe(true)
    expect(empty.snapshot).toBeNull()
    expect(isEmptyDataset(data)).toBe(false)
  })

  it('スナップショットが無い状態も往復する（履歴だけ入れた場合）', () => {
    const noSnap = { ...data, snapshot: null }
    expect(tablesToDataset(datasetToTables(noSnap)).snapshot).toBeNull()
  })

  it('壊れた fx を読んでも読み込み全体は落ちない', () => {
    const t = datasetToTables(data)
    const row = t.meta.rows.find((r) => r[0] === 'fx')!
    row[1] = '{壊れている'
    expect(tablesToDataset(t).snapshot?.fx).toEqual({})
  })
})
