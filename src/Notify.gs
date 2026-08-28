/**
 * 自分宛の進捗レポートメール。
 *
 * 週次は「今月あといくら」、月次は「締めた結果と到達予定日の変化」。
 * 数字を並べるだけでなく、遅れているときは何をすれば戻るかまで書く。
 */

function emailStyles_() {
  return 'font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;'
    + 'background:#0f1216;color:#e8edf3;padding:24px;border-radius:12px;max-width:560px;';
}

function bar_(pctVal, color) {
  var w = Math.max(0, Math.min(100, pctVal));
  return '<div style="background:#1e252e;border-radius:6px;height:10px;overflow:hidden;margin:8px 0;">'
    + '<div style="background:' + color + ';height:10px;width:' + w + '%;border-radius:6px;"></div></div>';
}

function row_(label, value, color) {
  return '<tr><td style="padding:6px 0;color:#93a1b3;font-size:13px;">' + label + '</td>'
    + '<td style="padding:6px 0;text-align:right;font-size:15px;font-weight:700;color:'
    + (color || '#e8edf3') + ';">' + value + '</td></tr>';
}

function webAppUrl_() {
  try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; }
}

/** 遅れ具合に応じたコーチング文。 */
function coachLine_(c) {
  if (c.delayDirection === 'ahead') {
    return '計画より <b>' + c.delayHuman + '前倒し</b>。このまま維持すれば十分に届く。';
  }
  if (c.delayDirection === 'on_track') {
    return '計画どおり。今のペースを崩さないこと。';
  }
  if (c.delayDirection === 'unknown') {
    return '今のペースでは 1億円に到達しない計算。積立額の見直しが必要。';
  }
  var extra = Math.max(0, c.monthlyTarget - c.pace);
  return '計画より <b style="color:#f87171;">' + c.delayHuman + '遅れ</b>。'
    + '毎月あと <b>' + jpyLabel_(extra) + '</b> 積み増せば計画に戻る。';
}

function buildReport_(c, title, extraRows) {
  var url = webAppUrl_();
  var monthColor = c.thisMonth >= c.monthlyTarget ? '#4ade80' : '#fbbf24';

  var html = '<div style="' + emailStyles_() + '">'
    + '<div style="font-size:11px;color:#93a1b3;letter-spacing:.08em;">1億円プロジェクト</div>'
    + '<h2 style="margin:6px 0 18px;font-size:18px;">' + title + '</h2>'

    + '<div style="font-size:32px;font-weight:700;letter-spacing:-.02em;">' + jpyLabel_(c.total) + '</div>'
    + '<div style="font-size:13px;color:#93a1b3;margin-top:2px;">'
    + '目標 1億円の <b style="color:#4ade80;">' + c.pct.toFixed(1) + '%</b>'
    + '　/　あと ' + jpyLabel_(c.remaining) + '</div>'
    + bar_(c.pct, '#4ade80')

    + '<div style="margin:22px 0 8px;font-size:12px;color:#93a1b3;">今月の投入</div>'
    + '<div style="font-size:20px;font-weight:700;color:' + monthColor + ';">'
    + jpyLabel_(c.thisMonth) + ' <span style="font-size:13px;color:#93a1b3;font-weight:400;">/ '
    + jpyLabel_(c.monthlyTarget) + '</span></div>'
    + bar_(c.thisMonthPct, monthColor)
    + (c.thisMonthShort > 0
        ? '<div style="font-size:13px;color:#fbbf24;">あと ' + jpyLabel_(c.thisMonthShort) + '</div>'
        : '<div style="font-size:13px;color:#4ade80;">今月は達成 ✓</div>')

    + '<table style="width:100%;margin:22px 0 0;border-top:1px solid #2a323d;">'
    + row_('現在のペース（近6ヶ月平均）', jpyLabel_(c.pace) + '/月')
    + row_('そのペースでの到達', c.paceEtaLabel + '（' + c.paceEtaHuman + '）', '#fbbf24')
    + row_('計画どおりなら', c.targetEtaLabel + '（' + c.targetEtaHuman + '）', '#60a5fa')
    + (extraRows || '')
    + row_('連続達成', c.streak + ' ヶ月')
    + row_('投信の運用益', (c.gain >= 0 ? '+' : '') + jpyLabel_(c.gain), c.gain >= 0 ? '#4ade80' : '#f87171')
    + '</table>'

    + '<div style="margin-top:20px;padding:14px;background:#1e252e;border-radius:10px;font-size:13px;line-height:1.7;">'
    + coachLine_(c) + '</div>'

    + (url ? '<div style="margin-top:20px;"><a href="' + url + '" style="color:#4ade80;font-size:13px;">'
        + 'ダッシュボードを開く →</a></div>' : '')

    + '<div style="margin-top:20px;font-size:11px;color:#5b6675;line-height:1.7;">'
    + '想定年利 ' + (c.expectedReturn * 100).toFixed(0) + '%（米ドル建て名目）。'
    + '為替・税・インフレは別途考慮が必要。</div>'
    + '</div>';

  return html;
}

/** 毎週月曜。今月の進捗と不足額を知らせる。 */
function sendWeeklyReport() {
  var c = computeCoaching();
  var cfg = getSettings_();
  var subject = '【1億円】' + c.pct.toFixed(1) + '% · ' + jpyLabel_(c.total)
    + '（今月 ' + jpyLabel_(c.thisMonth) + '/' + jpyLabel_(c.monthlyTarget) + '）';
  MailApp.sendEmail({
    to: cfg.notifyEmail || Session.getActiveUser().getEmail(),
    subject: subject,
    htmlBody: buildReport_(c, '今週の進捗'),
    name: '1億円プロジェクト'
  });
  return subject;
}

/** 毎月1日。前月を締めて結果を知らせる。 */
function sendMonthlyReport() {
  var c = computeCoaching();
  var cfg = getSettings_();
  var byMonth = contributionsByMonth_();
  var lastKey = prevMonthKey_(monthKey_(todayStr_()), 1);
  var lastAmount = byMonth[lastKey] || 0;
  var achieved = lastAmount >= c.monthlyTarget;

  var extra = row_(lastKey + ' の投入',
    jpyLabel_(lastAmount) + (achieved ? ' ✓' : ' ✗'),
    achieved ? '#4ade80' : '#f87171');

  var subject = '【1億円】' + lastKey + ' 締め · '
    + (achieved ? '目標達成 ✓' : '未達 ' + jpyLabel_(c.monthlyTarget - lastAmount) + '不足');

  MailApp.sendEmail({
    to: cfg.notifyEmail || Session.getActiveUser().getEmail(),
    subject: subject,
    htmlBody: buildReport_(c, lastKey + ' の締め', extra),
    name: '1億円プロジェクト'
  });
  return subject;
}
