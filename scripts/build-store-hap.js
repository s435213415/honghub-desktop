#!/usr/bin/env node
'use strict';
/* 1.7.108 商店纯净 HAP：同步 app→harmony www → store 二次净化 → 复用现有证书重签 → 产出 -store HAP。
   注意：当前用工程自签证书（keys/），上架深开鸿需换「开鸿发布签名」后重跑本脚本。
   用法：node scripts/build-store-hap.js   （需 OH_KEY_PWD 或 .env；KH_HAP_ALLOW_STALE=1） */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const WWW = path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www');
const DIST = path.join(ROOT, 'dist');
const PY = process.env.KH_PYTHON || 'C:\\Users\\admin\\HongHubServer\\runtime\\python\\python.exe';
const log = (...a) => console.log(...a);
if (!fs.existsSync(WWW)) { console.error('www 目录不存在'); process.exit(1); }

// 1) 同步 app 前端到 www（与私发同一份源码）
const files = fs.readdirSync(APP).filter((f) => f === 'index.html' || /^kh-.*\.js$/.test(f));
const baks = [];
for (const f of files) {
  const dst = path.join(WWW, f);
  baks.push({ f, buf: fs.existsSync(dst) ? fs.readFileSync(dst) : null });
  fs.copyFileSync(path.join(APP, f), dst);
}
log('[1/3] 已同步 app→www ' + files.length + ' 个文件');

// 2) store 净化（与 build-client-exe 的 store 段同口径）
try {
  const idxPath = path.join(WWW, 'index.html');
  let pg = fs.readFileSync(idxPath, 'utf8');
  pg = pg.replace(/(<script id="kh-sources" type="application\/json">)[\s\S]*?(<\/script>)/,
    '$1{"v":0,"updatedAt":"","count":0,"sites":[],"channels":[],"parses":[]}$2');
  pg = pg.replace(/<script[^>]*src="kh-src\.js"[^>]*>\s*<\/script>/, '');
  pg = pg.replace('<script src="kh-hap-bridge.js"></script>',
    '<script>window.KH_STORE=true;</script>\n<script src="kh-hap-bridge.js"></script>');
  if (!pg.includes('window.KH_STORE=true')) throw new Error('store 旗标注入失败');
  fs.writeFileSync(idxPath, pg);
  const srcJs = path.join(WWW, 'kh-src.js');
  if (fs.existsSync(srcJs)) fs.writeFileSync(srcJs, '/* store: 影视仓解析器已剔除 */\n');
  const cfgPath = path.join(WWW, 'kh-config.js');
  let cf = fs.readFileSync(cfgPath, 'utf8');
  for (const name of ['BUILTIN_SITES', 'SEED_SITES', 'SEED_WH_APIS', 'LIVE_CHANNELS'])
    cf = cf.replace(new RegExp('var ' + name + ' = \\[[\\s\\S]*?\\];'), 'var ' + name + ' = [];');
  fs.writeFileSync(cfgPath, cf);
  for (const f of files) {
    const p = path.join(WWW, f);
    let t = fs.readFileSync(p, 'utf8');
    const b = t;
    t = t.replace(/api\.php\/provide\/vod/g, '（接口示例已移除）').replace(/api\?ac=videolist/g, '（接口示例已移除）');
    if (t !== b) fs.writeFileSync(p, t);
  }
  log('[2/3] www store 净化完成');

  // 3) 用 store 变体重签：resign_hap.py 走独立 bundle com.honghub.store，
  //    直接产出 -store 产物名与 .hap-build-store.json，绝不覆盖私发 client 产物。
  const env = Object.assign({}, process.env, { KH_HAP_ALLOW_STALE: '1', KH_HAP_VARIANT: 'store' });
  const rs = spawnSync(PY, [path.join(ROOT, 'harmony', 'signing', 'resign_hap.py')], { cwd: ROOT, env, stdio: 'inherit' });
  if (rs.status !== 0) throw new Error('resign_hap.py exit=' + rs.status);
  for (const n of ['honghub-harmony-store.hap', 'HongHubMovie-store.hap']) {
    const p = path.join(DIST, n);
    if (fs.existsSync(p)) log('[3/3] store HAP: ' + n + ' · ' + fs.statSync(p).size + ' B');
  }
  log('提示：当前为工程自签（bundle com.honghub.store）；上架深开鸿前换开鸿发布签名后重跑本脚本。');
} finally {
  // 还原 www 为私发源码，避免污染下一次私发 HAP
  for (const b of baks) {
    const dst = path.join(WWW, b.f);
    if (b.buf) fs.writeFileSync(dst, b.buf); else { try { fs.unlinkSync(dst); } catch (e) {} }
  }
  log('[恢复] www 已还原为私发前端');
}