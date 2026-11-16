#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
开鸿影视(KaihongMovie) HAP 本地自签名脚本。

重要背景: 本 SDK 内置的 hap-sign-tool.jar 在 pwdInputMode 非 "1" 时走命令行明文密码、
无需交互终端, 用 JDK8 即可正常完成全部 ECC 步骤(keypair/ca/app-cert/profile-cert/sign)。
真正的坑位在 generate-app-cert / generate-profile-cert: CA 密钥库密码用的是独立选项
-issuerKeystorePwd(由 LocalizationAdapter.initKeyStore 读取), 而 NOT -issuerKeyPwd
(后者只是 CA 私钥别名密码)。漏掉 -issuerKeystorePwd 时工具用空密码加载 ca.p12,
报 "Init keystore failed / keystore password was incorrect"。本脚本已显式补上。

本脚本: 纯 ECC(app / profile / CA 均为 NIST-P-256) + SHA256withECDSA。
默认采用 RELEASE profile(基于 UnsgnedReleasedProfileTemplate.json), 不含 debug-info / device-ids,
因此签名后的 HAP 不绑定具体设备, 可在任意设备(开发板/模拟器/开启开发者模式的设备)安装。

环境自适应(各类电脑都能跑):
  - 路径全自探测: 工程根默认取本脚本所在目录(拷到哪台电脑都行); SDK / JDK 找不到时
    自动搜索常见安装位置, 不写死路径, 也不依赖特定盘符。
  - JDK 多策略定位: 优先 JDK8 (hap-sign-tool 的 BC 只能读 JDK8 写出的旧式 PKCS12), 否则
    回退到 JBR / JDK11 / JDK17 / JDK21 / JAVA_HOME / PATH / 系统目录, 跨 Windows / Linux / macOS。
  - 全部路径通过环境变量可覆盖(用于特殊环境):
      OH_SDK_HOME    command-line-tools 根目录 (内含 sdk/.../lib/hap-sign-tool.jar 与模板)
      OH_TOOLCHAIN  含 JDK 的目录
      OH_PROJECT    KaihongMovie 工程根目录 (内含 entry/build/.../entry-default-unsigned.hap)
      OH_KEY_PWD    密钥库/私钥密码 (默认 OpenHarmony123)
    (不设也行: 脚本会自动探测)
如需回到"仅限指定设备"的 debug 签名, 见本文件末的还原说明。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import glob
import datetime

# ---- 路径解析(环境自适应): 优先环境变量, 否则自动探测 ----
# 工程根目录: 默认取本脚本所在目录(无论拷到哪台电脑, 只要脚本在工程根即可)
PROJ = os.environ.get("OH_PROJECT", os.path.dirname(os.path.abspath(__file__)))
SDK = os.environ.get("OH_SDK_HOME", "")
# TOOLCHAIN 默认: OH_TOOLCHAIN 优先; 否则沿用本机已知 toolchain 目录(若存在); 再不行则留空交给自动探测
_default_tc = r"C:/Users/admin/WorkBuddy/2026-11-12-16-34-57/toolchain"
TOOLCHAIN = os.environ.get("OH_TOOLCHAIN", _default_tc if os.path.isdir(_default_tc) else "")
PWD = os.environ.get("OH_KEY_PWD", "OpenHarmony123")
CA_SUBJECT = "C=CN,O=OpenHarmony,OU=OpenHarmony Community,CN=OH Local Debug CA"
APP_SUBJECT = "C=CN,O=OpenHarmony,OU=OpenHarmony Community,CN=KaihongMovie Debug"
PROF_SUBJECT = "C=CN,O=OpenHarmony,OU=OpenHarmony Community,CN=KaihongMovie Profile"
BUNDLE = "com.kaihong.movie"


def _is_windows():
    return (os.sep == "\\") or (os.environ.get("OS", "").lower().startswith("windows"))


def _java_version(java):
    """返回 (major, full) 或 None。兼容 '1.8.0_512' / '11.0.2' / '17' / '21' 等格式。"""
    try:
        r = subprocess.run([java, "-version"], capture_output=True, text=True, timeout=20)
    except Exception:
        return None
    out = (r.stdout or "") + (r.stderr or "")
    m = re.search(r'version "([\d.]+)', out)
    if not m:
        return None
    ver = m.group(1)
    try:
        parts = ver.split(".")
        major = int(parts[0])
        if major == 1:          # 1.8.0_xxx -> 8
            major = int(parts[1])
        return (major, ver)
    except Exception:
        return None


