#!/usr/bin/env node
/* 装机与卸载残留自检（分发前 6 项 · 第 6 项的可执行版）
   只读扫描，不删任何东西。用法：
     node scripts\release\check-install-clean.js --snapshot before
     （装/用/卸之后）node scripts\release\check-install-clean.js --snapshot after
     node scripts\release\check-install-clean.js --diff before after
   判定：after 相对 before 只多出「卸载后不该留」的东西 → 列出并退出 1；否则退出 0。
   扫描范围：两处 AppData、开始菜单、桌面（当前用户 + 公共）、Program Files 安装目录、注册表卸载项。
   机器上没有装过本应用时，before/after 都为空，diff 结果为「干净」，这也是有效结论。*/
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', '..', 'logs');
const NEEDLES = ['鸿汇影', 'HongHub', 'honghub'];
const APP_KEYS = ['HongHub-Desktop', 'honghub-desktop', '鸿汇影'];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function hit(s) {
  const t = String(s || '');
  return NEEDLES.some((n) => t.indexOf(n) >= 0);
}
function listDir(dir, depth, acc, maxDepth) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (hit(e.name)) { acc.push(full); continue; }
    if (e.isDirectory() && depth < maxDepth) listDir(full, depth + 1, acc, maxDepth);
  }
}

function scan() {
  const res = { at: new Date().toISOString(), host: os.hostname(), dirs: [], appdata: [], shortcuts: [], install: [], reg: [] };

  /* 1) 两处 AppData：用户数据目录存在即为「未清理」的证据 */
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (!base) continue;
    for (const k of APP_KEYS) {
      const p = path.join(base, k);
      if (fs.existsSync(p)) res.appdata.push(p);
    }
    try {
      for (const e of fs.readdirSync(base, { withFileTypes: true })) if (hit(e.name)) res.appdata.push(path.join(base, e.name));
    } catch (e) {}
  }

  /* 2) 开始菜单 + 桌面（当前用户与公共） */
  const menus = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ];
  for (const m of menus) if (m && fs.existsSync(m)) listDir(m, 0, res.shortcuts, 3);
  const desktops = [path.join(os.homedir(), 'Desktop'), path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
  for (const d of desktops) if (fs.existsSync(d)) for (const e of fs.readdirSync(d)) if (hit(e)) res.shortcuts.push(path.join(d, e));

  /* 3) Program Files 下的安装目录 */
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (!base || !fs.existsSync(base)) continue;
    try { for (const e of fs.readdirSync(base, { withFileTypes: true })) if (hit(e.name)) res.install.push(path.join(base, e.name)); } catch (e2) {}
  }

  const regRoots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ];
  /* 4) 注册表卸载项（HKCU/HKLM，只读 query）
     注意：本机实测 PATH 里没有 reg.exe，直接写 'reg' 会 ENOENT 被 catch 吞掉，
     结果是「注册表永远是 0 项」的假通过，必须用绝对路径。*/
  const REG = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const regBin = fs.existsSync(REG) ? REG : 'reg';
  const regFail = [];
  for (const r of regRoots) {
    for (const needle of ['鸿汇影', 'HongHub']) {
      try {
        const out = execFileSync(regBin, ['query', r, '/s', '/f', needle], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        for (const line of out.split(/\r?\n/)) if (/^HKEY_/.test(line.trim())) res.reg.push(line.trim());
      } catch (e) {
        /* reg query 找不到时返回 1，属正常空结果；只有连 reg.exe 都起不来才算失败 */
        if (e && (e.code === 'ENOENT' || e.code === 'EACCES')) regFail.push(needle + '@' + r + '：' + e.code);
      }
    }
  }
  if (regFail.length) res.regError = regFail;
  res.reg = Array.from(new Set(res.reg));
  for (const k of ['dirs', 'appdata', 'shortcuts', 'install', 'reg']) res[k] = Array.from(new Set(res[k]));
  res.counts = { appdata: res.appdata.length, shortcuts: res.shortcuts.length, install: res.install.length, reg: res.reg.length };
  return res;
}

