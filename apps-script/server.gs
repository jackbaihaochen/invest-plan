/**
 * 1億円プロジェクト —— Sheet のバックエンド。
 *
 * これはブラウザのバンドルには入らない。スプレッドシートに紐づく Apps Script
 * プロジェクトに貼り、「ウェブアプリ / 自分として実行 / 全員がアクセス可」で
 * デプロイする。リポジトリにはデプロイの元として置いてあるだけ。
 *
 * ── 動かす前に必要な設定 ─────────────────────────────
 *   スクリプト プロパティ:
 *     TOKEN  自分で決めた長いランダム文字列。これを知らない相手には何も返さない。
 *
 * ── 守っている境界（変えないこと）───────────────────────
 *   exec の URL は**公開**で、しかも**あなたの権限で動く**。だから:
 *
 *   1. doGet / doPost は最初にトークンを検証し、通らなければ何もしない。
 *   2. メールには doGet / doPost から絶対に触らない。触った瞬間、この URL は
 *      あなたの受信箱を誰でも読める代理サーバになる。メールを読むのは
 *      時間主導トリガーから呼ばれる updatePrices だけ。
 *   3. Gmail は高度なサービス（Gmail.Users...）を gmail.readonly で使う。
 *      GmailApp を使うと https://mail.google.com/ の全権限を要求され、
 *      読むだけのはずが削除も送信もできる鍵を渡すことになる。
 */

var SHEETS = ['txns', 'positions', 'entries', 'values', 'meta']

/* ── トークン ───────────────────────────────────────── */

/** 早期 return しない比較。長さの差だけは漏れるが内容は漏らさない。 */
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

/** 失敗は常に同じ形。表の有無やデータの有無を推測させない。 */
function denied() {
  return reply({ ok: false, error: 'denied' })
}

/* ── 入口 ───────────────────────────────────────────── */

function doGet(e) {
  // 読み取り専用の退路。POST が使えないと判った場合にだけ使う。
  // トークンが URL に載る＝ログに残るので、既定では load しか許さない。
  var token = (e && e.parameter && e.parameter.token) || ''
  if (!tokenOk(token)) return denied()
  return handle('load', null)
}

function doPost(e) {
  var body
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}')
  } catch (err) {
    return denied()
  }
  if (!tokenOk(body.token)) return denied()
  return handle(body.action, body.payload)
}

function handle(action, payload) {
  try {
    if (action === 'ping') return reply({ ok: true, data: {} })
    if (action === 'load') return reply({ ok: true, data: loadTables() })
    if (action === 'save') return reply({ ok: true, data: saveTables(payload) })
    return reply({ ok: false, error: 'unknown action' })
  } catch (err) {
    // 中身は返さない。スタックにシート名やデータが混じることがある。
    console.error(err)
    return reply({ ok: false, error: 'internal' })
  }
}

/* ── シート入出力 ───────────────────────────────────── */

/**
 * 列の意味は一切解釈しない。クライアントが header と rows を決め、こちらは
 * そのまま置くだけ。おかげでスキーマ変更でサーバを触らずに済むし、
 * スプレッドシートを開けば人間もそのまま読める。
 */
function sheetByName(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name)
}

function loadTables() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var tables = {}
  for (var i = 0; i < SHEETS.length; i++) {
    var name = SHEETS[i]
    var sh = ss.getSheetByName(name)
    if (!sh || sh.getLastRow() === 0) { tables[name] = { header: [], rows: [] }; continue }
    var values = sh.getDataRange().getValues()
    tables[name] = {
      header: values[0].map(String),
      rows: values.slice(1).map(normalizeRow),
    }
  }
  return {
    tables: tables,
    updatedAt: PropertiesService.getScriptProperties().getProperty('UPDATED_AT') || null,
  }
}

/** Sheets は日付を Date で返す。往復で形が変わらないよう ISO の日付に戻す。 */
function normalizeRow(row) {
  return row.map(function (v) {
    if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd')
    return v
  })
}

function saveTables(payload) {
  var tables = (payload && payload.tables) || {}
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  // 一度に書く側と読む側がぶつかると半端な状態を読ませてしまう。
  var lock = LockService.getScriptLock()
  lock.waitLock(20000)
  try {
    for (var i = 0; i < SHEETS.length; i++) {
      var name = SHEETS[i]
      var t = tables[name]
      if (!t) continue // 送られてこなかったシートは触らない
      writeTable(sheetByName(ss, name), t)
    }
    var now = new Date().toISOString()
    PropertiesService.getScriptProperties().setProperty('UPDATED_AT', now)
    return { updatedAt: now }
  } finally {
    lock.releaseLock()
  }
}

