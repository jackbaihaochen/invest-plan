import type { Position, Snapshot } from './types'

export interface PriceRow {
  on: string
  fund: string
  navJpy: number
}

/**
 * 基準価額は「1万口あたり」。保有数量は口数なので 1万で割る。
 * 実データで確認済み: 34,943口 × 20,176 / 10,000 = 70,501 で CSV の時価と一致する。
 */
const PER_UNITS = 10_000

/**
 * メールと CSV で同じファンドの名前が違うので、突き合わせ用の鍵に落とす。
 *
 *   CSV   : eMAXIS Slim 全世界株式(オール・カントリー)(オルカン)
 *   メール: eMAXIS　Slim　全世界株式（オール・カントリー） (三菱ＵＦＪアセットマネジメント)
 *
 * NFKC で全角を半角に寄せ、括弧の中身（委託会社名も愛称も）を落とし、空白を削る。
 * 括弧を落とすのは名前を揃えるためだが、**それは別のファンドを同じ鍵に潰す危険と
 * 裏表**なので、衝突したら値段を捨てる（下の buildIndex）。
 */
export function normalizeFund(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

interface Index {
  nav: Map<string, number>
  /** 鍵が衝突して使えなかったファンド名。黙って捨てず、画面に出す。 */
  ambiguous: string[]
}

function buildIndex(rows: readonly PriceRow[]): Index {
  const byKey = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const key = normalizeFund(r.fund)
    if (key === '') continue
    const names = byKey.get(key) ?? new Map<string, number>()
    names.set(r.fund, r.navJpy) // 同じ名前が二度来ても1件
    byKey.set(key, names)
  }

  const nav = new Map<string, number>()
  const ambiguous: string[] = []
  for (const [key, names] of byKey) {
    if (names.size === 1) {
      nav.set(key, [...names.values()][0]!)
    } else {
      // 別名のファンドが同じ鍵になった。どちらか選ぶより、値段を使わないほうがいい。
      ambiguous.push(...names.keys())
    }
  }
  return { nav, ambiguous }
}

export interface Repriced {
  snapshot: Snapshot
  /** この評価額が「いつの基準価額」で出ているか。付け替えなかったら null。 */
  pricedOn: string | null
  /** 付け替えなかったぶんが載っている日付（もとの CSV の取得日）。 */
  baseAsOf: string | null
  /** 新しい価格が付いた金額の、総額に対する割合。 */
  repricedShare: number
  /** 値段は届いたのに銘柄を特定できなかったもの。 */
  ambiguous: string[]
  /** 持っているのに当日の値段が来ていないファンド。 */
  missing: string[]
}

const unchanged = (snap: Snapshot): Repriced =>
  ({ snapshot: snap, pricedOn: null, baseAsOf: snap.asOf, repricedShare: 0, ambiguous: [], missing: [] })

/**
 * 投資信託の評価額を、いちばん新しい基準価額メールの日付で付け替える。
 *
 * 付け替えるのは投資信託だけ。米国株・金・国内株には日次の情報源が無いので、
 * スナップショットの値のまま持ち越す —— そのぶんは「その日の値段ではない」ので、
 * repricedShare として割合を返し、画面がそれを言葉にする。
 *
 * CSV のほうが新しいときは何もしない。古い基準価額で新しい CSV を上書きしたら、
 * 数字を新しくするどころか古くすることになる。
 */
export function reprice(snap: Snapshot | null, prices: readonly PriceRow[]): Repriced | null {
  if (!snap) return null
  if (prices.length === 0) return unchanged(snap)

  let latest = ''
  for (const p of prices) if (p.on > latest) latest = p.on
  if (latest === '') return unchanged(snap)
  // スナップショットのほうが新しいなら触らない。
  if (snap.asOf !== null && latest <= snap.asOf) return unchanged(snap)

  const { nav, ambiguous } = buildIndex(prices.filter((p) => p.on === latest))

  const missing: string[] = []
  let repricedJpy = 0
  const positions: Position[] = snap.positions.map((p) => {
    if (p.kind !== '投資信託') return p
    const price = nav.get(normalizeFund(p.name))
    if (price === undefined) {
      if (!missing.includes(p.name)) missing.push(p.name)
      return p
    }
    // 同じファンドを同じ枠に2ロット持つことがある。1つの値段が複数の行に付くのは正常。
    const marketValueJpy = Math.round((p.quantity * price) / PER_UNITS)
    repricedJpy += marketValueJpy
    return { ...p, marketValueJpy, gainJpy: marketValueJpy - p.costJpy }
  })

  const totalJpy = positions.reduce((a, p) => a + p.marketValueJpy, 0) + snap.cashJpy
  return {
    // asOf は付け替えた日にする。付け替えなかったぶんは「最後に判っている値段」の
    // まま繰り越しているので、総額としてはこの日の見積もりになる。
    // 何割がその日の値段なのかは repricedShare で必ず併記すること。
    snapshot: { ...snap, positions, totalJpy, asOf: latest },
    pricedOn: latest,
    baseAsOf: snap.asOf,
    repricedShare: totalJpy === 0 ? 0 : repricedJpy / totalJpy,
    ambiguous,
    missing,
  }
}