function load(label) {
  const p = path.join(OUT, 'install-snapshot-' + label + '.json');
  if (!fs.existsSync(p)) { console.error('找不到快照：' + p); process.exit(2); }
  return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
}

/* 判定口径（别把「我自己的产物」当成安装残留）：
   1) 用户数据目录（%APPDATA% / %LOCALAPPDATA% 下）= 预期保留：卸载器故意不清设置，彻底清需手动删，不算失败
   2) 产物 / 归档 / 分发包 / 开发启动项 = 不是安装器写的，豁免
   3) 其余（注册表卸载项、安装目录、开始菜单与桌面快捷方式）= 异常残留，计入失败 */
const ARTIFACT_RE = /(鸿汇影·(客户成品|开发端|文档资料|历史归档|开鸿签名资料|私发))|鸿汇影桌面版 Setup|HongHubMovie\.hap|影视仓配置|网站导入备份|Startup\\(鸿汇影自动发版|鸿汇影镜像站)/;
function classify(p, k) {
  /* 先判产物：Startup 里的开发启动项也在 %APPDATA% 下，但它不是安装器写的 */
  if (ARTIFACT_RE.test(p)) return 'artifact';
  /* 只有 appdata 这组才可能是「卸载器故意保留的用户设置」。
     安装目录、快捷方式、注册表卸载项即便落在 %LOCALAPPDATA% 里也必须算残留——
     本机实测安装器是 per-user 装到 %LOCALAPPDATA%\Programs\honghub-desktop，
     旧口径会因为它在 %LOCALAPPDATA% 下而误判成「预期保留」，等于给真残留发豁免。 */
  if (k !== 'appdata') return 'leftover';
  const ad = (process.env.APPDATA || '').toLowerCase(), lad = (process.env.LOCALAPPDATA || '').toLowerCase();
  const lp = p.toLowerCase();
  if (ad && lp.indexOf(ad + '\\') === 0) return 'userdata';
  if (lad && lp.indexOf(lad + '\\') === 0) return 'userdata';
  return 'leftover';
}

const argv = process.argv.slice(2);
if (argv[0] === '--snapshot') {
  const label = argv[1] || 'snap-' + stamp();
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const s = scan();
  const p = path.join(OUT, 'install-snapshot-' + label.replace(/[^\w.-]/g, '_') + '.json');
  fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf8');
  console.log('已记录快照 ' + label + '：' + p);
  console.log('  AppData ' + s.counts.appdata + ' · 快捷方式/开始菜单 ' + s.counts.shortcuts + ' · 安装目录 ' + s.counts.install + ' · 注册表项 ' + s.counts.reg);
  for (const k of ['appdata', 'shortcuts', 'install', 'reg']) if (s[k].length) for (const x of s[k]) console.log('  · ' + x);
  process.exit(0);
}

if (argv[0] === '--diff') {
  const a = load(argv[1] || 'before'), b = load(argv[2] || 'after');
  const groups = { appdata: '用户数据', shortcuts: '快捷方式/桌面', install: '安装目录', reg: '注册表卸载项' };
  let bad = 0, keep = 0, ignore = 0;
  console.log('对比 ' + argv[1] + ' → ' + argv[2] + '：卸载后仍在的项');
  for (const k of ['appdata', 'shortcuts', 'install', 'reg']) {
    const still = a.data[k].filter((x) => b.data[k].indexOf(x) >= 0);   /* before 有、after 还有 */
    if (!still.length) { console.log('  ✓ ' + groups[k] + '：已清理'); continue; }
    const cls = still.map((x) => ({ x, c: classify(x, k) }));
    const left = cls.filter((o) => o.c === 'leftover');
    const keepd = cls.filter((o) => o.c === 'userdata');
    const art = cls.filter((o) => o.c === 'artifact');
    keep += keepd.length; ignore += art.length; bad += left.length;
    if (left.length) {
      console.log('  ✗ ' + groups[k] + '：异常残留 ' + left.length + ' 项');
      for (const o of left) console.log('      ' + o.x);
    } else {
      console.log('  ✓ ' + groups[k] + '：无异常残留');
    }
    for (const o of keepd) console.log('      ! 预期保留（用户设置）：' + o.x);
    for (const o of art) console.log('      · 非安装产物，已豁免：' + o.x);
  }
  const added = [];
  for (const k of ['appdata', 'shortcuts', 'install', 'reg']) for (const x of b.data[k]) if (a.data[k].indexOf(x) < 0) added.push(k + ': ' + x);
  if (added.length) { console.log('  另外 after 里新出现（若尚未卸载，属正常）：'); for (const x of added) console.log('      ' + x); }
  console.log('\n汇总：异常残留 ' + bad + ' 项 · 预期保留的用户数据 ' + keep + ' 项 · 豁免的产物 ' + ignore + ' 项');
  console.log(bad ? ('结论：未通过（退出 1）—— ' + bad + ' 项该清没清') : '结论：通过（退出 0）—— 没有该清没清的项');
  if (keep && !bad) console.log('提示：用户数据目录仍有残留属设计如此（卸载保留设置）；要彻底清，按客户说明第六节手动删两处目录。');
  process.exit(bad ? 1 : 0);
}

