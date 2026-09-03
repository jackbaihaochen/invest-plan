import { useState } from 'react'
import type { Model } from '../domain/model'
import { daysSooner } from '../domain/projection'
import type { Plan } from '../domain/projection'
import { pct, span, yen, yenShort, ymd } from '../format'

/** 実績年率がどの期間のものかを言うため。始点だけだと将来の約束に読める。 */
const flowPeriod = (model: Model): string => {
  const first = model.txns.filter((t) => t.netJpy !== 0).map((t) => t.settledOn).sort()[0]
  const last = model.snapshot?.asOf
  return first && last ? `${ymd(first)}〜${ymd(last)}` : ''
}

/* ── 今月の環 ───────────────────────────────────────── */

const R = 46
const C = 2 * Math.PI * R

function Ring({ confirmed, pending, target }: { confirmed: number; pending: number; target: number }) {
  const frac = (v: number) => (target <= 0 ? 0 : Math.max(0, Math.min(1, v / target)))
  const done = frac(confirmed)
  const prov = frac(confirmed + pending) - done
  const total = done + prov

  return (
    <svg className="ring" width="118" height="118" viewBox="0 0 118 118" aria-hidden>
      <circle cx="59" cy="59" r={R} fill="none" stroke="var(--line)" strokeWidth="11" />
      <g transform="rotate(-90 59 59)">
        {/* 0 のときは描かない。丸い線端が残って、進んでいるように見える。 */}
        {done + prov > 0 && (
          <circle
            cx="59" cy="59" r={R} fill="none" stroke="var(--pending)" strokeWidth="11"
            strokeDasharray={`${(done + prov) * C} ${C}`} strokeLinecap="round"
          />
        )}
        {done > 0 && (
          <circle
            cx="59" cy="59" r={R} fill="none" stroke="var(--accent)" strokeWidth="11"
            strokeDasharray={`${done * C} ${C}`} strokeLinecap="round"
          />
        )}
      </g>
      <text
        x="59" y="64" textAnchor="middle" className="ring-hole num"
        fill={total >= 1 ? 'var(--good)' : 'var(--ink)'}
      >
        {Math.round(total * 100)}%
      </text>
    </svg>
  )
}

export function MonthCard({ model, onRecord }: { model: Model; onRecord: () => void }) {
  const m = model.thisMonth
  const hit = m.totalJpy >= m.targetJpy
  return (
    <div className="card stack" style={{ gap: 14 }}>
      <h2>今月の投入 · {m.ym}</h2>
      <div className="ring-wrap">
        <Ring confirmed={m.confirmedJpy} pending={m.pendingJpy} target={m.targetJpy} />
        <div className="stack" style={{ flex: 1 }}>
          <div className="big num">{yen(m.totalJpy)}</div>
          <div className="muted small num">目标 {yen(m.targetJpy)} · 剩 {m.daysLeft} 天</div>
          {hit
            ? <div className="good num" style={{ fontWeight: 600 }}>已达标 ✓</div>
            : <div className="num" style={{ fontWeight: 600 }}>还差 {yen(m.remainingJpy)}</div>}
          {m.pendingJpy > 0 && (
            <div className="small" style={{ color: 'var(--pending)' }}>
              其中 {yen(m.pendingJpy)} 是你自己记的，等 CSV 确认
            </div>
          )}
        </div>
      </div>
      <button className="primary" onClick={onRecord}>記録する — 我刚投了一笔</button>
    </div>
  )
}

/* ── 记录一笔 ───────────────────────────────────────── */

interface FormProps {
  plan: Plan
  presentJpy: number
  paceJpy: number
  onSubmit: (amountJpy: number, on: string, note: string) => void
  onCancel: () => void
}

export function EntryForm({ plan, presentJpy, paceJpy, onSubmit, onCancel }: FormProps) {
  const today = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
  const [amount, setAmount] = useState('')
  const [on, setOn] = useState(today)
  const [note, setNote] = useState('')

  const value = Number(amount.replace(/[^\d-]/g, ''))
  const valid = Number.isFinite(value) && value > 0
  const sooner = valid ? daysSooner(plan, presentJpy, paceJpy, value) : 0

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <h2>投入を記録</h2>
      <div className="banner warn small">
        記録するのは<b>証券口座に移した金額</b>。口座にある預り金で買っただけなら資産は増えない。
        毎月の積立は CSV から自動で入るので記録しなくていい。
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="amt">金额（円）</label>
          <input
            id="amt" inputMode="numeric" autoFocus placeholder="50000"
            value={amount} onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="on">日付</label>
          <input id="on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="note">備考（任意）</label>
        <input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="オルカン 買い増し" />
      </div>

      <div className="banner good num" style={{ opacity: valid ? 1 : 0.35 }}>
        {valid
          ? <>这一笔让 1 亿提前 <b>{sooner.toFixed(1)} 天</b></>
          : <>填入金额就能看到它让目标提前多久</>}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" disabled={!valid} onClick={() => onSubmit(value, on, note)}>
          記録する
        </button>
        <button onClick={onCancel}>やめる</button>
      </div>
    </div>
  )
}

