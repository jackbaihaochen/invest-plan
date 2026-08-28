const assert = require('assert');
const { loadGas } = require('./shim');

const ctx = loadGas(['Config.gs', 'Projection.gs']);
const { futureValue_, monthsToGoal_, requiredMonthly_, coastAmount_, humanMonths_, realValue_ } = ctx;

const CURRENT = 13000000;   // 現在の資産
const GOAL = 100000000;     // 1億円
const R = 0.07;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('\nprojection');

test("the user's own estimate checks out: 40万/月 reaches 1億 in ~10.4 years", () => {
  const m = monthsToGoal_(CURRENT, 400000, R, GOAL);
  assert.strictEqual(m, 125);
  assert.strictEqual(humanMonths_(m), '10年5ヶ月');
});

test('at exactly 10 years, 40万/月 lands just short of the goal (~9,536万)', () => {
  const v = futureValue_(CURRENT, 400000, R, 120);
  assert.ok(v > 95000000 && v < 96000000, 'got ' + Math.round(v));
  assert.ok(v < GOAL, 'should fall short of 1億 at 10 years');
});

test('hitting 1億 in exactly 10 years needs ~42.7万/月', () => {
  const pmt = requiredMonthly_(CURRENT, R, 120, GOAL);
  assert.ok(Math.abs(pmt - 426810) < 100, 'got ' + Math.round(pmt));
});

test('requiredMonthly_ round-trips through futureValue_', () => {
  const pmt = requiredMonthly_(CURRENT, R, 120, GOAL);
  const v = futureValue_(CURRENT, pmt, R, 120);
  assert.ok(Math.abs(v - GOAL) < 1, 'got ' + Math.round(v));
});

test('the observed ~15万/月 pace pushes the goal out to ~16.9 years', () => {
  const m = monthsToGoal_(CURRENT, 150000, R, GOAL);
  assert.strictEqual(m, 203);
  assert.strictEqual(humanMonths_(m), '16年11ヶ月');
});

test('the gap between plan and observed pace is 6 years 6 months', () => {
  const delay = monthsToGoal_(CURRENT, 150000, R, GOAL) - monthsToGoal_(CURRENT, 400000, R, GOAL);
  assert.strictEqual(delay, 78);
  assert.strictEqual(humanMonths_(delay), '6年6ヶ月');
});

test('more contribution never takes longer', () => {
  let prev = Infinity;
  for (const pmt of [0, 50000, 100000, 200000, 400000, 800000]) {
    const m = monthsToGoal_(CURRENT, pmt, R, GOAL);
    assert.ok(m !== null && m <= prev, 'not monotonic at ' + pmt);
    prev = m;
  }
});

test('already at goal returns 0 months', () => {
  assert.strictEqual(monthsToGoal_(GOAL, 0, R, GOAL), 0);
  assert.strictEqual(monthsToGoal_(GOAL + 1, 0, R, GOAL), 0);
});

test('zero contribution and zero return never reaches the goal', () => {
  assert.strictEqual(monthsToGoal_(CURRENT, 0, 0, GOAL), null);
});

test('zero return still works when contributing (pure arithmetic)', () => {
  // (100,000,000 - 13,000,000) / 400,000 = 217.5 -> 218 months
  assert.strictEqual(monthsToGoal_(CURRENT, 400000, 0, GOAL), 218);
});

test('Coast FIRE line: that amount alone compounds to the goal', () => {
  const months = monthsToGoal_(CURRENT, 400000, R, GOAL);
  const coast = coastAmount_(R, months, GOAL);
  assert.ok(coast < GOAL, 'coast amount must be below the goal');
  const v = futureValue_(coast, 0, R, months);
  assert.ok(Math.abs(v - GOAL) < 1, 'compounds to ' + Math.round(v));
});

test('inflation makes the goal worth less in real terms', () => {
  const real = realValue_(GOAL, 0.01, 125);
  assert.ok(real < GOAL && real > 85000000, 'got ' + Math.round(real));
});

test('humanMonths_ formats the edges', () => {
  assert.strictEqual(humanMonths_(0), '0ヶ月');
  assert.strictEqual(humanMonths_(12), '1年');
  assert.strictEqual(humanMonths_(13), '1年1ヶ月');
  assert.strictEqual(humanMonths_(null), '到達しません');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
