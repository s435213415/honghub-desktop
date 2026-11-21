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
OFFICIAL = os.path.join(HERE, "keys-official")   # OpenHarmony 官方证书链物料（SDK 自带，公开口令）
OFFICIAL_PWD = "123456"                          # SDK OpenHarmony.p12 公开口令
BUNDLE = "com.honghub.harmony"
CHAIN_TAG = "official-openharmony"
DIST = os.path.join(ROOT, "dist")
# 壳包来源：优先 hvigor 刚编出来的未签名包（ArkTS 改动只有重新编译才生效），
# 其次才是仓库里固化的签名壳包。可用 KH_HAP_SHELL 显式指定。
BASE_DEFAULT = os.path.join(HERE, "entry-default-unsigned.hap")
BASE = BASE_DEFAULT
OUT_DIR = os.path.join(HERE, "entry", "build", "default", "outputs", "default")
# hvigor 实际构建目录（ArkTS 编译产物所在）
BUILD_OUT_DIR = os.path.join(ROOT, "harmony", "entry", "build", "default", "outputs", "default")
UNSIGNED_BUILD = os.path.join(BUILD_OUT_DIR, "entry-default-unsigned.hap")
# 注入后的中间包另起名字，避免与 hvigor 构建产物同名互相覆盖
UNSIGNED = os.path.join(OUT_DIR, "honghub-harmony-unsigned.hap")
# 运行态 API 声明对齐：目标设备 KaihongOS 桌面版基于 OpenHarmony 5.0.2 = API 14
TARGET_API = int(os.environ.get("KH_HAP_TARGET_API") or 14)
# 变体隔离：KH_HAP_VARIANT=dev 出开发端变体 HAP，中间签名产物 / dist 产物名 / build 记录
# 全部与客户版分开，绝不覆盖客户 HongHubMovie.hap；默认（client）行为与现状一致。
VARIANT = (os.environ.get("KH_HAP_VARIANT") or "client").strip().lower()
IS_DEV = VARIANT == "dev"
SIGNED = os.path.join(KEYS, "sign", "HongHubMovie-dev.hap" if IS_DEV else "HongHubMovie.hap")
ENTRY = "resources/rawfile/www/index.html"
PAGE = os.path.join(ROOT, "harmony", "entry", "src", "main", "resources", "rawfile", "www", "index.html")
WWW = os.path.dirname(PAGE)   # 前端目录：壳页 + kh-*.js 模块（1.7.72 模块化）
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


def load_pwd(env_name="OH_KEY_PWD", default=None):
    """口令只从环境变量或工程根 .env 读；env_name 决定读哪个键。"""
    p = os.environ.get(env_name)
    if p:
        return p.strip()
    for f in (os.path.join(ROOT, ".env"), os.path.join(HERE, ".env")):
        if os.path.isfile(f):
            for line in open(f, encoding="utf-8"):
                s = line.strip()
                if s.startswith(env_name + "="):
                    v = s.split("=", 1)[1].strip().strip('"').strip("'")
                    if v:
                        return v
    return default


# ===== 签名链注册表：只用显式声明的链，不做隐式回退 =====
# 每条链说明「谁的密钥、签哪个 bundle、什么类型」。bundle 不匹配、材料缺失、口令缺失，
# 一律直接失败并说清原因，绝不悄悄换一条链把包签出来。
KAIHONG_DIR = os.path.join(HERE, "keys-kaihong")

