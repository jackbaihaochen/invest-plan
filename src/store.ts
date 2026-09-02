import type { Entry } from './domain/contribution'
import type { ValuePoint } from './domain/growth'
import { parseSnapshot } from './domain/holdings'

export interface Settings {
  goalJpy: number
  /** 北極星。毎月これを達成する前提の到達日を示すが、環の目標には使わない。 */
  plannedMonthlyJpy: number
  annualRate: number
  /**
   * 今月の環の目標。null なら直近6ヶ月の中央値を使う。
   * 大半の月で勝てる値でないと、環は無視されるだけの赤い棒になる。
   */
  ringTargetJpy: number | null
}

export const DEFAULT_SETTINGS: Settings = {
  goalJpy: 100_000_000,
  plannedMonthlyJpy: 400_000,
  annualRate: 0.07,
  ringTargetJpy: null,
}

/** 取り込んだ CSV は生のまま持つ。解析を直したら過去の取り込みにも効く。 */
export interface RawFile {
  name: string
  text: string
  importedAt: string
}

export type { ValuePoint }

export interface Store {
  version: 1
  snapshot?: RawFile
  historyJp?: RawFile
  historyUs?: RawFile
  entries: Entry[]
  valuePoints: ValuePoint[]
  settings: Settings
}

export const EMPTY: Store = { version: 1, entries: [], valuePoints: [], settings: DEFAULT_SETTINGS }

const KEY = 'invest-plan/v1'

export function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<Store>
    if (parsed.version !== 1) return EMPTY
    return {
      ...EMPTY,
      ...parsed,
      version: 1,
      entries: parsed.entries ?? [],
      valuePoints: parsed.valuePoints ?? [],
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    }
  } catch {
    // プライベートウィンドウやサイトデータ遮断では読み書きが例外を投げる。
    return EMPTY
  }
}

export function save(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // 容量超過やストレージ無効。落とさず、保存できないだけにする。
  }
}

/**
 * 保有商品 CSV を取り込むたびに、その日の総資産を1点だけ残す。
 *
 * version は上げない。上げると load() が EMPTY を返し、取り込み済みの
 * CSV と手動記録がまとめて消える。増える項目は既定値で足りる。
 */
export function withValuePoint(store: Store, file: RawFile): Store {
  let point: ValuePoint
  try {
    const snap = parseSnapshot(file.text, file.name)
    // 日付が読めないものは記録しない。時系列に置き場所が無い。
    if (snap.asOf === null) return store
    point = { on: snap.asOf, totalJpy: snap.totalJpy }
  } catch {
    return store
  }
  const rest = store.valuePoints.filter((p) => p.on !== point.on)
  return { ...store, valuePoints: [...rest, point].sort((a, b) => a.on.localeCompare(b.on)) }
}

/**
 * どのファイルかは名前ではなく中身で見分ける。楽天のファイル名は
 * ダウンロードのたびに連番が付くし、名前を変えられても壊れないほうがいい。
 */
export type FileKind = 'snapshot' | 'historyJp' | 'historyUs'

export function detectKind(text: string): FileKind | null {
  const head = text.slice(0, 4000)
  if (/(^|\n)"?種別"?,/.test(head) || head.includes('保有商品詳細')) return 'snapshot'
  if (head.includes('受渡日')) {
    // 外貨ファイルだけが決済通貨と円換算列を持つ。
    return head.includes('決済通貨') || head.includes('[円換算]') ? 'historyUs' : 'historyJp'
  }
  return null
}

export const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
