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

/** 画面に返す表。prices はトリガーが育てるので読むだけ。 */
var READ_SHEETS = ['txns', 'positions', 'entries', 'values', 'prices', 'meta']

/**
 * クライアントが書ける表。**prices を入れてはいけない。**
 *
 * 画面は保存のたびにデータ全体を送ってくる。その中の prices は「ページを開いた時点の
 * 写し」でしかないので、そのまま書き戻すと、その後トリガーが足した行を消してしまう。
 * 設定直後（画面側の prices が空）なら、蓄積ぶんを丸ごと消す。
 */
var WRITE_SHEETS = ['txns', 'positions', 'entries', 'values', 'meta']

/**
 * 対象のスプレッドシート。
 *
 * 通常はコンテナ（このスクリプトが紐づいている表）で足りる。ただし doGet/doPost の
 * 文脈で getActiveSpreadsheet() が null を返す例が報告されていて、こちらでは
 * 再現も否定もできなかった。**確かめられないことは、確かめられない前提のまま
 * 逃げ道を用意しておく。** スクリプト プロパティに SHEET_ID を入れればそちらを使う
 * （そのときは appsscript.json の spreadsheets.currentonly を spreadsheets に広げる）。
 */
function book() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID')
  if (id) return SpreadsheetApp.openById(id)
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  if (!ss) throw new Error('スプレッドシートに到達できません（SHEET_ID を設定してください）')
  return ss
}

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
  var ss = book()
  var tables = {}
  for (var i = 0; i < READ_SHEETS.length; i++) {
    var name = READ_SHEETS[i]
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
  var ss = book()
  // 一度に書く側と読む側がぶつかると半端な状態を読ませてしまう。
  var lock = LockService.getScriptLock()
  lock.waitLock(20000)
  try {
    for (var i = 0; i < WRITE_SHEETS.length; i++) {
      var name = WRITE_SHEETS[i]
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
  var messages = list.messages || []
  if (messages.length === 0) return

  var rows = []
  for (var i = 0; i < messages.length; i++) {
    var msg = Gmail.Users.Messages.get('me', messages[i].id, { format: 'full' })
    var text = decodeBody(msg.payload)
    var on = parsePriceDate(text) || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
    var found = parsePrices(text)
    // エディタから手で走らせたときに、どこで落ちたか / 何が取れたかが判るように。
    console.log((i + 1) + '/' + messages.length + ' 本文 ' + text.length + ' 文字、日付 ' + on + '、' + found.length + ' 件')
    // 一件も取れなかったときは本文を覗かせる。下の throw だけでは「0 件」としか判らず、
    // parsePrices を実本文に合わせるのに必要な情報がどこにも残らない。
    // 生の HTML の先頭を出しても DOCTYPE と CSS しか写らないので、タグを落として
    // 「基準価額」の周りを出す。
    if (found.length === 0) console.log(dumpLines(text))
    for (var j = 0; j < found.length; j++) rows.push([on, found[j].fund, found[j].navJpy])
  }
  // 件名に合うメールが在るのに一件も取れないのは「今日は何も無い」ではなく壊れている。
  // ここで黙って成功すると、失敗通知という唯一の合図を失う。
  if (rows.length === 0) {
    throw new Error(messages.length + ' 通のメールから基準価額を一件も取れませんでした')
  }

  var ss = book()
  var sh = sheetByName(ss, 'prices')
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 3).setValues([['on', 'fund', 'navJpy']])
  }
  // 同じ日・同じファンドを二度書かない。トリガーは失敗すると再実行されるし、
  // newer_than:2d には同じ日の数値を載せたメールが二通入ることもある。
  var seen = {}
  if (sh.getLastRow() > 1) {
    var have = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    for (var k = 0; k < have.length; k++) seen[have[k][0] + ' ' + have[k][1]] = true
  }
  var fresh = []
  for (var m = 0; m < rows.length; m++) {
    var key = rows[m][0] + ' ' + rows[m][1]
    if (seen[key]) continue
    seen[key] = true
    fresh.push(rows[m])
  }
  if (fresh.length === 0) return
  sh.getRange(sh.getLastRow() + 1, 1, fresh.length, 3).setNumberFormat('@').setValues(fresh)
}

/**
 * 本文をテキストで取り出す。
 *
 * multipart/alternative は text/plain と text/html の両方を持つ。両方つないで
 * 読むと同じ値段を二度拾うので、**片方だけ**使う（plain を優先）。
 */
function decodeBody(payload) {
  var part = pickTextPart(payload, 'text/plain') || pickTextPart(payload, 'text/html')
  if (!part) return ''
  return decodePart(part)
}

function pickTextPart(part, mimeType) {
  if (!part) return null
  if (part.mimeType === mimeType && part.body && part.body.data) return part
  var parts = part.parts || []
  for (var i = 0; i < parts.length; i++) {
    var hit = pickTextPart(parts[i], mimeType)
    if (hit) return hit
  }
  return null
}

