import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { Model } from '../domain/model'
import type { Resolved } from '../domain/contribution'
import { monthLabel, pct, yen, yenShort, ymd } from '../format'

/* 色は index.css の --c1..--c6 に持たせる。ここに16進を書かない。 */
const color = (i: number): string => `var(--c${(i % 6) + 1})`

export function CategoryCard({ model }: { model: Model }) {
  if (model.categories.length === 0) return null
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2>资产分类</h2>
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={model.categories} dataKey="marketValueJpy" nameKey="kind"
              innerRadius={52} outerRadius={82} paddingAngle={2} stroke="none"
            >
              {model.categories.map((c, i) => (
                <Cell key={c.kind} fill={color(i)} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => yen(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <table>
        <tbody>
          {model.categories.map((c, i) => (
            <tr key={c.kind}>
              <td>
                <span style={{
                  display: 'inline-block', width: 9, height: 9, borderRadius: 3,
                  background: color(i), marginRight: 8,
                }} />
                {c.kind}
                {!c.livePrice && <span className="tag" style={{ marginLeft: 8 }}>价格停在快照日</span>}
              </td>
              <td className="n num">{yen(c.marketValueJpy)}</td>
              <td className="n num muted">{pct(c.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MonthlyCard({ model }: { model: Model }) {
  const months = [...model.monthly].slice(-24)
  if (months.length === 0) return null

  /* 上下の帯を最大値の比で割る。こうすると正負が同じ「円/px」になり、
     取り崩した月の深さがそのまま比べられる。 */
  const up = Math.max(...months.map(([, v]) => Math.max(v, 0)), 1)
  const down = Math.max(...months.map(([, v]) => Math.max(-v, 0)), 0)
  const span = up + down

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2>月次の純入金 · 直近 {months.length} ヶ月</h2>
      <div className="bars">
        {months.map(([ym, v]) => (
          <div key={ym} className="bar-col" title={`${monthLabel(ym)} ${yen(v)}`}>
            <div className="bar-up" style={{ flexBasis: `${(up / span) * 100}%` }}>
              {v > 0 && <div style={{ height: `${(v / up) * 100}%`, background: 'var(--accent)' }} />}
            </div>
            {down > 0 && (
              <div className="bar-down" style={{ flexBasis: `${(down / span) * 100}%` }}>
                {/* 取り崩した月は下向きの棒で出す。隠すと平均だけが不自然に見える。 */}
                {v < 0 && <div style={{ height: `${(-v / down) * 100}%`, background: 'var(--bad)' }} />}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row small muted">
        <span>{monthLabel(months[0]![0])}</span>
        <span>{down > 0 ? '横线以下 = 那个月净取出' : '负柱 = 那个月净取出'}</span>
        <span>{monthLabel(months[months.length - 1]![0])}</span>
      </div>
    </div>
  )
}

export function EntriesCard({ resolved, onDismiss }: {
  resolved: readonly Resolved[]
  onDismiss: (id: string) => void
}) {
  const shown = resolved.filter((r) => r.status !== 'dismissed').slice().reverse()
  if (shown.length === 0) return null
  const LABEL = { pending: '待 CSV 确认', confirmed: 'CSV 已确认', unmatched: 'CSV 里找不到' } as const
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2>我记的投入</h2>
      {shown.some((r) => r.status === 'unmatched') && (
        <div className="banner bad small">
          有记录在 CSV 的覆盖范围内却找不到对应入金 —— 可能是记错了，也可能是钱没到。
          这些不计入进度。
        </div>
      )}
      <table>
        <tbody>
          {shown.map((r) => (
            <tr key={r.entry.id}>
              <td className="muted small num">{ymd(r.entry.on)}</td>
              <td className="n num">{yen(r.entry.amountJpy)}</td>
              <td><span className={`tag ${r.status}`}>{LABEL[r.status as keyof typeof LABEL]}</span></td>
              <td className="muted small">{r.entry.note}</td>
              <td className="n">
                {r.status === 'unmatched' && (
                  <button className="ghost" onClick={() => onDismiss(r.entry.id)}>无视</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PositionsCard({ model }: { model: Model }) {
  const snap = model.snapshot
  if (!snap) return null
  const rows = [...snap.positions].sort((a, b) => b.marketValueJpy - a.marketValueJpy)
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2>持仓 · {rows.length} 件</h2>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>銘柄</th><th>口座</th>
              <th className="n">数量</th><th className="n">評価額</th><th className="n">損益</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={`${p.name}-${p.account}-${i}`}>
                <td>{p.name}</td>
                <td className="muted small">{p.account === '-' ? '—' : p.account}</td>
                <td className="n num muted">
                  {p.quantity.toLocaleString('ja-JP')}<span className="small"> {p.quantityUnit}</span>
                </td>
                <td className="n num">{yenShort(p.marketValueJpy)}</td>
                <td className={p.gainJpy >= 0 ? 'n num good' : 'n num bad'}>
                  {yenShort(p.gainJpy)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const FLOW_LABEL = {
  inflow: '入金', outflow: '出金', internal: '口座内', income: '収益',
} as const

export function TxnsCard({ model }: { model: Model }) {
  const [flow, setFlow] = useState<'all' | keyof typeof FLOW_LABEL>('inflow')
  const [limit, setLimit] = useState(30)
  if (model.txns.length === 0) return null

  const rows = model.txns
    .filter((t) => flow === 'all' || t.flow === flow)
    .sort((a, b) => b.settledOn.localeCompare(a.settledOn))

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2>交易记录 · 全部 {model.txns.length} 件</h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['all', 'inflow', 'outflow', 'internal', 'income'] as const).map((f) => (
          <button
            key={f} className="ghost"
            style={f === flow ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            onClick={() => { setFlow(f); setLimit(30) }}
          >
            {f === 'all' ? '全部' : FLOW_LABEL[f]}
          </button>
        ))}
      </div>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>受渡日</th><th>取引区分</th><th>銘柄</th>
              <th className="n">金額</th><th>意味</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((t, i) => (
              <tr key={`${t.settledOn}-${t.type}-${i}`}>
                <td className="muted small num">{ymd(t.settledOn)}</td>
                <td className="small">{t.type}</td>
                <td className="muted small">{t.security === '-' ? '' : t.security}</td>
                <td className="n num">
                  {t.receivedJpy > 0 ? yenShort(t.receivedJpy) : yenShort(-t.paidJpy)}
                </td>
                <td><span className={`tag ${t.flow}`}>{FLOW_LABEL[t.flow]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button className="ghost" onClick={() => setLimit(limit + 100)}>
          还有 {rows.length - limit} 件 — 再显示 100 件
        </button>
      )}
      <div className="small muted">
        「口座内」是账户里的买卖和振替，不改变总资产；「収益」是分红和利息，
        增加资产但不算投入。只有「入金」「出金」计入投入。
      </div>
    </div>
  )
}
