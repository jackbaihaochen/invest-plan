import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decodeCp932 } from '../src/domain/csv'

/**
 * テストが読む CSV は作り物で、`make-rakuten.mjs` が生成する。本物の取引データは
 * コミットしない。構造（CP932・列順・ヘッダの重複・区分の網羅）は本物と同じに
 * してあるので、解析器の落とし穴はここで踏める。
 *
 * 本物のファイルを `rakuten-private/`（.gitignore 済み）に置くと、`real-data.test.ts`
 * が自己整合のチェックだけ追加で走る。**CI の緑より手元の緑のほうが強い証拠**
 * —— 作り物が通っても、券商が書式を変えていないことの証明にはならない。
 */
const dir = fileURLToPath(new URL('./fixtures/rakuten/', import.meta.url))
const privateDir = fileURLToPath(new URL('./fixtures/rakuten-private/', import.meta.url))

/** 実ファイルをバイト列のまま読んで CP932 として復号する。変換済みを置かない。 */
const load = (base: string, name: string): string => decodeCp932(readFileSync(base + name))

export const SNAPSHOT_FILE = 'assetbalance(all)_20260829_231124.csv'
const JP_FILE = 'adjusthistory(JP)_20260829.csv'
const US_FILE = 'adjusthistory(US)_20260829.csv'

export const snapshotCsv = () => load(dir, SNAPSHOT_FILE)
export const jpHistoryCsv = () => load(dir, JP_FILE)
export const usHistoryCsv = () => load(dir, US_FILE)

export const hasRealFiles = (): boolean => existsSync(privateDir + SNAPSHOT_FILE)
export const realSnapshotCsv = () => load(privateDir, SNAPSHOT_FILE)
export const realJpHistoryCsv = () => load(privateDir, JP_FILE)
export const realUsHistoryCsv = () => load(privateDir, US_FILE)
