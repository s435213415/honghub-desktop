#!/usr/bin/env node
'use strict';
/* 1.7.108 商店纯净门禁：扫描 store 免安装 zip，断言包内无任何在线内容入口。
   用法：node scripts/check-store-purity.js [zip路径]
   默认取 dist/client/鸿汇影免安装 <ver>-store.zip。退出码 0=纯净，1=有残留。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const SEVEN = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const zip = process.argv[2] || path.join(ROOT, 'dist', 'client', '鸿汇影免安装 ' + VER + '-store.zip');
if (!fs.existsSync(zip)) { console.error('[store-purity] 包不存在：' + zip); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khpure-'));
const r = spawnSync(SEVEN, ['x', '-y', '-o' + tmp, zip, '*/resources/app/app/*', '-r'], { stdio: 'ignore' });
if (r.status !== 0) { console.error('[store-purity] 解压失败'); process.exit(1); }
// 定位 app 目录
function findApp(dir) {
  const hit = path.join(dir, 'resources', 'app', 'app');
  if (fs.existsSync(hit)) return hit;
  for (const e of fs.readdirSync(dir)) { const p = path.join(dir, e); if (fs.statSync(p).isDirectory()) { const f = findApp(p); if (f) return f; } }
  return null;
}
const app = findApp(tmp);
if (!app) { console.error('[store-purity] 包内未找到 app 目录'); process.exit(1); }
const read = (n) => { const p = path.join(app, n); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const idx = read('index.html');
const cfg = read('kh-config.js');
const core = read('kh-core.js');
const appjs = read('kh-app.js');
const srcjs = read('kh-src.js');
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  [PASS] ' : '  [FAIL] ') + msg); if (!cond) fail++; };
console.log('[store-purity] ' + path.basename(zip));
// 全包不得含开发端嵌套 dist / 运维面板 / dev 自更新（防 stray 打包）
const lst = spawnSync(SEVEN, ['l', zip], { encoding: 'utf8' }).stdout || '';
let stray = 0;
for (const line of lst.split(/\r?\n/)) {
  if (/resources[\\/]app[\\/]dist[\\/]/.test(line) || /resources[\\/]app[\\/]server[\\/]admin/.test(line) || /dev-auto-update\.js\s*$/.test(line)) stray++;
}
ok(stray === 0, '无开发端嵌套 dist/运维面板/dev 自更新（stray=' + stray + '）');
ok(idx.includes('window.KH_STORE=true'), 'index.html 注入 KH_STORE 旗标');
const m = idx.match(/<script id="kh-sources" type="application\/json">([\s\S]*?)<\/script>/);
let srcEmpty = false;
if (m) { try { const j = JSON.parse(m[1]); srcEmpty = (!j.sites || !j.sites.length) && (!j.channels || !j.channels.length); } catch (e) {} }
ok(srcEmpty, 'kh-sources 预置 JSON 为空');
ok(!/src="kh-src\.js"/.test(idx), 'index.html 不引用 kh-src.js');
ok(!/isApiSite\s*[:=]\s*function|api\?ac=videolist/.test(srcjs), 'kh-src.js 解析器已剔除');
const blob = idx + cfg + core + appjs;
ok(!/trycloudflare\.com/.test(blob), '无 trycloudflare 隧道域名');
ok(!/api\.php\/provide\/vod/.test(blob), '无采集接口 api.php/provide/vod');
ok(!/guangsuapi|huyaapi|taopianapi|hhzyapi|lzizy|apibdzy|tyyszy|ffzy\.tv|jszyapi/.test(blob), '无内置采集站域名');
ok(!/afhgrj|sizhengxt|tfznaz|jianwuye5|irrmj\.cc/.test(blob), '无内置影视网站域名');
ok(/if\(window\.KH_STORE\) return \[\]/.test(cfg), 'getWhList 商店闸在位');
ok(/if\(window\.KH_STORE\) return;/.test(cfg), 'khSeedBuiltin 商店闸在位');
ok(/window\.KH_STORE \? \(c\.enabled === true/.test(cfg), '上报商店默认关（仅本地模式强制关）');
ok(/KH_LIMITED/.test(core) && /limited:true/.test(core), '隐私闸允许「仅本地使用」而非强制同意');
ok(/KH_STORE/.test(core) && /khStoreHomeHtml/.test(core), 'kh-core 商店首页在位');
ok(/window\.KH_STORE && \(key==='live'/.test(appjs), '导航商店隐藏入口在位');
ok(/khStorePrivacyGate/.test(core) && /KH_PRIVACY_KEY/.test(core), '首启隐私同意闸在位');
ok(/store-privacy/.test(appjs), '隐私与权限复查入口在位');
ok(/if\(window\.KH_STORE\)\{ try\{ toast\('商店版由应用市场统一更新'\)/.test(appjs), '自更新商店闸在位');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? '[store-purity] 不纯净：' + fail + ' 项残留' : '[store-purity] 纯净 ✔');
process.exit(fail ? 1 : 0);