CHAINS = {
    "official": {
        "tag": "official-openharmony",
        "bundle": BUNDLE,
        "profileType": "release",
        "own": False,
        "keystore": "sdk",                       # SDK 内置 OpenHarmony.p12
        "alias": "openharmony application release",
        "cert": os.path.join(OFFICIAL, "app-chain.pem"),
        "profile": os.path.join(OFFICIAL, "profile-release.p7b"),
        "pwd": "123456",                          # 公开口令
        "note": "OpenHarmony SDK 公开密钥，不是自持私钥",
    },
    "kaihong": {
        "tag": "kaihong-platform-debug",
        "bundle": "com.kaihong.movie",
        "profileType": "debug",
        "own": True,
        "keystore": os.path.join(KAIHONG_DIR, "kaihong.p12"),
        "alias": "kaihong",
        "cert": os.path.join(KAIHONG_DIR, "app.cer"),
        "profile": os.path.join(KAIHONG_DIR, "app.p7b"),
        "pwdEnv": "KH_KAIHONG_PWD",
        "note": "开鸿平台签发证书，私钥自持（仅限 com.kaihong.movie 调试装机）",
    },
    "kaihong-release": {
        "tag": "kaihong-platform-release",
        "bundle": "com.kaihong.movie",
        "profileType": "release",
        "own": True,
        "keystore": os.path.join(KAIHONG_DIR, "kaihong.p12"),
        "alias": "kaihong",
        "cert": os.path.join(KAIHONG_DIR, "app-release.cer"),
        "profile": os.path.join(KAIHONG_DIR, "profile-release.p7b"),
        "pwdEnv": "KH_KAIHONG_PWD",
        "note": "开鸿平台 release 链（com.kaihong.movie 正式分发）；release 应用证书 app-release.cer 待平台签发，私钥暂复用自持 kaihong.p12，若平台另发 release 私钥需替换",
    },
}


def selected_chain():
    """选定链：命令行 --chain=xxx > 环境变量 KH_HAP_CHAIN > 默认 official。"""
    want = os.environ.get("KH_HAP_CHAIN", "").strip().lower()
    for a in sys.argv[1:]:
        if a.startswith("--chain="):
            want = a.split("=", 1)[1].strip().lower()
    if not want:
        want = "official"
    if want not in CHAINS:
        fail("未知签名链：" + want + "（可用：" + " / ".join(CHAINS) + "）")
    return want, dict(CHAINS[want])


def check_chain(name, ch):
    """只做校验、不签名：材料齐不齐、bundle 对不对、口令在不在、证书过没过期。
    有任何一条不满足就返回问题列表，调用方决定是失败还是打印。"""
    problems = []
    if ch.get("keystore") == "sdk":
        jar = find_jar()
        ks = os.path.join(os.path.dirname(jar), "OpenHarmony.p12")
    else:
        ks = ch["keystore"]
    if not os.path.isfile(ks):
        problems.append("密钥库不存在：" + ks)
    if not os.path.isfile(ch["cert"]):
        problems.append("证书/证书链不存在：" + ch["cert"])
    if not os.path.isfile(ch["profile"]):
        problems.append("Profile 不存在：" + ch["profile"])
    if ch.get("pwdEnv"):
        if not load_pwd(ch["pwdEnv"]):
            problems.append("口令缺失：环境变量或 .env 里没有 " + ch["pwdEnv"])
    if ch["bundle"] != BUNDLE:
        problems.append("bundle 不匹配：链 " + name + " 的 Profile 是 " + ch["bundle"] +
                        "，当前壳包是 " + BUNDLE + "（签名能过但装机必失败）")
    # 证书有效期：keytool 能读就查，读不到只提示不阻断
    try:
        keytool = os.path.join(os.path.dirname(find_java()), "keytool.exe" if os.name == "nt" else "keytool")
        if not os.path.isfile(keytool):
            keytool = "keytool"
        r = subprocess.run([keytool, "-printcert", "-file", ch["cert"]], capture_output=True,
                           text=True, encoding="utf-8", errors="replace")
        out = (r.stdout or "") + (r.stderr or "")
        import re, datetime
        m = re.search(r"until:\s*(\d{4}-\d{2}-\d{2})", out)
        if m:
            exp = datetime.datetime.strptime(m.group(1), "%Y-%m-%d").date()
            left = (exp - datetime.date.today()).days
            if left < 0:
                problems.append("证书已过期：" + m.group(1))
            elif left < 30:
                problems.append("证书 %d 天后到期（%s）" % (left, m.group(1)))
    except Exception:
        pass
    return problems


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


def newest_ets_mtime():
    base = os.path.join(ROOT, "harmony", "entry", "src", "main", "ets")
    newest = 0
    for root, _dirs, files in os.walk(base):
        for f in files:
            if f.endswith(".ets") or f.endswith(".ts"):
                try:
                    newest = max(newest, os.path.getmtime(os.path.join(root, f)))
                except OSError:
                    pass
    return newest


