# -*- coding: utf-8 -*-
"""1億円プロジェクト — Google Sheets 用ワークブックを生成する。

Drive コネクタ経由でシートを作ると数式が落ちる（検証済み）ため、
数式・書式・グラフを保持できる .xlsx を作り、Google スプレッドシートに
インポートしてもらう方式にしている。

使い方:  python3 tools/build-sheet.py build/1oku.xlsx
"""
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule
from openpyxl.chart import LineChart, BarChart, Reference

# ---- パレット -------------------------------------------------------------
INK    = "0F172A"
BAND   = "1E293B"
ACCENT = "2563EB"
GOOD   = "047857"
BAD    = "B91C1C"
MUTED  = "64748B"
PAPER  = "F8FAFC"
EDIT   = "FEF9C3"   # 入力してほしいセル
LINE   = "E2E8F0"

YEN  = '#,##0"円"'
YEN0 = '#,##0'
PCT  = '0.0%'
MON  = 'yyyy"年"m"月"'
DAY  = 'yyyy/m/d'

MONTHS = 60    # 月次残高の数式を流す行数
LOGS   = 400   # 入金ログの数式を流す行数

S_DASH, S_MON, S_LOG, S_CFG = "ダッシュボード", "月次残高", "入金ログ", "設定"

# 設定セルへの参照（絶対参照で固定）
GOAL   = f"'{S_CFG}'!$B$2"
TARGET = f"'{S_CFG}'!$B$3"
RATE   = f"'{S_CFG}'!$B$4"
BASE   = f"'{S_CFG}'!$B$5"
PACE0  = f"'{S_CFG}'!$B$6"
MRATE  = f"({RATE}/12)"

LOG_D = f"'{S_LOG}'!$A$3:$A${LOGS}"
LOG_A = f"'{S_LOG}'!$C$3:$C${LOGS}"


def bar(ratio_expr, width=22):
    """達成率を █/░ のバーで表す。Excel/Sheets 双方で動く REPT のみ使用。"""
    n = f'ROUND(MIN(1,MAX(0,{ratio_expr}))*{width},0)'
    return f'=IFERROR(REPT("█",{n})&REPT("░",{width}-{n}),"")'


def months_label(m):
    """124.8 → 「10年5ヶ月」。"""
    return (f'=IFERROR(INT({m}/12)&"年"&ROUND(MOD({m},12),0)&"ヶ月","—")')


def put(ws, ref, value, *, font=None, fill=None, fmt=None, align=None):
    c = ws[ref]
    c.value = value
    if font:  c.font = font
    if fill:  c.fill = PatternFill("solid", fgColor=fill)
    if fmt:   c.number_format = fmt
    if align: c.alignment = align
    return c


def band(ws, row, text, first="B", last="G"):
    """セクション見出しの帯。"""
    ws.merge_cells(f"{first}{row}:{last}{row}")
    put(ws, f"{first}{row}", text,
        font=Font(bold=True, size=11, color="FFFFFF"), fill=BAND,
        align=Alignment(vertical="center", indent=1))
    ws.row_dimensions[row].height = 24


def label(ws, row, text, col="B"):
    put(ws, f"{col}{row}", text, font=Font(size=10, color=MUTED),
        align=Alignment(vertical="center", indent=1))


# =========================================================================
wb = Workbook()

# ---------------------------------------------------------------- 設定 ----
cfg = wb.active
cfg.title = S_CFG
cfg.sheet_view.showGridLines = False
cfg.column_dimensions["A"].width = 30
cfg.column_dimensions["B"].width = 18
cfg.column_dimensions["C"].width = 52

put(cfg, "A1", "設定", font=Font(bold=True, size=16, color=INK))
rows = [
    ("目標金額",            100_000_000, YEN,  "ゴール。1億円。"),
    ("毎月の目標投入額",       400_000,   YEN,  "この額を毎月入れると約10年で届く。"),
    ("想定年利",                  0.07,   PCT,  "S&P500 の長期平均。保証ではない。"),
    ("開始時点の累計元本",   12_000_000,   YEN,  "いまの資産のうち「自分で入れた金額」。だいたいで良い。"),
    ("現在の実績ペース(月)",    150_000,   YEN,  "入金ログが3ヶ月分たまるまでの暫定値。"),
]
for i, (name, val, fmt, note) in enumerate(rows, start=2):
    put(cfg, f"A{i}", name, font=Font(size=11, color=INK), align=Alignment(indent=1))
    put(cfg, f"B{i}", val, font=Font(bold=True, size=12, color=ACCENT), fmt=fmt,
        fill=EDIT, align=Alignment(horizontal="right"))
    put(cfg, f"C{i}", note, font=Font(size=9, color=MUTED), align=Alignment(indent=1))
    cfg.row_dimensions[i].height = 22

