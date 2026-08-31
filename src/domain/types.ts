/** 保有商品詳細の1行。数量と取得原価はここが唯一の権威。 */
export interface Position {
  kind: string          // 種別 — 投資信託 / 米国株式 / 国内株式 / 金・プラチナ / 外貨建MMF
  ticker: string        // 銘柄コード・ティッカー（投信は空）
  name: string          // 銘柄
  account: string       // 口座 — NISAつみたて投資枠 / NISA成長投資枠 / 特定 / 一般 / -
  quantity: number      // 保有数量（株・口・g）
  quantityUnit: string
  price: number | null  // 現在値（スナップショット時点）
  priceUnit: string     // 円 / USD / 円/USD
  marketValueJpy: number
  gainJpy: number
  /** 取得原価。掛け目は種別ごとに違うので推定せず 時価 − 評価損益 で出す。 */
  costJpy: number
}

export interface Snapshot {
  asOf: string                     // YYYY-MM-DD
  positions: Position[]
  cashJpy: number                  // 預り金合計（預り金 + 信用保証金）
  totalJpy: number                 // 資産合計（CSV 記載値）
  fx: Record<string, number>       // '米ドル' => 160.06
}

/** 取引が総資産に与える意味。合計の取り方がこれで決まる。 */
export type Flow =
  | 'inflow'    // 外部から入ってきた金 = 投入
  | 'outflow'   // 外部へ出ていった金 = マイナスの投入
  | 'internal'  // 口座内の移動（購入・売却・振替・保証金）— 総資産は動かない
  | 'income'    // 配当・分配金・利金 — 資産は増えるが投入ではない

export interface Txn {
  settledOn: string          // 受渡日 YYYY-MM-DD
  tradedOn: string | null    // 約定日
  type: string               // 取引区分
  account: string            // 口座区分
  security: string           // 対象証券名
  quantity: number | null
  unitPrice: number | null
  receivedJpy: number        // 受渡金額（受取）— 外貨ファイルは円換算列
  paidJpy: number            // 受渡金額（支払）
  currency: 'JPY' | 'USD'
  flow: Flow
  /** flow が inflow / outflow のときだけ符号付きで入る。それ以外は 0。 */
  netJpy: number
  source: 'JP' | 'US'
}
