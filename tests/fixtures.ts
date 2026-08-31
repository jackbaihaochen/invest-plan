import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decodeCp932 } from '../src/domain/csv'

const dir = fileURLToPath(new URL('./fixtures/rakuten/', import.meta.url))

/** 実ファイルをバイト列のまま読んで CP932 として復号する。変換済みを置かない。 */
function load(name: string): string {
  return decodeCp932(readFileSync(dir + name))
}

export const SNAPSHOT_FILE = 'assetbalance(all)_20260829_231124.csv'
export const snapshotCsv = () => load(SNAPSHOT_FILE)
export const jpHistoryCsv = () => load('adjusthistory(JP)_20260829.csv')
export const usHistoryCsv = () => load('adjusthistory(US)_20260829.csv')