put(cfg, "A8", "黄色いセルは自由に変えてください。他のシートは全部ここを見ています。",
    font=Font(size=9, italic=True, color=MUTED))

# ------------------------------------------------------------ 入金ログ ----
log = wb.create_sheet(S_LOG)
log.sheet_view.showGridLines = False
for col, w in zip("ABCDEF", (13, 15, 14, 26, 15, 26)):
    log.column_dimensions[col].width = w

put(log, "A1", "入金ログ ── 投資したらこの下に1行足すだけ",
    font=Font(bold=True, size=14, color=INK))
log.merge_cells("A1:F1")
log.row_dimensions[1].height = 26

heads = ["日付", "口座", "金額", "メモ", "今月の累計", "今月の達成度"]
for j, h in enumerate(heads, start=1):
    put(log, f"{get_column_letter(j)}2", h,
        font=Font(bold=True, size=10, color="FFFFFF"), fill=BAND,
        align=Alignment(horizontal="center", vertical="center"))
log.row_dimensions[2].height = 22
log.freeze_panes = "A3"

for r in range(3, LOGS + 1):
    log[f"E{r}"] = (f'=IF($A{r}="","",SUMIFS({LOG_A},{LOG_D},'
                    f'">="&DATE(YEAR($A{r}),MONTH($A{r}),1),'
                    f'{LOG_D},"<"&EOMONTH($A{r},0)+1))')
    log[f"F{r}"] = (f'=IF($A{r}="","",IFERROR(REPT("█",ROUND(MIN(1,$E{r}/{TARGET})*18,0))'
                    f'&REPT("░",18-ROUND(MIN(1,$E{r}/{TARGET})*18,0)),""))')
    log[f"A{r}"].number_format = DAY
    log[f"C{r}"].number_format = YEN
    log[f"E{r}"].number_format = YEN
    log[f"E{r}"].font = Font(size=10, color=MUTED)
    log[f"F{r}"].font = Font(size=10, color=ACCENT)
    for col in "ABCD":
        log[f"{col}{r}"].fill = PatternFill("solid", fgColor=EDIT)

dv = DataValidation(type="list",
                    formula1='"楽天証券,野村持株会,bitFlyer,ゆうちょ銀行,その他"',
                    allow_blank=True, showDropDown=False)
log.add_data_validation(dv)
dv.add(f"B3:B{LOGS}")

# 書き方の見本（金額0なので集計に影響しない）
log["A3"] = "=DATE(YEAR(TODAY()),MONTH(TODAY()),1)"
log["B3"] = "楽天証券"
log["C3"] = 0
log["D3"] = "← これは記入例。上書きして使ってください"
log["D3"].font = Font(size=9, italic=True, color=MUTED)

# ------------------------------------------------------------ 月次残高 ----
mon = wb.create_sheet(S_MON)
mon.sheet_view.showGridLines = False
for col, w in zip("ABCDEFGHIJK", (12, 14, 14, 13, 13, 15, 14, 15, 15, 8, 8)):
    mon.column_dimensions[col].width = w

put(mon, "A1", "月次残高 ── 月に1回、4つの口座の残高を書くだけ",
    font=Font(bold=True, size=14, color=INK))
mon.merge_cells("A1:K1")
mon.row_dimensions[1].height = 26

heads = ["年月", "楽天証券", "野村持株会", "bitFlyer", "ゆうちょ銀行",
         "合計", "当月の投入", "累計元本", "評価損益", "達成", "連続"]
for j, h in enumerate(heads, start=1):
    put(mon, f"{get_column_letter(j)}2", h,
        font=Font(bold=True, size=10, color="FFFFFF"), fill=BAND,
        align=Alignment(horizontal="center", vertical="center"))
mon.row_dimensions[2].height = 22
mon.freeze_panes = "B3"

