/**
 * 時間主導トリガーの設置。1度だけ実行する（重複作成は自動で防ぐ）。
 */

function installTriggers() {
  var existing = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { existing[t.getHandlerFunction()] = true; });
  var created = [];

  if (!existing.dailyIngest) {
    ScriptApp.newTrigger('dailyIngest').timeBased().atHour(8).everyDays(1).inTimezone(TZ).create();
    created.push('dailyIngest（毎日 8:00 JST）');
  }
  if (!existing.sendWeeklyReport) {
    ScriptApp.newTrigger('sendWeeklyReport').timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone(TZ).create();
    created.push('sendWeeklyReport（毎週月曜 8:00 JST）');
  }
  if (!existing.sendMonthlyReport) {
    ScriptApp.newTrigger('sendMonthlyReport').timeBased()
      .onMonthDay(1).atHour(9).inTimezone(TZ).create();
    created.push('sendMonthlyReport（毎月1日 9:00 JST）');
  }

  return created.length ? '設置しました:\n  ' + created.join('\n  ') : 'トリガーは設置済みです。';
}

function removeTriggers() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); n++; });
  return n + ' 件のトリガーを削除しました。';
}

/** スプレッドシートのメニューから主要な操作を実行できるようにする。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('1億円プロジェクト')
    .addItem('初期セットアップ', 'setupSheets')
    .addItem('全履歴を取り込む（初回）', 'backfillAll')
    .addSeparator()
    .addItem('今すぐ更新', 'dailyIngest')
    .addItem('スナップショット再構築', 'rebuildSnapshots')
    .addSeparator()
    .addItem('週次レポートを送る', 'sendWeeklyReport')
    .addItem('トリガーを設置', 'installTriggers')
    .addToUi();
}
