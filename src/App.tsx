import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Dataset, EMPTY_DATASET, buildModel, isEmptyDataset } from './domain/model'
import {
  type FileKind, type RawFile, type Store, EMPTY, datasetOf, load, loadToken, newId,
  save, saveToken, withDataset, withImport,
} from './store'
import { RemoteError, loadRemote, saveRemote } from './sync/remote'
import { Import } from './ui/Import'
import { AssetsCard, EntryForm, MonthCard, PaceCard } from './ui/Dashboard'
import { GrowthCard } from './ui/Growth'
import { type SyncStatus, MigrationCard, SyncBanner, SyncCard } from './ui/Sync'
import { CategoryCard, EntriesCard, MonthlyCard, PositionsCard, TxnsCard } from './ui/Panels'
import { yen } from './format'

export function App() {
  const [store, setStore] = useState<Store>(EMPTY)
  const [token, setToken] = useState('')
  const [recording, setRecording] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncStatus>({ kind: 'off' })
  const [askMigrate, setAskMigrate] = useState(false)

  /* 前の状態から作る。まとめて3ファイル落とすと onImport が同じ tick で
     3回走るので、閉じ込めた store を使うと最後の1つしか残らない。 */
  const update = useCallback((fn: (prev: Store) => Store) =>
    setStore((prev) => { const next = fn(prev); save(next); return next }), [])

  /* ── 起動 ─────────────────────────────────────────── */

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const s = load()
    setStore(s)
    // 移行した形をその場で書き戻す。放っておくと保存済みは v1 のままで、
    // 次の移行を書くときに v1 の面倒をまた見ることになる。
    save(s)
    setToken(loadToken())
  }, [])

  const cfg = store.execUrl && token ? { execUrl: store.execUrl, token } : null

  const pull = useCallback(async (execUrl: string, tok: string) => {
    setSync({ kind: 'loading' })
    try {
      const remote = await loadRemote({ execUrl, token: tok })
      const at = new Date().toISOString()
      if (isEmptyDataset(remote.dataset)) {
        // サーバが空。手元に何かあるなら、どちらを残すかは本人に訊く。
        setStore((prev) => {
          if (isEmptyDataset(datasetOf(prev))) return { ...prev, lastSyncedAt: at }
          setAskMigrate(true)
          return prev
        })
      } else {
        update((prev) => ({ ...withDataset(prev, remote.dataset), lastSyncedAt: at }))
      }
      setSync({ kind: 'ok', at })
    } catch (e) {
      const err = e as RemoteError
      setSync(err.kind === 'denied'
        ? { kind: 'denied' }
        : { kind: 'offline', message: err.message })
    }
  }, [update])

  // 設定が揃ったら一度だけ引く。以降は手動同期か、書き込みのついで。
  const pulled = useRef('')
  useEffect(() => {
    if (!cfg) { setSync({ kind: 'off' }); return }
    const key = `${cfg.execUrl}|${cfg.token}`
    if (pulled.current === key) return
    pulled.current = key
    void pull(cfg.execUrl, cfg.token)
  }, [cfg, pull])

  /** 変更をサーバへ。失敗しても手元の変更は残す —— 消してはいけない。 */
  const push = useCallback(async (dataset: Dataset) => {
    if (!cfg) return
    setSync({ kind: 'loading' })
    try {
      await saveRemote(cfg, dataset)
      const at = new Date().toISOString()
      update((prev) => ({ ...prev, lastSyncedAt: at }))
      setSync({ kind: 'ok', at })
    } catch (e) {
      const err = e as RemoteError
      setSync(err.kind === 'denied'
        ? { kind: 'denied' }
        : { kind: 'offline', message: err.message })
    }
  }, [cfg, update])

  /** 手元を変えてから送る。順番が逆だと、送信に失敗したとき変更が消える。 */
  const change = useCallback((fn: (d: Dataset) => Dataset) => {
    setStore((prev) => {
      const next = withDataset(prev, fn(datasetOf(prev)))
      save(next)
      void push(datasetOf(next))
      return next
    })
  }, [push])

  /* ── モデル ───────────────────────────────────────── */

  const dataset = useMemo(() => datasetOf(store), [store])
  const plan = { goalJpy: store.settings.goalJpy, annualRate: store.settings.annualRate }
  const model = useMemo(() => buildModel(dataset, {
    plan,
    plannedMonthlyJpy: store.settings.plannedMonthlyJpy,
    ringTargetJpy: store.settings.ringTargetJpy,
  }), [dataset, store.settings])

  const hasData = !isEmptyDataset(dataset)

  return (
    <div className="app">
      <header className="stack" style={{ gap: 2 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>1億円プロジェクト</div>
        <div className="muted small">楽天証券</div>
      </header>

      <SyncBanner status={sync} lastSyncedAt={store.lastSyncedAt} />
      {model.problems.map((p) => <div key={p} className="banner bad">{p}</div>)}
      {flash && <div className="banner good">{flash}</div>}

      {askMigrate && (
        <MigrationCard
          localCount={{
            txns: dataset.txns.length,
            entries: dataset.entries.length,
            values: dataset.valuePoints.length,
          }}
          onUpload={() => { setAskMigrate(false); void push(dataset) }}
          onStartFresh={() => {
            setAskMigrate(false)
            update((prev) => ({ ...withDataset(prev, EMPTY_DATASET), files: {} }))
          }}
        />
      )}

      {hasData && !recording && (
        <>
          <MonthCard model={model} onRecord={() => { setFlash(null); setRecording(true) }} />
          <AssetsCard model={model} goalJpy={store.settings.goalJpy} />
          <GrowthCard model={model} plan={plan} plannedMonthlyJpy={store.settings.plannedMonthlyJpy} />
          <PaceCard
            model={model}
            plannedMonthlyJpy={store.settings.plannedMonthlyJpy}
            annualRate={store.settings.annualRate}
            onRate={(annualRate) =>
              update((s) => ({ ...s, settings: { ...s.settings, annualRate } }))}
          />
        </>
      )}

      {recording && (
        <EntryForm
          plan={plan}
          presentJpy={model.totalAssetsJpy}
          paceJpy={model.recentPaceJpy}
          onCancel={() => setRecording(false)}
          onSubmit={(amountJpy, on, note) => {
            change((d) => ({ ...d, entries: [...d.entries, { id: newId(), on, amountJpy, note }] }))
            setRecording(false)
            setFlash(`记下了 ${yen(amountJpy)}。下次导入 CSV 时会自动核对。`)
          }}
        />
      )}

      {hasData && !recording && (
        <>
          <EntriesCard
            resolved={model.resolved}
            onDismiss={(id) => change((d) => ({
              ...d,
              entries: d.entries.map((e) => (e.id === id ? { ...e, dismissed: true } : e)),
            }))}
          />
          <MonthlyCard model={model} />
          <CategoryCard model={model} />
          <PositionsCard model={model} />
          <TxnsCard model={model} />
        </>
      )}

      <Import
        files={store.files as Partial<Record<FileKind, RawFile>>}
        onImport={(kind, file) => setStore((prev) => {
          const next = withImport(prev, kind, file)
          save(next)
          void push(datasetOf(next))
          return next
        })}
      />

      <SyncCard
        execUrl={store.execUrl}
        token={token}
        status={sync}
        lastSyncedAt={store.lastSyncedAt}
        onSave={(execUrl, tok) => {
          update((s) => ({ ...s, execUrl }))
          setToken(tok)
          saveToken(tok)
        }}
        onSync={() => { if (cfg) void pull(cfg.execUrl, cfg.token) }}
      />

      <footer className="small muted">
        本工具仅用于个人记录，不构成投资建议。
      </footer>
    </div>
  )
}
