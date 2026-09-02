# 配信 — GitHub Pages

`main` に push すると `.github/workflows/deploy.yml` が走り、`tsc -b` → `npm test` →
`npm run build` を通ったものだけを Pages に配る。落ちたら配らない。

**リポジトリは公開のまま**でよい。配信されるのは JS と CSS だけで、取引データは
一行も入っていない。他人がリンクを開いても、CSV を持っていないので空の画面が出る。
テスト用の CSV も作り物（[tests/fixtures/rakuten/README.md](../tests/fixtures/rakuten/README.md)）。

## 一度だけ必要な設定

リポジトリの Settings → Pages → **Source を「GitHub Actions」に変更**。
（既定の「Deploy from a branch」のままだと、この workflow の成果物は配信されない。）

## サブパス

Pages は `https://<user>.github.io/invest-plan/` で配信されるので、
`vite.config.ts` の `base` を `/invest-plan/` にしてある。ルート配信（S3 など）に
移すときは `BASE_PATH=/ npm run build`。

## この段階で持ち越す制約

**データは端末ごとの localStorage にしかない。** 携帯で開いても中身は空で、
その端末でもう一度 CSV を入れる必要がある。取り込みのたびに1点ずつ貯まる
`valuePoints`（資産曲線の実測点）も端末ローカルで、サイトデータを消すと失われる。

これが解けるのは第3段階（Google Sheet）。そこで Sheet を「自分のみ」にして、
読み書きとも Apps Script のトークン越しにする —— [decisions.md](decisions.md) 参照。
