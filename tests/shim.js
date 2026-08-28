// Minimal Apps Script shim so the .gs parsers can be exercised under Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function pad(n, w) { return String(n).padStart(w, '0'); }

// All fixtures and expectations are JST; the shim formats in JST explicitly.
function jstParts(d) {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const j = new Date(utc + 9 * 3600000);
  return { y: j.getFullYear(), m: j.getMonth() + 1, d: j.getDate() };
}

const Utilities = {
  formatDate(date, tz, pattern) {
    const p = jstParts(date);
    if (pattern === 'yyyy-MM-dd') return `${p.y}-${pad(p.m, 2)}-${pad(p.d, 2)}`;
    if (pattern === 'yyyy') return String(p.y);
    if (pattern === 'MM') return pad(p.m, 2);
    throw new Error('unsupported pattern ' + pattern);
  },
  formatString(fmt, ...args) {
    let i = 0;
    return fmt.replace(/%s/g, () => String(args[i++]));
  }
};

const Session = { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) };
const PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };

function loadGas(files) {
  const ctx = vm.createContext({
    Utilities, Session, PropertiesService,
    console, Date, Math, Number, String, Object, Array, JSON, isNaN, RegExp
  });
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    vm.runInContext(src, ctx, { filename: f });
  }
  return ctx;
}

module.exports = { loadGas };
