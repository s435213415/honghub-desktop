#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
开鸿影视 · 直播源健康检查 (m3u8)

用途：把「定时任务里临时探测」固化为可复用脚本，供人工或自动化调用。

用法:
    python check_sources.py                       # 检查 HAP 内全部源(默认)
    python check_sources.py --limit 60 --timeout 8
    python check_sources.py --html 某文件.html      # 直接检查 html
    python check_sources.py --json report.json     # 同时输出 JSON 报告
    python check_sources.py --rewrite map.json --out fixed.html   # 半自动改写(死链->备用)

--rewrite 的 map.json 形如: {"旧m3u8地址": "新m3u8地址", ...}
只替换命中的 URL，不改其它内容；改写后需自行 make.py 重签。
"""
import os, sys, re, json, zipfile, argparse, urllib.request
import concurrent.futures as cf

PROJ = os.path.dirname(os.path.abspath(__file__))
DEFAULT_HAP = os.path.join(PROJ, "sign", "KaihongMovie.hap")
ENTRY = "resources/rawfile/movie-site/index.html"
UA = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"


def load_html(hap=None, html=None):
    if html:
        with open(html, encoding="utf-8") as f:
            return f.read()
    hap = hap or DEFAULT_HAP
    if not os.path.isfile(hap):
        sys.exit(f"[ERROR] 找不到 HAP: {hap}（可用 --html 指定 html）")
    with zipfile.ZipFile(hap) as z:
        return z.read(ENTRY).decode("utf-8", "ignore")


URL_RE = re.compile(r"https?://[^\s\"'<>()\\]+?\.m3u8[^\s\"'<>()]*")


def extract(html):
    items, seen = [], set()
    for m in URL_RE.finditer(html):
        u = m.group(0).rstrip(",;")
        if u in seen:
            continue
        # 跳过界面占位符/示例地址(非真实频道，避免误报)
        if any(x in u for x in ("你的", "example.com", "your-", "placeholder", "xxx.com")):
            continue
        seen.add(u)
        # 数据结构: {id:'cn001',...,name:"CCTV-1 综合",...,sources:[{label:"直播主源",url:"..."}]}
        ctx = html[max(0, m.start() - 900):m.start()]
        nm = re.findall(r'name\s*:\s*"([^"]{1,30})"', ctx)
        lb = re.findall(r'label\s*:\s*"([^"]{1,20})"', ctx)
        name = nm[-1].strip() if nm else ""
        if not name:
            cm = re.findall(r"(CCTV[- ]?\d+\+?|[\u4e00-\u9fa5]{2,6}卫视|[\u4e00-\u9fa5]{2,8}频道)", ctx)
            name = cm[-1] if cm else "未知"
        if lb:
            name = f"{name}·{lb[-1].strip()}"
        items.append({"name": name, "url": u})
    return items


def probe(item, timeout):
    """返回 (状态, 是否存活)。2xx/3xx=活；401/403=可能可用；其余=死。"""
    url = item["url"]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=0-2047"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            code = r.status
            return code, (200 <= code < 400)
    except urllib.error.HTTPError as e:
        c = e.code
        return c, (200 <= c < 400) or c in (401, 403)
    except Exception:
        return "TIMEOUT", False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hap")
    ap.add_argument("--html")
    ap.add_argument("--limit", type=int, default=0, help="最多探测多少个(0=全部)")
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--json")
    ap.add_argument("--rewrite")
    ap.add_argument("--out")
    a = ap.parse_args()

    html = load_html(a.hap, a.html)
    items = extract(html)
    total = len(items)

    # 半自动改写
    if a.rewrite:
        with open(a.rewrite, encoding="utf-8") as f:
            mapping = json.load(f)
        hit = 0
        for old, new in mapping.items():
            if old in html:
                html = html.replace(old, new)
                hit += 1
        out = a.out or os.path.join(PROJ, "_signtmp", "index_rewritten.html")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"[REWRITE] 命中 {hit}/{len(mapping)} 条，已写出: {out}")
        print("           下一步: 用该文件替换源码 rawfile 后执行 python make.py")
        return

    todo = items[:a.limit] if a.limit and a.limit < total else items
    print(f"[INFO] 共发现 {total} 个 m3u8 源，探测 {len(todo)} 个，超时 {a.timeout}s，并发 {a.workers}\n")

    results = []
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(probe, it, a.timeout): it for it in todo}
        for fu in cf.as_completed(futs):
            it = futs[fu]
            code, alive = fu.result()
            results.append({**it, "code": code, "alive": alive})

    dead = [r for r in results if not r["alive"]]
    alive = [r for r in results if r["alive"]]
    results.sort(key=lambda r: (r["alive"], str(r["code"])))

    print(f"存活 {len(alive)} / {len(results)}，失效 {len(dead)}\n")
    for r in results:
        flag = "✓" if r["alive"] else "✗"
        nm = (r["name"] or "未知")[:12]
        print(f"  {flag} [{str(r['code']):>7}] {nm:<14} {r['url'][:88]}")

    if dead:
        print(f"\n[失效清单] {len(dead)} 个：")
        for r in dead:
            print(f"  - {r['name']} -> {r['url']}")
        if len(dead) >= max(2, len(results) // 3):
            print("\n[建议] 失效比例较高，请在源码 index.html 中替换上述 URL，再执行 python make.py 重签。")

    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"\n[JSON] 已写出: {a.json}")

    sys.exit(0 if not dead else 1)


if __name__ == "__main__":
    main()
