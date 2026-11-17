#!/usr/bin/env node
'use strict';
/* 开发者端「一键发布客户端成品 · 免卸载更新」编排

   目标：已安装客户端不卸载、不重装，客户始终能拿到新版本。为此把更新拆成两层：
     A) 内容层（功能清单 / 源清单 / 播放档位）——客户端启动 + 每 10 分钟自动从公网
        /api/manifest、/api/features/sync 拉取，用户零操作、永不重装（主力通道）。
     B) 本体层（exe / HAP）——只有确实需要换安装包时，客户端拉起 NSIS 标准向导做
        「同目录覆盖安装」：不卸载旧版、不清用户数据、不删配置，装完原地升级。

   本脚本只做「发布既有成品 + 刷新内容清单」，严格遵守：
     · 不重新 pack、不重建 HAP、不升 versionCode；
     · 三件成品哈希为不可变基线，任何改动立即中止（防止误重出包导致重装）；
     · 报告显式给出 reinstallRequired=false 与 updateStrategy。

   流程：采集权威成品 → 哈希基线断言 → 组装纯净静态站点 → 部署 → 公网回下验收 → 报告

   用法：
     node scripts/ship-client.js                 # 默认：以桌面客户成品目录为权威源发布
     node scripts/ship-client.js <成品目录>       # 指定权威成品目录
     npm run ship:client                          # 同上（推荐）
     npm run ship:client -- --deep-verify         # 额外做 180MB 全量哈希回下比对
     npm run ship:client -- --no-deploy           # 只组装 + 断言，不触发部署

   站点发布：
     · 配置 KH_DEPLOY_CMD → 真正一键上传；
     · 未配置 → 写 dist/deploy-request.json，如实回报 deploy-pending，绝不谎报已发布。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUB = path.join(DIST, 'public');
const env = require('./lib/env');
env.apply();
const distribute = require('../server/distribute');

const ARGS = process.argv.slice(2);
const DEEP = ARGS.includes('--deep-verify');
const NO_DEPLOY = ARGS.includes('--no-deploy');
const ARG_DIR = ARGS.find((a) => !a.startsWith('--') && /[\\/]/.test(a));
const c = distribute.config();
const Q = c.shareQuery || '';
const steps = [];

function log(s) { console.log(s); }
function record(name, status, detail) {
  steps.push({ name, status, detail: detail || '', at: new Date().toISOString() });
  log('  [' + status.toUpperCase() + '] ' + name + (detail ? ' — ' + detail : ''));
}
function need(cond, msg) { if (!cond) { console.error('已中止：' + msg); process.exit(1); } }
function jread(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
function sha(p) {
  const h = crypto.createHash('sha256'), fd = fs.openSync(p, 'r'), buf = Buffer.allocUnsafe(1 << 20);
  let n;
  try { while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function copyIf(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}
function asset(relPath) { return c.baseUrl + '/' + relPath + Q; }
function fetchBuf(url, timeoutMs) {
  return new Promise((resolve) => {
    const lib = url.indexOf('https:') === 0 ? https : http;
    const r = lib.get(url, { timeout: timeoutMs || 20000 }, (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    r.on('timeout', () => { r.destroy(); resolve(null); });
    r.on('error', () => resolve(null));
  });
}
function probe(url) {
  return new Promise((resolve) => {
    const lib = url.indexOf('https:') === 0 ? https : http;
    const r = lib.request(url, { method: 'GET', timeout: 15000, headers: { Range: 'bytes=0-63' } }, (res) => {
      let n = 0; res.on('data', (d) => { n += d.length; }); res.on('end', () => resolve({ code: res.statusCode, len: n }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ code: 0, len: 0 }); });
    r.on('error', () => resolve({ code: 0, len: 0 }));
    r.end();
  });
}

// 从客户说明文本解析不可变基线（版本 / 版本码 / 三件成品哈希）
function parseBaseline(notePath) {
  const txt = fs.readFileSync(notePath, 'utf8');
  const vm = txt.match(/v(\d+\.\d+\.\d+)\s*\/\s*#(\d+)/);
  const hashes = {};
  let m;
  // 旧格式：行首 exe/hap/zip + 哈希
  const re = /^(exe|hap|zip)\s+([0-9a-f]{64})/gim;
  while ((m = re.exec(txt))) hashes[m[1].toLowerCase()] = m[2].toLowerCase();
  // 新格式（v1.7.30 起）：文件名行 + 字节数 + 哈希行（可能无空行分隔），从文件名往后 5 行内找哈希
  if (!hashes.exe || !hashes.hap || !hashes.zip) {
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      let kind = null;
      if (/\.exe\b/i.test(lines[i])) kind = 'exe';
      else if (/\.hap\b/i.test(lines[i])) kind = 'hap';
      else if (/\.zip\b/i.test(lines[i])) kind = 'zip';
      if (!kind || hashes[kind]) continue;
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const hm = lines[j].match(/\b([0-9a-f]{64})\b/i);
        if (hm) { hashes[kind] = hm[1].toLowerCase(); break; }
      }
    }
  }
  if (!vm || !hashes.exe || !hashes.hap || !hashes.zip) return null;
  return { versionName: vm[1], versionCode: Number(vm[2]), hashes };
}

(async () => {
  log('鸿汇影 · 一键发布客户端成品（免卸载更新）');
  log('  策略：内容层自动热更新 + 本体层同目录覆盖安装；不重新出包、不改哈希、不升版本码');
  need(c.enabled, '公网端点未配置（server/public-endpoint.json / KH_PUBLIC_BASE_URL）');

  // 版本一致性门禁：真相源 manifest.release.latest 与全端 9 处版本字段必须一致，
  // 否则客户端版本判断会错乱（旧版误报更新 / 新版不报更新）。不一致先 npm run version:sync。
  const vchk = spawnSync(process.execPath, [path.join(__dirname, 'version.js'), '--check'],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  if (vchk.status !== 0) {
    log(String(vchk.stdout || '').trim());
    need(false, '版本一致性检查未通过，请先运行 npm run version:sync 对齐全部版本字段');
  }
  record('版本一致性门禁', 'passed', '9 处版本字段全部对齐（version.js --check）');

  // ---- 1) 定位权威成品目录 ----
  // 版本不再写死：以 server/manifest.json 的本次发版为准，桌面文件夹改名/换版本都不会失联。
  const rel = jread(path.join(ROOT, 'server', 'manifest.json'), {}).release || {};
  const LATEST = rel.latest || {};
  const relVer = String(LATEST.versionName || '');
  const relCode = Number(LATEST.versionCode || 0);
  need(relVer && relCode, 'server/manifest.json 缺少本次发版版本（请先 npm run release）');
  const DESKTOP = path.join(os.homedir(), 'Desktop');
  const ART = ARG_DIR ? path.resolve(ARG_DIR)
    : (function () {
        const NAME = /客户成品_v/;
        const found = [];
        const scan = (dir) => {
          try {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
              if (e.isDirectory() && NAME.test(e.name) && !/开发端/.test(e.name)) found.push(path.join(dir, e.name));
            }
          } catch (e) {}
        };
        scan(DESKTOP);
        try {
          for (const e of fs.readdirSync(DESKTOP, { withFileTypes: true })) {
            if (e.isDirectory()) scan(path.join(DESKTOP, e.name));
          }
        } catch (e) {}
        const uniq = Array.from(new Set(found)).sort();
        // 优先本次版本的成品目录；没有则退回最新一个（哈希基线断言会兜住其余风险）
        const exact = uniq.filter((p) => p.indexOf('客户成品_v' + relVer) >= 0);
        if (exact.length) return exact[exact.length - 1];
        if (uniq.length) return uniq[uniq.length - 1];
        return path.join(DESKTOP, '鸿汇影·客户成品_v' + relVer);
      })();
  need(fs.existsSync(ART), '未找到权威成品目录：' + ART);
  // 防呆：只接受客户成品目录，绝不把开发端专用包发布上线
  need(/客户成品/.test(path.basename(ART)) && !/开发端/.test(ART),
       '发布源必须是「鸿汇影·客户成品_v*」，开发端专用包禁止上传公网');
  // 深度防呆：目录里只要出现开发端专属物（源码 / 签名密钥 / 内部工程），一律中止，
  // 保证下发通道里出现的每个文件都是客户能直接拿去用的成品。
  const DEV_ONLY = /(^|[\\/])(开发者端|开发端|dev|dist|server|scripts|resources|harmony|node_modules|signing|sign-keys|签名密钥|\.git)([\\/]|$)|\.p12$|\.p7b$|\.pem$|\.cer$|package\.json$|electron-main\.js$|\.js$|\.py$|\.cjs$|\.bak$|\.log$/i;
  const offenders = [];
  const scanDev = (dir, depth) => {
    if (depth > 6 || offenders.length > 20) return;
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      const p = path.join(dir, e.name);
      if (DEV_ONLY.test(e.name) || DEV_ONLY.test(p)) { offenders.push(path.relative(ART, p)); continue; }
      if (e.isDirectory()) scanDev(p, depth + 1);
    }
  };
  scanDev(ART, 0);
  need(!offenders.length, '客户成品目录混入开发端文件（下发通道只发客户成品）：' + offenders.slice(0, 8).join(' / '));
  const notePath = path.join(ART, '客户下载说明.txt');
  const pick = (re, fallback) => {
    let hits = [];
    try { hits = fs.readdirSync(ART).filter((n) => re.test(n)); } catch (e) {}
    hits = hits.sort();
    return path.join(ART, hits.length ? hits[hits.length - 1] : fallback);
  };
  const artifacts = {
    exe: pick(/^鸿汇影桌面版 Setup .*\.exe$/i, '鸿汇影桌面版 Setup ' + relVer + '.exe'),
    hap: pick(/^HongHubMovie\.hap$/i, 'HongHubMovie.hap'),
    zip: pick(/^鸿汇影桌面版 Setup .*\.zip$/i, '鸿汇影桌面版 Setup ' + relVer + '.zip')
  };
  record('定位权威成品目录', 'passed', ART + ' · 目标版本 v' + relVer + ' / #' + relCode);
  need(fs.existsSync(notePath), '缺少客户下载说明.txt（基线来源）');

  // ---- 2) 哈希基线断言 ----
  const base = parseBaseline(notePath);
  need(base, '客户下载说明.txt 未解析出版本与三件成品哈希基线');
  const measured = {};
  for (const k of ['exe', 'hap', 'zip']) {
    need(fs.existsSync(artifacts[k]), '缺少成品：' + artifacts[k]);
    measured[k] = { sha: sha(artifacts[k]), size: fs.statSync(artifacts[k]).size };
    const ok = measured[k].sha === base.hashes[k];
    need(ok, k + ' 哈希与基线不符（实测 ' + measured[k].sha.slice(0, 12) + '… / 基线 ' +
      base.hashes[k].slice(0, 12) + '…）——成品被改动，拒绝以「免重装」名义发布');
  }
  const V = base.versionName, CODE = base.versionCode;
  const prefix = 'honghub/v' + V;
  record('哈希基线断言', 'passed', 'v' + V + ' / #' + CODE + ' · exe/hap/zip 三件实测与说明基线一致');

  // ---- 3) 组装纯净静态站点（只含客户可见成品，不含源码/报告/密钥） ----
  fs.mkdirSync(PUB, { recursive: true });
  const exeDst = path.join(PUB, prefix, 'desktop-setup.exe');
  const hapDst = path.join(PUB, prefix, 'HongHubMovie.hap');
  const binDst = path.join(PUB, prefix, 'honghub-desktop-' + V + '-win.bin');
  copyIf(artifacts.exe, exeDst);
  copyIf(artifacts.hap, hapDst);
  copyIf(artifacts.zip, binDst);   // .bin 别名：站点 WAF 拦截 .zip 直链
  record('组装站点成品', 'passed', prefix + '/ 下 desktop-setup.exe + HongHubMovie.hap + win.bin（zip 别名）');

  // 下载页：每次按当前发版版本与实测哈希重新生成，避免旧页残留导致版本/链接失真
  const idxDst = path.join(PUB, 'index.html');
  const fmtSize = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const pubDate = new Date().toISOString().slice(0, 10);
  const idxHtml = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>鸿汇影 · 客户下载中心</title><style>',
    ':root{color-scheme:dark}*{box-sizing:border-box}',
    'body{margin:0;font-family:-apple-system,"Microsoft YaHei","Segoe UI",sans-serif;background:#0e1116;color:#e6ebf2;line-height:1.7}',
    '.wrap{max-width:880px;margin:0 auto;padding:48px 20px 72px}h1{font-size:26px;margin:0 0 6px}',
    '.sub{color:#8b97a8;font-size:14px;margin-bottom:28px}',
    '.badge{display:inline-block;padding:2px 10px;border:1px solid #2c3a4d;border-radius:999px;font-size:12px;color:#7fd3a8;margin-left:8px;vertical-align:middle}',
    '.card{background:#151b24;border:1px solid #22303f;border-radius:14px;padding:18px 20px;margin:14px 0}',
    '.card h2{font-size:16px;margin:0 0 4px}.card p{margin:4px 0;color:#8b97a8;font-size:13px}',
    '.btn{display:inline-block;margin-top:10px;padding:10px 18px;background:#2f6fed;color:#fff;text-decoration:none;border-radius:10px;font-size:14px}',
    '.meta{font-size:12px;color:#6d7a8c;word-break:break-all;margin-top:8px}',
    'h3{font-size:15px;margin:32px 0 8px;color:#cfe0f5}ul{color:#9aa7b8;font-size:13px;padding-left:20px}ul li{margin:5px 0}a{color:#6fa8ff}',
    '</style></head><body><div class="wrap">',
    '<h1>鸿汇影 · 客户下载中心<span class="badge">v' + V + '</span></h1>',
    '<div class="sub">' + pubDate + ' 发布 · 版本号 ' + V + ' / #' + CODE + ' · 覆盖升级不需要先卸载</div>',
    // 上传入口：公网静态站无后端，按钮展开操作指引，引导到本机开发端运维台执行真实上传
    '<div class="card"><h2>📤 上传成品（开发端）</h2>',
    '<p>对外下载页只读；上传新成品请在本机开发端运维台操作，需访问口令，不暴露到公网。</p>',
    '<button class="btn" type="button" id="uploadHelpBtn">📤 上传成品</button>',
    '<div id="uploadHelp" style="display:none;margin-top:10px;padding:12px;background:#10161f;border:1px solid #2c3a4d;border-radius:10px;font-size:13px;color:#b9c6d8">',
    '<div style="margin-bottom:6px">1. 本机启动开发端：<code>npm start</code>（默认 <a href="http://127.0.0.1:8787/admin">http://127.0.0.1:8787/admin</code>）</div>',
    '<div style="margin-bottom:6px">2. 在「🛠️ 开发者端运维」点 <b>📤 发布并校验</b>，走上传通道并回读校验 SHA256。</div>',
    '<div>3. 命令行等价：<code>npm run ship:client</code>（发布成功后本页自动更新）。</div>',
    '</div></div>',
    '<div class="card"><h2>Windows 安装版</h2>',
    '<p>双击安装，装完桌面有快捷方式。已装旧版直接覆盖安装即可，收藏与登录状态保留。</p>',
    '<p>体积 ' + fmtSize(measured.exe.size) + ' B</p>',
    '<a class="btn" href="' + asset(prefix + '/desktop-setup.exe') + '">下载 Setup ' + V + '.exe</a>',
    '<div class="meta">sha256 ' + measured.exe.sha + '</div></div>',
    '<div class="card"><h2>Windows 免安装版</h2>',
    '<p>解压即用，不写注册表、不占系统目录；适合放 U 盘或临时机器。</p>',
    '<p>体积 ' + fmtSize(measured.zip.size) + ' B · 后缀是 .bin，下载后改成 .zip 再解压</p>',
    '<a class="btn" href="' + asset(prefix + '/honghub-desktop-' + V + '-win.bin') + '">下载免安装包</a>',
    '<div class="meta">sha256 ' + measured.zip.sha + '</div></div>',
    '<div class="card"><h2>深开鸿 / 鸿蒙 HAP</h2>',
    '<p>走 hdc 安装，与旧包同证书，可覆盖安装，不需要先卸载。</p>',
    '<p>体积 ' + fmtSize(measured.hap.size) + ' B</p>',
    '<a class="btn" href="' + asset(prefix + '/HongHubMovie.hap') + '">下载 HongHubMovie.hap</a>',
    '<div class="meta">sha256 ' + measured.hap.sha + '</div></div>',
    '<h3>这一版改了什么</h3><ul>',
    '<li>客户端与深开鸿 HAP 前端同源，功能与页面随公网清单自动热更新，已装用户刷新即生效。</li>',
    '<li>本体更新走同目录覆盖安装，不卸载、不删用户数据。</li>',
    '<li>更新清单支持多源探测，主源失败自动回退，全挂时保留上一次缓存。</li>',
    '</ul><h3>装机提示</h3><ul>',
    '<li>Windows 提示「已保护你的电脑」：点「更多信息」→「仍要运行」。</li>',
    '<li>HAP 安装前确认设备已开「开发者模式」和 USB 调试，命令：hdc install -r HongHubMovie.hap。</li>',
    '<li>更新清单：<a href="' + asset('remote-manifest.json') + '">remote-manifest.json</a></li>',
    '</ul></div>',
    '<script>',
    'document.getElementById("uploadHelpBtn").addEventListener("click",function(){',
    'var b=document.getElementById("uploadHelp");b.style.display=b.style.display==="none"?"block":"none";});',
    '</script></body></html>'
  ].join('\n');
  fs.writeFileSync(idxDst, idxHtml);
  record('生成客户下载页', 'passed', 'v' + V + ' / #' + CODE + ' · 三件链接带访问码，体积与哈希取实测值');

  // 客户可用应用页面：随公网下发，已装客户端按 SHA256 校验后热更新（免重打包）
  const pageSrc = path.join(ROOT, 'app', 'index.html');
  const pageBuf = fs.readFileSync(pageSrc);
  const pageHash = crypto.createHash('sha256').update(pageBuf).digest('hex');
  fs.writeFileSync(path.join(PUB, 'app-page.html'), pageBuf);
  record('生成客户应用页面', 'passed', 'app-page.html · ' + pageBuf.length + ' B / ' + pageHash.slice(0, 12) + '…');

  // 公网清单：结构与现网一致，哈希/体积/URL 以本地实测成品为准
  const manifest = {
    schema: 1, versionName: V, versionCode: CODE,
    publishedAt: new Date().toISOString(),
    baseUrl: c.baseUrl, shareQuery: Q || null,
    distribution: 'workbuddy-sites',
    desktopUrl: asset(prefix + '/desktop-setup.exe'),
    hapUrl: asset(prefix + '/HongHubMovie.hap'),
    desktopSha256: measured.exe.sha, hapSha256: measured.hap.sha,
    desktopSize: measured.exe.size, hapSize: measured.hap.size,
    zipUrl: asset(prefix + '/honghub-desktop-' + V + '-win.bin'),
    zipSha256: measured.zip.sha, zipSize: measured.zip.size,
    pageUrl: asset('app-page.html'), pageHash: pageHash, pageSize: pageBuf.length,
    zipAliasNote: '内容等同 zip 包；下载后把后缀改为 .zip 再解压（站点对 .zip 直链有 WAF 拦截，故用 .bin 别名分发）',
    // 免卸载更新策略：随清单下发，客户端可据此选择内容通道而非提示重装
    updateStrategy: {
      contentAutoUpdate: true,          // 功能 / 源清单 / 播放档位自动热更新
      reinstallRequired: false,         // 关键：更新不需要卸载重装
      inPlaceOverlayInstall: true,      // 本体更新走同目录覆盖安装
      preserveUserData: true,           // 覆盖安装不清用户数据
      channels: ['content-hot-update', 'nsis-in-place-overlay']
    }
  };
  fs.writeFileSync(path.join(PUB, 'remote-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  record('生成公网更新清单', 'passed', 'remote-manifest.json · reinstallRequired=false 已随清单下发');

  // 客户站点只保留「客户可直接下载安装的成品」：下载页 + 更新清单 + 三件成品，共 6 个文件（含客户可用应用页面 app-page.html）。
  // 开发端内部资料（回滚索引 / 下发通道清单 / OS 适配矩阵 / 架构清单 / 报告 / 源码等）
  // 一律不上传；若发布目录留有历史残留，移动到 dist/_public_internal/ 留档（不删除、可回滚）。
  const ALLOW = new Set([
    'index.html', 'remote-manifest.json', 'app-page.html',
    prefix + '/desktop-setup.exe',
    prefix + '/HongHubMovie.hap',
    prefix + '/honghub-desktop-' + V + '-win.bin'
  ]);
  const stash = path.join(DIST, '_public_internal');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((acc, e) => {
    const p = path.join(dir, e.name);
    return acc.concat(e.isDirectory() ? walk(p) : [p]);
  }, []);
  let stashed = 0;
  for (const f of walk(PUB)) {
    const rel = path.relative(PUB, f).split(path.sep).join('/');
    if (ALLOW.has(rel)) continue;
    const to = path.join(stash, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f, to);
    fs.unlinkSync(f);
    stashed++;
  }
  // 清理因移出文件留下的空目录（releases/ 等）
  const prune = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const p = path.join(dir, e.name);
        prune(p);
        if (!fs.readdirSync(p).length) fs.rmdirSync(p);
      }
    }
  };
  prune(PUB);
  record('组装纯净站点', 'passed',
    'dist/public/ 仅 5 个客户成品文件（下载页 + 更新清单 + exe/hap/zip）；内部资料移出 ' + stashed + ' 件');

  // ---- 4) 部署 ----
  let deployStatus = 'pending';
  if (NO_DEPLOY) {
    deployStatus = 'skipped';
    record('站点发布', 'skipped', '显式 --no-deploy');
  } else {
    const cmd = process.env.KH_DEPLOY_CMD;
    if (cmd) {
      const ENV = Object.assign({}, process.env);
      const r = spawnSync(cmd, { cwd: ROOT, shell: true, stdio: 'inherit', env: ENV, timeout: 1800000 });
      deployStatus = r.status === 0 ? 'deployed' : 'failed';
      record('站点发布（KH_DEPLOY_CMD）', deployStatus === 'deployed' ? 'passed' : 'failed', 'exit=' + r.status);
      if (r.status !== 0) process.exit(r.status || 1);
    } else {
      const req = {
        appName: '鸿汇影频道下发', directory: PUB, entryHtml: 'index.html', language: 'static',
        domainPrefix: 'honghub-delivery', baseUrl: c.baseUrl, shareQuery: Q, version: V,
        note: '由宿主站点发布能力执行 dist/public/；完成后重跑本命令做公网回下验收。'
      };
      fs.writeFileSync(path.join(DIST, 'deploy-request.json'), JSON.stringify(req, null, 2) + '\n');
      record('站点发布', 'pending', '未配置 KH_DEPLOY_CMD，已写 dist/deploy-request.json，待宿主发布');
    }
  }

  // ---- 5) 公网回下验收 ----
  let verify = { status: 'not-run' };
  if (deployStatus === 'deployed' || deployStatus === 'pending') {
    const targets = [
      ['manifest', asset('remote-manifest.json')],
      ['exe', manifest.desktopUrl], ['hap', manifest.hapUrl], ['zip(.bin)', manifest.zipUrl]
    ];
    const reach = {};
    for (const [k, u] of targets) reach[k] = await probe(u);
    const reachable = Object.keys(reach).every((k) => reach[k].code === 200 || reach[k].code === 206);
    if (!reachable) {
      verify = { status: 'unreachable', reach };
      record('公网回下验收', 'warn', '部分资源未就绪：' + JSON.stringify(reach));
    } else {
      // 清单内容比对：版本 + 三件哈希必须一致
      const liveBuf = await fetchBuf(asset('remote-manifest.json'), 20000);
      let live = null; try { live = liveBuf ? JSON.parse(liveBuf.toString('utf8')) : null; } catch (e) {}
      const manifestOk = live && Number(live.versionCode) === CODE &&
        live.desktopSha256 === measured.exe.sha && live.hapSha256 === measured.hap.sha &&
        live.zipSha256 === measured.zip.sha;
      if (!manifestOk) {
        verify = { status: 'manifest-mismatch', reach };
        record('公网回下验收', 'warn', '清单版本或哈希与本地成品不一致：请先重新发布 dist/public/');
      } else {
        let deep = null;
        if (DEEP) {
          deep = {};
          for (const [k, u] of [['exe', manifest.desktopUrl], ['hap', manifest.hapUrl], ['zip', manifest.zipUrl]]) {
            const b = await fetchBuf(u, 180000);
            deep[k] = b ? (crypto.createHash('sha256').update(b).digest('hex') === measured[k].sha ? 'SAME' : 'DIFF') : 'FETCH-FAIL';
          }
          record('公网全量哈希回下', Object.values(deep).every((x) => x === 'SAME') ? 'passed' : 'warn', JSON.stringify(deep));
        }
        verify = { status: 'ok', reach, manifestOk: true, deep };
        record('公网回下验收', 'passed', '清单版本 + 三件成品哈希与本地权威成品一致' +
          (deep ? ' · 全量回下 ' + JSON.stringify(deep) : '（Range 探测；加 --deep-verify 做全量）'));
      }
    }
  }

  // ---- 6) 报告 ----
  const out = {
    schema: 1, at: new Date().toISOString(), versionName: V, versionCode: CODE,
    deploy: deployStatus, verify: verify.status,
    // 核心结论：客户已安装客户端无需卸载 / 重装
    reinstallRequired: false,
    updateStrategy: {
      contentAutoUpdate: true, inPlaceOverlayInstall: true, preserveUserData: true,
      note: '内容（功能/源清单/播放档位）自动热更新；本体仅在需要时用 NSIS 同目录覆盖安装，不卸载、不删数据。'
    },
    artifacts: {
      exe: { sha256: measured.exe.sha, size: measured.exe.size },
      hap: { sha256: measured.hap.sha, size: measured.hap.size },
      zip: { sha256: measured.zip.sha, size: measured.zip.size }
    },
    publicUrl: c.baseUrl + (Q ? '/' + Q : ''), steps
  };
  fs.writeFileSync(path.join(DIST, 'ship-client.json'), JSON.stringify(out, null, 2) + '\n');
  log('\n=== ship-client 报告 ===');
  log('  版本 ' + V + ' / #' + CODE + ' · 部署 ' + deployStatus + ' · 验收 ' + verify.status);
  log('  reinstallRequired = false（免卸载更新）');
  log('  报告 ' + path.join(DIST, 'ship-client.json'));
  if (deployStatus === 'pending') log('\n  站点发布待执行：发布 dist/public/ 后重跑 npm run ship:client 完成验收。');
})().catch((e) => {
  console.error('\nship-client 失败：' + (e && e.message || e));
  try {
    fs.writeFileSync(path.join(DIST, 'ship-client.json'), JSON.stringify({
      schema: 1, at: new Date().toISOString(), status: 'failed',
      error: String(e && e.message || e), steps
    }, null, 2) + '\n');
  } catch (e2) {}
  process.exit(1);
});
