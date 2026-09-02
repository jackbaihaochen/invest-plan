/**
 * 传输层の spike。これ自体は本番のコードではない —— 検証したら捨てる。
 *
 * 確かめたいのは4つだけ:
 *   1. GET が返るか、JS からレスポンスを読めるか
 *   2. POST(text/plain) が preflight を避けられるか、レスポンスを読めるか
 *   3. script.google.com → googleusercontent.com のリダイレクトを跨いで body が読めるか
 *   4. トークンが違うときの返り、成功時と同じ形か
 *
 * スプレッドシートには触らない。メールにも触らない。
 *
 * 使い方:
 *   1. スプレッドシート → 拡張機能 → Apps Script にこれを貼る
 *   2. プロジェクトの設定 → スクリプト プロパティ に TOKEN を追加（値は自分で決める）
 *   3. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        次のユーザーとして実行: 自分
 *        アクセスできるユーザー: 全員
 *   4. 出てきた /exec の URL を渡す（トークンは渡さない）
 */

/** 早期 return しない比較。長さの差だけは漏れるが、内容は漏らさない。 */
function tokenOk(given) {
  var want = PropertiesService.getScriptProperties().getProperty('TOKEN')
  if (!want || typeof given !== 'string') return false
  if (given.length !== want.length) return false
  var diff = 0
  for (var i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i)
  return diff === 0
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
}

/** 失敗も成功と同じ形で返す。表の有無やデータの有無を推測させない。 */
function denied() {
  return reply({ ok: false, error: 'denied' })
}

function doGet(e) {
  var token = (e && e.parameter && e.parameter.token) || ''
  if (!tokenOk(token)) return denied()
  return reply({ ok: true, via: 'GET', now: new Date().toISOString() })
}

function doPost(e) {
  var body = {}
  try {
    // text/plain なら生の本文、form-urlencoded なら payload パラメータ。
    // どちらも preflight を起こさない「単純リクエスト」なので両方測る。
    var raw = (e && e.parameter && e.parameter.payload)
      || (e && e.postData && e.postData.contents)
      || '{}'
    body = JSON.parse(raw)
  } catch (err) {
    return denied()
  }
  if (!tokenOk(body.token)) return denied()
  return reply({
    ok: true,
    via: 'POST',
    // 往復できているかを見るため、送ったものをそのまま返す
    echo: body.echo === undefined ? null : body.echo,
    contentType: (e && e.postData && e.postData.type) || null,
    viaFormParam: !!(e && e.parameter && e.parameter.payload),
    now: new Date().toISOString(),
  })
}
