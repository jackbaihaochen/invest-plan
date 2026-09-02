import { useState } from 'react'
import { ymd } from '../format'

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'loading' }
  | { kind: 'ok'; at: string }
  | { kind: 'denied' }
  | { kind: 'offline'; message: string }

const when = (iso: string | null): string =>
  iso ? `${ymd(iso.slice(0, 10))} ${iso.slice(11, 16)}` : '—'

/**
 * つながらないときに黙って古い数字を出さないための帯。
 *
 * Sheet を非公開にした代償で、読みも Apps Script に依存するようになった
 * （proposal §2・§8）。せめて「これはいつのものか」は必ず言う。
 */
export function SyncBanner({ status, lastSyncedAt }: {
  status: SyncStatus
  lastSyncedAt: string | null
}) {
  if (status.kind === 'ok' || status.kind === 'off') return null
  if (status.kind === 'loading') return <div className="banner small">同期中…</div>
  if (status.kind === 'denied') {
    return <div className="banner bad small">令牌不对 —— 下面重新填一次。显示的是这台设备上的副本。</div>
  }
  return (
    <div className="banner warn small">
      连不上服务器（{status.message}）。
      {lastSyncedAt
        ? <> 显示的是 <b>{when(lastSyncedAt)}</b> 同步下来的副本，之后的变化不在里面。</>
        : <> 这台设备还没同步过，显示的是本地数据。</>}
    </div>
  )
}

/** 別端末で入れたデータを、こちらの空の Sheet に上書きさせないための問い。 */
export function MigrationCard({ localCount, onUpload, onStartFresh }: {
  localCount: { txns: number; entries: number; values: number }
  onUpload: () => void
  onStartFresh: () => void
}) {
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <h2>服务器上是空的</h2>
      <div className="small">
        这台设备上有 <b>{localCount.txns}</b> 条交易、<b>{localCount.entries}</b> 条手动记录、
        <b>{localCount.values}</b> 个资产实测点。要把它们传上去，还是从空开始？
      </div>
      <div className="banner warn small">
        我不替你选。默认上传，会在你已经从别处存过东西时用旧盖新；
        默认清空，会悄悄弄丢你记过的投入。
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" onClick={onUpload}>把这台设备的数据传上去</button>
        <button onClick={onStartFresh}>从空开始</button>
      </div>
    </div>
  )
}

interface SetupProps {
  execUrl: string
  token: string
  status: SyncStatus
  lastSyncedAt: string | null
  onSave: (execUrl: string, token: string) => void
  onSync: () => void
}

export function SyncCard({ execUrl, token, status, lastSyncedAt, onSave, onSync }: SetupProps) {
  const [url, setUrl] = useState(execUrl)
  const [tok, setTok] = useState(token)
  const dirty = url !== execUrl || tok !== token
  const configured = execUrl !== '' && token !== ''

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <h2>多设备同步</h2>

      {!configured && (
        <div className="small muted">
          没配的话，数据只留在这台设备上。配好之后，手机和电脑看到同一份。
        </div>
      )}

      <div className="field">
        <label htmlFor="exec">Apps Script 的 /exec 地址</label>
        <input
          id="exec" value={url} onChange={(e) => setUrl(e.target.value.trim())}
          placeholder="https://script.google.com/macros/s/…/exec"
        />
      </div>
      <div className="field">
        <label htmlFor="token">令牌</label>
        <input
          id="token" type="password" value={tok} onChange={(e) => setTok(e.target.value.trim())}
          placeholder="你自己生成的那串"
        />
        <div className="small muted">
          只存在这台设备的浏览器里，不进代码仓库、不进网页包。换设备要再输一次。
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="primary" style={{ width: 'auto' }} disabled={!dirty}
          onClick={() => onSave(url, tok)}>
          保存并连接
        </button>
        {configured && <button onClick={onSync} disabled={status.kind === 'loading'}>立刻同步</button>}
      </div>

      {configured && (
        <div className="small muted num">
          状态：{
            status.kind === 'ok' ? `已同步 ${when(status.at)}`
              : status.kind === 'loading' ? '同步中…'
                : status.kind === 'denied' ? '令牌不对'
                  : `连不上 · 上次同步 ${when(lastSyncedAt)}`
          }
        </div>
      )}
    </div>
  )
}
