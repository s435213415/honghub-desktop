#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把鸿汇影 深开鸿适配前端注入未签名 HAP 的 movie-site/index.html（不触动 ArkTS）。
输出到 entry/build/default/outputs/default/entry-default-unsigned.hap，
避免覆盖根目录原始未签名包；sign-hap.py 会优先使用该路径。"""
import os, sys, zipfile, shutil

PROJ = os.path.dirname(os.path.abspath(__file__))
SRC_HAP = os.path.join(PROJ, "entry-default-unsigned.hap")
# 适配前端相对项目根推导：换机、换工作目录都无需改脚本；也可用 KH_ADAPTED_HTML 覆盖
_ROOT = os.path.abspath(os.path.join(PROJ, "..", ".."))
ADAPTED = os.environ.get("KH_ADAPTED_HTML", os.path.join(
    _ROOT, "harmony", "entry", "src", "main", "resources", "rawfile", "www", "index.html"))
OUT_DIR = os.path.join(PROJ, "entry", "build", "default", "outputs", "default")
OUT = os.path.join(OUT_DIR, "entry-default-unsigned.hap")
ENTRY = "resources/rawfile/movie-site/index.html"

assert os.path.isfile(SRC_HAP), "缺少源未签名包: " + SRC_HAP
assert os.path.isfile(ADAPTED), "缺少适配前端: " + ADAPTED
data = open(ADAPTED, encoding="utf-8").read().encode("utf-8")
print("适配前端字节数:", len(data))

os.makedirs(OUT_DIR, exist_ok=True)
with zipfile.ZipFile(SRC_HAP, "r") as zin:
    names = zin.namelist()
    assert ENTRY in names, "未签名包内缺少 " + ENTRY
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename == ENTRY:
                zout.writestr(item, data)
            else:
                zout.writestr(item, zin.read(item.filename))
print("已生成注入版未签名包:", OUT)
# 校验
with zipfile.ZipFile(OUT) as z:
    html = z.read(ENTRY).decode("utf-8", "ignore")
for kw in ["KH_HARMONY", "KH_HUB", "/api/report", "/api/govern", "/api/feedback", "中枢"]:
    print(f"  注入校验 {kw}: {'✅' if kw in html else '❌'}")
