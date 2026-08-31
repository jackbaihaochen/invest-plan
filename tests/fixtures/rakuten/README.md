# 楽天証券 CSV 実データ（2026/08/29 取得）

解析器のテストはこの3ファイルをそのまま読む。**変換しないこと** —— エンコーディングは
CP932 で、それを `TextDecoder('shift_jis')` で読めることがテスト対象の一部。

| ファイル | 中身 |
|---|---|
| `assetbalance(all)_*.csv` | 保有商品詳細 26 行 + 合計段 + 参考為替 |
| `adjusthistory(JP)_*.csv` | 円貨取引 465 行（2024/3/25〜2026/8/18）|
| `adjusthistory(US)_*.csv` | 外貨取引 128 行（2024/5/21〜2026/8/26）|

対账の期待値は `docs/changes/rakuten-dashboard/proposal.md` §8 を参照。
