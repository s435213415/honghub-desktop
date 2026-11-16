/* 把内置平台清单（server/manifest.json → sources.sites）同步成页面里的离线基线。
   为什么要这一步：页面断网/没中枢时只认随包 BUILTIN_SITES，v1.7.13 就出现过
   「中枢 204 个平台、断网只剩 29 个」的落差。跑完这个脚本两边一致。
   用法： node scripts/sync-sites.js [--check]   --check 只比对不写。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MAN = path.join(ROOT, 'server/manifest.json');
const PAGES = [path.join(ROOT, 'app/index.html')];
const CHECK = process.argv.includes('--check');

const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));
const sites = ((man.sources || {}).sites || []).filter((s) => s && s.name && /^https?:\/\//i.test(String(s.url || '')));
const q = (v) => JSON.stringify(String(v));
const rows = sites.map((s) => {
  const parts = ['name:' + q(s.name.slice(0, 24)), 'url:' + q(s.url.slice(0, 512)),
    'color:' + q(/^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : '#3B456B'),
    'tag:' + q((s.prov || s.tag || s.name.slice(0, 1)).slice(0, 2)),
    'cat:' + q((s.cat || '综合视频').slice(0, 20))];
  if (s.mobile) parts.push('mobile:' + q(s.mobile));
  if (s.mode) parts.push('mode:' + q(s.mode));
  return '{' + parts.join(',') + '}';
});
const block = 'var BUILTIN_SITES = [\n' + rows.join(',\n') + '\n];';

let changed = 0;
for (const p of PAGES) {
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, 'utf8');
  const m = html.match(/var BUILTIN_SITES = \[[\s\S]*?\n\];/);
  if (!m) { console.log('  跳过（无 BUILTIN_SITES 锚点）：' + path.relative(ROOT, p)); continue; }
  const same = m[0] === block;
  console.log('  ' + (same ? '已一致' : '需同步') + '：' + path.relative(ROOT, p) + '（基线 ' +
    (m[0].match(/\{name:/g) || []).length + ' → ' + rows.length + ' 条）');
  if (!same && !CHECK) { fs.writeFileSync(p, html.slice(0, m.index) + block + html.slice(m.index + m[0].length)); changed++; }
}
console.log('内置平台 ' + rows.length + ' 条 · ' + (CHECK ? '仅比对' : '已写 ' + changed + ' 个文件'));