def pick_shell():
    """选壳包：KH_HAP_SHELL > 最新的 hvigor 构建产物 / 固化壳包。"""
    env_shell = (os.environ.get("KH_HAP_SHELL") or "").strip()
    if env_shell:
        if not os.path.isfile(env_shell):
            fail("KH_HAP_SHELL 指向的壳包不存在：" + env_shell)
        return env_shell
    cands = [p for p in (UNSIGNED_BUILD, BASE_DEFAULT) if os.path.isfile(p)]
    if not cands:
        fail("缺少壳包：既没有 hvigor 构建产物，也没有 " + BASE_DEFAULT)
    picked = max(cands, key=lambda p: os.path.getmtime(p))
    if picked == UNSIGNED_BUILD:
        src = newest_ets_mtime()
        if src and src > os.path.getmtime(picked):
            print("  ⚠ ArkTS 源码比构建产物新：原生改动未编译，需重跑 hvigor assembleHap 才会进包")
    return picked


def www_files():
    """前端已模块化（1.7.72）：www 目录里除壳页还有 kh-*.js 等外链脚本。
    返回 [(相对路径, 绝对路径)]，并把这些文件全部写进 HAP 的 rawfile/www/。"""
    out = []
    for root, _dirs, files in os.walk(WWW):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, WWW).replace("\\", "/")
            out.append((rel, full))
    return out


def www_text():
    """合并视图：壳页 + 所有外链脚本，用于 KH_HARMONY / 版本标记校验。"""
    txt = ""
    for rel, full in www_files():
        try:
            if rel.endswith((".html", ".js")):
                txt += "\n" + open(full, encoding="utf-8").read()
        except Exception:
            pass
    return txt


def build_unsigned(vn, vc, shell):
    if not os.path.isfile(shell):
        fail("缺少壳包：" + shell)
    if not os.path.isfile(PAGE):
        fail("缺少前端：" + PAGE + "（请先执行 python harmony/build_hap.py）")
    page_bytes = open(PAGE, "rb").read()
    text = www_text()
    if "KH_HARMONY" not in text:
        fail("前端缺少 KH_HARMONY 适配标记，疑似没跑 build_hap.py")
    files = www_files()
    if not files:
        fail("前端目录为空：" + WWW)
    print("  壳包：" + shell + "（%d B）· 前端 %d 个文件" % (os.path.getsize(shell), len(files)))
    os.makedirs(OUT_DIR, exist_ok=True)
    with zipfile.ZipFile(shell) as zin, zipfile.ZipFile(UNSIGNED, "w", zipfile.ZIP_DEFLATED) as zout:
        names = zin.namelist()
        if ENTRY not in names:
            fail("壳包内缺少 " + ENTRY)
        for item in zin.infolist():
            if item.filename.startswith("resources/rawfile/www/"):
                continue   # 壳包里的旧前端整体丢弃，下面按 www 目录重建
            data = zin.read(item.filename)
            if item.filename == "module.json":
                obj = json.loads(data.decode("utf-8"))
                obj["app"]["versionName"] = vn
                obj["app"]["versionCode"] = vc
                # 运行态 API 声明对齐目标设备（OpenHarmony 5.0.2 = API14）：
                # 目标 API 不高于设备实际，系统按设备版本给出行为；
                # 发行类型改 Release，避免 Beta1 包在正式设备上被安装器判定为测试包。
                min_api = int(obj["app"].get("minAPIVersion") or 11)
                obj["app"]["targetAPIVersion"] = max(min_api, TARGET_API)
                obj["app"]["apiReleaseType"] = "Release"
                data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            elif item.filename == "pack.info":
                obj = json.loads(data.decode("utf-8"))
                obj["summary"]["app"]["version"] = {"code": vc, "name": vn}
                api = obj["summary"]["modules"][0].get("apiVersion")
                if isinstance(api, dict):
                    api["target"] = max(int(api.get("compatible") or 11), TARGET_API)
                    api["releaseType"] = "Release"
                data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            zout.writestr(item, data)
        for rel, full in files:
            zout.write(full, "resources/rawfile/www/" + rel)
    print("  注入完成：" + UNSIGNED + "  (%d B, v%s / #%d)" % (os.path.getsize(UNSIGNED), vn, vc))