/* 真正的「装→卸干净度」要看「装后有、卸后无」。
   --diff before after 只能回答「原来就有的东西有没有被误删」，回答不了这个，所以单开一支。*/
if (argv[0] === '--residue') {
  const a = load(argv[1] || 'installed'), b = load(argv[2] || 'after');
  const groups = { appdata: '用户数据', shortcuts: '快捷方式/桌面', install: '安装目录', reg: '注册表卸载项' };
  let bad = 0, keep = 0, ignore = 0, total = 0, gone = 0;
  console.log('装机 → 卸载残留：以「装后快照 ' + argv[1] + '」为基准，看卸后还剩什么');
  for (const k of ['appdata', 'shortcuts', 'install', 'reg']) {
    const had = a.data[k].filter((x) => !(ARTIFACT_RE.test(x)));      /* 装后属于本产品的项（去掉我自己的产物） */
    total += had.length;
    const still = had.filter((x) => b.data[k].indexOf(x) >= 0);
    gone += had.length - still.length;
    if (!had.length) { console.log('  · ' + groups[k] + '：装后无本产品项'); continue; }
    if (!still.length) { console.log('  ✓ ' + groups[k] + '：装后 ' + had.length + ' 项，卸后全清'); continue; }
    const cls = still.map((x) => ({ x, c: classify(x, k) }));
    const left = cls.filter((o) => o.c === 'leftover');
    const keepd = cls.filter((o) => o.c === 'userdata');
    bad += left.length; keep += keepd.length;
    console.log((left.length ? '  ✗ ' : '  ✓ ') + groups[k] + '：装后 ' + had.length + ' 项，卸后仍在 ' + still.length + ' 项'
      + (left.length ? '（异常残留 ' + left.length + '）' : '（均为预期保留）'));
    for (const o of left) console.log('      ✗ 该清没清：' + o.x);
    for (const o of keepd) console.log('      ! 预期保留（用户设置）：' + o.x);
  }
  console.log('\n汇总：装后本产品痕迹 ' + total + ' 项 · 卸后清掉 ' + gone + ' 项 · 该清没清 ' + bad + ' 项 · 预期保留 ' + keep + ' 项');
  console.log(bad ? ('结论：未通过（退出 1）—— ' + bad + ' 项该清没清') : '结论：通过（退出 0）—— 装后写下的痕迹，卸载后没有该清没清的');
  if (keep && !bad) console.log('提示：%APPDATA% 下的设置目录属设计保留（卸载不清设置），不算失败；要彻底清按客户说明第六节手动删。');
  process.exit(bad ? 1 : 0);
}

console.log('用法：');
console.log('  node scripts\\release\\check-install-clean.js --snapshot before');
console.log('  node scripts\\release\\check-install-clean.js --snapshot installed   # 装完、用完之后');
console.log('  node scripts\\release\\check-install-clean.js --snapshot after       # 卸载之后');
console.log('  node scripts\\release\\check-install-clean.js --diff before after     # 原有东西没被误删');
console.log('  node scripts\\release\\check-install-clean.js --residue installed after  # 装后痕迹卸后全清（主判据）');
process.exit(2);
