/* 双端 e2e 冒烟：起临时中枢 → 断言页面/接口/HAP 内嵌/三件哈希，一条命令确认没打坏。
   用法： node scripts/verify-e2e.js
   退出码 0 全绿；1 有失败项。全程只读，不改包、不发布、不动桌面文件。 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8899 + Math.floor(Math.random() * 60);
const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/manifest.json'), 'utf8'));
const PAGE = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log('  ' + (cond ? '[PASSED] ' : '[FAILED] ') + name + (detail ? ' — ' + detail : ''));
}
const count = (s, re) => (s.match(re) || []).length;

function fetch(p) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: p, headers: { Host: '127.0.0.1:' + PORT } }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    }).on('error', reject);
  });
}
function post(p, obj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(obj);
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

(async function main() {
  console.log('=== 双端 e2e 冒烟（临时端口 ' + PORT + '）===');
  const child = spawn(process.execPath, [path.join(ROOT, 'server/server.js')], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), KH_HOST: '127.0.0.1', KH_DEV_MODE: '1' }), stdio: 'ignore'
  });
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('/'); if (r.code === 200) { up = true; break; } } catch (e) { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!up) { console.log('  中枢未能在 16 秒内启动，后续断言跳过'); child.kill(); process.exit(1); }

  try {
    const home = await fetch('/');
    check('首页 200 且可播放', home.code === 200 && home.body.indexOf('LIVE_CHANNELS') > 0, home.code + ' · ' + home.body.length + ' B');
    const chansBlock = home.body.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/);
    const chans = chansBlock ? count(chansBlock[0], /\{id:/g) : 0;
    const mChans = ((MAN.sources && MAN.sources.channels) || []).length;
    check('频道数与清单一致', chans === mChans, '页面 LIVE_CHANNELS ' + chans + ' / 清单 ' + mChans);
    const pageSites = count(home.body.match(/var BUILTIN_SITES = \[[\s\S]*?\n\];/) ? home.body.match(/var BUILTIN_SITES = \[[\s\S]*?\n\];/)[0] : '', /\{name:/g);
    const mSites = ((MAN.sources && MAN.sources.sites) || []).length;
    check('平台基线与清单一致', pageSites === mSites, '页面 ' + pageSites + ' / 清单 ' + mSites);

    const sites = JSON.parse((await fetch('/api/sites')).body);
    check('/api/sites 返回总数', sites.ok && sites.total === mSites, 'total=' + sites.total);
    const gd = (sites.sites || []).filter((s) => s.cat === '各地广电');
    check('各地广电条目存在且带省份', gd.length >= 50 && gd.every((s) => s.prov && s.tag), gd.length + ' 条');

    const admin = await fetch('/admin/sites');
    check('/admin/sites 管理页', admin.code === 200 && admin.body.indexOf('平台清单管理') > 0, admin.code + ' · ' + admin.body.length + ' B');

    const bogus = await post('/api/sites/update', { url: 'https://nonexist.example.com', patch: { cat: 'x' } });
    const bogusJson = JSON.parse(bogus.body || '{}');
    check('/api/sites/update 拒绝未知条目', bogusJson.ok === false, bogusJson.error || '');

    const man = await fetch('/api/manifest');
    const manJson = JSON.parse(man.body);
    check('/api/manifest 版本对齐', manJson.ok !== false && (manJson.sources ? manJson.sources.v : manJson.v) === MAN.sources.v, 'v' + MAN.sources.v);

    const health = JSON.parse((await fetch('/api/sources/health')).body);
    check('/api/sources/health 可读', typeof health.ready === 'boolean', 'ready=' + health.ready +
      (health.totals ? ' · ' + health.totals.ok + '/' + health.totals.tested : ''));

    // HAP 前端内嵌（只在最近一次出过 HAP 时才有源文件可比）
    const hapPage = path.join(ROOT, 'harmony/entry/src/main/resources/rawfile/www/index.html');
    if (fs.existsSync(hapPage)) {
      const hp = fs.readFileSync(hapPage, 'utf8');
      const m = hp.match(/var BUILTIN_SITES = \[[\s\S]*?\n\];/);
      const n = m ? count(m[0], /\{name:/g) : 0;
      check('HAP 前端已内嵌平台', n === mSites, 'HAP ' + n + ' / 清单 ' + mSites);
    } else {
      check('HAP 前端文件', true, '未出过 HAP，跳过');
    }

    // 三件成品哈希 vs 客户下载说明基线
    const base = path.join(ROOT, '..', '..', '..');
    const dlCandidates = [
      path.join(process.env.USERPROFILE || 'C:/Users/admin', 'Desktop'),
      path.join(ROOT, 'dist')
    ];
    let baseTxt = null;
    /* 先收集所有「交付中心/成品」下的 客户下载说明.txt，再挑与当前版本同名的那一份；
       旧写法按目录遍历顺序取第一份，桌面留着上一版文件夹时会拿到过期的哈希基线。 */
    const foundNotes = [];
    for (const d of dlCandidates) {
      if (!fs.existsSync(d)) continue;
      for (const name of fs.readdirSync(d)) {
        if (name.indexOf('交付中心') < 0 && name.indexOf('成品') < 0) continue;
        const p1 = path.join(d, name, '客户下载说明.txt');
        if (fs.existsSync(p1)) { foundNotes.push(p1); continue; }
        try {
          if (fs.statSync(path.join(d, name)).isDirectory()) {
            for (const sub of fs.readdirSync(path.join(d, name))) {
              const p2 = path.join(d, name, sub, '客户下载说明.txt');
              if (fs.existsSync(p2)) foundNotes.push(p2);
            }
          }
        } catch (e) {}
      }
    }
    const relVerNow = (MAN.release && MAN.release.latest && MAN.release.latest.versionName) || '';
    baseTxt = foundNotes.find((p) => relVerNow && p.indexOf(relVerNow) >= 0) || foundNotes[0] || null;
    if (baseTxt) {
      const txt = fs.readFileSync(baseTxt, 'utf8');
      const expect = {};
      for (const ln of txt.split(/\r?\n/)) {
        const m = ln.match(/^(exe|hap|zip)\s+([0-9a-f]{64})/);
        if (m) expect[m[1]] = m[2];
      }
      const ver = (MAN.release && MAN.release.latest && MAN.release.latest.versionName) || 'unknown';
      const files = {
        exe: path.join(ROOT, 'dist', '鸿汇影桌面版 Setup ' + ver + '.exe'),
        hap: path.join(ROOT, 'dist', 'HongHubMovie.hap'),
        zip: path.join(ROOT, 'dist', '鸿汇影桌面版 Setup ' + ver + '.zip')
      };
      for (const k of ['exe', 'hap', 'zip']) {
        const p = files[k];
        if (!fs.existsSync(p)) { check('成品 ' + k + ' 存在', false, p); continue; }
        const got = sha256(p);
        check('成品 ' + k + ' 哈希对齐基线', !expect[k] || got === expect[k], got.slice(0, 16) + (expect[k] ? '' : '（基线未列，仅记录）'));
      }
    } else {
      check('客户下载说明基线', true, '未找到基线与校验文件，跳过');
    }
  } catch (e) {
    check('冒烟执行', false, e.message);
  } finally {
    child.kill();
  }

  const fails = results.filter((r) => !r.pass);
  console.log('\n=== e2e 结果：' + (results.length - fails.length) + '/' + results.length + ' 通过 ===');
  if (fails.length) { fails.forEach((f) => console.log('  失败：' + f.name + ' — ' + f.detail)); process.exit(1); }
  console.log('  这套检查可随时重跑：npm run verify:e2e');
})();