def find_java():
    """跨平台自适应定位 java。优先 JDK8(满足 hap-sign-tool 对旧式 PKCS12 的读取要求),
    否则回退到 JBR / JDK11/17/21 / JAVA_HOME / PATH / 系统常见安装目录中的任意 JDK。"""
    java_bin = "java.exe" if _is_windows() else "java"
    candidates = []  # (order, base, path)

    # 1) 含 JDK 的目录(多候选): OH_TOOLCHAIN 指定目录 + WorkBuddy 自带 toolchain + ~/toolchain
    tc_dirs = []
    if TOOLCHAIN:
        tc_dirs.append(TOOLCHAIN)
    home = os.path.expanduser("~")
    wb_base = os.path.join(home, "WorkBuddy")
    if os.path.isdir(wb_base):
        tc_dirs += glob.glob(os.path.join(wb_base, "*", "toolchain"))
    tc_dirs.append(os.path.join(home, "toolchain"))
    patterns = ["jdk8*", "jbr*", "jdk-8*", "jdk1.8*", "jdk11*", "jdk-11*",
                "jdk17*", "jdk-17*", "jdk21*", "jdk-21*", "jdk*", "JDK*"]
    order = 0
    for tc in tc_dirs:
        if not tc or not os.path.isdir(tc):
            continue
        for pat in patterns:
            for base in sorted(glob.glob(os.path.join(tc, pat))):
                candidates.append((order, base, os.path.join(base, "bin", java_bin)))
                order += 1

    # 2) JAVA_HOME
    jh = os.environ.get("JAVA_HOME")
    if jh:
        candidates.append((order, jh, os.path.join(jh, "bin", java_bin)))
        order += 1

    # 3) PATH 中的 java
    candidates.append((order, "<PATH>", "java"))
    order += 1

    # 4) 系统常见目录
    if _is_windows():
        pf = os.environ.get("ProgramFiles", "C:/Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")
        for d in [os.path.join(pf, "Java"), os.path.join(pf, "Eclipse Adoptium"),
                  os.path.join(pf86, "Java"), os.path.join(pf86, "Eclipse Adoptium")]:
            if os.path.isdir(d):
                for base in sorted(os.listdir(d)):
                    candidates.append((order, os.path.join(d, base),
                                       os.path.join(d, base, "bin", java_bin)))
                    order += 1
    else:
        for d in ["/usr/lib/jvm", "/Library/Java/JavaVirtualMachines",
                  "/opt/java", os.path.expanduser("~/java")]:
            if os.path.isdir(d):
                for base in sorted(os.listdir(d)):
                    candidates.append((order, os.path.join(d, base),
                                       os.path.join(d, base, "bin", java_bin)))
                    order += 1

    seen = set()
    results = []  # (order, major, version, path)
    for (o, base, path) in candidates:
        if path in seen:
            continue
        seen.add(path)
        jp = "java" if base == "<PATH>" else path
        if not os.path.isfile(jp) and base != "<PATH>":
            continue
        ver = _java_version(jp)
        if ver is None:
            continue
        results.append((o, ver[0], ver[1], jp))

    if not results:
        print("!! 未找到可用的 JDK / java。请安装 JDK8 并设置 OH_TOOLCHAIN / JAVA_HOME, "
              "或将 java 加入 PATH。", file=sys.stderr)
        sys.exit(1)
    # 优先 JDK8(满足 hap-sign-tool 对旧式 PKCS12 的读取要求)
    jdk8 = [r for r in results if r[1] == 8]
    if jdk8:
        best = sorted(jdk8, key=lambda r: r[0])[0]
        print("== 使用 JDK8 (满足 hap-sign-tool 对旧式 PKCS12 的读取要求): %s  [version %s]"
              % (best[3], best[2]))
        return best[3]
    # 回退到最高版本(提示风险)
    best = sorted(results, key=lambda r: r[1], reverse=True)[0]
    print("!! 警告: 未找到 JDK8, 回退到 %s [version %s]。首次生成密钥若用此 JDK 写出新版 "
          "PKCS12, 可能被 hap-sign-tool 的 BC 拒绝; 已存在的 JDK8 生成密钥可正常复用。"
          % (best[3], best[2]))
    return best[3]


