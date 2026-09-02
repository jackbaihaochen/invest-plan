import { useEffect, useMemo, useState } from 'react'
import { buildModel } from './domain/model'
import { type FileKind, type RawFile, type Store, EMPTY, load, newId, save, withValuePoint } from './store'
import { Import } from './ui/Import'
import { AssetsCard, EntryForm, MonthCard, PaceCard } from './ui/Dashboard'
import { GrowthCard } from './ui/Growth'
import { CategoryCard, EntriesCard, MonthlyCard, PositionsCard, TxnsCard } from './ui/Panels'
import { yen } from './format'

export function App() {
  const [store, setStore] = useState<Store>(EMPTY)
  const [recording, setRecording] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => { setStore(load()) }, [])

  /* 前の状態から作る。まとめて3ファイル落とすと onImport が同じ tick で
     3回走るので、閉じ込めた store を使うと最後の1つしか残らない。 */
  const update = (fn: (prev: Store) => Store) =>
    setStore((prev) => { const next = fn(prev); save(next); return next })

  const plan = { goalJpy: store.settings.goalJpy, annualRate: store.settings.annualRate }

  const model = useMemo(() => buildModel({
    ...(store.snapshot ? { snapshot: store.snapshot } : {}),
    ...(store.historyJp ? { historyJp: store.historyJp } : {}),
    ...(store.historyUs ? { historyUs: store.historyUs } : {}),
    entries: store.entries,
    valuePoints: store.valuePoints,
    plan: { goalJpy: store.settings.goalJpy, annualRate: store.settings.annualRate },
    plannedMonthlyJpy: store.settings.plannedMonthlyJpy,
    ringTargetJpy: store.settings.ringTargetJpy,
  }), [store])

  const files: Partial<Record<FileKind, RawFile>> = {
    ...(store.snapshot ? { snapshot: store.snapshot } : {}),
    ...(store.historyJp ? { historyJp: store.historyJp } : {}),
    ...(store.historyUs ? { historyUs: store.historyUs } : {}),
  }
  const hasData = store.snapshot !== undefined || store.historyJp !== undefined

  return (
    <div className="app">
      <header className="stack" style={{ gap: 2 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>1億円プロジェクト</div>
        <div className="muted small">楽天証券 · 数据全部留在这台设备上</div>
      </header>

      {model.problems.map((p) => <div key={p} className="banner bad">{p}</div>)}
      {flash && <div className="banner good">{flash}</div>}

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
            update((s) => ({ ...s, entries: [...s.entries, { id: newId(), on, amountJpy, note }] }))
            setRecording(false)
            setFlash(`记下了 ${yen(amountJpy)}。下次导入 CSV 时会自动核对。`)
          }}
        />
      )}

      {hasData && !recording && (
        <>
          <EntriesCard
            resolved={model.resolved}
            onDismiss={(id) => update((s) => ({
              ...s,
              entries: s.entries.map((e) => (e.id === id ? { ...e, dismissed: true } : e)),
            }))}
          />
          <MonthlyCard model={model} />
          <CategoryCard model={model} />
          <PositionsCard model={model} />
          <TxnsCard model={model} />
        </>
      )}

      <Import
        files={files}
        onImport={(kind, file) => update((s) => {
          const next = { ...s, [kind]: file }
          return kind === 'snapshot' ? withValuePoint(next, file) : next
        })}
      />

      <footer className="small muted">
        本工具仅用于个人记录，不构成投资建议。
      </footer>
    </div>
  )
}
