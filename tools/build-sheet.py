# -*- coding: utf-8 -*-
"""1亿日元计划 —— Google 表格工作簿生成器。

通过 Drive 连接器创建表格会丢失公式（已验证：连 =1+1 都变空），
所以这里生成 .xlsx，由 Google 表格自己的导入器读入。

用法:  python3 tools/build-sheet.py build/1oku.xlsx
"""
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule
from openpyxl.chart import LineChart, BarChart, Reference

INK, BAND, ACCENT = "0F172A", "1E293B", "2563EB"
GOOD, BAD, MUTED = "047857", "B91C1C", "64748B"
EDIT = "FEF9C3"

YEN, PCT, MON, DAY = '#,##0"円"', '0.0%', 'yyyy"年"m"月"', 'yyyy/m/d'
MONTHS, HOLDS = 72, 60

S_DASH, S_HOLD, S_MON, S_CFG = "总览", "持仓明细", "月次记录", "设置"

GOAL   = f"'{S_CFG}'!$B$2"
TARGET = f"'{S_CFG}'!$B$3"
RATE   = f"'{S_CFG}'!$B$4"
BASE   = f"'{S_CFG}'!$B$5"
PACE0  = f"'{S_CFG}'!$B$6"
MRATE  = f"({RATE}/12)"

M_YM  = f"'{S_MON}'!$A$3:$A${MONTHS+2}"
M_VAL = f"'{S_MON}'!$B$3:$B${MONTHS+2}"
M_IN  = f"'{S_MON}'!$C$3:$C${MONTHS+2}"
M_PRI = f"'{S_MON}'!$D$3:$D${MONTHS+2}"
M_STK = f"'{S_MON}'!$G$3:$G${MONTHS+2}"
H_CAT = f"'{S_HOLD}'!$B$3:$B${HOLDS+2}"
H_VAL = f"'{S_HOLD}'!$E$3:$E${HOLDS+2}"
H_CST = f"'{S_HOLD}'!$F$3:$F${HOLDS+2}"
H_ACC = f"'{S_HOLD}'!$C$3:$C${HOLDS+2}"

CATS = ["指数基金", "美股个股", "日本个股", "黄金",
        "现金·MMF", "加密货币", "持株会", "银行存款"]
ACCTS = ["NISAつみたて投資枠", "NISA成長投資枠", "特定口座", "一般口座", "其他"]

# 楽天証券「保有商品詳細」2026/08/29 时点的实际持仓（評価額 / 取得原価）
HOLDINGS = [
    ("楽天・プラス・S&P500",        "指数基金", "NISAつみたて投資枠", "日元", 3053416, 2200000),
    ("楽天・プラス・S&P500",        "指数基金", "NISA成長投資枠",     "日元", 3834848, 2559723),
    ("楽天・プラス・S&P500",        "指数基金", "NISA成長投資枠",     "日元",   70501,   50000),
    ("eMAXIS Slim オルカン",        "指数基金", "NISA成長投資枠",     "日元",  807113,  619402),
    ("eMAXIS Slim オルカン",        "指数基金", "NISAつみたて投資枠", "日元",  642035,  600000),
    ("iFreeNEXT FANG+",             "指数基金", "NISA成長投資枠",     "日元",  399842,  350000),
    ("eMAXIS Slim 米国株式(S&P500)", "指数基金", "NISA成長投資枠",    "日元",  159856,  100000),
    ("楽天・プラス・NASDAQ-100",     "指数基金", "NISA成長投資枠",    "日元",   19272,   20000),
    ("NVDA エヌビディア",           "美股个股", "NISA成長投資枠",     "美元",  591957,  338145),
    ("GOOG アルファベットC",        "美股个股", "NISA成長投資枠",     "美元",  548813,  265576),
    ("CRCL サークル",               "美股个股", "特定口座",           "美元",  251057,  273264),
    ("MSFT マイクロソフト",         "美股个股", "NISA成長投資枠",     "美元",  164391,  127332),
    ("MSFT マイクロソフト",         "美股个股", "特定口座",           "美元",   82195,   60687),
    ("AMZN アマゾン",               "美股个股", "NISA成長投資枠",     "美元",   85289,   63981),
    ("AMZN アマゾン",               "美股个股", "特定口座",           "美元",   42644,   23722),
    ("AMD",                         "美股个股", "NISA成長投資枠",     "美元",   74520,   19102),
    ("TSM タイワンセミ",            "美股个股", "NISA成長投資枠",     "美元",   66828,   65928),
    ("AAPL アップル",               "美股个股", "NISA成長投資枠",     "美元",   51171,   25715),
    ("CLS セレスティカ",            "美股个股", "NISA成長投資枠",     "美元",   47809,   60368),
    ("VRT バーティブ",              "美股个股", "NISA成長投資枠",     "美元",   41148,   54219),
    ("6787 メイコー",               "日本个股", "NISA成長投資枠",     "日元",   56280,  108763),
    ("4385 メルカリ",               "日本个股", "NISA成長投資枠",     "日元",   32319,   13825),
    ("3492 ＭＩＲＡＲＴＨ (REIT)",   "日本个股", "NISA成長投資枠",    "日元",   79000,   92300),
    ("金 現物 72.24958g",           "黄金",     "其他",               "日元", 1694398, 1245041),
    ("425A ＧＸゴールド",           "黄金",     "NISA成長投資枠",     "日元",  148542,  148610),
    ("楽天・米ドルMMF",             "现金·MMF", "特定口座",           "美元",    4969,    4934),
    ("楽天証券 預り金",             "现金·MMF", "其他",               "日元",    3478,    3478),
    ("bitFlyer BTC 0.061912",       "加密货币", "其他",               "日元",    None,  893703),
    ("野村 持株会",                 "持株会",   "其他",               "日元",    None,    None),
    ("ゆうちょ銀行",                "银行存款", "其他",               "日元",    None,    None),
]

