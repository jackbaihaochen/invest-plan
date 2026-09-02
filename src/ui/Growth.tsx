import { useState } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Point } from '../domain/growth'
import { projectionSeries, requiredMonthly } from '../domain/growth'
import type { Model } from '../domain/model'
import type { Plan } from '../domain/projection'
import { yen, yenShort, ymd } from '../format'

const tick = (t: number) => `${new Date(t).getFullYear()}`

/** 目盛りは年の頭に置く。等間隔に刻むと「2024 2024 2024 2025」と同じ年が並ぶ。 */
function yearTicks(rows: readonly Record<string, number>[]): number[] {
  const first = rows[0]?.['t']
  const last = rows[rows.length - 1]?.['t']
  if (first === undefined || last === undefined) return []
  const from = new Date(first).getFullYear()
  const to = new Date(last).getFullYear()
  const step = Math.ceil((to - from + 1) / 7) // 目盛りは7本まで
  const out: number[] = []
  for (let y = from + 1; y <= to; y += step) out.push(new Date(y, 0, 1).getTime())
  return out
}

/** 系列ごとに日付が違うので、時刻をキーに1本の配列へ畳む。 */
function merge(series: Record<string, Point[]>): Record<string, number>[] {
  const by = new Map<number, Record<string, number>>()
  for (const [key, points] of Object.entries(series)) {
    for (const p of points) {
      const row = by.get(p.t) ?? { t: p.t }
      row[key] = p.jpy
      by.set(p.t, row)
    }
  }
  return [...by.values()].sort((a, b) => a['t']! - b['t']!)
}

const NAMES: Record<string, string> = {
  principal: '累计投入（本金）',
  value: '实测总资产',
  pace: '按现在的速度',
  plan: '按计划',
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: readonly { dataKey?: string | number; value?: number; color?: string }[]
  label?: number
}) {
  if (!active || !payload?.length || label === undefined) return null
  return (
    <div className="card small" style={{ padding: 10, gap: 3, display: 'grid' }}>
      <div className="muted">{new Date(label).toLocaleDateString('sv-SE').replace(/-/g, '/')}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="num" style={{ color: p.color }}>
          {NAMES[String(p.dataKey)] ?? p.dataKey} {yen(p.value ?? 0)}
        </div>
      ))}
    </div>
  )
}

/* ── これまで ───────────────────────────────────────── */

