# PROGRESS

**Current Status**：`claude/rebuild` 分支。提案已批准，正在实现。
骨架（Vite + React + TS + vitest）就位，两个 CSV 解析器完成并对真实文件验证通过（19 项测试）。
下一步：基準価額メール解析 → 领域计算 → Apps Script → UI。

**Blockers**：无（CSV 已拿到并验证，见 proposal §8）。等提案批准即可开工。

---

## Plan

- [x] 架构提案获批
- [x] 项目骨架（Vite + React + TS + vitest）／ [ ] GitHub Pages 部署
- [x] CSV 解析（持仓快照 + 交易履历，19 项测试对真实文件通过）
- [ ] 手动记录与 CSV 的对账（coverageEnd 接缝 + 匹配规则）
- [ ] 交易记录一览 + 分类时序图
- [ ] Google Sheet 读路径 + 数据模型
- [ ] Apps Script 写端点（令牌鉴权）
- [ ] Apps Script 日次触发器：基準価額メール → prices 表
- [ ] 投入记录与月度进度环
- [ ] 看板其余部分（曲线、持仓、NISA、What-if、里程碑）

---

## Completed

### 2026-09-01 · CSV 解析器完成，对真实文件全部验证通过
`src/domain/{csv,types,holdings,transactions}.ts` + 19 项测试。测试直接读仓库里的
原始 CP932 文件，不放转码副本 —— 能否用 `TextDecoder('shift_jis')` 读也是被测对象。

断言的是硬数字，不留丸め誤差的逃生口：Σ評価損益 = ***（与記載完全一致）、
時価 *** ＋ 預り金 *** 与 資産合計 差 −6、NISA 取得原価 = ***、
純入金 = ***、coverageEnd = 2026-08-18。

未知の取引区分は**抛错而不是默默归类** —— 默认归 internal 会漏掉入金，
默认归 inflow 会重复计。两种都是静默出错。

写测试时发现三处我自己写错的断言（跨币种振替当天 JP 侧还有一笔金積立、
income 是 61 笔不是 60、JP/US 不重复这一点只对売買成立不对振替成立），
已按数据实际的样子修正。合计段的标签是「預り金合計」不是「預り金等合計」。

### 2026-09-01 · 拿到真实 CSV，三个文件全部解析验证通过
`assetbalance(all)` / `adjusthistory(JP)` / `adjusthistory(US)`，均为 CP932。
重算 Σ時価 ***（+預り金 = ***，与記載 資産合計 *** 差 −6 円，
美股行四舍五入）；Σ評価損益 *** 与記載**完全一致**；NISA 枠使用 ***
与上一版记录一致。

三个会静默算错的坑已记录进 proposal §8：明细表头 `［単位］` 重复 4 次（不能按名建索引）、
取得原価必须由「時価 − 評価損益」反推（各種別倍率不同）、`振替出金` 是金の定額積立
（内部移动，不是取出）。US 文件第 3/4 列顺序与 JP 相反。

全期间净入金 *** 円，对应现资产 *** 円 → 运用益 *** 円。

### 2026-09-01 · 重启项目，确定架构方向
分支 `claude/rebuild` 从 `main`（仅一行 README 的 initial commit）切出，
只带过来 `CLAUDE.md` 和 `NOTES-background.md`。上一版的实现全部留在
`claude/savings-goal-tracker-0dv6g6`，不再使用。

实测确认 Google Sheet 的 `gviz/tq?tqx=out:csv` 端点带 CORS 头，静态页面可直接读取，
读路径零成本。写路径定为用户一次性部署的 Apps Script Web App。

激励机制围绕「手动买入补足 40 万/月差额」设计，而非每日打卡 —— 見 `docs/decisions.md`。
