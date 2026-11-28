# -*- coding: utf-8 -*-
import openpyxl, json
P = r'C:\Users\admin\Desktop\鸿汇影·文档资料\鸿汇影·客户端可配置项清单_v1.7.93.xlsx'
wb = openpyxl.load_workbook(P)
ws = wb['可配置项清单']
print('rows', ws.max_row, 'cols', ws.max_column)
print('sheets', wb.sheetnames)
st = {}
rows = []
for r in range(2, ws.max_row + 1):
    no = ws.cell(r, 1).value
    if no is None:
        continue
    s = ws.cell(r, 4).value
    st[s] = st.get(s, 0) + 1
    rows.append((no, ws.cell(r, 2).value, ws.cell(r, 3).value, s, ws.cell(r, 5).value))
print(json.dumps(st, ensure_ascii=False))
for row in rows:
    print(' | '.join('' if x is None else str(x) for x in row))
