#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
开鸿影视 · 一键构建 → 补丁 → 签名

用法:
    python make.py            # 打补丁(如需) + 签名（最常用；要求已存在 unsigned HAP）
    python make.py --build    # 先尝试用 hvigorw 构建，再补丁+签名
    python make.py --no-sign  # 只做构建+补丁，不签名

设计要点:
- 源码 rawfile/movie-site/index.html 现已内嵌全部特性(去演示/第三方/一键导入)，
  正常构建即自带；本脚本仅在检测到「构建产物不含补丁」时，才回退调用 3 个 fix_*.py 重打。
- 签名交给环境自适应的 sign-hap.py(JAVA/SDK 自动探测，优先 JDK8)。
- 全程幂等，可重复运行。
"""
import os, sys, re, glob, shutil, subprocess, zipfile

PROJ = os.path.dirname(os.path.abspath(__file__))
UNSIGNED = os.path.join(PROJ, "entry", "build", "default", "outputs", "default",
                        "entry-default-unsigned.hap")
FIX_DIR = os.path.join(PROJ, "_signtmp")
FIX_SCRIPTS = ["fix_demo.py", "fix_third_party.py", "fix_quick_import.py"]
SIGN_SCRIPT = os.path.join(PROJ, "sign-hap.py")
ENTRY = "resources/rawfile/movie-site/index.html"
PATCH_MARKER = "一键导入"   # 最新补丁独有标记；存在即说明已打补丁

def log(tag, msg):  print(f"[{tag}] {msg}")

def find_hvigorw():
    """在工程或常见 DevEco 位置找 hvigorw 可执行。"""
    cands = []
    for name in ("hvigorw.bat", "hvigorw"):
        cands += glob.glob(os.path.join(PROJ, name))
    # DevEco 常见安装目录
    for pat in [
        r"C:\Users\admin\Desktop\软件开发工具\command-line-tools\bin\hvigorw.bat",
        r"C:\Program Files\Huawei\DevEco Studio\*\hvigorw.bat",
        r"C:\Program Files\Huawei\DevEco Studio\*\hvigor\bin\hvigorw.bat",
        os.path.expanduser("~/DevEco Studio/*/hvigorw.bat"),
    ]:
        cands += glob.glob(pat)
    for c in cands:
        if os.path.isfile(c):
            return c
    return None

def hap_index_html(hap_path):
    """从 HAP 读 index.html；读不到返回 None。"""
    if not os.path.isfile(hap_path):
        return None
    try:
        with zipfile.ZipFile(hap_path) as z:
            if ENTRY not in z.namelist():
                return None
            return z.read(ENTRY).decode("utf-8", "ignore")
    except Exception as e:
        log("WARN", f"读取 HAP 内 index.html 失败: {e}")
        return None

def run(cmd, cwd=PROJ):
    log("RUN", " ".join(cmd))
    return subprocess.call(cmd, cwd=cwd)

def do_build():
    hvigorw = find_hvigorw()
    if not hvigorw:
        log("WARN", "未找到 hvigorw，跳过构建。请用 DevEco 手动 Build Hap(s)，或用 --no-build 直接签名现有产物。")
        return 0
    # 默认 assembleHap，产物在 entry/build/default/outputs/default/
    return run([hvigorw, "--mode", "module", "-p", "product=default", "assembleHap"])

def ensure_patched():
    """若 unsigned HAP 内 index.html 不含补丁标记，则回退执行 fix 脚本。"""
    if not os.path.isfile(UNSIGNED):
        log("ERROR", f"找不到构建产物: {UNSIGNED}\n      请先构建，或确认路径。")
        return False
    html = hap_index_html(UNSIGNED)
    if html is None:
        log("ERROR", f"HAP 内缺少 {ENTRY}")
        return False
    if PATCH_MARKER in html:
        log("OK", "构建产物已含全部补丁（源码内嵌），跳过重打。")
        return True
    log("WARN", "检测到构建产物不含补丁，回退执行 fix 脚本重打…")
    for s in FIX_SCRIPTS:
        p = os.path.join(FIX_DIR, s)
        if not os.path.isfile(p):
            log("WARN", f"缺少 {p}，跳过")
            continue
        if run([sys.executable, p]) != 0:
            log("ERROR", f"{s} 执行失败")
            return False
    # 复检
    html = hap_index_html(UNSIGNED)
    if html and PATCH_MARKER in html:
        log("OK", "重打补丁成功。")
        return True
    log("ERROR", "重打后仍未检测到补丁标记，请人工检查。")
    return False

def do_sign():
    if not os.path.isfile(SIGN_SCRIPT):
        log("ERROR", f"找不到签名脚本: {SIGN_SCRIPT}")
        return 1
    rc = run([sys.executable, SIGN_SCRIPT])
    out = os.path.join(PROJ, "sign", "KaihongMovie.hap")
    if rc == 0 and os.path.isfile(out):
        log("OK", f"签名完成: {out} ({os.path.getsize(out)} bytes)")
        log("TIP", "如需上云，请覆盖资料库 3 个节点：工程整包 / 安装包 / 完整站点")
    return rc

def main():
    args = sys.argv[1:]
    do_b = "--build" in args
    no_sign = "--no-sign" in args

    log("STEP", "1/3 构建" + ("（尝试 hvigorw）" if do_b else "（跳过，用现有产物）"))
    if do_b:
        if do_build() != 0:
            log("WARN", "构建失败/不可用，继续尝试使用现有 unsigned HAP")

    log("STEP", "2/3 校验补丁")
    if not ensure_patched():
        sys.exit(2)

    if no_sign:
        log("STEP", "3/3 跳过签名（--no-sign）")
        sys.exit(0)

    log("STEP", "3/3 签名")
    sys.exit(do_sign())

if __name__ == "__main__":
    main()
