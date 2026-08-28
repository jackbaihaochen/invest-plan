(function () {
  'use strict';

  var RAKUTEN = 'service@rakuten-sec.co.jp';

  // 楽天証券の保有銘柄。nav_key は基準価額メールと約定メールの両方に共通して
  // 現れる部分文字列（matchInstrument_ が正規化して包含判定する）。
  var INSTRUMENTS = [
    { id: 'fund_alcan',           kind: 'fund', name: 'eMAXIS Slim 全世界株式（オルカン）',        navKeyRaw: 'eMAXIS Slim 全世界株式(オール・カントリー)' },
    { id: 'fund_slim_sp500',      kind: 'fund', name: 'eMAXIS Slim 米国株式（S&P500）',            navKeyRaw: 'eMAXIS Slim 米国株式(S&P500)' },
    { id: 'fund_rakuten_sp500',   kind: 'fund', name: '楽天・プラス・S&P500',                      navKeyRaw: '楽天・プラス・S&P500インデックス・ファンド' },
    { id: 'fund_rakuten_nasdaq',  kind: 'fund', name: '楽天・プラス・NASDAQ-100',                  navKeyRaw: '楽天・プラス・NASDAQ-100インデックス・ファンド' },
    { id: 'fund_fangplus',        kind: 'fund', name: 'iFreeNEXT FANG+',                           navKeyRaw: 'iFreeNEXT FANG+インデックス' },
    { id: 'fund_hsbc_india',      kind: 'fund', name: 'HSBC インド・インフラ株式オープン',          navKeyRaw: 'HSBC インド・インフラ株式オープン' }
  ];
  INSTRUMENTS.forEach(function (i) { i.navKey = normalizeName_(i.navKeyRaw); });

  var STOCKS = [
    { id: 'us_aapl', name: 'アップル',        qtyKey: 'AAPL_株数', priceKey: 'NASDAQ:AAPL', usd: true },
    { id: 'us_goog', name: 'アルファベットC', qtyKey: 'GOOG_株数', priceKey: 'NASDAQ:GOOG', usd: true },
    { id: 'us_crcl', name: 'サークル',        qtyKey: 'CRCL_株数', priceKey: 'NYSE:CRCL',   usd: true },
    { id: 'jp_4385', name: 'メルカリ',        qtyKey: '4385_株数', priceKey: 'TYO:4385',    usd: false }
  ];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var state = null;
  var mcp = null;
  // 'pending' | 'ready' | 'readonly'
  // readonly は「コネクタに届かない」状態。URL を直接開いた場合がこれで、
  // 契約上 use() は null を返す（能力はビューアに framed されたときだけ動く）。
  var mcpState = 'pending';
  var artifactApi = null;
  var charts = {};
  var mcTimer = null;

  // ------------------------------------------------------------------ state

  function loadState() {
    try { return JSON.parse(document.getElementById('app-state').textContent); }
    catch (e) { return null; }
  }

  /**
   * 保存用の完全な HTML を組み立てる。
   *
   * ライブ DOM を直列化するのではなく、不変のソースブロック（app-style と
   * app-script の textContent）を読み直して組み直す。こうすると
   * 「自分自身を含むテンプレート」という再帰を避けられる。
   */
  function buildDocument(next) {
    var css = document.getElementById('app-style').textContent;
    var js = document.getElementById('app-script').textContent;
    var close = '<\/scr' + 'ipt>';
    return '<!doctype html>\n<html lang="zh">\n<head>\n'
      + '<meta charset="utf-8">\n<title>1億円プロジェクト</title>\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + '<style id="app-style">' + css + '</style>\n</head>\n<body>\n'
      + '<div id="root"><div class="boot"><div class="spinner"></div><p>読み込み中…</p></div></div>\n'
      + '<script id="app-state" type="application/json">'
      + JSON.stringify(next).replace(/</g, '\\u003c') + close + '\n'
      + '<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js">' + close + '\n'
      + '<script id="app-script">' + js + close + '\n'
      + '</body>\n</html>';
  }

  var saving = false;
  function save(msg) {
    if (!artifactApi || saving) return Promise.resolve(false);
    saving = true;
    return artifactApi.publish(buildDocument(state))
      .then(function () { saving = false; return true; })
      .catch(function (e) {
        saving = false;
        // conflict は正常系（誰かが先に publish した）。再試行しない。
        if (e && e.code === 'conflict') return false;
        note('保存できませんでした: ' + (e && e.message ? e.message : e), 'err');
        return false;
      });
  }

  // -------------------------------------------------------------- mcp helpers

  function gmailSearch(query, pageSize, pageToken) {
    var input = { query: query, pageSize: pageSize || 50 };
    if (pageToken) input.pageToken = pageToken;
    return mcp.callTool('Gmail', 'search_threads', input).then(function (r) { return r.payload; });
  }

  function gmailMessage(id) {
    return mcp.callTool('Gmail', 'get_message', { messageId: id, messageFormat: 'PLAIN_TEXT' })
      .then(function (r) { return r.payload; });
  }

  function driveSheet(fileId) {
    return mcp.callTool('Google Drive', 'read_file_content', { fileId: fileId })
      .then(function (r) { return r.payload; });
  }

  /** search_threads の結果から、条件に合うメッセージを平坦化して返す。 */
  function flattenMessages(payload, subjectRe) {
    var out = [];
    (payload && payload.threads ? payload.threads : []).forEach(function (t) {
      (t.messages || []).forEach(function (m) {
        if (String(m.sender || '').indexOf(RAKUTEN) === -1) return;
        if (subjectRe && !subjectRe.test(String(m.subject || ''))) return;
        out.push({ id: m.id, date: m.date, subject: m.subject });
      });
    });
    return out;
  }

  /** 全ページを辿ってメッセージ一覧を集める。 */
  function listAll(query, subjectRe, maxPages) {
    var acc = [];
    function page(token, n) {
      return gmailSearch(query, 50, token).then(function (p) {
        acc = acc.concat(flattenMessages(p, subjectRe));
        var next = p && p.nextPageToken;
        if (next && n < (maxPages || 6)) return page(next, n + 1);
        return acc;
      });
    }
    return page(null, 1);
  }

  // ----------------------------------------------------------------- syncing

  function isoWeek(dateStr) {
    var d = parseDateStr_(dateStr);
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = (t.getDay() + 6) % 7;
    t.setDate(t.getDate() - day);
    return t.getFullYear() + '-' + t.getMonth() + '-' + t.getDate();
  }

  /**
   * 基準価額メールを取り込む。
   *
   * 全件（1年で約200通）を本文取得すると呼び出しが多すぎるので、履歴は
   * 週1通に間引く。最新の1通だけは必ず取得して、現在値は6本すべて揃える。
   */
  function syncNav(onProgress) {
    return listAll('from:' + RAKUTEN + ' subject:投信基準価額メール', /基準価額/, 6)
      .then(function (msgs) {
        msgs.sort(function (a, b) { return a.date < b.date ? 1 : -1; });

        var seen = {};
        state.seenIds.forEach(function (i) { seen[i] = true; });

        var pick = [];
        var weeks = {};
        msgs.forEach(function (m, idx) {
          if (seen[m.id]) return;
          var wk = isoWeek(dateStr_(new Date(m.date)));
          if (idx === 0 || !weeks[wk]) { weeks[wk] = true; pick.push(m); }
        });

        return fetchSequential(pick, onProgress, function (msg, body) {
          var parsed = parseNavEmail_(body, new Date(msg.date));
          parsed.rows.forEach(function (row) {
            var inst = matchInstrument_(row.name, INSTRUMENTS);
            if (!inst) return;
            if (!state.nav[inst.id]) state.nav[inst.id] = [];
            var arr = state.nav[inst.id];
            for (var i = 0; i < arr.length; i++) if (arr[i].d === parsed.baseDate) return;
            arr.push({ d: parsed.baseDate, p: row.price });
          });
          state.seenIds.push(msg.id);
        }).then(function () {
          Object.keys(state.nav).forEach(function (k) {
            state.nav[k].sort(function (a, b) { return a.d < b.d ? -1 : 1; });
          });
          return pick.length;
        });
      });
  }

  /** 約定メールを取り込む。通数が少ないので全件本文を取る。 */
  function syncTx(onProgress) {
    return listAll('from:' + RAKUTEN + ' subject:積立購入が完了', /積立購入|約定/, 3)
      .then(function (msgs) {
        var seen = {};
        state.seenIds.forEach(function (i) { seen[i] = true; });
        var pick = msgs.filter(function (m) { return !seen[m.id]; });

        return fetchSequential(pick, onProgress, function (msg, body) {
          var recs = parseTxEmail_(body, new Date(msg.date), INSTRUMENTS);
          recs.forEach(function (r) {
            var inst = matchInstrument_(r.name, INSTRUMENTS);
            if (!inst) return;
            var dup = state.tx.some(function (t) { return t.mid === msg.id && t.instId === inst.id; });
            if (dup) return;
            state.tx.push({
              date: r.execDate, instId: inst.id, amount: r.amount,
              nisa: r.nisaBucket, mid: msg.id
            });
          });
          state.seenIds.push(msg.id);
        }).then(function () {
          state.tx.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
          return pick.length;
        });
      });
  }

  /** 逐次実行。並列に投げるとレート制限に当たりやすいので直列にする。 */
  function fetchSequential(msgs, onProgress, handle) {
    var i = 0;
    function step() {
      if (i >= msgs.length) return Promise.resolve();
      var m = msgs[i++];
      if (onProgress) onProgress(i, msgs.length);
      return gmailMessage(m.id).then(function (p) {
        var body = (p && (p.plaintextBody || p.htmlBody)) || '';
        handle(m, body);
        return step();
      }).catch(function (e) {
        // 1通の失敗で全体を止めない。
        console.warn('skip message', m.id, e);
        return step();
      });
    }
    return step();
  }

  function syncSheet() {
    if (!state.sheetId) return Promise.resolve(false);
    return driveSheet(state.sheetId).then(function (p) {
      var text = (p && (p.fileContent || p.content)) || '';
      var table = parseSheetTable_(text);
      if (Object.keys(table).length) {
        state.sheet = table;
        state.sheetReadAt = todayStr_();
      }
      return true;
    }).catch(function (e) {
      note('スプレッドシートを読めませんでした: ' + (e && e.message ? e.message : e), 'err');
      return false;
    });
  }

  // --------------------------------------------------------------- computing

  function latestNav(instId) {
    var arr = state.nav[instId];
    return arr && arr.length ? arr[arr.length - 1].p : null;
  }

  function navAsOf(instId, dateStr) {
    var arr = state.nav[instId];
    if (!arr || !arr.length) return null;
    var found = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].d <= dateStr) found = arr[i]; else break;
    }
    return found ? found.p : null;
  }

  /** 約定金額と約定日の基準価額から口数を積み上げる。 */
  function unitsByInstrument() {
    var u = {};
    state.tx.forEach(function (t) {
      var nav = navAsOf(t.instId, t.date) || latestNav(t.instId);
      if (!nav) return;
      u[t.instId] = (u[t.instId] || 0) + (t.amount / nav) * FUND_UNIT_BASIS;
    });
    return u;
  }

  function num(k) { var v = state.sheet[k]; return typeof v === 'number' ? v : 0; }

  function compute() {
    var s = state.settings;
    var units = unitsByInstrument();

    var fund = 0;
    INSTRUMENTS.forEach(function (i) {
      var nav = latestNav(i.id);
      if (nav && units[i.id]) fund += (units[i.id] / FUND_UNIT_BASIS) * nav;
    });

    var usdJpy = num('CURRENCY:USDJPY');
    var stock = 0;
    STOCKS.forEach(function (st) {
      var q = num(st.qtyKey), p = num(st.priceKey);
      if (!q || !p) return;
      stock += st.usd ? q * p * usdJpy : q * p;
    });

    var btcQty = num('BTC_数量');
    var btcJpy = num('CURRENCY:BTCJPY');
    var crypto = btcQty * btcJpy;

    var nomura = num('野村持株会_評価額');
    var yucho = num('ゆうちょ_残高');
    var manual = nomura + yucho;

    var total = fund + stock + crypto + manual;
    var principal = state.tx.reduce(function (a, t) { return a + t.amount; }, 0);

    // 月次投入
    var byMonth = {};
    state.tx.forEach(function (t) {
      var k = monthKey_(t.date);
      byMonth[k] = (byMonth[k] || 0) + t.amount;
    });
    var cur = monthKey_(todayStr_());
    var thisMonth = byMonth[cur] || 0;

    var paceSum = 0;
    for (var i = 1; i <= 6; i++) paceSum += byMonth[prevMonthKey_(cur, i)] || 0;
    var pace = paceSum / 6;

    var streak = 0;
    for (var j = 1; j <= 240; j++) {
      if ((byMonth[prevMonthKey_(cur, j)] || 0) >= s.monthlyTarget) streak++; else break;
    }

    var targetEta = monthsToGoal_(total, s.monthlyTarget, s.expectedReturn, s.goal);
    var paceEta = monthsToGoal_(total, pace, s.expectedReturn, s.goal);
    var delay = (paceEta === null || targetEta === null) ? null : paceEta - targetEta;
    var horizon = targetEta || 120;

    var nisa = { tsumitate: 0, growth: 0 };
    state.tx.forEach(function (t) {
      if (String(t.nisa).indexOf('つみたて') !== -1) nisa.tsumitate += t.amount;
      else if (String(t.nisa).indexOf('成長') !== -1) nisa.growth += t.amount;
    });

    // 履歴: 各基準日の口数 = 現在の口数 − その日より後の買付口数
    var dates = {};
    Object.keys(state.nav).forEach(function (k) {
      state.nav[k].forEach(function (p) { dates[p.d] = true; });
    });
    var series = Object.keys(dates).sort().map(function (d) {
      var v = 0, pr = 0;
      INSTRUMENTS.forEach(function (i) {
        var u = units[i.id] || 0;
        state.tx.forEach(function (t) {
          if (t.instId !== i.id || t.date <= d) return;
          var nav = navAsOf(t.instId, t.date) || latestNav(t.instId);
          if (nav) u -= (t.amount / nav) * FUND_UNIT_BASIS;
        });
        if (u < 0) u = 0;
        var nav2 = navAsOf(i.id, d);
        if (nav2) v += (u / FUND_UNIT_BASIS) * nav2;
      });
      state.tx.forEach(function (t) { if (t.date <= d) pr += t.amount; });
      return { d: d, fund: v, principal: pr };
    });

    return {
      total: total, fund: fund, stock: stock, crypto: crypto, manual: manual,
      nomura: nomura, yucho: yucho, btcQty: btcQty, btcJpy: btcJpy,
      principal: principal, gain: fund - principal,
      gainPct: principal ? ((fund - principal) / principal) * 100 : 0,
      pct: (total / s.goal) * 100, remaining: Math.max(0, s.goal - total),
      thisMonth: thisMonth, thisMonthPct: (thisMonth / s.monthlyTarget) * 100,
      thisMonthShort: Math.max(0, s.monthlyTarget - thisMonth),
      pace: pace, streak: streak, byMonth: byMonth,
      targetEta: targetEta, paceEta: paceEta, delay: delay,
      requiredMonthly: requiredMonthly_(total, s.expectedReturn, horizon, s.goal),
      coast: coastAmount_(s.expectedReturn, horizon, s.goal),
      goalReal: realValue_(s.goal, s.inflation, horizon),
      nisa: nisa, series: series, units: units,
      hasNav: Object.keys(state.nav).length > 0,
      hasSheet: Object.keys(state.sheet).length > 0
    };
  }

  // ---------------------------------------------------------------- helpers

  function jpy(n) { return jpyLabel_(n); }
  function signed(n) { return (n >= 0 ? '+' : '') + jpy(n); }
  function pct(n) { return (Number(n) || 0).toFixed(1) + '%'; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function etaLabel(m) {
    if (m === null || m === undefined) return '—';
    var d = new Date(); d.setMonth(d.getMonth() + m);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
  }

  var notes = [];
  function note(msg, kind) {
    notes.push({ msg: msg, kind: kind || 'ok' });
    renderNotes();
  }
  function renderNotes() {
    var box = $('#notes');
    if (!box) return;
    box.innerHTML = (mcpState === 'readonly' ? readonlyBanner() : '')
      + notes.map(function (n) {
          return '<div class="' + n.kind + '">' + esc(n.msg) + '</div>';
        }).join('');
  }

  /**
   * URL を直接開いたときの案内。
   * この状態でも保存済みの数字は全部出るので、画面は殺さず注意書きだけ足す。
   */
  function readonlyBanner() {
    return '<div class="err"><b>読み取り専用モード</b><br>'
      + 'この開き方では Gmail に接続できないため、表示は'
      + (state.lastSync ? '<b>' + esc(state.lastSync) + ' に同期した内容</b>' : '未同期の初期状態')
      + 'のままです。<br><br>'
      + '更新するには <b>claude.ai にログインした状態で</b>このページを開いてください'
      + '（スマホならブラウザで claude.ai → Artifacts → このページ）。'
      + 'アプリのインストールは不要です。</div>';
  }

  // ---------------------------------------------------------------- rendering

  function render() {
    var c = compute();
    var s = state.settings;
    var ready = c.hasNav && state.tx.length > 0;

    $('#root').innerHTML = ready ? dashboardHtml(c, s) : setupHtml(c);
    renderNotes();
    wire(c, s);
    if (ready) { drawCharts(c); whatIf(c, s); }
  }

  function setupHtml(c) {
    var sheetUrl = state.sheetId
      ? 'https://docs.google.com/spreadsheets/d/' + state.sheetId + '/edit' : '';
    return ''
      + '<div class="topbar"><div><h1>1億円プロジェクト</h1>'
      + '<p class="sub">最初の同期をすると、ここがダッシュボードになります。</p></div></div>'
      + '<div id="notes"></div>'
      + '<section class="card"><h2>セットアップ</h2><div class="steps">'
      + '<div class="step' + (state.sheetId ? ' done' : '') + '"><div>'
      + (sheetUrl
          ? '<a href="' + sheetUrl + '" target="_blank" rel="noopener">データ用スプレッドシート</a> を開く'
          : 'スプレッドシートが未設定です')
      + '</div></div>'
      + '<div class="step"><div>セル <b>B3</b> に次の数式を貼り付けて Enter。株価と為替が6行ぶん一度に入ります。<br>'
      + '<code>=MAP(A3:A8,LAMBDA(t,IFERROR(GOOGLEFINANCE(t),0)))</code></div></div>'
      + '<div class="step"><div><b>野村持株会_評価額</b> と <b>ゆうちょ_残高</b> の B 列に金額を入力（株を持っていれば株数も）。</div></div>'
      + '<div class="step"><div>下のボタンで最初の同期。楽天証券のメールを遡って読み込みます（1〜2分）。</div></div>'
      + '</div>'
      + '<div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;">'
      + '<button id="sync">最初の同期を実行</button>'
      + '</div>'
      + '<div class="prog" id="prog" hidden><i></i></div>'
      + '<p class="note" id="progText"></p>'
      + '</section>'
      + '<p class="foot">データは楽天証券の通知メールとあなたのスプレッドシートから読み込みます。<br>'
      + 'このページはあなただけが見られます。</p>';
  }

  function dashboardHtml(c, s) {
    var dir = c.delay === null ? 'unknown' : (c.delay > 0 ? 'behind' : (c.delay < 0 ? 'ahead' : 'on_track'));
    var sheetUrl = 'https://docs.google.com/spreadsheets/d/' + state.sheetId + '/edit';
    var circ = 2 * Math.PI * 86;
    var p = Math.max(0, Math.min(100, c.pct));

    var gapLabel, gapValue;
    if (dir === 'behind') { gapLabel = '計画より遅れ'; gapValue = humanMonths_(Math.abs(c.delay)); }
    else if (dir === 'ahead') { gapLabel = '計画より前倒し'; gapValue = humanMonths_(Math.abs(c.delay)); }
    else if (dir === 'on_track') { gapLabel = '順調'; gapValue = '計画どおり'; }
    else { gapLabel = '今のペースでは'; gapValue = '到達しません'; }

    return ''
      + '<div class="topbar"><div><h1>1億円プロジェクト</h1>'
      + '<p class="sub">' + (state.lastSync || '—') + ' 同期 · 目標 ' + jpy(s.goal)
      + (c.hasSheet ? '' : ' · <span class="warn">相場データ未取得</span>') + '</p></div>'
      + '<button class="ghost" id="sync">同期</button></div>'
      + '<div id="notes"></div>'
      + '<div class="prog" id="prog" hidden><i></i></div>'
      + '<p class="note" id="progText"></p>'

      // hero
      + '<section class="card hero">'
      + '<div class="ringwrap"><svg viewBox="0 0 200 200" class="ring">'
      + '<circle class="bg" cx="100" cy="100" r="86"></circle>'
      + '<circle class="fg" cx="100" cy="100" r="86" stroke-dasharray="' + circ
      + '" stroke-dashoffset="' + (circ * (1 - p / 100)) + '"></circle></svg>'
      + '<div class="ringc"><b>' + p.toFixed(1) + '%</b><span>到 1億円</span></div></div>'
      + '<div class="figs">'
      + fig('现在资产', jpy(c.total), '')
      + fig('还差', jpy(c.remaining), '', 'dim')
      + fig('投信の運用益', signed(c.gain),
            '元本比 ' + (c.gainPct >= 0 ? '+' : '') + pct(c.gainPct), c.gain >= 0 ? 'up' : 'down')
      + '</div></section>'

      // verdict
      + '<section class="card verdict ' + dir + '">'
      + '<div class="vm"><span class="k">按<em>当前实际节奏</em>（近6个月平均 ' + jpy(c.pace) + '/月）</span>'
      + '<b class="eta">' + (c.paceEta === null ? 'このペースでは届きません'
          : etaLabel(c.paceEta) + '（' + humanMonths_(c.paceEta) + '）') + '</b></div>'
      + '<div class="gap"><span>' + gapLabel + '</span><b>' + gapValue + '</b></div>'
      + '<div class="vm"><span class="k">按<em>计划</em>（' + jpy(s.monthlyTarget) + '/月）</span>'
      + '<b class="eta plan">' + (c.targetEta === null ? '—'
          : etaLabel(c.targetEta) + '（' + humanMonths_(c.targetEta) + '）') + '</b></div>'
      + '</section>'

      // this month
      + '<section class="card"><div class="row"><h2 style="margin:0">本月投入</h2>'
      + '<span class="small">' + (c.streak > 0 ? '🔥 连续达标 ' + c.streak + ' 个月' : '连续达标：0 个月')
      + '</span></div>'
      + '<div class="bar"><i class="' + (c.thisMonth >= s.monthlyTarget ? '' : 'short')
      + '" style="width:' + Math.min(100, c.thisMonthPct) + '%"></i></div>'
      + '<div class="row small"><span>' + jpy(c.thisMonth) + ' / ' + jpy(s.monthlyTarget)
      + '（' + pct(c.thisMonthPct) + '）</span><span class="' + (c.thisMonthShort ? 'warn' : 'up') + '">'
      + (c.thisMonthShort > 0 ? 'あと ' + jpy(c.thisMonthShort) : '達成 ✓') + '</span></div>'
      + '<p class="note">目標期日（' + etaLabel(c.targetEta) + '）に間に合わせるには、今の残高から月 '
      + jpy(c.requiredMonthly) + ' が必要。</p></section>'

      // history
      + '<section class="card"><h2>資産推移（楽天証券 投資信託）</h2>'
      + '<canvas id="hist" height="220"></canvas>'
      + '<p class="note">実線＝評価額、点線＝投入元本。差が運用益。'
      + '基準価額メールから復元しているため週次サンプルです。</p></section>'

      // breakdown + contributions
      + '<div class="grid2">'
      + '<section class="card"><h2>口座別内訳</h2><div class="bd">'
      + bd('楽天証券 投資信託', c.fund, c.total, '#4ade80')
      + bd('楽天証券 株式', c.stock, c.total, '#60a5fa')
      + bd('bitFlyer（' + c.btcQty + ' BTC）', c.crypto, c.total, '#fbbf24')
      + bd('野村持株会', c.nomura, c.total, '#a78bfa')
      + bd('ゆうちょ銀行', c.yucho, c.total, '#f472b6')
      + '</div>'
      + (c.hasSheet ? '' : '<p class="note warn">相場と手入力の値がまだ読めていません。'
          + '<a href="' + sheetUrl + '" target="_blank" rel="noopener">シート</a>を確認して「同期」を押してください。</p>')
      + '</section>'
      + '<section class="card"><h2>月次投入額</h2><canvas id="contrib" height="200"></canvas></section>'
      + '</div>'

      // forecast
      + '<section class="card"><h2>将来予測</h2>'
      + '<div class="sl"><label for="wf">毎月の積立額</label>'
      + '<input type="range" id="wf" min="0" max="800000" step="10000" value="' + s.monthlyTarget + '">'
      + '<output id="wfv"></output></div>'
      + '<div class="wf" id="wfr"></div>'
      + '<canvas id="fc" height="240"></canvas>'
      + '<p class="note">帯は2,000回のモンテカルロ試行による10〜90パーセンタイル。'
      + '年率' + pct(s.expectedReturn * 100) + '・ボラティリティ' + pct(s.volatility * 100)
      + 'を仮定。<strong>7%は平均であって保証ではありません。</strong></p></section>'

      // milestones
      + '<section class="card"><h2>マイルストーン</h2><div class="ms">'
      + [20000000, 30000000, 50000000, 75000000, s.goal].map(function (m) {
          var done = c.total >= m;
          return '<div class="' + (done ? 'done' : '') + '"><b>' + (m / 10000).toLocaleString('ja-JP')
            + '万円</b><span>' + (done ? '達成 ✓' : 'あと ' + jpy(m - c.total)) + '</span></div>';
        }).join('')
      + '</div></section>'

      // caveats
      + '<section class="card cav"><h2>把这些记在心里</h2><ul>'
      + '<li>想定年利 <strong>' + pct(s.expectedReturn * 100) + '</strong> は<strong>米ドル建ての名目</strong>リターン。'
      + '円建てで見る以上 <strong>USD/JPY の変動</strong>を直接受ける（円高は逆風）。</li>'
      + '<li><strong>特定口座</strong>の譲渡益には <strong>' + pct(s.taxRate * 100) + '</strong> の税。'
      + '1億円を<strong>税引後</strong>で持ちたいなら必要な評価額はさらに上。</li>'
      + '<li>NISA生涯投資枠 ' + jpy(s.nisaCap) + ' のうち <strong>'
      + jpy(c.nisa.tsumitate + c.nisa.growth) + '</strong> を使用済み'
      + '（つみたて枠 ' + jpy(c.nisa.tsumitate) + ' / 成長枠 ' + jpy(c.nisa.growth) + '）。</li>'
      + '<li>目標達成時の1億円は、インフレ年' + pct(s.inflation * 100) + 'なら今の <strong>'
      + jpy(c.goalReal) + '</strong> 相当の購買力。</li>'
      + '<li>' + (c.total >= c.coast
          ? '✓ <strong>Coast FIRE 到達</strong>：今後積み立てなくても複利だけで目標期日に届く水準。'
          : 'Coast FIRE ライン（積立を止めても届く額）は <strong>' + jpy(c.coast)
            + '</strong>。あと ' + jpy(c.coast - c.total) + '。') + '</li>'
      + '<li>持株会は<strong>給与と自社株が同じ会社に集中</strong>する。会社が傾けば収入と資産が同時に減る。</li>'
      + '</ul></section>'

      + '<p class="foot"><a href="' + sheetUrl + '" target="_blank" rel="noopener">データ用スプレッドシートを開く</a><br>'
      + '楽天証券の通知メール・GOOGLEFINANCE より。投资有风险，本页仅为个人记录工具。</p>';
  }

  function fig(k, v, d, cls) {
    return '<div class="fig"><span class="k">' + k + '</span>'
      + '<span class="v ' + (cls === 'dim' ? 'dim' : (cls || '')) + '">' + v + '</span>'
      + (d ? '<span class="d ' + (cls || '') + '">' + d + '</span>' : '') + '</div>';
  }

  function bd(label, value, total, color) {
    if (!value) return '';
    var w = total ? (value / total) * 100 : 0;
    return '<div class="bdr"><div class="bdh"><span>' + label + '</span><span>'
      + jpy(value) + ' · ' + w.toFixed(1) + '%</span></div>'
      + '<div class="bdb"><i style="width:' + w + '%;background:' + color + '"></i></div></div>';
  }

  // ------------------------------------------------------------------ charts

  var GRID = { color: 'rgba(255,255,255,.06)' };
  var TICK = { color: '#93a1b3', font: { size: 10 } };

  function opts() {
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#93a1b3', boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: function (x) { return x.dataset.label + ': ' + jpy(x.parsed.y); } } }
      },
      scales: {
        x: { grid: GRID, ticks: TICK },
        y: { grid: GRID, ticks: { color: '#93a1b3', font: { size: 10 },
             callback: function (v) { return (v / 10000).toLocaleString('ja-JP') + '万'; } } }
      }
    };
  }

  function drawCharts(c) {
    if (typeof Chart === 'undefined') return;
    if (charts.hist) charts.hist.destroy();
    charts.hist = new Chart($('#hist'), {
      type: 'line',
      data: {
        labels: c.series.map(function (x) { return x.d.slice(2); }),
        datasets: [
          { label: '評価額', data: c.series.map(function (x) { return x.fund; }),
            borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,.10)',
            fill: true, tension: .25, pointRadius: 0, borderWidth: 2 },
          { label: '投入元本', data: c.series.map(function (x) { return x.principal; }),
            borderColor: '#93a1b3', borderDash: [5, 4], fill: false, tension: .25,
            pointRadius: 0, borderWidth: 1.5 }
        ]
      },
      options: opts()
    });

    var months = Object.keys(c.byMonth).sort().slice(-18);
    if (charts.contrib) charts.contrib.destroy();
    charts.contrib = new Chart($('#contrib'), {
      type: 'bar',
      data: {
        labels: months.map(function (m) { return m.slice(2); }),
        datasets: [
          { label: '投入額', data: months.map(function (m) { return c.byMonth[m]; }),
            backgroundColor: months.map(function (m) {
              return c.byMonth[m] >= state.settings.monthlyTarget ? '#4ade80' : '#fbbf24';
            }), borderRadius: 4 },
          { label: '目標', type: 'line', data: months.map(function () { return state.settings.monthlyTarget; }),
            borderColor: '#60a5fa', borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, fill: false }
        ]
      },
      options: opts()
    });
  }

  function gauss() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** 幾何ブラウン運動。年率とボラティリティを月次の対数正規に落として回す。 */
  function monteCarlo(current, monthly, mu, sigma, months, paths) {
    var sd = sigma / Math.sqrt(12);
    var m = Math.log(1 + mu) / 12 - (sd * sd) / 2;
    var step = 3, n = Math.floor(months / step) + 1, buckets = [];
    for (var i = 0; i < n; i++) buckets.push(new Float64Array(paths));
    for (var p = 0; p < paths; p++) {
      var v = current, si = 0;
      buckets[si++][p] = v;
      for (var t = 1; t <= months; t++) {
        v = v * Math.exp(m + sd * gauss()) + monthly;
        if (t % step === 0) buckets[si++][p] = v;
      }
    }
    function q(a, k) {
      var b = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; });
      return b[Math.min(b.length - 1, Math.floor(k * b.length))];
    }
    return buckets.map(function (b, i) {
      return { month: i * step, p10: q(b, .10), p50: q(b, .50), p90: q(b, .90) };
    });
  }

  function drawForecast(bands, goal) {
    if (typeof Chart === 'undefined') return;
    if (charts.fc) charts.fc.destroy();
    charts.fc = new Chart($('#fc'), {
      type: 'line',
      data: {
        labels: bands.map(function (b) { return (b.month / 12).toFixed(1) + '年'; }),
        datasets: [
          { label: '楽観 (90%)', data: bands.map(function (b) { return b.p90; }),
            borderColor: 'rgba(74,222,128,.35)', backgroundColor: 'rgba(74,222,128,.10)',
            fill: '+1', pointRadius: 0, borderWidth: 1, tension: .3 },
          { label: '中央値 (50%)', data: bands.map(function (b) { return b.p50; }),
            borderColor: '#4ade80', fill: false, pointRadius: 0, borderWidth: 2.5, tension: .3 },
          { label: '悲観 (10%)', data: bands.map(function (b) { return b.p10; }),
            borderColor: 'rgba(74,222,128,.35)', fill: false, pointRadius: 0, borderWidth: 1, tension: .3 },
          { label: '目標', data: bands.map(function () { return goal; }),
            borderColor: '#f87171', borderDash: [6, 4], fill: false, pointRadius: 0, borderWidth: 1.5 }
        ]
      },
      options: opts()
    });
  }

  function whatIf(c, s) {
    var slider = $('#wf');
    if (!slider) return;
    function update() {
      var monthly = Number(slider.value);
      $('#wfv').textContent = jpy(monthly) + '/月';
      var m = monthsToGoal_(c.total, monthly, s.expectedReturn, s.goal);
      var diff = (m === null || c.targetEta === null) ? null : c.targetEta - m;
      var txt = m === null ? 'この金額では1億円に到達しません。'
        : '1億円到達は <strong>' + etaLabel(m) + '</strong>（' + humanMonths_(m) + '）。';
      if (diff) {
        txt += diff > 0
          ? ' 计划より <strong>' + humanMonths_(diff) + '早い</strong>。'
          : ' 计划より ' + humanMonths_(-diff) + '遅い。';
      }
      $('#wfr').innerHTML = txt;
      clearTimeout(mcTimer);
      mcTimer = setTimeout(function () {
        var horizon = Math.min(360, Math.max(120, (m || 240) + 24));
        drawForecast(monteCarlo(c.total, monthly, s.expectedReturn, s.volatility, horizon, 2000), s.goal);
      }, 180);
    }
    slider.addEventListener('input', update);
    update();
  }

  // -------------------------------------------------------------------- wire

  function wire(c, s) {
    var btn = $('#sync');
    if (!btn) return;
    if (mcpState === 'readonly') {
      btn.disabled = true;
      btn.textContent = '同期できません';
      btn.title = 'claude.ai 上で開くと同期できます';
      return;
    }
    if (mcpState === 'pending') {
      btn.disabled = true;
      btn.textContent = '接続中…';
      return;
    }
    btn.addEventListener('click', runSync);
  }

  function progress(i, n, label) {
    var bar = $('#prog'), txt = $('#progText');
    if (!bar) return;
    bar.hidden = false;
    bar.firstChild.style.width = n ? (i / n) * 100 + '%' : '0%';
    if (txt) txt.textContent = label + '  ' + i + ' / ' + n;
  }

  function runSync() {
    if (!mcp) { note('コネクタが使えません。claude.ai のこのページを開き直してください。', 'err'); return; }
    var btn = $('#sync');
    if (btn) { btn.disabled = true; btn.textContent = '同期中…'; }
    notes = [];

    var navCount = 0, txCount = 0;
    syncNav(function (i, n) { progress(i, n, '基準価額メール'); })
      .then(function (n) { navCount = n; return syncTx(function (i, m) { progress(i, m, '約定メール'); }); })
      .then(function (n) { txCount = n; return syncSheet(); })
      .then(function () {
        state.lastSync = todayStr_();
        note('同期しました（基準価額 ' + navCount + ' 通 / 約定 ' + txCount + ' 通）。', 'ok');
        return save();
      })
      .then(function () { render(); })
      .catch(function (e) {
        note('同期に失敗しました: ' + (e && e.message ? e.message : e), 'err');
        if (btn) { btn.disabled = false; btn.textContent = '同期'; }
        render();
      });
  }

  // -------------------------------------------------------------------- boot

  // Node から読み込まれたときは計算部分だけを公開してテストに使う。
  // ブラウザには module が無いので、この分岐は通らず通常起動する。
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      compute: compute,
      monteCarlo: monteCarlo,
      unitsByInstrument: unitsByInstrument,
      INSTRUMENTS: INSTRUMENTS,
      setState: function (s) { state = s; }
    };
    return;
  }

  state = loadState();
  if (!state) {
    document.getElementById('root').innerHTML =
      '<div class="err">状態を読み込めませんでした。</div>';
    return;
  }
  state.nav = state.nav || {};
  state.tx = state.tx || [];
  state.seenIds = state.seenIds || [];
  state.sheet = state.sheet || {};

  // 能力は必ず後から解決する（同期的な最初の実行中には絶対に来ない）。
  // まず保存済みデータだけで描き、解決したら描き直す。
  if (window.claude && typeof window.claude.use === 'function') {
    render();
    window.claude.use('mcp').then(function (m) {
      mcp = m;
      mcpState = m ? 'ready' : 'readonly';
      render();
    }).catch(function () { mcpState = 'readonly'; render(); });
    window.claude.use('artifact').then(function (a) { artifactApi = a; }).catch(function () {});
  } else {
    // window.claude すら無い＝ビューア外のコピー。
    mcpState = 'readonly';
    render();
  }
})();