/**
 * 二つとも実測で確かめた。**どちらもヘッダやサンプル通りではない。**
 *
 *   1. `body.data` は base64 の文字列ではない。高度なサービス（Gmail.Users...）は
 *      discovery 上 `format: byte` のこの項目を**バイト配列に復号して**返す
 *      （typeof=object ctor=Array）。REST を直に叩く前提のサンプルはどれも base64 と
 *      して書いてあるが、ここでは当てはまらない。9/3 から毎朝
 *      「Could not decode string.」で落ちていたのはこれ。
 *
 *   2. そのバイト列は **UTF-8**。Content-Type は `charset=iso-2022-jp` と言うが、
 *      それは**元のメール**の話で、バイト配列に直す時点で変換済み。ヘッダを信じて
 *      iso-2022-jp で読むと、ASCII は通るのに日本語が全部 U+FFFD になる（実測）。
 *      **だからヘッダの charset は読まない。**
 */
function decodePart(part) {
  console.log('本文 ' + part.mimeType + ' ' + part.body.data.length + ' バイト')
  return Utilities.newBlob(part.body.data).getDataAsString('UTF-8')
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
 * ファンド名と基準価額の組を拾う。
 *
 * 実物のメール（2026-09-04 に実行ログで確認）は HTML の表で、タグを落とすと
 * 1 ファンド 6 行に割れる:
 *
 *     HSBC インド・インフラ株式オープン        ← 名前
 *     (ＨＳＢＣアセットマネジメント)            ← 委託会社
 *     19,016円                                ← 基準価額。**欲しいのはこれだけ**
 *     -308円                                  ← 前営業日比（金額）
 *     (-1.59％)                               ← 前営業日比（率）
 *     5.45％                                  ← リターン（年率）
 *
 * だから **符号の付かない「円」だけの行**を基準価額とみなし、そこから上に遡って
 * 名前を組み立てる。6 行おきに数えて読むようなことはしない —— ファンドが増減しても、
 * 間に文が挟まっても壊れないほうがいい。
 *
 * 返す名前は「名前 (委託会社)」。画面側の normalizeFund が括弧の中身を落として
 * CSV と突き合わせる（src/domain/prices.ts）ので、この形で渡すのが前提になっている。
 */

/** 基準価額の行。符号が付かないので、前営業日比の「-308円」と区別できる。 */
var NAV_LINE = /^([\d,]+)円$/
/** 委託会社の行。名前の下に括弧だけで入っている。 */
var COMPANY_LINE = /^[（(].+[）)]$/
var HAS_LETTER = /[A-Za-z\u3040-\u30ff\u4e00-\u9fff]/

function parsePrices(text) {
  var lines = textLines(text)
  var out = []
  for (var i = 0; i < lines.length; i++) {
    var m = NAV_LINE.exec(lines[i])
    if (!m) continue
    var nav = Number(m[1].replace(/,/g, ''))
    var fund = fundNameAbove(lines, i)
    if (nav && fund) out.push({ fund: fund, navJpy: nav })
  }
  return out
}

/**
 * 値段の行から上へ 3 行だけ遡って名前を組み立てる。見出しや注意書きに当たったら
 * 何も返さない —— **取り違えて付けるくらいなら、付けない。**
 */
function fundNameAbove(lines, at) {
  var company = ''
  for (var i = at - 1; i >= 0 && i >= at - 3; i--) {
    var line = lines[i]
    if (COMPANY_LINE.test(line)) { company = line; continue }
    if (!HAS_LETTER.test(line)) return ''                 // 数字や記号だけの行
    if (line === '基準価額' || line.indexOf('ファンド名') === 0) return ''  // 見出し
    if (line.indexOf('。') >= 0 || line.charAt(0) === '※') return ''        // 注意書き
    if (line.length > 120) return ''
    return company ? line + ' ' + company : line
  }
  return ''
}

/**
 * 一件も取れなかったときに実行ログへ出す。**実行ログはブラウザからコピーできない**ので、
 * 一画面に収まってスクリーンショットが撮れる形にする —— 空行を潰し、値段らしき行の
 * 手前 8 行から 30 行だけ、行番号つきで。ここを見て parsePrices を書いた。
 */
function dumpLines(text) {
  var lines = textLines(text)
  var at = 0
  for (var j = 0; j < lines.length; j++) {
    if (/\d,\d{3}/.test(lines[j]) || lines[j].indexOf('基準価額') >= 0) { at = j; break }
  }
  var from = Math.max(0, at - 8)
  var out = ['取れなかった本文（タグ除去・空行なし・' + lines.length + ' 行中 ' + (from + 1) + '〜）:']
  for (var k = from; k < Math.min(lines.length, from + 30); k++) {
    out.push((k + 1) + '| ' + lines[k].slice(0, 90))
  }
  return out.join('\n')
}

/** タグと空行を落とした行の並び。parsePrices と dumpLines が同じものを見る。 */
function textLines(text) {
  var out = []
  var all = flatten(text).split(/\n+/)
  for (var i = 0; i < all.length; i++) {
    var t = all[i].replace(/　/g, ' ').trim()
    if (t) out.push(t)
  }
  return out
}

function flatten(text) {
  return text.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}
