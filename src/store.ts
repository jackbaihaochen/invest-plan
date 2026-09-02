import type { Entry } from './domain/contribution'
import type { ValuePoint } from './domain/growth'
import { type Dataset, datasetFromFiles } from './domain/model'
import { type Tables, datasetToTables, tablesToDataset } from './sync/table'

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

/** 取り込んだ CSV は生のまま持つ。解析を直したとき、取り込み直しの手間で済む。 */
export interface RawFile {
  name: string
  text: string
  importedAt: string
}

export type FileKind = 'snapshot' | 'historyJp' | 'historyUs'
export type Files = Partial<Record<FileKind, RawFile>>

export interface Store {
  version: 2
  files: Files
  /**
   * データ本体。Sheet と同じ形（表）で持つ。
   *
   * 解析結果ではなく CSV から毎回組み直していたのを改めた —— 第3段階では
   * 別の端末から「行」として降ってくるので、そちらに CSV は存在しない。
   * 代償は proposal §5 のとおり: 解析器を直しても過去のぶんは自動では直らない。
   */
  tables: Tables | null
  settings: Settings
  /** Apps Script の /exec。秘密ではないので、ここに置いてよい。 */
  execUrl: string
  /**
   * 最後にサーバと一致した時刻。つながらないときは、この日時を添えて
   * 手元の写しを出す —— 黙って古い数字を見せないための材料。
   */
  lastSyncedAt: string | null
}

export const EMPTY: Store = {
  version: 2, files: {}, tables: null, settings: DEFAULT_SETTINGS,
  execUrl: '', lastSyncedAt: null,
}

const KEY = 'invest-plan/v1'
/** トークンは別のキーに置く。設定を書き出すような操作で巻き添えにしないため。 */
const TOKEN_KEY = 'invest-plan/token'

/* ── 保存と読み出し ─────────────────────────────────── */

interface StoreV1 {
  version: 1
  snapshot?: RawFile
  historyJp?: RawFile
  historyUs?: RawFile
  entries?: Entry[]
  valuePoints?: ValuePoint[]
  settings?: Partial<Settings>
}

/**
 * v1（CSV と記録をばらばらに持っていた形）から v2 へ。
 *
 * **version が違うからと EMPTY を返してはいけない。** それはユーザーが記録した
 * 投入と、取り込み直せない過去の実測点を黙って捨てるということ。
 */
function migrateV1(old: StoreV1): Store {
  const files: Files = {}
  if (old.snapshot) files.snapshot = old.snapshot
  if (old.historyJp) files.historyJp = old.historyJp
  if (old.historyUs) files.historyUs = old.historyUs

  const dataset = datasetFromFiles(files, old.entries ?? [], old.valuePoints ?? [])
  return {
    version: 2,
    files,
    tables: datasetToTables(dataset),
    settings: { ...DEFAULT_SETTINGS, ...old.settings },
    execUrl: '',
    lastSyncedAt: null,
  }
}

export function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<Store> & Partial<StoreV1>
    if (parsed.version === 1) return migrateV1(parsed as StoreV1)
    if (parsed.version !== 2) return EMPTY
    return {
      ...EMPTY,
      ...(parsed as Store),
      version: 2,
      files: parsed.files ?? {},
      tables: parsed.tables ?? null,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      execUrl: parsed.execUrl ?? '',
      lastSyncedAt: parsed.lastSyncedAt ?? null,
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

export const loadToken = (): string => {
  try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' }
}

export const saveToken = (token: string): void => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* 同上 */ }
}

/* ── Dataset との橋渡し ─────────────────────────────── */

export const datasetOf = (store: Store): Dataset =>
  store.tables ? tablesToDataset(store.tables) : datasetFromFiles(store.files, [], [])

export const withDataset = (store: Store, dataset: Dataset): Store =>
  ({ ...store, tables: datasetToTables(dataset) })

/**
 * CSV を取り込む。記録と実測点は今のデータから引き継ぐ ——
 * 取り込みは「相場と取引の事実」を差し替えるだけで、手で書いたものには触らない。
 */
export function withImport(store: Store, kind: FileKind, file: RawFile): Store {
  const files = { ...store.files, [kind]: file }
  const current = datasetOf(store)
  const next = datasetFromFiles(files, current.entries, current.valuePoints)

  // 取り込んだ日の総資産を1点だけ残す。日付が読めないものは記録しない。
  const asOf = next.snapshot?.asOf
  const valuePoints = asOf
    ? [...current.valuePoints.filter((p) => p.on !== asOf),
      { on: asOf, totalJpy: next.snapshot!.totalJpy }].sort((a, b) => a.on.localeCompare(b.on))
    : current.valuePoints

  return { ...store, files, tables: datasetToTables({ ...next, valuePoints }) }
}

/**
 * どのファイルかは名前ではなく中身で見分ける。楽天のファイル名は
 * ダウンロードのたびに連番が付くし、名前を変えられても壊れないほうがいい。
 */
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