# 取引履歴から集計した楽天証券への純入金（円）
PAST = [("2025-09", 250470), ("2025-10", -50000), ("2025-11", -250000),
        ("2025-12", -100000), ("2026-01", 250000), ("2026-02", -40000),
        ("2026-03", 150000), ("2026-04", 200000), ("2026-05", 155587),
        ("2026-06", 310000), ("2026-07", 110000), ("2026-08", 100000)]


def bar(expr, width=20):
    n = f'ROUND(MIN(1,MAX(0,{expr}))*{width},0)'
    return f'=IFERROR(REPT("█",{n})&REPT("░",{width}-{n}),"")'


def mlabel(m):
    return f'=IFERROR(INT({m}/12)&"年"&ROUND(MOD({m},12),0)&"个月","—")'


def put(ws, ref, v, *, font=None, fill=None, fmt=None, align=None):
    c = ws[ref]; c.value = v
    if font: c.font = font
    if fill: c.fill = PatternFill("solid", fgColor=fill)
    if fmt:  c.number_format = fmt
    if align: c.alignment = align
    return c


def band(ws, row, text, first="B", last="G"):
    ws.merge_cells(f"{first}{row}:{last}{row}")
    put(ws, f"{first}{row}", text, font=Font(bold=True, size=11, color="FFFFFF"),
        fill=BAND, align=Alignment(vertical="center", indent=1))
    ws.row_dimensions[row].height = 24


def label(ws, row, text, col="B"):
    put(ws, f"{col}{row}", text, font=Font(size=10, color=MUTED),
        align=Alignment(vertical="center", indent=1))


def header(ws, row, names, widths):
    for col, w in zip(range(1, len(widths) + 1), widths):
        ws.column_dimensions[get_column_letter(col)].width = w
    for j, h in enumerate(names, start=1):
        put(ws, f"{get_column_letter(j)}{row}", h,
            font=Font(bold=True, size=10, color="FFFFFF"), fill=BAND,
            align=Alignment(horizontal="center", vertical="center"))
    ws.row_dimensions[row].height = 22


wb = Workbook()

# ------------------------------------------------------------------ 设置 --
cfg = wb.active; cfg.title = S_CFG
cfg.sheet_view.showGridLines = False
for c, w in zip("ABC", (26, 18, 60)):
    cfg.column_dimensions[c].width = w