function SoFar({ model }: { model: Model }) {
  const data = merge({ principal: model.principal, value: model.values })
  const latest = model.values[model.values.length - 1]
  const principalNow = model.principal[model.principal.length - 1]?.jpy ?? 0
  const gain = (latest?.jpy ?? 0) - principalNow
  const gainShare = latest && latest.jpy > 0 ? gain / latest.jpy : 0

  return (
    <>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
              ticks={yearTicks(data)} tickFormatter={tick} stroke="var(--muted)" fontSize={11}
            />
            <YAxis tickFormatter={yenShort} stroke="var(--muted)" fontSize={11} width={52} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              dataKey="principal" stroke="var(--c1)" strokeWidth={2}
              fill="var(--accent-soft)" connectNulls dot={false} activeDot={{ r: 4 }}
            />
            {/* 点が1つしかない間は dot を出さないと何も描かれない。 */}
            <Line
              dataKey="value" stroke="var(--good)" strokeWidth={2}
              connectNulls dot={{ r: 4, fill: 'var(--good)', strokeWidth: 0 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="legend">
        <span><i style={{ background: 'var(--c1)' }} />累计投入（本金）</span>
        <span><i className="dot" style={{ background: 'var(--good)' }} />实测总资产</span>
      </div>

      {latest && (
        <>
          <div className="split" style={{ marginTop: 4 }}>
            <div style={{ flex: Math.max(principalNow, 1), background: 'var(--c1)' }}>
              本金 {yenShort(principalNow)}
            </div>
            <div style={{ flex: Math.max(gain, 1), background: 'var(--good)' }}>
              收益 {yenShort(gain)}
            </div>
          </div>
          <div className="small muted num">
            {ymd(latest.on)} 时点 {yen(latest.jpy)} —— 其中 {(gainShare * 100).toFixed(1)}% 不是你存进去的
          </div>
        </>
      )}

      <div className="banner warn small">
        蓝线是<b>投入的本金</b>，不是当时的资产。过去每天的评价额在任何一份 CSV 里都没有，
        推不出来。绿点是每次导入保有商品 CSV 时记下的实测值 ——
        {model.values.length <= 1
          ? ' 现在只有 1 个点，以后每导入一次多一个。'
          : ` 目前 ${model.values.length} 个点。`}
      </div>
    </>
  )
}

/* ── 1億まで ────────────────────────────────────────── */

function ToGoal({ model, plan, plannedMonthlyJpy }: {
  model: Model
  plan: Plan
  plannedMonthlyJpy: number
}) {
  const now = new Date()
  const present = model.totalAssetsJpy
  const data = merge({
    pace: projectionSeries(plan, present, model.recentPaceJpy, now),
    plan: projectionSeries(plan, present, plannedMonthlyJpy, now),
  })
  const targets = [10, 15, 20].map((y) => ({
    years: y,
    year: now.getFullYear() + y,
    monthlyJpy: requiredMonthly(plan, present, y * 12),
  }))

  return (
    <>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
              ticks={yearTicks(data)} tickFormatter={tick} stroke="var(--muted)" fontSize={11}
            />
            <YAxis tickFormatter={yenShort} stroke="var(--muted)" fontSize={11} width={52} />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={plan.goalJpy} stroke="var(--bad)" strokeDasharray="4 4" />
            <Line dataKey="plan" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            <Line dataKey="pace" stroke="var(--c1)" strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="legend">
        <span><i style={{ background: 'var(--c1)' }} />按现在的速度 {yenShort(model.recentPaceJpy)}/月</span>
        <span><i style={{ background: 'var(--muted)' }} />按计划 {yenShort(plannedMonthlyJpy)}/月</span>
        <span><i style={{ background: 'var(--bad)' }} />1 亿</span>
      </div>

      <h2 style={{ margin: '10px 0 0' }}>想在这一年到达，每月要投多少</h2>
      <table>
        <tbody>
          {targets.map((t) => (
            <tr key={t.years}>
              <td>{t.year} 年 <span className="muted small">{t.years} 年后</span></td>
              <td className="n num" style={{ fontWeight: 600 }}>{yen(t.monthlyJpy)}</td>
              <td className="n num muted small">
                {t.monthlyJpy > model.recentPaceJpy
                  ? `比现在多 ${yenShort(t.monthlyJpy - model.recentPaceJpy)}`
                  : '已经够了'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small muted">
        按年率 {(plan.annualRate * 100).toFixed(0)}% 复利、每月末投入计算。年率是假设，不是承诺。
      </div>
    </>
  )
}

/* ── カード ─────────────────────────────────────────── */

export function GrowthCard({ model, plan, plannedMonthlyJpy }: {
  model: Model
  plan: Plan
  plannedMonthlyJpy: number
}) {
  const [view, setView] = useState<'soFar' | 'toGoal'>('soFar')
  if (model.principal.length === 0) return null

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>资产的成长</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={view === 'soFar' ? 'ghost on' : 'ghost'}
            onClick={() => setView('soFar')}
          >
            这些年
          </button>
          <button
            className={view === 'toGoal' ? 'ghost on' : 'ghost'}
            onClick={() => setView('toGoal')}
          >
            到 1 亿
          </button>
        </div>
      </div>
      {view === 'soFar'
        ? <SoFar model={model} />
        : <ToGoal model={model} plan={plan} plannedMonthlyJpy={plannedMonthlyJpy} />}
    </div>
  )
}
