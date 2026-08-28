/**
 * メール本文 → 行配列への変換。
 *
 * 楽天証券のメールは HTML テーブルで届く。GmailApp.getPlainBody() の
 * テキスト化結果はテーブル構造が壊れることがあるため、HTML を自前で
 * パイプ区切りに落としてから行単位で解析する。
 * プレーンテキストで届いた場合もそのまま同じ経路で扱える。
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

/** 1行をセル配列にする。区切り記号の無い行は1セルとして返す。 */
function lineCells_(line) {
  return String(line).split('|')
    .map(function (c) { return c.trim(); })
    .filter(function (c) { return c.length > 0 && !/^[-—─]+$/.test(c); });
}

/**
 * 基準価額メール1通を解析する。
 *   { baseDate: 'yyyy-MM-dd'|null, rows: [{ name, price }] }
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
      // テーブル形式:  ファンド名(委託会社) | 19,215円 | -90円 (-0.47%) | 1.67%
      var price = parseYen_(cells[1]);
      if (price) rows.push({ name: cells[0], price: price });
      continue;
    }

    if (cells.length === 1) {
      // プレーンテキスト形式:  ファンド名 (委託会社) 19,215円 -90円 (-0.47%) 1.67%
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
 *
 *   投信積立の購入注文が約定し、保有商品に追加されました
 *   8月12日に完了（約定）した注文
 *   eMAXIS Slim 全世界株式(オール・カントリー)(オルカン)
 *   口座区分 | NISAつみたて投資枠
 *   購入金額 | 100,000円
 *   注文日   | 2026年8月8日
 *
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

    // ファンド名らしき行が来たら、新しいレコードを開始する。
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
      var raw = val || line;
      var am = String(raw).match(/([\d,]+)\s*円/);
      if (am) current.amount = parseYen_(am[1]);
    } else if (/注文日/.test(key)) {
      var om = String(val || line).match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (om) {
        current.orderDate = om[1] + '-' + ('0' + om[2]).slice(-2) + '-' + ('0' + om[3]).slice(-2);
      }
    }
  }
  flush();

  // 約定日には年が無い。注文日の年を基準に、注文日以降で最も近い年を選ぶ。
  records.forEach(function (r) {
    if (!execMonthDay) { r.execDate = r.orderDate || dateStr_(receivedDate); return; }
    var ref = r.orderDate ? parseDateStr_(r.orderDate) : receivedDate;
    var cand = resolveYear_(execMonthDay.m, execMonthDay.d, ref);
    if (r.orderDate && cand < r.orderDate) {
      // 12月注文 → 1月約定 のような年跨ぎ
      var y = Number(cand.slice(0, 4)) + 1;
      cand = y + cand.slice(4);
    }
    r.execDate = cand;
  });

  return records;
}

/**
 * 米国株の配当入金メールを解析する。
 *   「合計金額1.98USドル」「一株につき0.220000USD」
 */
function parseDividendEmail_(body) {
  var lines = bodyToLines_(body);
  var text = lines.join('\n');
  var m = text.match(/合計金額\s*([\d,.]+)\s*(USドル|USD|米ドル)/);
  if (m) return { amount: Number(m[1].replace(/,/g, '')), currency: 'USD' };
  var j = text.match(/合計金額\s*([\d,]+)\s*円/);
  if (j) return { amount: Number(j[1].replace(/,/g, '')), currency: 'JPY' };
  return null;
}