def ensure_official_keys(java, jar):
    """用 SDK 自带 OpenHarmony 官方物料生成/复用 keys-official（幂等）。
    证书链：Application Release(模板叶子) -> Application CA -> Application Root CA。
    坑（沿袭 KaihongMovie/sign-official.py 的踩坑记录）：
      - p12 里 release alias 自带证书是自签的，必须用模板 distribution-certificate 做叶子；
      - sign-app 不能带 -signCode，只传 -profileSigned 1。"""
    chain = os.path.join(OFFICIAL, "app-chain.pem")
    p7b = os.path.join(OFFICIAL, "profile-release.p7b")
    if os.path.isfile(chain) and os.path.isfile(p7b):
        return chain, p7b
    lib = os.path.dirname(jar)
    p12 = os.path.join(lib, "OpenHarmony.p12")
    tpl = os.path.join(lib, "UnsgnedReleasedProfileTemplate.json")
    prof_cert = os.path.join(lib, "OpenHarmonyProfileRelease.pem")
    for f in (p12, tpl, prof_cert):
        if not os.path.isfile(f):
            fail("缺少 SDK 官方签名物料：" + f)
    os.makedirs(OFFICIAL, exist_ok=True)
    import datetime
    prof = json.load(open(tpl, encoding="utf-8"))
    prof["bundle-info"]["bundle-name"] = BUNDLE
    leaf = prof["bundle-info"]["distribution-certificate"]
    now = datetime.datetime.now(datetime.timezone.utc)
    prof["validity"]["not-before"] = int((now - datetime.timedelta(days=1)).timestamp())
    prof["validity"]["not-after"] = int((now + datetime.timedelta(days=3650)).timestamp())
    prof_path = os.path.join(OFFICIAL, "profile-release.json")
    json.dump(prof, open(prof_path, "w", encoding="utf-8"), indent=4, ensure_ascii=False)
    if not leaf.endswith("\n"):
        leaf += "\n"
    keytool = os.path.join(os.path.dirname(java), "keytool.exe" if os.name == "nt" else "keytool")
    if not os.path.isfile(keytool):
        keytool = "keytool"
    with open(chain, "w", encoding="utf-8") as out:
        out.write(leaf)
        for alias in ("openharmony application ca", "openharmony application root ca"):
            r = subprocess.run([keytool, "-exportcert", "-rfc", "-alias", alias,
                                "-keystore", p12, "-storetype", "PKCS12",
                                "-storepass", OFFICIAL_PWD], capture_output=True, text=True,
                               encoding="utf-8", errors="replace")
            if r.returncode != 0 or "BEGIN CERTIFICATE" not in r.stdout:
                fail("导出官方证书失败：" + alias + "\n" + (r.stderr or ""))
            out.write(r.stdout.strip() + "\n")
    r = subprocess.run([java, "-jar", jar, "sign-profile", "-mode", "localSign",
                        "-keyAlias", "openharmony application profile release",
                        "-profileCertFile", prof_cert, "-inFile", prof_path,
                        "-signAlg", "SHA256withECDSA", "-keystoreFile", p12,
                        "-keystorePwd", OFFICIAL_PWD, "-keyPwd", OFFICIAL_PWD,
                        "-outFile", p7b], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        fail("sign-profile 失败：\n" + (r.stdout or "") + (r.stderr or ""))
    print("  官方链物料就绪：" + OFFICIAL)
    return chain, p7b


def sign(pwd, chain_name, ch):
    java, jar = find_java(), find_jar()
    if chain_name == "official":
        chain, p7b = ensure_official_keys(java, jar)
        ks = os.path.join(os.path.dirname(jar), "OpenHarmony.p12")
        pwd = OFFICIAL_PWD
    else:
        chain, p7b = ch["cert"], ch["profile"]
        ks = ch["keystore"]
    # 签名兼容版本取包内 minAPIVersion：与包声明一致，低版本设备才有机会安装
    compat = 11
    try:
        with zipfile.ZipFile(UNSIGNED) as z:
            compat = int(json.loads(z.read("module.json").decode("utf-8"))["app"].get("minAPIVersion") or 11)
    except Exception:
        pass
    os.makedirs(os.path.dirname(SIGNED), exist_ok=True)
    cmd = [java, "-jar", jar, "sign-app", "-mode", "localSign",
           "-keyAlias", ch["alias"],
           "-appCertFile", chain,
           "-profileFile", p7b,
           "-inFile", UNSIGNED, "-signAlg", "SHA256withECDSA",
           "-keystoreFile", ks,
           "-keystorePwd", pwd, "-keyPwd", pwd,
           "-outFile", SIGNED, "-compatibleVersion", str(compat), "-profileSigned", "1"]
    print("  签名链：%s（%s / bundle=%s / %s）" % (ch["tag"], ch["alias"], ch["bundle"],
                                        "自持私钥" if ch["own"] else "SDK 公开密钥"))
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        fail("sign-app 失败（链 " + chain_name + "）：\n" + (r.stdout or "") + (r.stderr or ""))
    print("  已签名：" + SIGNED + "  (%d B)" % os.path.getsize(SIGNED))


def verify(vn, vc):
    with zipfile.ZipFile(SIGNED) as z:
        packed = {n: z.read(n) for n in z.namelist() if n.startswith("resources/rawfile/www/")}
        mod = json.loads(z.read("module.json").decode("utf-8"))
    if ENTRY not in packed:
        fail("签名包内缺少前端入口：" + ENTRY)
    alltext = "\n".join(b.decode("utf-8", "ignore") for b in packed.values())
    if "KH_HARMONY" not in alltext:
        fail("签名包内前端缺少 KH_HARMONY")
    for rel, full in www_files():
        key = "resources/rawfile/www/" + rel
        if key not in packed:
            fail("签名包内缺少前端文件：" + rel)
        if packed[key] != open(full, "rb").read():
            fail("包内前端与本次生成的 www 不一致（注入未生效）：" + rel)
    m = mod["app"]
    if str(m.get("versionName")) != vn or int(m.get("versionCode")) != vc:
        fail("包内版本与本次发版不一致：%s / #%s ≠ %s / #%d" % (m.get("versionName"), m.get("versionCode"), vn, vc))
    # 目标设备兼容声明：target 不高于 KaihongOS 最新版（OpenHarmony 5.0.2 = API14），
    # 且必须是 Release 发行类型、覆盖桌面（2in1 / default）与平板 / TV 形态
    tgt = int(m.get("targetAPIVersion") or 0)
    if tgt > TARGET_API:
        fail("包内 targetAPIVersion=%d 高于目标设备 API%d，运行态行为会按更高版本走" % (tgt, TARGET_API))
    if str(m.get("apiReleaseType") or "") != "Release":
        fail("包内 apiReleaseType=%s，正式设备应声明 Release" % m.get("apiReleaseType"))
    devs = mod.get("module", {}).get("deviceTypes") or []
    if "2in1" not in devs:
        fail("包内 deviceTypes 缺少 2in1（KaihongOS 桌面版必须在列）：" + str(devs))
    code = None
    import re
    mm = re.search(r"var KH_APP_CODE\s*=\s*(\d+)", alltext)
    if mm:
        code = int(mm.group(1))
    if code is not None and code != vc:
        fail("前端 KH_APP_CODE #%d ≠ 本次发版 #%d（疑似沿用旧前端）" % (code, vc))
    print("  校验通过：v%s / #%d · 前端 %d B" % (vn, vc, len(alltext.encode("utf-8"))))
    return mod


def deliver(vn, vc, ch, shell):
    os.makedirs(DIST, exist_ok=True)
    buf = open(SIGNED, "rb").read()
    sha = hashlib.sha256(buf).hexdigest()
    if IS_DEV:
        names = ("HongHubMovie-dev.hap", "honghub-harmony-dev.hap")
    else:
        names = ("HongHubMovie.hap", "honghub-harmony.hap", "kaihongcinema-harmony.hap")
    for name in names:
        with open(os.path.join(DIST, name), "wb") as f:
            f.write(buf)
        with open(os.path.join(DIST, name + ".sha256"), "w", encoding="utf-8") as f:
            f.write(sha + "  " + name + "\n")
    stamp_name = ".hap-build-dev.json" if IS_DEV else ".hap-build.json"
    with open(os.path.join(DIST, stamp_name), "w", encoding="utf-8") as f:
        json.dump({"schema": 1, "size": len(buf), "sha256": sha, "versionName": vn, "versionCode": vc,
                   "variant": "dev" if IS_DEV else "client",
                   "chain": ch["tag"], "chainOwner": "self" if ch["own"] else "sdk-public",
                   "shell": os.path.basename(shell), "shellSha256": file_sha256(shell),
                   "targetApi": TARGET_API, "compatVersion": 11,
                   "builtAt": __import__("datetime").datetime.now().astimezone().isoformat(),
                   "source": "harmony/signing（壳包注入 + " + ch["tag"] + " 签名）"}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("  已输出 dist：%s · %d B · sha256 %s…" % (" / ".join(names), len(buf), sha[:16]))
    return sha


def file_sha256(p):
    try:
        return hashlib.sha256(open(p, "rb").read()).hexdigest()
    except Exception:
        return ""


def signed_is_fresh(vn, vc, ch, shell):
    """同版本 + 同前端 + 同壳包 + 同链 + 签名文件未变 → 直接复用，避免重复签名让字节漂移，
    导致「安装包内置 HAP」与「dist 发布的 HAP」哈希对不上。"""
    if not (os.path.isfile(SIGNED) and os.path.isfile(PAGE)):
        return False
    try:
        stamp_name = ".hap-build-dev.json" if IS_DEV else ".hap-build.json"
        stamp = json.load(open(os.path.join(DIST, stamp_name), encoding="utf-8"))
        if stamp.get("chain") != ch["tag"]:
            return False   # 换了签名链，必须重签
        if stamp.get("shellSha256") and stamp.get("shellSha256") != file_sha256(shell):
            return False   # 壳包（ArkTS 编译产物）变了，旧签名包不含新原生逻辑
        buf = open(SIGNED, "rb").read()
        if stamp.get("sha256") != hashlib.sha256(buf).hexdigest():
            return False
        if str(stamp.get("versionName")) != vn or int(stamp.get("versionCode")) != vc:
            return False
        with zipfile.ZipFile(SIGNED) as z:
            packed = {n: z.read(n) for n in z.namelist() if n.startswith("resources/rawfile/www/")}
            mod = json.loads(z.read("module.json").decode("utf-8"))
        for rel, full in www_files():
            key = "resources/rawfile/www/" + rel
            if key not in packed or packed[key] != open(full, "rb").read():
                return False   # 前端模块有变化，必须重签
        if ENTRY not in packed:
            return False
        app = mod["app"]
        if int(app.get("targetAPIVersion") or 0) != max(int(app.get("minAPIVersion") or 11), TARGET_API):
            return False   # API 声明未对齐，必须重签
        return str(app.get("versionName")) == vn and int(app.get("versionCode")) == vc
    except Exception:
        return False


def main():
    global BASE
    chain_name, ch = selected_chain()
    if "--check" in sys.argv or "--check-chain" in sys.argv:
        print("=== 签名链自检：%s（%s）===" % (chain_name, ch["tag"]))
        print("  密钥归属：" + ("自持" if ch["own"] else "SDK 公开密钥（不是自己的）"))
        print("  签名 bundle：" + ch["bundle"] + " · 包内 bundle：" + BUNDLE)
        print("  Profile 类型：" + ch["profileType"])
        probs = check_chain(chain_name, ch)
        if probs:
            print("  发现 %d 个问题：" % len(probs))
            for p in probs:
                print("   ✘ " + p)
            sys.exit(2)
        print("  ✔ 材料齐全、bundle 匹配、证书在有效期内")
        sys.exit(0)

    shell = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else pick_shell()
    BASE = shell
    vn, vc = read_versions()

    probs = check_chain(chain_name, ch)
    if probs:
        for p in probs:
            print("  ✘ " + p)
        fail("签名链 " + chain_name + " 前置校验未通过（不会自动换链）")

    if signed_is_fresh(vn, vc, ch, shell):
        print("=== HAP 出包：v%s / #%d（同版本同前端同壳包同链，复用已签包）===" % (vn, vc))
        deliver(vn, vc, ch, shell)
        return
    pwd = ch.get("pwd") or load_pwd(ch.get("pwdEnv", "OH_KEY_PWD"))
    print("=== HAP 出包：v%s / #%d ===" % (vn, vc))
    build_unsigned(vn, vc, shell)
    sign(pwd, chain_name, ch)
    verify(vn, vc)
    deliver(vn, vc, ch, shell)
    print("=== HAP 出包完成 ===")


if __name__ == "__main__":
    main()
