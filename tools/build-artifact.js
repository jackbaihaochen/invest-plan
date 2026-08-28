#!/usr/bin/env node
/**
 * Artifact ページのビルド。
 *
 * Shared.gs（Apps Script と共用の純 JS）と app.js を1枚の HTML に埋め込む。
 * 同じ関数がテスト・Apps Script・ブラウザの3か所で使われ、実装は1つだけ。
 *
 * 出力ページは `artifact` 能力で自分自身を publish して状態を保存するため、
 * app-style / app-script のテキストをそのまま読み直して文書を組み直せる形にする。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const shared = read('src/Shared.gs');
const app = read('artifact/app.js');
const style = read('artifact/style.css');
let tpl = read('artifact/template.html');

// 初期状態。同期前でも画面が壊れないよう空で入れておく。
const initialState = {
  version: 1,
  lastSync: null,
  sheetId: process.env.SHEET_ID || '',
  settings: {
    goal: 100000000,
    monthlyTarget: 400000,
    expectedReturn: 0.07,
    volatility: 0.15,
    inflation: 0.01,
    taxRate: 0.20315,
    nisaCap: 18000000
  },
  nav: {},
  tx: [],
  seenIds: [],
  sheet: {},
  sheetReadAt: null,
  manualNote: ''
};

const script = [
  '/* ---- src/Shared.gs (Apps Script と共用・テスト済み) ---- */',
  shared,
  '/* ---- artifact/app.js ---- */',
  app
].join('\n');

tpl = tpl
  .replace('/*__STYLE__*/', style)
  .replace('/*__SCRIPT__*/', script)
  .replace('/*__STATE__*/', JSON.stringify(initialState));

const out = path.join(root, 'build/dashboard.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, tpl);

const kb = (Buffer.byteLength(tpl) / 1024).toFixed(1);
console.log(`built build/dashboard.html  (${kb} KB)`);
if (Buffer.byteLength(tpl) > 16 * 1024 * 1024) {
  console.error('ERROR: exceeds the 16MB artifact limit');
  process.exit(1);
}
