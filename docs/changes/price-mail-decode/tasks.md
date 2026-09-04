# price-mail-decode —— 基準価額邮件解不开码，触发器挂掉

**分类：B**（需求是对的，实现没做到＝bug）。不需要 proposal。

## 症状

Apps Script 的失败通知（2026-09-04 收到）：

| Start | Function | Error | Trigger |
|---|---|---|---|
| 9/3 7:01:55 JST | `updatePrices` | `Exception: Could not decode string.` | time-based |
| 9/4 7:01:55 JST | `updatePrices` | `Exception: Could not decode string.` | time-based |

`prices` 表一直是空的 —— 对真实邮件从来没成功过一次。

## 定位过程（值得记下来，因为前两次都猜错了）

1. **第一次：猜。** 认为是 base64 少 padding 或字符编码写死 UTF-8，两个都修了。
   → 用户手动执行，**同样的异常**。
2. **第二次：读堆栈。** 报 `decodePart` 那一行，而且它之后那句 `console.log` 一行都没打出来 ——
   确定是 `Utilities.base64DecodeWebSafe` 抛的，与字符编码无关，补 padding 也无效。
3. **第三次：不猜，打印真实形状。** 一个只打印不写表的临时函数：

```
mimeType=text/html
typeof=object ctor=Array
length=6562
charset=iso-2022-jp
head=60,33,68,79,67,84,89,80,69,32,72,84,77,76,32,80,85,66,76,73,67  ← "<!DOCTYPE HTML PUBLIC"
```

## 真因

**高级服务（`Gmail.Users.Messages.get`）会把 `body.data` 预先解码成字节数组。**
它在 discovery 文档里是 `format: byte`，Apps Script 的客户端替我们解掉了 base64。
网上的示例几乎都按「直接调 REST」写，那种前提下 `data` 才是 base64 字符串。

原来的 `String(part.body.data)` 把数组揉成 `"60,33,68,..."` 这串数字，再送去 base64 解码，
必然抛 `Could not decode string.`。正确写法只有一句：

```javascript
Utilities.newBlob(part.body.data).getDataAsString(charset)
```

**字符编码那一半也是错的，而且方向反了。** 按 header 的 `iso-2022-jp` 去解，
执行日志里 ASCII 全好、日文全变 U+FFFD（`20,031���`）。原因同上：
header 的 `charset` 描述的是**原始邮件**，而高级服务在解成字节数组时已经转成 UTF-8 了。
五种编码并排打印后确认 **UTF-8 才是对的**，所以 `charsetOf` 整个删掉 ——
它不是不够，是会主动骗人。

## 已做

- [x] `decodePart` 改为直接把字节数组交给 `newBlob`，全程不碰 base64
- [x] 固定按 **UTF-8** 解码，删掉读 header charset 的 `charsetOf`
- [x] **正文只取 text/plain 或 text/html 其中一个**（实物只有 html）。
      原来把两份拼在一起，同一个价格抓两遍，且同一次执行内的重复没被去掉
- [x] 同一次执行内也按 `on + fund` 去重
- [x] 解出 0 条时 throw，并打印 `dumpLines()` —— 去标签、去空行、**带行号的 30 行**。
      执行日志复制不出来，所以要能一屏截图。原来打原始正文前 800 字，
      对 HTML 只能看到 DOCTYPE 和 CSS
- [x] **按真实排版重写 `parsePrices`**（见下）
- [x] `tests/apps-script.test.ts`：把 `.gs` 的纯函数用桩跑起来，13 项，夹具照抄真实排版

## 真实排版（2026-09-04 执行日志）

去掉标签后，每支基金 6 行：

```
 3| ファンド名(委託会社)          ← 表头，共 7 行
 4| 基準価額
 …
 8| HSBC インド・インフラ株式オープン        ← 名称
 9| (ＨＳＢＣアセットマネジメント)            ← 委託会社
10| 19,016円                                ← 基準価額 ★ 要的只有这个
11| -308円                                  ← 前营业日比（金额）
12| (-1.59％)                               ← 前营业日比（率）
13| 5.45％                                  ← 年率回报
```

**关键区分点：基準価額不带符号，前营业日比带 `+` / `-`。** 所以用
`/^([\d,]+)円$/` 锚定整行就能分开，不需要数行数 —— 基金增减、中间插文案都不会坏。

名字向上回溯最多 3 行，遇到括号行当作委託会社，拼成 `名前 (委託会社)` ——
这正是 `src/domain/prices.ts` 的 `normalizeFund` 期待的形状（它会去掉括号内容再和 CSV 对）。
碰到表头、注意书（含「。」或以「※」开头）、纯数字行就**返回空，放弃这条** ——
宁可不取，也不能取错。

## 完成

2026-09-04，用户手动执行 `updatePrices` 成功，`prices` 表写入了数据。
触发器每天 7:01 自动跑，同日同基金不重复写。**这条改动到此结束。**

网页应用（`/exec`）**不需要重新部署**：这次只动了 `updatePrices` 这条链，
`doGet` / `doPost` → `loadTables` / `saveTables` 一个字都没改。
触发器跑的是当前保存的代码，网页应用跑的是部署时钉住的版本 —— 两条路是分开的。

## 教训

`.gs` 在这台机器上验证不了，但**它依赖的外部形状是可以问出来的**。
连猜三次（padding / header charset ×2）的成本，远高于一开始就让用户跑一个六行的打印函数。

而且两次都栽在同一件事上：**高级服务不按 REST 文档的样子给数据**。
`format: byte` 会被预先解码，`Content-Type` 的 charset 在转码后已经失效。
以后再碰 Apps Script 的高级服务，先打印 `typeof` 和实际内容，再写代码。
