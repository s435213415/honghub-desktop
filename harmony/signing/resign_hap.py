#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""鸿汇影 HAP · 注入前端 + 版本对齐 + 稳定重签（一次成包）

背景：本工程只保留一份「壳」未签名包（ArkTS 与资源已编译好），前端每次发版
都由 harmony/build_hap.py 重新生成。因此出包 = 换前端 + 改版本 + 复用同一套
证书重签，避免重新签发证书导致已装设备无法覆盖安装。

做四件事：
  1) 把 harmony/entry/src/main/resources/rawfile/www/index.html 换进壳包；
  2) 把 module.json / pack.info 的 versionName、versionCode 对齐到本次发版；
  3) 用 keys/ 下已固化的证书与 profile 稳定重签（hap-sign-tool.jar + JRE）；
  4) 校验包内前端带 KH_HARMONY、KH_APP_CODE 与本次版本一致、字节与源一致，
     然后输出到 dist/honghub-harmony.hap 与 dist/HongHubMovie.hap。

口令只从环境变量 OH_KEY_PWD 或工程根 .env 读取，不写入任何文件。
用法（在工程根执行）：python harmony/signing/resign_hap.py [未签名壳包路径]
"""
import os, sys, json, zipfile, shutil, hashlib, subprocess, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
KEYS = os.path.join(HERE, "keys")
DIST = os.path.join(ROOT, "dist")
BASE = os.path.join(HERE, "entry-default-unsigned.hap")
OUT_DIR = os.path.join(HERE, "entry", "build", "default", "outputs", "default")
UNSIGNED = os.path.join(OUT_DIR, "entry-default-unsigned.hap")
SIGNED = os.path.join(KEYS, "sign", "HongHubMovie.hap")
ENTRY = "resources/rawfile/www/index.html"
PAGE = os.path.join(ROOT, "harmony", "entry", "src", "main", "resources", "rawfile", "www", "index.html")
MANIFEST = os.path.join(ROOT, "server", "manifest.json")


def fail(msg):
    print("[HAP 出包失败] " + msg)
    sys.exit(1)


def read_versions():
    try:
        m = json.load(open(MANIFEST, encoding="utf-8"))
        lat = m["release"]["latest"]
        vn, vc = str(lat["versionName"]), int(lat["versionCode"])
    except Exception as e:
        fail("读取 server/manifest.json 版本失败：" + str(e))
    if not vn or not vc:
        fail("版本号非法：" + str(vn) + " / " + str(vc))
    return vn, vc


def load_pwd():
    p = os.environ.get("OH_KEY_PWD")
    if p:
        return p
    for f in (os.path.join(ROOT, ".env"), os.path.join(HERE, ".env")):
        if os.path.isfile(f):
            for line in open(f, encoding="utf-8"):
                s = line.strip()
                if s.startswith("OH_KEY_PWD="):
                    return s.split("=", 1)[1].strip().strip('"').strip("'")
    fail("缺少签名口令：请设置 OH_KEY_PWD 或在工程根 .env 配置")


def find_java():
    env = os.environ.get("KH_JAVA") or os.environ.get("JAVA_HOME")
    if env:
        cand = os.path.join(env, "bin", "java.exe") if os.path.isdir(env) else env
        if os.path.isfile(cand):
            return cand
    pats = [r"C:/Users/admin/Desktop/软件开发工具/command-line-tools/tool/jre/bin/java.exe",
            r"C:/Users/admin/Desktop/command-line-tools/tool/jre/bin/java.exe",
            r"C:/Program Files/Java/jdk*/bin/java.exe",
            os.path.expanduser("~") + "/toolchain/jdk*/bin/java.exe"]
    for pat in pats:
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    return "java"


def find_jar():
    pats = [os.environ.get("OH_SDK_HOME", "") + "/sdk/*/toolchains/lib/hap-sign-tool.jar",
            r"C:/Users/admin/Desktop/软件开发工具/command-line-tools/sdk/*/toolchains/lib/hap-sign-tool.jar",
            r"C:/Users/admin/Desktop/command-line-tools/sdk/*/toolchains/lib/hap-sign-tool.jar"]
    for pat in pats:
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    fail("未找到 hap-sign-tool.jar（请确认 command-line-tools/sdk 已安装）")


def build_unsigned(vn, vc):
    if not os.path.isfile(BASE):
        fail("缺少壳包：" + BASE)
    if not os.path.isfile(PAGE):
        fail("缺少前端：" + PAGE + "（请先执行 python harmony/build_hap.py）")
    page_bytes = open(PAGE, "rb").read()
    text = page_bytes.decode("utf-8")
    if "KH_HARMONY" not in text:
        fail("前端缺少 KH_HARMONY 适配标记，疑似没跑 build_hap.py")
    os.makedirs(OUT_DIR, exist_ok=True)
    with zipfile.ZipFile(BASE) as zin, zipfile.ZipFile(UNSIGNED, "w", zipfile.ZIP_DEFLATED) as zout:
        names = zin.namelist()
        if ENTRY not in names:
            fail("壳包内缺少 " + ENTRY)
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == ENTRY:
                data = page_bytes
            elif item.filename == "module.json":
                obj = json.loads(data.decode("utf-8"))
                obj["app"]["versionName"] = vn
                obj["app"]["versionCode"] = vc
                data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            elif item.filename == "pack.info":
                obj = json.loads(data.decode("utf-8"))
                obj["summary"]["app"]["version"] = {"code": vc, "name": vn}
                data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            zout.writestr(item, data)
    print("  注入完成：" + UNSIGNED + "  (%d B, v%s / #%d)" % (os.path.getsize(UNSIGNED), vn, vc))


def sign(pwd):
    java, jar = find_java(), find_jar()
    os.makedirs(os.path.dirname(SIGNED), exist_ok=True)
    cmd = [java, "-jar", jar, "sign-app", "-mode", "localSign",
           "-keyAlias", "app-key",
           "-appCertFile", os.path.join(KEYS, "app-chain.pem"),
           "-profileFile", os.path.join(KEYS, "app.p7b"),
           "-inFile", UNSIGNED, "-signAlg", "SHA256withECDSA",
           "-keystoreFile", os.path.join(KEYS, "sign-keys", "app-key.p12"),
           "-keystorePwd", pwd, "-keyPwd", pwd,
           "-outFile", SIGNED, "-compatibleVersion", "12", "-signCode", "1"]
    print("  签名：", java)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        fail("sign-app 失败：\n" + (r.stdout or "") + (r.stderr or ""))
    print("  已签名：" + SIGNED + "  (%d B)" % os.path.getsize(SIGNED))


def verify(vn, vc):
    with zipfile.ZipFile(SIGNED) as z:
        html = z.read(ENTRY).decode("utf-8", "ignore")
        mod = json.loads(z.read("module.json").decode("utf-8"))
    if "KH_HARMONY" not in html:
        fail("签名包内前端缺少 KH_HARMONY")
    src = open(PAGE, encoding="utf-8").read()
    if html.replace("\r\n", "\n") != src.replace("\r\n", "\n"):
        fail("包内前端与本次生成的 www/index.html 不一致（注入未生效）")
    m = mod["app"]
    if str(m.get("versionName")) != vn or int(m.get("versionCode")) != vc:
        fail("包内版本与本次发版不一致：%s / #%s ≠ %s / #%d" % (m.get("versionName"), m.get("versionCode"), vn, vc))
    code = None
    import re
    mm = re.search(r"var KH_APP_CODE\s*=\s*(\d+)", html)
    if mm:
        code = int(mm.group(1))
    if code is not None and code != vc:
        fail("前端 KH_APP_CODE #%d ≠ 本次发版 #%d（疑似沿用旧前端）" % (code, vc))
    print("  校验通过：v%s / #%d · 前端 %d B" % (vn, vc, len(html.encode("utf-8"))))
    return mod


def deliver(vn, vc):
    os.makedirs(DIST, exist_ok=True)
    buf = open(SIGNED, "rb").read()
    sha = hashlib.sha256(buf).hexdigest()
    for name in ("HongHubMovie.hap", "honghub-harmony.hap", "kaihongcinema-harmony.hap"):
        with open(os.path.join(DIST, name), "wb") as f:
            f.write(buf)
        with open(os.path.join(DIST, name + ".sha256"), "w", encoding="utf-8") as f:
            f.write(sha + "  " + name + "\n")
    with open(os.path.join(DIST, ".hap-build.json"), "w", encoding="utf-8") as f:
        json.dump({"schema": 1, "size": len(buf), "sha256": sha, "versionName": vn, "versionCode": vc,
                   "builtAt": __import__("datetime").datetime.now().astimezone().isoformat(),
                   "source": "harmony/signing（壳包注入 + 复用证书重签）"}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("  已输出 dist：honghub-harmony.hap / HongHubMovie.hap · %d B · sha256 %s…" % (len(buf), sha[:16]))
    return sha


def signed_is_fresh(vn, vc):
    """同版本 + 同前端 + 签名文件未变 → 直接复用，避免重复签名让字节漂移，
    导致「安装包内置 HAP」与「dist 发布的 HAP」哈希对不上。"""
    if not (os.path.isfile(SIGNED) and os.path.isfile(PAGE)):
        return False
    try:
        stamp = json.load(open(os.path.join(DIST, ".hap-build.json"), encoding="utf-8"))
        buf = open(SIGNED, "rb").read()
        if stamp.get("sha256") != hashlib.sha256(buf).hexdigest():
            return False
        if str(stamp.get("versionName")) != vn or int(stamp.get("versionCode")) != vc:
            return False
        with zipfile.ZipFile(SIGNED) as z:
            html = z.read(ENTRY).decode("utf-8")
            mod = json.loads(z.read("module.json").decode("utf-8"))["app"]
        if html.replace("\r\n", "\n") != open(PAGE, encoding="utf-8").read().replace("\r\n", "\n"):
            return False
        return str(mod.get("versionName")) == vn and int(mod.get("versionCode")) == vc
    except Exception:
        return False


def main():
    global BASE
    base = sys.argv[1] if len(sys.argv) > 1 else BASE
    BASE = base
    vn, vc = read_versions()
    if signed_is_fresh(vn, vc):
        print("=== HAP 出包：v%s / #%d（同版本同前端，复用已签包，不重复签名）===" % (vn, vc))
        deliver(vn, vc)
        return
    pwd = load_pwd()
    print("=== HAP 出包：v%s / #%d ===" % (vn, vc))
    build_unsigned(vn, vc)
    sign(pwd)
    verify(vn, vc)
    deliver(vn, vc)
    print("=== HAP 出包完成 ===")


if __name__ == "__main__":
    main()