put(cfg, "A1", "设置", font=Font(bold=True, size=16, color=INK))
for i, (name, val, fmt, note) in enumerate([
    ("目标金额",       100_000_000, YEN, "1亿日元。"),
    ("每月目标投入",       400_000, YEN, "按这个金额投，约10年到。"),
    ("预期年化收益",          0.07, PCT, "S&P500 长期平均。不是保证。"),
    ("起始累计本金",     9_301_761, YEN, "楽天証券取得原価 9,494,115 + BTC 893,703 − 已列在月次记录里的近12个月。还要加上野村持株会 / ゆうちょ 的本金。"),
    ("当前实际速度",        90_505, YEN, "楽天証券 近12个月净入金的月均（含取出的月份）。月次记录满3个月后自动改用实际值。"),
], start=2):
    put(cfg, f"A{i}", name, font=Font(size=11, color=INK), align=Alignment(indent=1))
    put(cfg, f"B{i}", val, font=Font(bold=True, size=12, color=ACCENT), fmt=fmt,
        fill=EDIT, align=Alignment(horizontal="right"))
    put(cfg, f"C{i}", note, font=Font(size=9, color=MUTED), align=Alignment(indent=1))
    cfg.row_dimensions[i].height = 22
put(cfg, "A8", "黄色格子随便改。其他所有表都引用这里。",
    font=Font(size=9, italic=True, color=MUTED))

# -------------------------------------------------------------- 持仓明细 --
hold = wb.create_sheet(S_HOLD)
hold.sheet_view.showGridLines = False
put(hold, "A1", "持仓明细 —— 每月更新「评价额」一列即可",
    font=Font(bold=True, size=14, color=INK))
hold.merge_cells("A1:I1"); hold.row_dimensions[1].height = 26
header(hold, 2, ["名称", "类别", "账户", "币种", "评价额(日元)", "成本(日元)",
                 "盈亏", "占比", "备注"],
       (30, 12, 20, 8, 16, 16, 15, 9, 26))
hold.freeze_panes = "A3"

dv_cat = DataValidation(type="list", formula1='"' + ",".join(CATS) + '"', allow_blank=True)
dv_acc = DataValidation(type="list", formula1='"' + ",".join(ACCTS) + '"', allow_blank=True)
hold.add_data_validation(dv_cat); dv_cat.add(f"B3:B{HOLDS+2}")
hold.add_data_validation(dv_acc); dv_acc.add(f"C3:C{HOLDS+2}")

for i, (nm, cat, acc, cur, v, cost) in enumerate(HOLDINGS):
    r = 3 + i
    hold[f"A{r}"], hold[f"B{r}"], hold[f"C{r}"], hold[f"D{r}"] = nm, cat, acc, cur
    if v is not None:
        hold[f"E{r}"] = v
    else:
        put(hold, f"I{r}", "← 填上评价额，总资产才准",
            font=Font(size=9, bold=True, color=BAD))
    if cost is not None: hold[f"F{r}"] = cost
for r in range(3, HOLDS + 3):
    hold[f"G{r}"] = f'=IF(OR($E{r}="",$F{r}=""),"",$E{r}-$F{r})'
    hold[f"H{r}"] = f'=IF($E{r}="","",IFERROR($E{r}/SUM({H_VAL}),""))'
    for col in "ABCDEF":
        hold[f"{col}{r}"].fill = PatternFill("solid", fgColor=EDIT)
    hold[f"E{r}"].number_format = YEN
    hold[f"F{r}"].number_format = YEN
    hold[f"G{r}"].number_format = YEN
    hold[f"H{r}"].number_format = PCT
    hold[f"G{r}"].font = Font(size=10, color=MUTED)
    hold[f"H{r}"].font = Font(size=10, color=MUTED)
hold.conditional_formatting.add(
    f"G3:G{HOLDS+2}", CellIsRule(operator="lessThan", formula=["0"], font=Font(color=BAD)))
put(hold, f"A{HOLDS+4}",
    "名称/类别/账户是从你导出的楽天証券取引履歴还原的。已经卖掉的请直接删行，漏掉的请补上。",
    font=Font(size=9, italic=True, color=MUTED))
put(hold, f"A{HOLDS+5}",
    "省力做法：每月只更新「总资产」一个数（记到月次记录）；这张明细表每季度整理一次就够。",
    font=Font(size=9, italic=True, color=MUTED))

# -------------------------------------------------------------- 月次记录 --
mon = wb.create_sheet(S_MON)
mon.sheet_view.showGridLines = False
put(mon, "A1", "月次记录 —— 每月两个数：总资产、这个月投了多少",
    font=Font(bold=True, size=14, color=INK))
mon.merge_cells("A1:G1"); mon.row_dimensions[1].height = 26
header(mon, 2, ["年月", "总资产", "本月投入", "累计本金", "评价盈亏", "达成", "连续"],
       (13, 16, 15, 16, 16, 8, 8))
mon.freeze_panes = "A3"