def find_sdk():
    """定位 command-line-tools 根目录, 返回 (hap-sign-tool.jar, release profile 模板, 根路径)。"""
    cands = []
    if SDK:
        cands.append(SDK)
    home = os.path.expanduser("~")
    cands += [
        os.path.join(home, "Desktop", "command-line-tools"),
        os.path.join(home, "command-line-tools"),
        os.path.join(os.path.dirname(PROJ), "command-line-tools"),
        os.path.join(home, "AppData", "Local", "Huawei", "Sdk", "command-line-tools"),
    ]
    if not _is_windows():
        cands += ["/opt/HarmonyOS/command-line-tools",
                  "/usr/local/HarmonyOS/command-line-tools"]
    for c in cands:
        st = os.path.join(c, "sdk/26.0.1/toolchains/lib/hap-sign-tool.jar")
        tpl = os.path.join(c, "sdk/26.0.1/toolchains/lib/UnsgnedReleasedProfileTemplate.json")
        if os.path.isfile(st) and os.path.isfile(tpl):
            return st, tpl, c
    return None, None, None


# ---- 定位 SDK / 工具链 ----
ST, TPL, SDK_FOUND = find_sdk()
if not ST:
    print("!! 未找到签名工具 hap-sign-tool.jar 与 release profile 模板。\n"
          "   请设置环境变量 OH_SDK_HOME 指向 command-line-tools 根目录。", file=sys.stderr)
    sys.exit(1)
print("== 签名工具链: " + SDK_FOUND)

# 自动定位未签名 HAP(不写死路径): 优先标准产物路径, 否则在工程内 glob
UNSIGNED = os.path.join(PROJ, "entry/build/default/outputs/default/entry-default-unsigned.hap")
if not os.path.isfile(UNSIGNED):
    hits = glob.glob(os.path.join(PROJ, "**", "entry-default-unsigned.hap"), recursive=True)
    if hits:
        UNSIGNED = hits[0]
if not os.path.isfile(UNSIGNED):
    print("!! 未找到未签名 HAP, 请先编译工程, 或设置 OH_PROJECT 指向正确工程根目录", file=sys.stderr)
    sys.exit(1)

OUT_DIR = os.path.join(PROJ, "sign")
OUT = os.path.join(OUT_DIR, "KaihongMovie.hap")
KEYS = os.path.join(PROJ, "sign-keys")   # 持久化签名密钥目录: 复用同一套密钥, 避免反复重签导致签名漂移(否则已装设备需卸载重装)

JAVA = find_java()
print("== 签名工具: " + ST)
print("== 未签名 HAP: " + UNSIGNED)
# 清理旧产物, 保证可复现( sign/ 内均为生成物, 无用户数据)
shutil.rmtree(OUT_DIR, ignore_errors=True)
os.makedirs(OUT_DIR, exist_ok=True)
os.chdir(OUT_DIR)


