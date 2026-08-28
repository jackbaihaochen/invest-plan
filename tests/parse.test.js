const assert = require('assert');
const { loadGas } = require('./shim');
const F = require('./fixtures');

const ctx = loadGas(['Shared.gs']);
const { parseNavEmail_, parseTxEmail_, parseDividendEmail_, normalizeName_, matchInstrument_ } = ctx;

const INSTRUMENTS = F.INSTRUMENT_SEED.map(([id, navKey]) => ({ id, navKey: normalizeName_(navKey) }));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('\nnormalizeName_');
test('NFKC folds fullwidth alphanumerics and the ＆ sign', () => {
  assert.strictEqual(normalizeName_('eMAXIS　Slim　米国株式（Ｓ＆Ｐ５００）'), 'EMAXISSLIM米国株式(S&P500)');
});
test('fullwidth and halfwidth fund names collapse to the same key', () => {
  assert.strictEqual(
    normalizeName_('楽天・プラス・Ｓ＆Ｐ５００インデックス・ファンド'),
    normalizeName_('楽天・プラス・S&P500インデックス・ファンド'));
});
test('S&P500 fund does not collide with the NASDAQ-100 fund', () => {
  const a = matchInstrument_('楽天・プラス・S&P500インデックス・ファンド (楽天投信投資顧問)', INSTRUMENTS);
  const b = matchInstrument_('楽天・プラス・NASDAQ-100インデックス・ファンド (楽天投信投資顧問)', INSTRUMENTS);
  assert.strictEqual(a.id, 'fund_rakuten_sp500');
  assert.strictEqual(b.id, 'fund_rakuten_nasdaq');
});
test('eMAXIS 全世界 does not collide with eMAXIS 米国', () => {
  const a = matchInstrument_('eMAXIS　Slim　全世界株式（オール・カントリー） (三菱ＵＦＪアセットマネジメント)', INSTRUMENTS);
  const b = matchInstrument_('eMAXIS　Slim　米国株式（S&P500） (三菱ＵＦＪアセットマネジメント)', INSTRUMENTS);
  assert.strictEqual(a.id, 'fund_alcan');
  assert.strictEqual(b.id, 'fund_slim_sp500');
});

console.log('\nparseNavEmail_ (plain text)');
const navText = parseNavEmail_(F.NAV_TEXT, new Date('2026-08-27T23:01:24Z'));
test('extracts all six funds', () => assert.strictEqual(navText.rows.length, 6));
test('uses the 基準日 from the body, not the received date', () =>
  assert.strictEqual(navText.baseDate, '2026-08-27'));
test('parses comma-separated NAV values', () => {
  const byId = {};
  navText.rows.forEach(r => { const m = matchInstrument_(r.name, INSTRUMENTS); if (m) byId[m.id] = r.price; });
  assert.strictEqual(byId.fund_alcan, 38629);
  assert.strictEqual(byId.fund_slim_sp500, 44958);
  assert.strictEqual(byId.fund_fangplus, 98519);
  assert.strictEqual(byId.fund_hsbc_india, 19215);
  assert.strictEqual(byId.fund_rakuten_nasdaq, 18686);
  assert.strictEqual(byId.fund_rakuten_sp500, 20005);
});
test('every parsed row matches a known instrument', () => {
  navText.rows.forEach(r => assert.ok(matchInstrument_(r.name, INSTRUMENTS), 'unmatched: ' + r.name));
});

console.log('\nparseNavEmail_ (HTML — the format 楽天証券 actually sends)');
const navHtml = parseNavEmail_(F.NAV_HTML, new Date('2026-08-27T23:01:24Z'));
test('HTML table yields the same six funds', () => assert.strictEqual(navHtml.rows.length, 6));
test('HTML and text paths agree on every price', () => {
  const key = rows => rows.map(r => matchInstrument_(r.name, INSTRUMENTS).id + ':' + r.price).sort().join(',');
  assert.strictEqual(key(navHtml.rows), key(navText.rows));
});
test('&amp; entity decodes so S&P500 still matches', () => {
  const hit = navHtml.rows.find(r => matchInstrument_(r.name, INSTRUMENTS).id === 'fund_slim_sp500');
  assert.strictEqual(hit.price, 44958);
});

console.log('\nparseTxEmail_');
const txOne = parseTxEmail_(F.TX_SINGLE, new Date('2026-08-13T07:05:46Z'), INSTRUMENTS);
test('single-fund email yields one record', () => assert.strictEqual(txOne.length, 1));
test('reads 購入金額 / 口座区分 / 約定日', () => {
  assert.strictEqual(txOne[0].amount, 100000);
  assert.strictEqual(txOne[0].nisaBucket, 'NISAつみたて投資枠');
  assert.strictEqual(txOne[0].execDate, '2026-08-12');
  assert.strictEqual(txOne[0].orderDate, '2026-08-08');
});

const txTwo = parseTxEmail_(F.TX_MULTI, new Date('2026-05-11T23:08:13Z'), INSTRUMENTS);
test('multi-fund email yields two records', () => assert.strictEqual(txTwo.length, 2));
test('each fund keeps its own amount and NISA bucket', () => {
  assert.strictEqual(txTwo[0].amount, 100000);
  assert.strictEqual(txTwo[0].nisaBucket, 'NISAつみたて投資枠');
  assert.strictEqual(txTwo[1].amount, 50000);
  assert.strictEqual(txTwo[1].nisaBucket, 'NISA成長投資枠');
  assert.strictEqual(matchInstrument_(txTwo[1].name, INSTRUMENTS).id, 'fund_fangplus');
});
test('both records share the 約定日', () => {
  assert.strictEqual(txTwo[0].execDate, '2026-05-11');
  assert.strictEqual(txTwo[1].execDate, '2026-05-11');
});

const txFw = parseTxEmail_(F.TX_FULLWIDTH, new Date('2025-08-13T05:27:16Z'), INSTRUMENTS);
test('fullwidth Ｓ＆Ｐ５００ fund name is recognised', () => {
  assert.strictEqual(txFw.length, 1);
  assert.strictEqual(matchInstrument_(txFw[0].name, INSTRUMENTS).id, 'fund_rakuten_sp500');
  assert.strictEqual(txFw[0].amount, 100000);
});

const txRoll = parseTxEmail_(F.TX_ROLLOVER, new Date('2026-01-06T00:00:00Z'), INSTRUMENTS);
test('December order executing in January resolves to the next year', () => {
  assert.strictEqual(txRoll[0].orderDate, '2025-12-28');
  assert.strictEqual(txRoll[0].execDate, '2026-01-05');
});

console.log('\nparseDividendEmail_');
test('reads USD dividend total', () => {
  // The parser returns an object created inside the VM realm, so compare fields
  // rather than using deepStrictEqual (which also compares prototypes).
  const d = parseDividendEmail_(F.DIVIDEND);
  assert.strictEqual(d.amount, 1.98);
  assert.strictEqual(d.currency, 'USD');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
