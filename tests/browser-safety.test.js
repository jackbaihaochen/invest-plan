// Shared.gs is embedded verbatim into the Artifact page, where no Apps Script
// global exists. This proves it runs with none of them present.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const src = fs.readFileSync('src/Shared.gs', 'utf8');

console.log('\nbrowser safety');

test('uses no Apps Script global in actual code', () => {
  // Strip comments first — the file's own doc comment names these globals
  // precisely to say it does not depend on them.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const banned = ['SpreadsheetApp', 'GmailApp', 'MailApp', 'UrlFetchApp', 'Utilities',
                  'PropertiesService', 'ScriptApp', 'HtmlService', 'Session', 'Logger'];
  const hits = banned.filter(b => new RegExp('\\b' + b + '\\b').test(code));
  assert.deepStrictEqual(hits, [], 'found: ' + hits.join(', '));
});

test('evaluates and runs in a context with no Apps Script globals', () => {
  // Only what a browser provides — deliberately no Utilities, no Session.
  const ctx = vm.createContext({ Date, Math, Number, String, Object, Array, JSON, isNaN, RegExp });
  vm.runInContext(src, ctx, { filename: 'Shared.gs' });

  assert.strictEqual(ctx.normalizeName_('eMAXIS　Slim　米国株式（Ｓ＆Ｐ５００）'),
                     'EMAXISSLIM米国株式(S&P500)');
  assert.strictEqual(ctx.monthsToGoal_(13000000, 400000, 0.07, 100000000), 125);
  assert.strictEqual(ctx.jpyLabel_(123450000), '1億2,345万円');
  assert.strictEqual(ctx.resolveYear_(1, 5, new Date('2025-12-28T00:00:00Z')), '2026-01-05');
  assert.ok(ctx.parseNavEmail_('| A (X) | 19,215円 | -90円 (-0.4%) | 1% |\n・基準価額は08月27日時点',
                               new Date('2026-08-27T23:00:00Z')).rows.length === 1);
});

test('date helpers stay on JST regardless of host timezone', () => {
  const ctx = vm.createContext({ Date, Math, Number, String, Object, Array, JSON, isNaN, RegExp });
  vm.runInContext(src, ctx, { filename: 'Shared.gs' });
  // 2026-08-27T16:30Z is already 2026-08-28 in Tokyo (UTC+9).
  assert.strictEqual(ctx.dateStr_(new Date('2026-08-27T16:30:00Z')), '2026-08-28');
  // ...and 2026-08-27T14:00Z is still 2026-08-27 there.
  assert.strictEqual(ctx.dateStr_(new Date('2026-08-27T14:00:00Z')), '2026-08-27');
});

test('parseSheetTable_ reads the pipe table Drive returns for a Sheet', () => {
  const ctx = vm.createContext({ Date, Math, Number, String, Object, Array, JSON, isNaN, RegExp });
  vm.runInContext(src, ctx, { filename: 'Shared.gs' });
  // Shape observed from a real read_file_content call, escapes included.
  const sheet = [
    '|  |  |  |', '| :-: | :-: | :-: |', '| キー | 値 | 説明 |',
    '| NASDAQ:AAPL | 232.14 | アップル 株価(USD) |',
    '| CURRENCY:USDJPY | 147.82 | ドル円レート |',
    '| 野村持株会\\_評価額 | ¥1,250,000 | 円 |',
    '| BTC\\_数量 | 0.061912 | BTC |',
    '| ゆうちょ\\_残高 |  | 円 |'
  ].join('\n');
  const t = ctx.parseSheetTable_(sheet);
  assert.strictEqual(t['NASDAQ:AAPL'], 232.14);
  assert.strictEqual(t['CURRENCY:USDJPY'], 147.82);
  assert.strictEqual(t['野村持株会_評価額'], 1250000, 'must strip ¥ and commas, and the markdown escape');
  assert.strictEqual(t['BTC_数量'], 0.061912);
  assert.ok(!('ゆうちょ_残高' in t), 'blank cells must be skipped, not stored as 0');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
