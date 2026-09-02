import { describe, expect, it, beforeEach } from 'vitest'
import { datasetOf, load, save, EMPTY, withDataset } from '../src/store'
import { SNAPSHOT_FILE, jpHistoryCsv, snapshotCsv } from './fixtures'

/** localStorage は node には無い。読み書きの挙動だけを最小限で真似る。 */
const memory = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = memory()
})

describe('保存形式の移行', () => {
  it('v1 の記録と実測点を捨てずに v2 へ持ち上げる', () => {
    // 第2段階まで使っていた形。ここで EMPTY を返す実装は、ユーザーが手で
    // 記録した投入と、取り込み直せない過去の実測点を黙って捨てることになる。
    localStorage.setItem('invest-plan/v1', JSON.stringify({
      version: 1,
      snapshot: { name: SNAPSHOT_FILE, text: snapshotCsv(), importedAt: '2026-08-29' },
      historyJp: { name: 'jp.csv', text: jpHistoryCsv(), importedAt: '2026-08-29' },
      entries: [{ id: 'a', on: '2026-09-01', amountJpy: 50_000, note: '手で記録' }],
      valuePoints: [{ on: '2026-08-29', totalJpy: 6_365_266 }],
      settings: { annualRate: 0.03 },
    }))

    const store = load()
    expect(store.version).toBe(2)
    const data = datasetOf(store)
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0]?.note).toBe('手で記録')
    expect(data.valuePoints).toEqual([{ on: '2026-08-29', totalJpy: 6_365_266 }])
    expect(data.txns.length).toBeGreaterThan(0)
    expect(data.snapshot?.totalJpy).toBe(6_365_266)
    expect(store.settings.annualRate).toBe(0.03) // 変えた設定も残る
    expect(store.files.snapshot?.name).toBe(SNAPSHOT_FILE) // 生ファイルも残る
  })

  it('読めない中身なら空から始める（例外で落とさない）', () => {
    localStorage.setItem('invest-plan/v1', '{壊れている')
    expect(load().version).toBe(2)
    expect(datasetOf(load()).txns).toEqual([])
  })

  it('保存して読み直すと同じデータが戻る', () => {
    const data = { ...datasetOf(EMPTY), entries: [{ id: 'x', on: '2026-09-03', amountJpy: 1, note: '' }] }
    save(withDataset(EMPTY, data))
    expect(datasetOf(load()).entries[0]?.id).toBe('x')
  })
})
