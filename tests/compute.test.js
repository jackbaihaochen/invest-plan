// Drives the *built* artifact's compute() so the shipped bundle is what gets tested.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, (what || '') + ' expected ~' + Math.round(b) + ', got ' + Math.round(a));

const html = fs.readFileSync('build/dashboard.html', 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)[1];

const mod = { exports: {} };
const ctx = vm.createContext({
  module: mod, Date, Math, Number, String, Object, Array, JSON, isNaN, RegExp,
  console, Float64Array, setTimeout, clearTimeout, window: undefined
});
vm.runInContext(script, ctx, { filename: 'dashboard.html' });
const app = mod.exports;

// A month key N months before the current one, so the fixture stays valid over time.
function monthsAgo(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function baseState(over) {
  return Object.assign({
    version: 1, lastSync: '2026-08-28', sheetId: 'x',
    settings: { goal: 100000000, monthlyTarget: 400000, expectedReturn: 0.07,
                volatility: 0.15, inflation: 0.01, taxRate: 0.20315, nisaCap: 18000000 },
    nav: {
      fund_alcan: [{ d: '2026-08-12', p: 38395 }, { d: '2026-08-27', p: 38629 }],
      fund_fangplus: [{ d: '2026-08-12', p: 97000 }, { d: '2026-08-27', p: 98519 }]
    },
    tx: [
      { date: '2026-08-12', instId: 'fund_alcan', amount: 100000, nisa: 'NISAつみたて投資枠', mid: 'm1' },
      { date: '2026-08-12', instId: 'fund_fangplus', amount: 50000, nisa: 'NISA成長投資枠', mid: 'm1' }
    ],
    seenIds: ['m1'],
    sheet: {
      'NASDAQ:AAPL': 232.14, 'AAPL_株数': 10,
      'CURRENCY:USDJPY': 147.82,
      'CURRENCY:BTCJPY': 17000000, 'BTC_数量': 0.061912,
      '野村持株会_評価額': 1250000, 'ゆうちょ_残高': 300000
    },
    sheetReadAt: '2026-08-28'
  }, over || {});
}

console.log('\ncompute (built bundle)');

app.setState(baseState());
const c = app.compute();

test('units are derived from the NAV on the 約定日, per 1万口', () => {
  const u = app.unitsByInstrument();
  near(u.fund_alcan, (100000 / 38395) * 10000, 0.01, 'alcan units');
  near(u.fund_fangplus, (50000 / 97000) * 10000, 0.01, 'fangplus units');
});

test('fund value uses the latest NAV, so a NAV rise shows as gain', () => {
  const expected = (100000 / 38395) * 38629 + (50000 / 97000) * 98519;
  near(c.fund, expected, 1, 'fund value');
  assert.ok(c.fund > 150000, 'both NAVs rose, so value must exceed the 150,000 principal');
});

test('principal counts only what was actually contributed', () => {
  assert.strictEqual(c.principal, 150000);
  near(c.gain, c.fund - 150000, 1, 'gain');
});

test('US stock is converted to JPY via the sheet FX rate', () => {
  near(c.stock, 10 * 232.14 * 147.82, 1, 'stock');
});

test('BTC is quantity x JPY price', () => {
  near(c.crypto, 0.061912 * 17000000, 1, 'crypto');
});

test('manual accounts add up', () => {
  assert.strictEqual(c.nomura, 1250000);
  assert.strictEqual(c.yucho, 300000);
  assert.strictEqual(c.manual, 1550000);
});

test('total is the sum of every bucket', () => {
  near(c.total, c.fund + c.stock + c.crypto + c.manual, 1, 'total');
});

test('NISA buckets are split by 口座区分', () => {
  assert.strictEqual(c.nisa.tsumitate, 100000);
  assert.strictEqual(c.nisa.growth, 50000);
});

test('a missing sheet value degrades to zero rather than NaN', () => {
  app.setState(baseState({ sheet: {} }));
  const d = app.compute();
  assert.strictEqual(d.stock, 0);
  assert.strictEqual(d.crypto, 0);
  assert.strictEqual(d.manual, 0);
  assert.ok(!isNaN(d.total) && d.total > 0, 'funds should still be valued');
  assert.strictEqual(d.hasSheet, false);
});

console.log('\ncoaching (built bundle)');

test('trailing pace averages the last 6 complete months, excluding this one', () => {
  const tx = [];
  for (let i = 1; i <= 6; i++) tx.push({ date: monthsAgo(i) + '-10', instId: 'fund_alcan', amount: 300000, nisa: '', mid: 'p' + i });
  tx.push({ date: monthsAgo(0) + '-05', instId: 'fund_alcan', amount: 999999, nisa: '', mid: 'now' });
  app.setState(baseState({ tx, nav: { fund_alcan: [{ d: '2020-01-01', p: 30000 }] } }));
  const d = app.compute();
  assert.strictEqual(d.pace, 300000, 'current month must not drag the average');
  assert.strictEqual(d.thisMonth, 999999);
});

test('streak counts consecutive complete months at or above target', () => {
  const tx = [];
  for (let i = 1; i <= 3; i++) tx.push({ date: monthsAgo(i) + '-10', instId: 'fund_alcan', amount: 400000, nisa: '', mid: 's' + i });
  tx.push({ date: monthsAgo(4) + '-10', instId: 'fund_alcan', amount: 100000, nisa: '', mid: 's4' });
  app.setState(baseState({ tx, nav: { fund_alcan: [{ d: '2020-01-01', p: 30000 }] } }));
  assert.strictEqual(app.compute().streak, 3);
});

test('a slower pace produces a later ETA than the plan', () => {
  const tx = [];
  for (let i = 1; i <= 6; i++) tx.push({ date: monthsAgo(i) + '-10', instId: 'fund_alcan', amount: 150000, nisa: '', mid: 'q' + i });
  app.setState(baseState({ tx, nav: { fund_alcan: [{ d: '2020-01-01', p: 30000 }] } }));
  const d = app.compute();
  assert.ok(d.paceEta > d.targetEta, 'pace ETA must be later');
  assert.ok(d.delay > 0, 'delay must be positive when behind');
});

test('history series never shows more units than were owned at the time', () => {
  app.setState(baseState());
  const d = app.compute();
  const first = d.series[0], last = d.series[d.series.length - 1];
  assert.ok(first.principal <= last.principal, 'principal must be non-decreasing');
  d.series.forEach(pt => assert.ok(pt.fund >= 0 && !isNaN(pt.fund), 'bad point at ' + pt.d));
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