for r in range(3, MONTHS + 3):
    a = f"$A{r}"
    mon[f"F{r}"] = f'=IF({a}="","",SUM($B{r}:$E{r}))'
    mon[f"G{r}"] = (f'=IF({a}="","",SUMIFS({LOG_A},{LOG_D},">="&{a},'
                    f'{LOG_D},"<"&EOMONTH({a},0)+1))')
    mon[f"H{r}"] = (f'=IF({a}="","",{BASE}+SUMIFS({LOG_A},{LOG_D},'
                    f'"<"&EOMONTH({a},0)+1))')
    mon[f"I{r}"] = f'=IF({a}="","",$F{r}-$H{r})'
    mon[f"J{r}"] = f'=IF({a}="","",IF($G{r}>={TARGET},"✓","–"))'
    if r == 3:
        mon[f"K{r}"] = f'=IF({a}="","",IF($G{r}>={TARGET},1,0))'
    else:
        mon[f"K{r}"] = (f'=IF({a}="","",IF($G{r}>={TARGET},'
                        f'IF($K{r-1}="",1,$K{r-1}+1),0))')
    mon[f"A{r}"].number_format = MON
    for col in "BCDEFGHI":
        mon[f"{col}{r}"].number_format = YEN
    for col in "BCDE":
        mon[f"{col}{r}"].fill = PatternFill("solid", fgColor=EDIT)
    for col in "FGHI":
        mon[f"{col}{r}"].font = Font(size=10, color=MUTED)
    mon[f"F{r}"].font = Font(bold=True, size=10, color=INK)
    for col in "JK":
        mon[f"{col}{r}"].alignment = Alignment(horizontal="center")

mon.conditional_formatting.add(
    f"I3:I{MONTHS+2}",
    CellIsRule(operator="lessThan", formula=["0"], font=Font(color=BAD)))
mon.conditional_formatting.add(
    f"J3:J{MONTHS+2}",
    CellIsRule(operator="equal", formula=['"✓"'],
               fill=PatternFill("solid", fgColor="D1FAE5")))

# 最初の1行（仮の数字。ユーザーが上書きする前提）
mon["A3"] = "=DATE(YEAR(TODAY()),MONTH(TODAY()),1)"
for ref, v in (("B3", 11_000_000), ("C3", 800_000), ("D3", 890_000), ("E3", 300_000)):
    mon[ref] = v
mon.column_dimensions["M"].width = 44
put(mon, "M3", "← この行は仮の数字です。実際の残高に置き換えてください。",
    font=Font(size=10, bold=True, color=BAD))

# -------------------------------------------------------- ダッシュボード ----
dash = wb.create_sheet(S_DASH, 0)
dash.sheet_view.showGridLines = False
for col, w in zip("ABCDEFG", (2, 26, 20, 16, 26, 3, 4)):
    dash.column_dimensions[col].width = w

LAST_F = f"IFERROR(LOOKUP(2,1/('{S_MON}'!$F$3:$F${MONTHS+2}<>\"\"),'{S_MON}'!$F$3:$F${MONTHS+2}),0)"
LAST_H = f"IFERROR(LOOKUP(2,1/('{S_MON}'!$H$3:$H${MONTHS+2}<>\"\"),'{S_MON}'!$H$3:$H${MONTHS+2}),0)"
LAST_K = f"IFERROR(LOOKUP(2,1/('{S_MON}'!$K$3:$K${MONTHS+2}<>\"\"),'{S_MON}'!$K$3:$K${MONTHS+2}),0)"

TOTAL = "$C$6"      # 総資産
THIS  = "$C$14"     # 今月の投入額
PACE  = "$C$21"     # 現在ペース
MP    = "$C$22"     # 現在ペースでの残り月数
MT    = "$C$23"     # 目標ペースでの残り月数

big   = Font(bold=True, size=20, color=INK)
huge  = Font(bold=True, size=26, color=ACCENT)
val   = Font(bold=True, size=12, color=INK)
sub   = Font(size=10, color=MUTED)
barf  = Font(size=11, color=ACCENT)

put(dash, "B2", "1億円プロジェクト", font=Font(bold=True, size=24, color=INK))
dash.row_dimensions[2].height = 36
put(dash, "B3", f'=" 目標 "&TEXT({GOAL},"#,##0")&"円 ／ 毎月 "&TEXT({TARGET},"#,##0")'
               f'&"円 ／ 想定年利 "&TEXT({RATE},"0.0%")', font=sub)