for i, (ym, amt) in enumerate(PAST):
    r = 3 + i
    y, m = ym.split("-")
    mon[f"A{r}"] = f"=DATE({y},{m},1)"
    mon[f"C{r}"] = amt

for r in range(3, MONTHS + 3):
    a = f"$A{r}"
    mon[f"D{r}"] = f'=IF({a}="","",{BASE}+SUMIFS({M_IN},{M_YM},"<="&{a}))'
    mon[f"E{r}"] = f'=IF(OR({a}="",$B{r}=""),"",$B{r}-$D{r})'
    mon[f"F{r}"] = f'=IF({a}="","",IF($C{r}>={TARGET},"✓","–"))'
    mon[f"G{r}"] = (f'=IF({a}="","",IF($C{r}>={TARGET},1,0))' if r == 3 else
                    f'=IF({a}="","",IF($C{r}>={TARGET},IF($G{r-1}="",1,$G{r-1}+1),0))')
    mon[f"A{r}"].number_format = MON
    for col in "BCDE":
        mon[f"{col}{r}"].number_format = YEN
    for col in "ABC":
        mon[f"{col}{r}"].fill = PatternFill("solid", fgColor=EDIT)
    for col in "DE":
        mon[f"{col}{r}"].font = Font(size=10, color=MUTED)
    mon[f"B{r}"].font = Font(bold=True, size=10, color=INK)
    for col in "FG":
        mon[f"{col}{r}"].alignment = Alignment(horizontal="center")
mon.conditional_formatting.add(
    f"C3:C{MONTHS+2}", CellIsRule(operator="lessThan", formula=["0"], font=Font(bold=True, color=BAD)))
mon.conditional_formatting.add(
    f"E3:E{MONTHS+2}", CellIsRule(operator="lessThan", formula=["0"], font=Font(color=BAD)))
mon.column_dimensions["I"].width = 52
put(mon, "I3", "「本月投入」这12行是从你的取引履歴算出来的真实净入金。",
    font=Font(size=10, bold=True, color=ACCENT))
put(mon, "I4", "负数＝那个月你从楽天証券取走的钱比投进去的多。",
    font=Font(size=10, color=BAD))
put(mon, "I5", "「总资产」留空是故意的：先去持仓明细填上 BTC / 野村 / ゆうちょ，",
    font=Font(size=10, color=MUTED))
put(mon, "I6", "然后把总览里那个自动算好的总资产抄一个数过来。",
    font=Font(size=10, color=MUTED))

# ------------------------------------------------------------------ 总览 --
d = wb.create_sheet(S_DASH, 0)
d.sheet_view.showGridLines = False
for c, w in zip("ABCDEFG", (2, 24, 20, 16, 24, 3, 3)):
    d.column_dimensions[c].width = w

TOTAL = "$C$6"; THIS = "$C$14"; PACE = "$C$20"; MP = "$C$21"; MT = "$C$22"
NEXT = "$C$45"
LAST = lambda col: (f"IFERROR(LOOKUP(2,1/('{S_MON}'!${col}$3:${col}${MONTHS+2}<>\"\"),"
                   f"'{S_MON}'!${col}$3:${col}${MONTHS+2}),0)")

huge = Font(bold=True, size=26, color=ACCENT)
val  = Font(bold=True, size=12, color=INK)
sub  = Font(size=10, color=MUTED)
barf = Font(size=11, color=ACCENT)

put(d, "B2", "1亿日元计划", font=Font(bold=True, size=24, color=INK))
d.row_dimensions[2].height = 36
put(d, "B3", f'="目标 "&TEXT({GOAL},"#,##0")&"円 ／ 每月 "&TEXT({TARGET},"#,##0")'
             f'&"円 ／ 预期年化 "&TEXT({RATE},"0.0%")', font=sub)
put(d, "E2", "=TODAY()", font=sub, fmt=DAY, align=Alignment(horizontal="right"))

band(d, 5, "  现在")
label(d, 6, "总资产");  put(d, "C6", f"=SUM({H_VAL})", font=huge, fmt=YEN)
d.row_dimensions[6].height = 34
put(d, "D6", '="（持仓明细自动合计）"', font=sub)
label(d, 7, "距离目标"); put(d, "C7", f"={GOAL}-{TOTAL}", font=val, fmt=YEN)
label(d, 8, "进度");     put(d, "C8", f"={TOTAL}/{GOAL}", font=val, fmt=PCT)
put(d, "E8", bar(f"{TOTAL}/{GOAL}"), font=barf)
label(d, 9, "累计本金"); put(d, "C9", f"={LAST('D')}", font=val, fmt=YEN)
label(d, 10, "浮动盈亏")
put(d, "C10", f"=IF($C$9=0,0,{TOTAL}-$C$9)", font=val, fmt='+#,##0"円";-#,##0"円"')
put(d, "D10", "=IFERROR($C$10/$C$9,0)", font=sub, fmt='+0.0%;-0.0%')
put(d, "E10", '="设置里的起始本金要含野村/ゆうちょ/BTC，这个数才准"',
    font=Font(size=9, italic=True, color=BAD))
