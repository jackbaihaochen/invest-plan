import type { Dataset } from '../domain/model'
import { type Tables, datasetToTables, tablesToDataset } from './table'

/**
 * Apps Script Web App との通信。**通信の癖はここだけに閉じ込める。**
 *
 * 判っている制約:
 *  - クロスオリジンの POST に `application/json` を付けると preflight OPTIONS が飛び、
 *    Apps Script はそれに答えない。`text/plain` で JSON を送れば単純リクエストになる。
 *  - レスポンスは script.google.com から googleusercontent.com へリダイレクトされる。
 *
 * どちらも本番の origin でしか確かめられないので、spike で検証してからここを確定する。
 * 検証結果によっては GET だけに退く —— そのときトークンが URL に載る（＝ログに残る）。
 */
export interface RemoteConfig {
  execUrl: string
  token: string
}

export interface RemoteState {
  dataset: Dataset
  /** サーバが最後に書き込んだ時刻。キャッシュの鮮度表示に使う。 */
  updatedAt: string | null
}

export class RemoteError extends Error {
  constructor(message: string, readonly kind: 'denied' | 'network' | 'server') {
    super(message)
    this.name = 'RemoteError'
  }
}

interface Envelope {
  ok: boolean
  error?: string
  data?: { tables?: Partial<Tables>; updatedAt?: string | null }
}

async function call(cfg: RemoteConfig, action: string, payload: unknown): Promise<Envelope> {
  let res: Response
  try {
    res = await fetch(cfg.execUrl, {
      method: 'POST',
      // application/json にしないこと。preflight が飛んで届かなくなる。
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: cfg.token, action, payload }),
      redirect: 'follow',
    })
  } catch (e) {
    // 画面側が「连不上服务器（…）」と包むので、ここは原因だけを返す。
    throw new RemoteError((e as Error).message, 'network')
  }
  if (!res.ok) throw new RemoteError(`HTTP ${res.status}`, 'server')

  let body: Envelope
  try {
    body = JSON.parse(await res.text()) as Envelope
  } catch {
    // ログイン画面の HTML が返ることがある。デプロイのアクセス設定を疑う。
    throw new RemoteError('返回的不是 JSON —— 检查部署的访问权限是否为「任何人」', 'server')
  }
  if (!body.ok) {
    throw new RemoteError(
      body.error === 'denied' ? '令牌不对' : `服务器出错: ${body.error}`,
      body.error === 'denied' ? 'denied' : 'server',
    )
  }
  return body
}

export async function loadRemote(cfg: RemoteConfig): Promise<RemoteState> {
  const body = await call(cfg, 'load', null)
  return {
    dataset: tablesToDataset(body.data?.tables ?? {}),
    updatedAt: body.data?.updatedAt ?? null,
  }
}

/**
 * 送るのは常に全体。差分にすると「どちらが新しいか」を両側で持つことになり、
 * ずれたときに黙って古い数字を見せる。一人で使う道具にその複雑さは要らない。
 */
export async function saveRemote(cfg: RemoteConfig, data: Dataset): Promise<void> {
  await call(cfg, 'save', { tables: datasetToTables(data) })
}

/** 設定画面用。トークンが通るかだけを見る。 */
export async function ping(cfg: RemoteConfig): Promise<boolean> {
  await call(cfg, 'ping', null)
  return true
}