put(dash, "E2", "=TODAY()", font=sub, fmt=DAY,
    align=Alignment(horizontal="right"))

# --- いまの状況
band(dash, 5, "  いまの状況")
label(dash, 6, "総資産");        put(dash, "C6", f"={LAST_F}", font=huge, fmt=YEN)
dash.row_dimensions[6].height = 34
label(dash, 7, "ゴールまで");    put(dash, "C7", f"={GOAL}-{TOTAL}", font=val, fmt=YEN)
label(dash, 8, "進捗");          put(dash, "C8", f"={TOTAL}/{GOAL}", font=val, fmt=PCT)
put(dash, "E8", bar(f"{TOTAL}/{GOAL}"), font=barf)
label(dash, 9, "累計元本");      put(dash, "C9", f"={LAST_H}", font=val, fmt=YEN)
label(dash, 10, "評価損益")
put(dash, "C10", f"={TOTAL}-$C$9", font=val, fmt='+#,##0"円";-#,##0"円"')
put(dash, "D10", f'=IFERROR($C$10/$C$9,0)', font=sub, fmt='+0.0%;-0.0%')
dash.conditional_formatting.add("C10:D10",
    CellIsRule(operator="lessThan", formula=["0"], font=Font(bold=True, color=BAD)))
dash.conditional_formatting.add("C10:D10",
    CellIsRule(operator="greaterThan", formula=["0"], font=Font(bold=True, color=GOOD)))

# --- 今月
band(dash, 13, '=" 今月 ── "&TEXT(TODAY(),"yyyy年m月")')
label(dash, 14, "投入した額")
put(dash, "C14", f'=SUMIFS({LOG_A},{LOG_D},">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),'
                 f'{LOG_D},"<"&EOMONTH(TODAY(),0)+1)', font=huge, fmt=YEN)
dash.row_dimensions[14].height = 34
put(dash, "D14", f'=" / "&TEXT({TARGET},"#,##0")&"円"', font=sub)
label(dash, 15, "達成率");  put(dash, "C15", f"=IFERROR({THIS}/{TARGET},0)", font=val, fmt=PCT)
put(dash, "E15", bar(f"{THIS}/{TARGET}"), font=barf)
label(dash, 16, "あと必要な額")
put(dash, "C16", f"=MAX(0,{TARGET}-{THIS})", font=val, fmt=YEN)
put(dash, "D16", '="今月あと"&(EOMONTH(TODAY(),0)-TODAY())&"日"', font=sub)
label(dash, 17, "連続達成");  put(dash, "C17", f'={LAST_K}&"ヶ月"', font=val)
dash.conditional_formatting.add("C15",
    CellIsRule(operator="greaterThanOrEqual", formula=["1"], font=Font(bold=True, color=GOOD)))
dash.conditional_formatting.add("C15",
    CellIsRule(operator="lessThan", formula=["0.5"], font=Font(bold=True, color=BAD)))

# --- 到達予測
band(dash, 20, "  ゴールに着く日")
label(dash, 21, "いまのペース")
put(dash, "C21", f'=IFERROR(IF(COUNTIF(\'{S_MON}\'!$G$3:$G${MONTHS+2},">0")>=3,'
                 f'AVERAGEIF(\'{S_MON}\'!$G$3:$G${MONTHS+2},">0"),{PACE0}),{PACE0})',
    font=val, fmt=YEN)
put(dash, "D21", '="／月"', font=sub)
put(dash, "C22", f'=IFERROR(NPER({MRATE},-{PACE},-{TOTAL},{GOAL}),"")', font=val, fmt='0.0')
put(dash, "D22", months_label(MP), font=Font(bold=True, size=13, color=INK))
put(dash, "E22", f'=IFERROR(TEXT(EDATE(TODAY(),ROUNDUP({MP},0)),"yyyy年m月")&" 到達","—")', font=sub)
label(dash, 22, "  → かかる時間")

label(dash, 23, "計画どおりなら")
put(dash, "C23", f'=IFERROR(NPER({MRATE},-{TARGET},-{TOTAL},{GOAL}),"")', font=val, fmt='0.0')
put(dash, "D23", months_label(MT), font=Font(bold=True, size=13, color=GOOD))
put(dash, "E23", f'=IFERROR(TEXT(EDATE(TODAY(),ROUNDUP({MT},0)),"yyyy年m月")&" 到達","—")', font=sub)

