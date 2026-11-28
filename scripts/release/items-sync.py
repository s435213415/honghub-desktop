# -*- coding: utf-8 -*-
import json, openpyxl
X = r'C:\Users\admin\Desktop\鸿汇影·文档资料\鸿汇影·客户端可配置项清单_v1.7.94.xlsx'
J = r'C:\Users\admin\WorkBuddy\2026-11-15-18-33-52\HongHub-Desktop\scripts\config-items.json'
wb = openpyxl.load_workbook(X)
ws = wb['可配置项清单']
print('HEAD:', [ws.cell(1, c).value for c in range(1, 15)])
MAP = {'已实现': '已有', '部分已有': '部分已有', '待做': '空白'}
old = json.load(open(J, encoding='utf-8'))
by_no = {it['no']: it for it in old['items']}
items = []
for r in range(2, ws.max_row + 1):
    no = ws.cell(r, 1).value
    if no is None:
        continue
    row = {
        'no': no,
        'group': ws.cell(r, 2).value,
        'name': ws.cell(r, 3).value,
        'status': MAP.get(ws.cell(r, 4).value, ws.cell(r, 4).value),
        'key': ws.cell(r, 5).value,
        'default': ws.cell(r, 6).value,
        'cost': ws.cell(r, 7).value,
        'dep': ws.cell(r, 8).value,
        'compliance': ws.cell(r, 9).value,
        'batch': ws.cell(r, 10).value,
        'coverage': ws.cell(r, 13).value,
        'ui': ws.cell(r, 11).value,
        'evt': ws.cell(r, 12).value,
        'note': (ws.cell(r, 14).value or ''),
    }
    prev = by_no.get(no)
    if prev:
        for k in ('note',):
            if not row[k]:
                row[k] = prev.get(k, '')
    items.append(row)
old['items'] = items
old['total'] = len(items)
old['version'] = '1.7.94'
old['generated'] = '2026-11-23'
json.dump(old, open(J, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
st = {}
for it in items:
    st[it['status']] = st.get(it['status'], 0) + 1
print('OK total', len(items), st)