def run(args):
    cmd = [JAVA, "-jar", ST] + args
    print("\n>> " + " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.stdout:
        print(r.stdout)
    if r.stderr:
        print(r.stderr, file=sys.stderr)
    if r.returncode != 0:
        print("!!! 命令失败 (exit %d)" % r.returncode, file=sys.stderr)
        sys.exit(1)


# 1) ECC 密钥: app / profile / CA (NIST-P-256) —— 持久化到 sign-keys/, 仅首次生成, 后续复用
os.makedirs(KEYS, exist_ok=True)
def kf(name):
    return os.path.join(KEYS, name)
if (os.path.isfile(kf("app-key.p12")) and os.path.isfile(kf("profile-key.p12"))
        and os.path.isfile(kf("ca.p12")) and os.path.isfile(kf("ca.cer"))):
    print("== 复用已有签名密钥 (%s/), 跳过生成" % KEYS)
else:
    run(["generate-keypair", "-keyAlias", "app-key", "-keyAlg", "ECC", "-keySize", "NIST-P-256",
         "-keystoreFile", kf("app-key.p12"), "-keystorePwd", PWD, "-keyPwd", PWD])
    run(["generate-keypair", "-keyAlias", "profile-key", "-keyAlg", "ECC", "-keySize", "NIST-P-256",
         "-keystoreFile", kf("profile-key.p12"), "-keystorePwd", PWD, "-keyPwd", PWD])
    run(["generate-ca", "-keyAlias", "ca-key", "-keyAlg", "ECC", "-keySize", "NIST-P-256",
         "-subject", CA_SUBJECT, "-validity", "3650", "-signAlg", "SHA256withECDSA",
         "-keystoreFile", kf("ca.p12"), "-keystorePwd", PWD, "-keyPwd", PWD, "-outFile", kf("ca.cer")])
    print("== 已生成并持久化签名密钥到 %s/" % KEYS)

# 2) 准备 profile 模板: 包名 / 有效期 (release 模板无 debug-info, 故不绑定 device-ids)
with open(TPL, encoding="utf-8") as f:
    prof = json.load(f)
prof["bundle-info"]["bundle-name"] = BUNDLE
now = datetime.datetime.now(datetime.timezone.utc)
prof["validity"]["not-before"] = int((now - datetime.timedelta(days=1)).timestamp())
prof["validity"]["not-after"] = int((now + datetime.timedelta(days=3650)).timestamp())
MODTPL = os.path.join(OUT_DIR, "modified-profile.json")
with open(MODTPL, "w", encoding="utf-8") as f:
    json.dump(prof, f, indent=4)
print("== profile 模板(初): type=%s bundle-name=%s (无设备绑定)" % (prof.get("type"), BUNDLE))

# 3) 签发应用证书 / Profile 证书 (ECDSA, 由 CA 签发)
run(["generate-app-cert", "-keyAlias", "app-key", "-keyPwd", PWD,
     "-issuer", CA_SUBJECT, "-issuerKeyAlias", "ca-key", "-issuerKeystoreFile", kf("ca.p12"),
     "-issuerKeyPwd", PWD, "-issuerKeystorePwd", PWD, "-subject", APP_SUBJECT, "-validity", "3650",
     "-signAlg", "SHA256withECDSA", "-keystoreFile", kf("app-key.p12"), "-keystorePwd", PWD,
     "-outForm", "cert", "-outFile", "app-end.cer"])
run(["generate-profile-cert", "-keyAlias", "profile-key", "-keyPwd", PWD,
     "-issuer", CA_SUBJECT, "-issuerKeyAlias", "ca-key", "-issuerKeystoreFile", kf("ca.p12"),
     "-issuerKeyPwd", PWD, "-issuerKeystorePwd", PWD, "-subject", PROF_SUBJECT, "-validity", "3650",
     "-signAlg", "SHA256withECDSA", "-keystoreFile", kf("profile-key.p12"), "-keystorePwd", PWD,
     "-outForm", "cert", "-outFile", "profile-end.cer"])

# 4) 证书链 (end-entity -> root)
def cat_chain(end, root, out):
    with open(out, "w", encoding="utf-8") as o:
        for fn in (end, root):
            with open(fn, encoding="utf-8") as i:
                o.write(i.read())
cat_chain("app-end.cer", kf("ca.cer"), "app-chain.pem")
cat_chain("profile-end.cer", kf("ca.cer"), "profile-chain.pem")

# 5) 把应用证书写入 profile 的 distribution-certificate (release 模板用此字段,
#    设备据此校验 app 证书)。注意: 该字段会被工具以 URL-safe base64 解码(拒绝 '+' '/' ,
#    只接受 '-' '_'), 因此取证书 DER 的 bytes 后做 urlsafe_b64encode(去 padding),
#    也不能带 -----BEGIN/END CERTIFICATE----- 头尾(头里含空格, 触发 "Illegal base64 character 20")。
import base64 as _b64
with open("app-end.cer", encoding="utf-8") as f:
    app_pem = f.read()
app_der = _b64.b64decode("".join(l for l in app_pem.splitlines() if not l.startswith("-----")))
app_b64_us = _b64.urlsafe_b64encode(app_der).decode().rstrip("=")
prof["bundle-info"]["distribution-certificate"] = app_b64_us
with open(MODTPL, "w", encoding="utf-8") as f:
    json.dump(prof, f, indent=4)
print("== profile 模板(终): distribution-certificate 已写入应用证书")

# 6) 签名 profile (p7b)
run(["sign-profile", "-mode", "localSign", "-keyAlias", "profile-key",
     "-profileCertFile", "profile-chain.pem", "-inFile", MODTPL, "-signAlg", "SHA256withECDSA",
     "-keystoreFile", kf("profile-key.p12"), "-keystorePwd", PWD, "-keyPwd", PWD, "-outFile", "app.p7b"])

# 7) 签名 HAP
run(["sign-app", "-mode", "localSign", "-keyAlias", "app-key",
     "-appCertFile", "app-chain.pem", "-profileFile", "app.p7b", "-inFile", UNSIGNED,
     "-signAlg", "SHA256withECDSA", "-keystoreFile", kf("app-key.p12"), "-keystorePwd", PWD,
     "-keyPwd", PWD, "-outFile", OUT, "-compatibleVersion", "12", "-signCode", "1"])

# 8) 校验
run(["verify-app", "-inFile", OUT, "-outCertChain", "outCertChain.cer", "-outProfile", "outprofile.p7b"])

print("\n==== 签名完成 ====")
print("已签名 HAP (release, 无设备绑定): " + OUT)
print("可在任意设备/模拟器安装 (目标设备需开启开发者模式或处于可装本地签名包的环境)")