label(dash, 24, "この差＝遅れ")
put(dash, "D24", months_label(f"MAX(0,{MP}-{MT})"),
    font=Font(bold=True, size=18, color=BAD))
dash.row_dimensions[24].height = 28
put(dash, "E24", '="毎月の差が、そのまま人生の時間になる"', font=Font(size=9, italic=True, color=MUTED))

label(dash, 25, "今月まるごとサボると")
put(dash, "D25", f'=IFERROR("ゴールが約"&TEXT(NPER({MRATE},-{TARGET},'
                 f'-({TOTAL}*(1+{MRATE})),{GOAL})+1-{MT},"0.0")&"ヶ月 遠のく","—")',
    font=Font(bold=True, size=11, color=BAD))

label(dash, 26, "毎月+10万にすると")
put(dash, "D26", f'=IFERROR("ゴールが約"&TEXT({MT}-NPER({MRATE},-({TARGET}+100000),'
                 f'-{TOTAL},{GOAL}),"0.0")&"ヶ月 近づく","—")',
    font=Font(bold=True, size=11, color=GOOD))

# --- マイルストーン
band(dash, 28, "  次のマイルストーン")
NEXT = "$C$29"
put(dash, "C29",
    f"=IF({TOTAL}<15000000,15000000,IF({TOTAL}<20000000,20000000,"
    f"IF({TOTAL}<30000000,30000000,IF({TOTAL}<50000000,50000000,"
    f"IF({TOTAL}<70000000,70000000,{GOAL})))))", font=Font(bold=True, size=16, color=ACCENT),
    fmt=YEN)
label(dash, 29, "次に届く節目")
label(dash, 30, "あといくら")
put(dash, "C30", f"={NEXT}-{TOTAL}", font=val, fmt=YEN)
put(dash, "E30", bar(f"1-({NEXT}-{TOTAL})/{NEXT}"), font=barf)
label(dash, 31, "このペースなら")
put(dash, "C31", f'=IFERROR(NPER({MRATE},-{PACE},-{TOTAL},{NEXT}),"")', font=val, fmt='0.0')
put(dash, "D31", months_label("$C$31"), font=Font(bold=True, size=13, color=INK))

# --- 注意
band(dash, 34, "  忘れないこと")
notes = [
    "7% は米国株の長期平均。円建てでは為替でぶれるし、下がる年も普通にある。",
    "特定口座の利益には 20.315% の税金。新NISA の生涯投資枠 1,800万円を先に埋めるのが得。",
    "野村は持株会。給料と株が同じ会社に集中している状態なので、増やしすぎないこと。",
    "評価額は上下する。自分でコントロールできるのは「累計元本」だけ。そこを見ること。",
]
for i, t in enumerate(notes):
    put(dash, f"B{35+i}", "・" + t, font=Font(size=9, color=MUTED),
        align=Alignment(indent=1))
    dash.merge_cells(f"B{35+i}:E{35+i}")

# --- グラフ
c1 = LineChart()
c1.title = "元本 vs 評価額"
c1.height, c1.width = 7.5, 15
c1.y_axis.numFmt = '#,##0'
data = Reference(mon, min_col=6, max_col=6, min_row=2, max_row=MONTHS + 2)
c1.add_data(data, titles_from_data=True)
data2 = Reference(mon, min_col=8, max_col=8, min_row=2, max_row=MONTHS + 2)
c1.add_data(data2, titles_from_data=True)
c1.set_categories(Reference(mon, min_col=1, min_row=3, max_row=MONTHS + 2))
dash.add_chart(c1, "H3")

c2 = BarChart()
c2.title = "毎月いくら入れたか"
c2.height, c2.width = 7.5, 15
c2.y_axis.numFmt = '#,##0'
c2.add_data(Reference(mon, min_col=7, max_col=7, min_row=2, max_row=MONTHS + 2),
            titles_from_data=True)
c2.set_categories(Reference(mon, min_col=1, min_row=3, max_row=MONTHS + 2))
dash.add_chart(c2, "H22")

wb.save(sys.argv[1] if len(sys.argv) > 1 else "1oku.xlsx")
print("wrote", sys.argv[1])
