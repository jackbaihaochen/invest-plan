import { useRef, useState } from 'react'
import { decodeCp932 } from '../domain/csv'
import { type FileKind, type RawFile, detectKind } from '../store'
import { ymd } from '../format'

const LABEL: Record<FileKind, string> = {
  snapshot: '保有商品詳細',
  historyJp: '取引履歴（円）',
  historyUs: '取引履歴（外貨）',
}

interface Props {
  files: Partial<Record<FileKind, RawFile>>
  onImport: (kind: FileKind, file: RawFile) => void
}

export function Import({ files, onImport }: Props) {
  const [over, setOver] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const picker = useRef<HTMLInputElement>(null)

  async function take(list: FileList | null) {
    if (!list) return
    const msgs: string[] = []
    for (const f of Array.from(list)) {
      // 楽天の CSV は CP932。ブラウザの TextDecoder で復号する。
      const text = decodeCp932(await f.arrayBuffer())
      const kind = detectKind(text)
      if (!kind) {
        msgs.push(`${f.name} — 楽天証券の CSV に見えないので取り込みませんでした`)
        continue
      }
      onImport(kind, { name: f.name, text, importedAt: new Date().toISOString() })
      msgs.push(`${f.name} → ${LABEL[kind]}`)
    }
    setNotes(msgs)
  }

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <h2>CSV を取り込む</h2>
      <div
        className={over ? 'drop over' : 'drop'}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files) }}
        onClick={() => picker.current?.click()}
      >
        楽天証券からダウンロードした CSV をここにドロップ
        <div className="small" style={{ marginTop: 6 }}>
          保有商品詳細 / 取引履歴（円・外貨）— まとめて放り込んで大丈夫
        </div>
        <input
          ref={picker} type="file" accept=".csv" multiple hidden
          onChange={(e) => { void take(e.target.files); e.target.value = '' }}
        />
      </div>

      <table>
        <tbody>
          {(Object.keys(LABEL) as FileKind[]).map((k) => {
            const f = files[k]
            return (
              <tr key={k}>
                <td>{LABEL[k]}</td>
                <td className="muted small">{f ? f.name : '未取り込み'}</td>
                <td className="n muted small">
                  {f ? ymd(f.importedAt.slice(0, 10)) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {notes.map((n) => <div key={n} className="small muted">{n}</div>)}
    </div>
  )
}
