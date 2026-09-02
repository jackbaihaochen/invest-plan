/**
 * spike の客側。**公開中のページ上で**実行すること ——
 * https://jackbaihaochen.github.io/invest-plan/ を開いて DevTools のコンソールへ貼る。
 *
 * localhost で試しても意味がない。検証したいのは「この origin から Apps Script を
 * 叩けるか」で、origin そのものが被験体だから。
 *
 * 使い方:
 *   EXEC_URL を自分の /exec の URL に、TOKEN を自分が決めた値に置き換えて実行。
 *   出力をそのまま貼ってくれれば十分（TOKEN の値は出力に含まれない）。
 *
 * 注意: transport が生きているかどうかは、**わざと間違ったトークン**でも判定できる。
 * denied が JS から読めた時点で、CORS もリダイレクトも通っている。
 * だから TOKEN を空のままでも 4 項目中 3 項目は確かめられる。
 */
const EXEC_URL = 'PASTE_YOUR_EXEC_URL_HERE' // .../macros/s/..../exec
const TOKEN = '' // 空のままでも transport の検証はできる

async function spike() {
  const out = {}

  // 1) GET —— レスポンスを読めるか
  try {
    const r = await fetch(`${EXEC_URL}?token=${encodeURIComponent(TOKEN)}`)
    out.get = { status: r.status, redirected: r.redirected, body: await r.text() }
  } catch (e) {
    out.get = { failed: String(e) }
  }

  // 2) POST text/plain —— preflight を避けられるか、読めるか
  //    application/json にすると OPTIONS が飛び、Apps Script はそれに答えない。
  try {
    const r = await fetch(EXEC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: TOKEN, echo: { hello: 'テスト', n: 42 } }),
    })
    out.post = { status: r.status, redirected: r.redirected, body: await r.text() }
  } catch (e) {
    out.post = { failed: String(e) }
  }

  // 3) POST application/json —— こちらは落ちるはず。落ち方を記録しておく。
  try {
    const r = await fetch(EXEC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })
    out.postJson = { status: r.status, body: await r.text() }
  } catch (e) {
    out.postJson = { failed: String(e) } // ここが失敗するのが想定どおり
  }

  // 3b) POST form-urlencoded —— これも単純リクエスト。text/plain が駄目でも
  //     こちらが通る可能性があるので、退路として一緒に測っておく。
  try {
    const r = await fetch(EXEC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ payload: JSON.stringify({ token: TOKEN, echo: { form: true } }) }),
    })
    out.postForm = { status: r.status, body: await r.text() }
  } catch (e) {
    out.postForm = { failed: String(e) }
  }

  // 4) わざと違うトークン —— 成功時と同じ形で返っているか
  try {
    const r = await fetch(EXEC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: 'definitely-not-the-token' }),
    })
    out.wrongToken = { status: r.status, body: await r.text() }
  } catch (e) {
    out.wrongToken = { failed: String(e) }
  }

  console.log(JSON.stringify(out, null, 2))
  return out
}

spike()
