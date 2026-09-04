# price-mail-decode —— 基準価額邮件解不开码，触发器挂掉

**分类：B**（需求是对的，实现没做到＝bug）。不需要 proposal。

## 症状

Apps Script 的失败通知（2026-09-04 收到）：

| Start | Function | Error | Trigger |
|---|---|---|---|
| 9/3 7:01:55 JST | `updatePrices` | `Exception: Could not decode string.` | time-based |
| 9/4 7:01:55 JST | `updatePrices` | `Exception: Could not decode string.` | time-based |

`prices` 表一直是空的。也就是说对真实邮件从来没成功过一次
（PROGRESS.md 的 Blockers 里写着的「还没用真实邮件验证过」，第一次跑就挂了）。

## 原因

能抛出这个异常的只有 `decodeBody` 的一行，但那一行上叠了两个问题：

1. **base64。** `Utilities.base64DecodeWebSafe` 在长度不是 4 的倍数时会抛
   「Could not decode string.」。Gmail 的 `payload.body.data` 通常是带 padding 的
   base64url，所以**这一条可能性偏低**，但只要 padding 掉了就必死在这里。
2. **字符编码。** `getDataAsString()` 写死 UTF-8。日文邮件可能是 ISO-2022-JP /
   Shift_JIS，作为 UTF-8 非法时会抛同样的异常；就算不抛，也会乱码到
   找不到「基準価額」，然后静悄悄写 0 行。

到底是哪一个，只有 Apps Script 编辑器「执行数」里的堆栈能确定。
两个都是真 bug，所以没等分辨清楚就一起修了。

## 已做

- [x] 先把 base64url 补齐 padding 再解码（`+` / `/` 也归一到 websafe 字母表）
- [x] 按 `Content-Type` 里的 charset 解码，失败再退回 UTF-8
- [x] **正文只取 text/plain 或 text/html 其中一个**。原来把 multipart/alternative 的
      两份拼在一起，同一个价格抓两遍，而且同一次执行内的重复没有被去掉
- [x] 同一次执行内也按 `on + fund` 去重
- [x] 匹配到了邮件却解出 0 条时**直接 throw**。默默返回成功会失去失败通知 ——
      而这次正是失败通知暴露了问题
- [x] 手动执行时能看的 `console.log`（mimeType / charset / 正文字数 / 条数），
      解出 0 条时额外打印正文开头 800 字

## 待办

- [ ] **用户在编辑器里手动执行 `updatePrices`**，看日志和 `prices` 表
- [ ] 按真实正文修 `parsePrices` 的正则。现在的 `^(.+?)…([\d,]+)\s*円`
      会把「資産合計は 12,345,678円」这类行也当成一支基金，得看到真实正文再改
- [ ] 等正文形状确定后，把 `parsePrices` / `parsePriceDate` 作为纯函数接进 vitest。
      **在那之前不接** —— 针对猜出来的正文写测试是白做
