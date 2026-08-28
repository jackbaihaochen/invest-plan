/**
 * 共有ロジック — Apps Script とブラウザ（Artifact）の両方で動く。
 *
 * このファイルは Apps Script 固有の API（SpreadsheetApp / GmailApp / Utilities）に
 * 一切依存しない。純粋な JS だけで書くことで、
 *   - Apps Script では他の .gs と同じグローバルスコープに載り、
 *   - Artifact のページには tools/build-artifact.js がそのまま埋め込み、
 *   - tests/ が Node で直接検証する
 * という3つの用途を1つの実装で賄う。ここに Apps Script の API を持ち込まないこと。
 */

/** 投資信託の基準価額は「1万口あたり」で表示される。 */
var FUND_UNIT_BASIS = 10000;

/** 日本標準時は UTC+9 固定（サマータイムなし）。 */
var JST_OFFSET_MS = 9 * 3600 * 1000;

// ---------------------------------------------------------------- date utils

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Date を JST の暦日に直した Date を返す。 */
function toJst_(d) {
  return new Date(d.getTime() + d.getTimezoneOffset() * 60000 + JST_OFFSET_MS);
}

function dateStr_(d) {
  var j = toJst_(d);
  return j.getFullYear() + '-' + pad2_(j.getMonth() + 1) + '-' + pad2_(j.getDate());
}

function todayStr_() { return dateStr_(new Date()); }

/** 'yyyy-MM-dd' -> Date（正午に置いて境界事故を避ける）。 */
function parseDateStr_(s) {
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
}

/**
 * 「08月27日」のように年が無い日付を、基準日から補完する。
 * 12月のメールを1月に受け取るような年跨ぎを考慮する。
 */
function resolveYear_(month, day, referenceDate) {
  var j = toJst_(referenceDate);
  var refY = j.getFullYear();
  var refM = j.getMonth() + 1;
  var year = refY;
  if (month === 12 && refM === 1) year = refY - 1;
  else if (month === 1 && refM === 12) year = refY + 1;
  return year + '-' + pad2_(month) + '-' + pad2_(day);
}

function addMonthsStr_(dateStr, months) {
  var d = parseDateStr_(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}

function monthKey_(dateStr) { return String(dateStr).slice(0, 7); }

function prevMonthKey_(key, back) {
  var p = String(key).split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1 - back, 1);
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1);
}

// ---------------------------------------------------------------- text utils

/**
 * ファンド名の照合キーを作る。
 *
 * 楽天証券のメールは全角と半角が混在する（「eMAXIS　Slim」の全角スペース、
 * 「Ｓ＆Ｐ５００」の全角英数、「（）」の全角括弧）。NFKC 正規化で半角に寄せ、
 * 空白を全て落とし、大文字化して比較する。
 *
 *   'eMAXIS　Slim　米国株式（Ｓ＆Ｐ５００）' -> 'EMAXISSLIM米国株式(S&P500)'
 */
function normalizeName_(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .toUpperCase();
}

/**
 * 正規化済みテキストに nav_key が含まれる instrument を返す。
 *
 * 完全一致にしないのは、同じファンドでもメールごとに後置文字列が違うため:
 *   基準価額メール: 'eMAXIS Slim 全世界株式（オール・カントリー） (三菱ＵＦＪ…)'
 *   約定メール:     'eMAXIS Slim 全世界株式(オール・カントリー)(オルカン)'
 * 共通の前半部分を nav_key に置き、包含判定する。
 * 複数該当した場合は nav_key が最長のものを採用する。
 */
function matchInstrument_(rawName, instruments) {
  var norm = normalizeName_(rawName);
  var best = null;
  for (var i = 0; i < instruments.length; i++) {
    var key = instruments[i].navKey;
    if (!key) continue;
    if (norm.indexOf(key) !== -1) {
      if (!best || key.length > best.navKey.length) best = instruments[i];
    }
  }
  return best;
}

/** 「19,215円」「100,000円」→ 数値。 */
function parseYen_(s) {
  var m = String(s).replace(/[,\s　]/g, '').match(/(-?\+?[\d.]+)/);
  if (!m) return null;
  var n = Number(m[1].replace('+', ''));
  return isNaN(n) ? null : n;
}

// -------------------------------------------------------------- body → lines