function writeTable(sh, table) {
  var header = table.header || []
  var rows = table.rows || []
  sh.clear()
  if (header.length === 0) return
  // 文字列として入れる。'2026/8/10' を Sheets に日付と解釈させると、
  // 読み戻したときに別物になる。
  sh.getRange(1, 1, 1, header.length).setValues([header])
  if (rows.length === 0) return
  var body = rows.map(function (r) {
    var out = []
    for (var i = 0; i < header.length; i++) out.push(r[i] === undefined || r[i] === null ? '' : r[i])
    return out
  })
  sh.getRange(2, 1, body.length, header.length)
    .setNumberFormat('@')
    .setValues(body)
}

/* ── 基準価額メール（トリガーからのみ）───────────────── */

/**
 * **時間主導トリガーからだけ呼ぶこと。** doGet / doPost から呼んではいけない。
 * この関数はあなたの受信箱を読む。公開 URL の処理経路に置いた瞬間、
 * 誰でもあなたのメールを引き出せるようになる。
 *
 * 設定: トリガー → 関数 updatePrices → 時間主導 → 日タイマー（朝）
 * 必要なスコープ: gmail.readonly（appsscript.json の oauthScopes に書く）
 */
function updatePrices() {
  var query = 'subject:基準価額 newer_than:2d'
  var list = Gmail.Users.Messages.list('me', { q: query, maxResults: 5 })
  if (!list.messages || list.messages.length === 0) return

  var rows = []
  for (var i = 0; i < list.messages.length; i++) {
    var msg = Gmail.Users.Messages.get('me', list.messages[i].id, { format: 'full' })
    var text = decodeBody(msg.payload)
    var on = parsePriceDate(text) || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
    var found = parsePrices(text)
    for (var j = 0; j < found.length; j++) rows.push([on, found[j].fund, found[j].navJpy])
  }
  if (rows.length === 0) return

  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var sh = sheetByName(ss, 'prices')
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 3).setValues([['on', 'fund', 'navJpy']])
  }
  // 同じ日・同じファンドを二度書かない。トリガーは失敗すると再実行される。
  var seen = {}
  if (sh.getLastRow() > 1) {
    var have = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    for (var k = 0; k < have.length; k++) seen[have[k][0] + ' ' + have[k][1]] = true
  }
  var fresh = rows.filter(function (r) { return !seen[r[0] + ' ' + r[1]] })
  if (fresh.length === 0) return
  sh.getRange(sh.getLastRow() + 1, 1, fresh.length, 3).setNumberFormat('@').setValues(fresh)
}

function decodeBody(payload) {
  if (!payload) return ''
  if (payload.body && payload.body.data) {
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(payload.body.data)).getDataAsString()
  }
  var parts = payload.parts || []
  var out = ''
  for (var i = 0; i < parts.length; i++) out += decodeBody(parts[i])
  return out
}

/** 「・基準価額は08月27日時点の数値を表示しております。」から日付を取る。 */
function parsePriceDate(text) {
  var m = /基準価額は\s*(\d{1,2})月(\d{1,2})日/.exec(text)
  if (!m) return null
  var now = new Date()
  var year = now.getFullYear()
  var month = Number(m[1])
  // 1月に受け取った12月のメール。年をまたぐと未来日付になるので戻す。
  if (month - (now.getMonth() + 1) > 6) year -= 1
  return year + '-' + ('0' + month).slice(-2) + '-' + ('0' + Number(m[2])).slice(-2)
}

/**
 * ファンド名と基準価額の組を拾う。本文は HTML のこともテキストのこともあるので
 * タグを落としてから行単位で見る。取れなかった行は黙って捨てる ——
 * 部分的にでも取れたぶんは日次の価格として役に立つ。
 */
function parsePrices(text) {
  var flat = text.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  var lines = flat.split(/\n+/)
  var out = []
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/　/g, ' ').trim()
    // 「eMAXIS Slim ... (委託会社) | 38,629円 | ...」形式と、表を分解した形式の両方
    var m = /^(.+?)\s*[|｜]?\s*([\d,]+)\s*円/.exec(line)
    if (!m) continue
    var fund = m[1].replace(/[|｜]/g, '').replace(/\s*\([^)]*\)\s*$/, '').trim()
    var nav = Number(m[2].replace(/,/g, ''))
    if (!fund || !nav || fund.length > 120) continue
    out.push({ fund: fund, navJpy: nav })
  }
  return out
}