/* ── 落后多久 ───────────────────────────────────────── */

const dateOf = (d: { year: number; month: number } | null) =>
  d ? `${d.year}年${d.month}月` : '—'

export function PaceCard({ model, plannedMonthlyJpy, annualRate, onRate }: {
  model: Model
  plannedMonthlyJpy: number
  annualRate: number
  onRate: (rate: number) => void
}) {
  const behind = model.behindMonths
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <h2>到 1 亿还要多久</h2>
      <div className="row">
        <div className="stack">
          <div className="small muted">按近 6 个月平均 {yenShort(model.recentPaceJpy)}/月</div>
          <div className="big num">{dateOf(model.atPaceDate)}</div>
          <div className="small muted num">{span(model.atPaceMonths)}</div>
        </div>
        <div className="stack" style={{ textAlign: 'right' }}>
          <div className="small muted">按计划 {yenShort(plannedMonthlyJpy)}/月</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{dateOf(model.atPlanDate)}</div>
          <div className="small muted num">{span(model.atPlanMonths)}</div>
        </div>
      </div>
      {Number.isFinite(behind) && (
        <div className={behind > 0 ? 'banner bad num' : 'banner good num'}>
          {behind > 0 ? <>落后计划 <b>{span(behind)}</b></> : <>比计划提前 <b>{span(-behind)}</b></>}
        </div>
      )}
      {/* 年率はこちらで決めない。前提として見せて、動かせるようにしておく。 */}
      <div className="row small muted">
        <label htmlFor="rate">前提の年率</label>
        <select
          id="rate" style={{ width: 'auto' }} value={String(annualRate)}
          onChange={(e) => onRate(Number(e.target.value))}
        >
          {[0, 0.03, 0.05, 0.07, 0.1].map((r) => (
            <option key={r} value={r}>{(r * 100).toFixed(0)}%</option>
          ))}
        </select>
      </div>
    </div>
  )
}

/* ── 这个数字是什么时候的 ───────────────────────────── */

/**
 * 総資産は日付が一つではない —— 投信は基準価額メールの当日値、それ以外は
 * CSV を取り込んだ日の値のまま。**混ざっていること自体を書く。**
 * 片方の日付だけ出すと、そうでない部分まで新しいように読める。
 */
function Freshness({ model }: { model: Model }) {
  const r = model.repriced
  const snap = model.snapshot
  if (!snap) return null

  if (r?.pricedOn) {
    return (
      <div className="stack" style={{ gap: 4 }}>
        <div className="small muted">
          評価額は <b>{ymd(r.pricedOn)}</b> 时点 —— 其中 <b>{pct(r.repricedShare)}</b> 是当天的基準価額，
          剩下的 {pct(1 - r.repricedShare)}（美股・金・日本股）还停在
          {r.baseAsOf ? ` ${ymd(r.baseAsOf)}` : '快照'} 的价格。
        </div>
        {r.missing.length > 0 && (
          <div className="small warn">
            这几只当天没收到基準価額，按快照价算：{r.missing.join('、')}
          </div>
        )}
        {r.ambiguous.length > 0 && (
          <div className="small bad">
            名字对不上，没敢用这些价格（宁可停在快照价，也不能安错）：{r.ambiguous.join('、')}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="small muted">
      {snap.asOf
        ? <>評価額は {ymd(snap.asOf)} 时点 —— <b>全部</b>停在这一天，还没有日次的基準価額</>
        : <span className="warn">CSV のファイル名から取得日を読めませんでした — 評価額がいつのものか不明です</span>}
    </div>
  )
}

/* ── 资产 ───────────────────────────────────────────── */

export function AssetsCard({ model, goalJpy }: { model: Model; goalJpy: number }) {
  const snap = model.snapshot
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2>现在的资产</h2>
      <div className="huge num">{yen(model.totalAssetsJpy)}</div>
      <div className="muted num">
        距 1 亿还差 {yen(goalJpy - model.totalAssetsJpy)} · 已完成 {pct(model.totalAssetsJpy / goalJpy)}
      </div>
      <table style={{ marginTop: 6 }}>
        <tbody>
          <tr>
            <td>累计投入（净入金）</td>
            <td className="n num">{yen(model.netInflowJpy)}</td>
          </tr>
          <tr>
            <td>总回报 <span className="muted small">含已实现和分红</span></td>
            <td className="n num good">{yen(model.totalReturnJpy)}</td>
          </tr>
          <tr>
            <td>其中未实现 <span className="muted small">CSV 的評価損益</span></td>
            <td className="n num">{yen(model.unrealizedJpy)}</td>
          </tr>
          {model.mwr !== null && (
            <tr>
              <td>
                实际年化回报 <span className="muted small">金额加权 · {flowPeriod(model)}</span>
              </td>
              <td className="n num good">{pct(model.mwr)}</td>
            </tr>
          )}
          <tr>
            <td>NISA 生涯枠 <span className="muted small">按取得価額</span></td>
            <td className="n num">{yen(model.nisa.usedJpy)} / {pct(model.nisa.share)}</td>
          </tr>
        </tbody>
      </table>
      {snap && <Freshness model={model} />}
    </div>
  )
}