/**
 * メール本文（HTML でもプレーンでも）を行配列にする。
 *
 * 楽天証券のメールは HTML テーブルで届く。テーブル構造を保ったままテキスト化
 * したいので、</td> をパイプに、</tr> を改行に自前で置き換えてから解析する。
 * Google Drive の read_file_content が返すシートも同じパイプ表なので使い回せる。
 */
function bodyToLines_(body) {
  var s = String(body == null ? '' : body);

  if (/<\s*\/?\s*(table|tr|td|th|div|p|br)\b/i.test(s)) {
    s = s
      .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|h[1-6]|li)\s*>/gi, '\n')
      .replace(/<\s*\/\s*t[dh]\s*>/gi, ' | ')
      .replace(/<\s*\/\s*tr\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); });
  }

  return s.split(/\r?\n/)
    .map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); })
    .filter(function (l) { return l.length > 0; });
}

/**
 * 1行を「中身のあるセル」の配列にする。区切りの無い行は1セルとして返す。
 * 空セルを落とすので、パターンで拾うメール解析向け。列位置は保たれない。
 */
function lineCells_(line) {
  return splitCells_(line)
    .filter(function (c) { return c.length > 0 && !/^[-—─:\s]+$/.test(c); });
}

/**
 * 1行を「列位置を保ったまま」セル配列にする。
 * 表の枠である先頭・末尾の空セルだけを落とし、途中の空セルは残す。
 * 「キー | 値 | 説明」のように列位置に意味がある表はこちらを使う
 * （lineCells_ だと値が空のとき説明が値の位置にずれてくる）。
 */
function splitCells_(line) {
  var parts = String(line).split('|').map(function (c) {
    return c.trim().replace(/\\([_*])/g, '$1');
  });
  if (parts.length && parts[0] === '') parts.shift();
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// -------------------------------------------------------------------- parsers

/**
 * 基準価額メール1通を解析する。
 *   { baseDate: 'yyyy-MM-dd', rows: [{ name, price }] }
 */
function parseNavEmail_(body, receivedDate) {
  var lines = bodyToLines_(body);
  var baseDate = null;
  var rows = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (!baseDate) {
      var bm = line.match(/基準価額は\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日時点/);
      if (bm) baseDate = resolveYear_(Number(bm[1]), Number(bm[2]), receivedDate);
    }

    var cells = lineCells_(line);
    if (cells.length >= 2 && /^-?[\d,]+\s*円$/.test(cells[1])) {
      var price = parseYen_(cells[1]);
      if (price) rows.push({ name: cells[0], price: price });
      continue;
    }

    if (cells.length === 1) {
      var pm = line.match(/^(.+?)\s+([\d,]+)\s*円\s+[+\-−][\d,]+\s*円/);
      if (pm) {
        var p2 = parseYen_(pm[2]);
        if (p2) rows.push({ name: pm[1], price: p2 });
      }
    }
  }

  if (!baseDate) baseDate = dateStr_(receivedDate);
  return { baseDate: baseDate, rows: rows };
}

/**
 * 積立約定メール1通を解析する。1通に複数ファンドが入りうる。
 * 返り値: [{ name, amount, nisaBucket, orderDate, execDate }]
 */
function parseTxEmail_(body, receivedDate, instruments) {
  var lines = bodyToLines_(body);
  var execMonthDay = null;
  var records = [];
  var current = null;

  function flush() {
    if (current && current.amount) records.push(current);
    current = null;
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    var em = line.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日に完了（?約定）?した注文/);
    if (em) { execMonthDay = { m: Number(em[1]), d: Number(em[2]) }; continue; }

    var cells = lineCells_(line);

    if (cells.length === 1 && matchInstrument_(cells[0], instruments)) {
      flush();
      current = { name: cells[0], amount: null, nisaBucket: '', orderDate: null, execDate: null };
      continue;
    }
    if (!current) continue;

    var key = cells[0] || '';
    var val = cells.length >= 2 ? cells[1] : '';

    if (/口座区分/.test(key)) {
      current.nisaBucket = val || String(line).replace(/.*口座区分\s*\|?\s*/, '').trim();
    } else if (/購入金額|買付金額|約定金額/.test(key)) {
      var am = String(val || line).match(/([\d,]+)\s*円/);
      if (am) current.amount = parseYen_(am[1]);
    } else if (/注文日/.test(key)) {
      var om = String(val || line).match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (om) current.orderDate = om[1] + '-' + pad2_(Number(om[2])) + '-' + pad2_(Number(om[3]));
    }
  }
  flush();

  // 約定日には年が無い。注文日の年を基準に、注文日以降で最も近い年を選ぶ。
  records.forEach(function (r) {
    if (!execMonthDay) { r.execDate = r.orderDate || dateStr_(receivedDate); return; }
    var ref = r.orderDate ? parseDateStr_(r.orderDate) : receivedDate;
    var cand = resolveYear_(execMonthDay.m, execMonthDay.d, ref);
    if (r.orderDate && cand < r.orderDate) {
      cand = (Number(cand.slice(0, 4)) + 1) + cand.slice(4);
    }
    r.execDate = cand;
  });

  return records;
}

