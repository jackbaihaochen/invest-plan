import { at, parseCsv, toAmount, toIsoDate, toNumber } from './csv'
import type { Flow, Txn } from './types'

/**
 * 取引区分ごとの「総資産にとっての意味」。
 *
 * 既定値を置かない: 未知の区分は分類せずに投げる。黙って internal に倒すと
 * 入金を取りこぼし、黙って inflow に倒すと二重計上になる。どちらも静かに
 * 間違った数字を出すので、気づける形で失敗させる。
 */
const FLOW: Record<string, Flow> = {
  // 外部 → 口座
  'リアルタイム入金(ゆうちょ銀行)': 'inflow',
  'らくらく入金(楽天銀行)': 'inflow',
  '入金(クレジットカード決済ご利用分)': 'inflow',
  '入金(楽天ペイ残高ご利用分)': 'inflow',
  '入金(楽天ポイント交換)': 'inflow',
  '入金(楽天ペイ残高注文エラー分)': 'inflow',
  // 口座 → 外部
  '通常出金(ゆうちょ銀行)': 'outflow',
  '譲渡益税（所得税）': 'outflow',
  '譲渡益税（住民税）': 'outflow',
  // 口座内の移動 — 総資産は動かない
  '株式投信購入（積立）': 'internal',
  '株式投信購入': 'internal',
  '株式投信解約': 'internal',
  '投信再投資': 'internal',
  '株式購入': 'internal',
  '株式購入（積立）': 'internal',
  '米国株式購入': 'internal',
  '米国株式積立購入': 'internal',
  '米国株式売却': 'internal',
  '外国債券購入': 'internal',
  '外国債券売却': 'internal',
  '外貨建てＭＭＦ買付': 'internal',
  '信用保証金入金': 'internal',
  '信用保証金出金': 'internal',
  // 振替出金 = 金の定額積立。金・プラチナは資産合計に含まれるので取り崩しではない。
  // 外貨↔円の振替も同じ扱いで、JP 側と US 側が対で現れて打ち消し合う。
  '振替出金': 'internal',
  '振替入金': 'internal',
  // 収益 — 資産は増えるが「投入」ではない
  '投信分配金': 'income',
  '国内株式配当金': 'income',
  '外株配当金': 'income',
  '外国債券利金': 'income',
}

export class UnknownTxnTypeError extends Error {
  constructor(readonly txnType: string) {
    super(`未知の取引区分「${txnType}」— src/domain/transactions.ts の FLOW に分類を追加してください`)
    this.name = 'UnknownTxnTypeError'
  }
}

/**
 * adjusthistory(JP)_*.csv / adjusthistory(US)_*.csv を読む。
 *
 * 両ファイルは「取引区分」と「口座区分」の列順が逆（JP は 取引区分,口座区分／
 * US は 口座区分,取引区分）。ヘッダ名で引くこと。位置を流用してはいけない。
 * 金額は US 側では [円換算] 列を使う。
 */
export function parseTransactions(text: string, source: 'JP' | 'US'): Txn[] {
  const rows = parseCsv(text)
  const header = rows[0]
  if (!header) return []
  const idx = (...names: string[]): number => {
    for (const name of names) {
      const i = header.findIndex((h) => h.trim() === name)
      if (i !== -1) return i
    }
    return -1
  }

  const c = {
    settledOn: idx('受渡日'),
    tradedOn: idx('約定日'),
    type: idx('取引区分'),
    account: idx('口座区分'),
    security: idx('対象証券名'),
    quantity: idx('数量［株/口/額面］', '数量［株 /口］'),
    unitPrice: idx('単価［円/％］', '単価'),
    received: idx('受渡金額（受取）[円換算]', '受渡金額（受取）'),
    paid: idx('受渡金額（支払）[円換算]', '受渡金額（支払）'),
  }
  if (c.settledOn === -1 || c.type === -1) {
    throw new Error(`${source} の取引履歴に「受渡日」または「取引区分」列がありません`)
  }

  const out: Txn[] = []
  for (const row of rows.slice(1)) {
    const settledOn = toIsoDate(at(row, c.settledOn))
    if (settledOn === null) continue
    const type = at(row, c.type)
    const flow = FLOW[type]
    if (flow === undefined) throw new UnknownTxnTypeError(type)

    const receivedJpy = toAmount(at(row, c.received))
    const paidJpy = toAmount(at(row, c.paid))
    out.push({
      settledOn,
      tradedOn: toIsoDate(at(row, c.tradedOn)),
      type,
      account: at(row, c.account),
      security: at(row, c.security),
      quantity: toNumber(at(row, c.quantity)),
      unitPrice: toNumber(at(row, c.unitPrice)),
      receivedJpy,
      paidJpy,
      currency: source === 'US' ? 'USD' : 'JPY',
      flow,
      netJpy: flow === 'inflow' ? receivedJpy : flow === 'outflow' ? -paidJpy : 0,
      source,
    })
  }
  return out
}

/**
 * CSV が事実として押さえている最終日。手動記録との継ぎ目はここで切る。
 * ダウンロード日ではない（受渡には数日の遅れがある）。
 */
export function coverageEnd(txns: readonly Txn[]): string | null {
  let max: string | null = null
  for (const t of txns) if (max === null || t.settledOn > max) max = t.settledOn
  return max
}

/** 月ごとの純入金。キーは 'YYYY-MM'。 */
export function monthlyNet(txns: readonly Txn[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of txns) {
    if (t.netJpy === 0) continue
    const ym = t.settledOn.slice(0, 7)
    out.set(ym, (out.get(ym) ?? 0) + t.netJpy)
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)))
}

export function totalNet(txns: readonly Txn[]): number {
  return txns.reduce((sum, t) => sum + t.netJpy, 0)
}