for op, col in (("lessThan", BAD), ("greaterThan", GOOD)):
    d.conditional_formatting.add("C10:D10",
        CellIsRule(operator=op, formula=["0"], font=Font(bold=True, color=col)))

band(d, 13, '="  本月 ── "&TEXT(TODAY(),"yyyy年m月")')
label(d, 14, "已投入")
put(d, "C14", f'=SUMIFS({M_IN},{M_YM},">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),'
              f'{M_YM},"<"&EOMONTH(TODAY(),0)+1)', font=huge, fmt=YEN)
d.row_dimensions[14].height = 34
put(d, "D14", f'=" / "&TEXT({TARGET},"#,##0")&"円"', font=sub)
label(d, 15, "达成率"); put(d, "C15", f"=IFERROR({THIS}/{TARGET},0)", font=val, fmt=PCT)
put(d, "E15", bar(f"{THIS}/{TARGET}"), font=barf)
label(d, 16, "还差");   put(d, "C16", f"=MAX(0,{TARGET}-{THIS})", font=val, fmt=YEN)
put(d, "D16", '="这个月还剩"&(EOMONTH(TODAY(),0)-TODAY())&"天"', font=sub)
label(d, 17, "连续达标"); put(d, "C17", f'={LAST("G")}&"个月"', font=val)
d.conditional_formatting.add("C15",
    CellIsRule(operator="greaterThanOrEqual", formula=["1"], font=Font(bold=True, color=GOOD)))
d.conditional_formatting.add("C15",
    CellIsRule(operator="lessThan", formula=["0.5"], font=Font(bold=True, color=BAD)))

band(d, 19, "  什么时候能到")
label(d, 20, "现在的速度")
put(d, "C20", f'=IFERROR(IF(COUNTIFS({M_YM},">="&EDATE(TODAY(),-12))>=3,'
              f'AVERAGEIFS({M_IN},{M_YM},">="&EDATE(TODAY(),-12)),{PACE0}),{PACE0})',
    font=val, fmt=YEN)
put(d, "E20", '="（近12个月平均，自动滚动）"', font=Font(size=9, italic=True, color=MUTED))
put(d, "D20", '="／月"', font=sub)
label(d, 21, "  按这个速度")
put(d, "C21", f'=IFERROR(NPER({MRATE},-{PACE},-{TOTAL},{GOAL}),"")', font=val, fmt='0.0')
put(d, "D21", mlabel(MP), font=Font(bold=True, size=13, color=INK))
put(d, "E21", f'=IFERROR(TEXT(EDATE(TODAY(),ROUNDUP({MP},0)),"yyyy年m月")&" 到达","—")', font=sub)
label(d, 22, "  按计划40万")
put(d, "C22", f'=IFERROR(NPER({MRATE},-{TARGET},-{TOTAL},{GOAL}),"")', font=val, fmt='0.0')
put(d, "D22", mlabel(MT), font=Font(bold=True, size=13, color=GOOD))
put(d, "E22", f'=IFERROR(TEXT(EDATE(TODAY(),ROUNDUP({MT},0)),"yyyy年m月")&" 到达","—")', font=sub)
label(d, 23, "差距")
put(d, "D23", mlabel(f"MAX(0,{MP}-{MT})"), font=Font(bold=True, size=18, color=BAD))
d.row_dimensions[23].height = 28
put(d, "E23", '="每月少投的那部分，变成了你的时间"', font=Font(size=9, italic=True, color=MUTED))
label(d, 24, "整月不投的话")
put(d, "D24", f'=IFERROR("目标推迟约"&TEXT(NPER({MRATE},-{TARGET},'
              f'-({TOTAL}*(1+{MRATE})),{GOAL})+1-{MT},"0.0")&"个月","—")',
    font=Font(bold=True, size=11, color=BAD))