/** 米国株の配当入金メールを解析する。 */
function parseDividendEmail_(body) {
  var text = bodyToLines_(body).join('\n');
  var m = text.match(/合計金額\s*([\d,.]+)\s*(USドル|USD|米ドル)/);
  if (m) return { amount: Number(m[1].replace(/,/g, '')), currency: 'USD' };
  var j = text.match(/合計金額\s*([\d,]+)\s*円/);
  if (j) return { amount: Number(j[1].replace(/,/g, '')), currency: 'JPY' };
  return null;
}

/**
 * Google Drive の read_file_content が返すシート表を {キー: 値} にする。
 * 数値に見えるものは数値化する。
 */
function parseSheetTable_(text) {
  var out = {};
  bodyToLines_(text).forEach(function (line) {
    var cells = splitCells_(line);
    if (cells.length < 2) return;
    // 区切り行（| :-: | :-: |）は捨てる
    if (cells.every(function (c) { return /^[-—─:\s]*$/.test(c); })) return;
    var k = cells[0];
    var raw = String(cells[1]).replace(/[¥,\s]/g, '');
    if (!k || raw === '') return;
    var n = Number(raw);
    out[k] = isNaN(n) ? cells[1] : n;
  });
  return out;
}

// ----------------------------------------------------------------- projection

var MAX_PROJECTION_MONTHS = 1200;

/** n ヶ月後の資産額。毎月末に monthly を積み立てる前提。 */
function futureValue_(current, monthly, annualRate, months) {
  var r = annualRate / 12, v = current;
  for (var i = 0; i < months; i++) v = v * (1 + r) + monthly;
  return v;
}

/** 目標到達までの月数。到達しなければ null。 */
function monthsToGoal_(current, monthly, annualRate, goal) {
  if (current >= goal) return 0;
  var r = annualRate / 12, v = current;
  for (var m = 1; m <= MAX_PROJECTION_MONTHS; m++) {
    v = v * (1 + r) + monthly;
    if (v >= goal) return m;
  }
  return null;
}

/** n ヶ月で目標に届かせるのに必要な月次積立額。 */
function requiredMonthly_(current, annualRate, months, goal) {
  if (months <= 0) return null;
  var r = annualRate / 12;
  if (r === 0) return (goal - current) / months;
  var f = Math.pow(1 + r, months);
  return Math.max(0, (goal - current * f) / ((f - 1) / r));
}

/** 積立をやめても n ヶ月後に目標へ届く現在額（Coast FIRE ライン）。 */
function coastAmount_(annualRate, months, goal) {
  return goal / Math.pow(1 + annualRate / 12, months);
}

function realValue_(nominal, inflation, months) {
  return nominal / Math.pow(1 + inflation / 12, months);
}

function humanMonths_(months) {
  if (months === null || months === undefined) return '到達しません';
  var y = Math.floor(months / 12), m = months % 12;
  if (y && m) return y + '年' + m + 'ヶ月';
  if (y) return y + '年';
  return m + 'ヶ月';
}

function etaMonthLabel_(months) {
  if (months === null || months === undefined) return '—';
  return addMonthsStr_(todayStr_(), months).slice(0, 7);
}

/** 円を「1億2,345万円」の形に整形する。 */
function jpyLabel_(n) {
  n = Math.round(Number(n) || 0);
  var sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  var oku = Math.floor(n / 100000000);
  var man = Math.floor((n % 100000000) / 10000);
  if (oku) return sign + oku + '億' + (man ? man.toLocaleString('ja-JP') + '万' : '') + '円';
  if (man) return sign + man.toLocaleString('ja-JP') + '万円';
  return sign + n.toLocaleString('ja-JP') + '円';
}