label(d, 25, "每月多投10万")
put(d, "D25", f'=IFERROR("目标提前约"&TEXT({MT}-NPER({MRATE},-({TARGET}+100000),'
              f'-{TOTAL},{GOAL}),"0.0")&"个月","—")', font=Font(bold=True, size=11, color=GOOD))

band(d, 28, "  资产构成（条形按 33% 满格）")
for i, cat in enumerate(CATS):
    r = 29 + i
    put(d, f"B{r}", cat, font=Font(size=10, color=INK), align=Alignment(indent=1))
    put(d, f"C{r}", f'=SUMIF({H_CAT},$B{r},{H_VAL})', font=Font(size=10, color=INK), fmt=YEN)
    put(d, f"D{r}", f'=IFERROR($C{r}/{TOTAL},0)', font=sub, fmt=PCT)
    put(d, f"E{r}", bar(f"$C{r}/{TOTAL}*3", 18), font=Font(size=10, color=ACCENT))

band(d, 40, "  NISA 生涯投资额度")
label(d, 41, "已经用掉")
put(d, "C41", f'=SUMIF({H_ACC},"NISA*",{H_CST})', font=val, fmt=YEN)
put(d, "D41", "=IFERROR($C$41/18000000,0)", font=sub, fmt=PCT)
put(d, "E41", bar("$C$41/18000000"), font=barf)
label(d, 42, "还剩")
put(d, "C42", "=MAX(0,18000000-$C$41)", font=val, fmt=YEN)
put(d, "D42", '="额度按取得原价计算，不是按评价额"', font=Font(size=9, italic=True, color=MUTED))

band(d, 44, "  下一个里程碑")
label(d, 45, "下一档")
put(d, "C45", f"=IF({TOTAL}<15000000,15000000,IF({TOTAL}<20000000,20000000,"
              f"IF({TOTAL}<30000000,30000000,IF({TOTAL}<50000000,50000000,"
              f"IF({TOTAL}<70000000,70000000,{GOAL})))))",
    font=Font(bold=True, size=16, color=ACCENT), fmt=YEN)
label(d, 46, "还差")
put(d, "C46", f"={NEXT}-{TOTAL}", font=val, fmt=YEN)
put(d, "E46", bar(f"{TOTAL}/{NEXT}"), font=barf)
label(d, 47, "按现在速度")
put(d, "C47", f'=IFERROR(NPER({MRATE},-{PACE},-{TOTAL},{NEXT}),"")', font=val, fmt='0.0')
put(d, "D47", mlabel("$C$47"), font=Font(bold=True, size=13, color=INK))

band(d, 50, "  别忘了")
for i, t in enumerate([
    "84% 的资产在 NISA 里，356万含み益目前免税。NISA 卖出后额度要等次年才恢复 —— 别乱动。",
    "美国资产约占 78%（含オルカン的美国部分）。日元升值会直接吃掉收益，这是最大的单一风险。",
    "黄金 14%。它不产生现金流，是保险，不是引擎。别指望它把你送到1亿。",
    "個別股 17%：AMD +290%、GOOG +107%，但メイコー -48%。投信（69%）才是主力。",
    "评价额会上下跳，你能控制的只有「累计本金」。看那一条。",
]):
    put(d, f"B{51+i}", "・" + t, font=Font(size=9, color=MUTED), align=Alignment(indent=1))
    d.merge_cells(f"B{51+i}:E{51+i}")

c1 = LineChart(); c1.title = "本金 vs 总资产"; c1.height, c1.width = 7.5, 15
c1.y_axis.numFmt = '#,##0'
c1.add_data(Reference(mon, min_col=2, max_col=2, min_row=2, max_row=MONTHS + 2), titles_from_data=True)
c1.add_data(Reference(mon, min_col=4, max_col=4, min_row=2, max_row=MONTHS + 2), titles_from_data=True)
c1.set_categories(Reference(mon, min_col=1, min_row=3, max_row=MONTHS + 2))
d.add_chart(c1, "H3")

c2 = BarChart(); c2.title = "每月投入"; c2.height, c2.width = 7.5, 15
c2.y_axis.numFmt = '#,##0'
c2.add_data(Reference(mon, min_col=3, max_col=3, min_row=2, max_row=MONTHS + 2), titles_from_data=True)
c2.set_categories(Reference(mon, min_col=1, min_row=3, max_row=MONTHS + 2))
d.add_chart(c2, "H22")

wb.save(sys.argv[1])
print("wrote", sys.argv[1])
