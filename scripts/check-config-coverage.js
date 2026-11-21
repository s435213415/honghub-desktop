#!/usr/bin/env node
/* 配置项覆盖率自检：以《客户端可配置项清单》为准，核对代码里每个配置键是否真的接上了线。
   用法：
     node scripts/check-config-coverage.js            # 报告
     node scripts/check-config-coverage.js --strict   # 有缺失即 exit 1（可进门禁）
     node scripts/check-config-coverage.js --json     # 额外写 dist/config-coverage.json
   判定口径：
     - 清单「现状=空白」：代码里出现该键 → NOTE（表落后于代码，需回填）
     - 清单「已有 / 本次新增」：代码里 0 处 → MISSING（功能没接线，属于缺陷）
     - 键只出现在 kh-config / kh-app，未出现在 kh-core → WARN（无设置界面，用户改不到）
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ITEMS_PATH = path.join(__dirname, 'config-items.json');
const SCAN_FILES = [
  'app/kh-config.js', 'app/kh-core.js', 'app/kh-app.js', 'app/kh-player.js',
  'app/kh-admin.js', 'electron-main.js', 'preload.js'
];

function readIf(p) {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

const files = {};
for (const f of SCAN_FILES) {
  const c = readIf(f);
  if (c != null) files[f] = c;
}

const allText = Object.values(files).join('\n');
function hits(key, f) {
  const re = new RegExp("'" + key + "'", 'g');
  return (files[f].match(re) || []).length;
}
function total(key) { return (allText.match(new RegExp("'" + key + "'", 'g')) || []).length; }

const keysOf = s => (String(s || '').match(/kh_[a-z0-9_]+/gi) || []);

/* 界面落点是否真的能在渲染层找到：取「设置 · 外观 › xxx」里除通用词外的中文片段，
   在 kh-core.js / kh-player.js 里找。命中即认为界面存在（比只看键名更接近事实）。 */
const GENERIC = ['设置', '本机中枢', '播放器', '视图', 'HUD', '通用', '内部函数', '计划'];
const uiCache = {};
function uiHit(uiTxt) {
  const t = String(uiTxt || '');
  if (!t || /计划：|无界面|服务端后台/.test(t)) return null; // null = 不适用（未实现或本就无界面）
  if (t in uiCache) return uiCache[t];
  const parts = t.split(/[·›\/、，,（）()／]/).map(s => s.trim())
    .filter(s => s.length >= 2 && !GENERIC.includes(s) && !s.startsWith('计划'));
  const layer = ['app/kh-core.js', 'app/kh-player.js', 'app/kh-config.js'].filter(f => files[f]).map(f => files[f]).join('\n');
  const hit = parts.some(p => layer.indexOf(p) >= 0);
  uiCache[t] = hit;
  return hit;
}

if (!fs.existsSync(ITEMS_PATH)) {
  console.error('缺少清单数据 scripts/config-items.json，请先跑清单生成脚本');
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
const items = data.items || [];

const rows = [];
let missing = 0, review = 0, note = 0, ok = 0, planned = 0;

for (const it of items) {
  const keys = keysOf(it.key);
  const blank = /空白/.test(it.status);
  const pending = /暂缓|1\.7\.82/.test(it.batch) && /空白/.test(it.status);
  if (!keys.length) {
    rows.push({ no: it.no, name: it.name, status: 'NO_KEY', detail: '该项没有具体键（策略类/构建类），人工核对', it });
    continue;
  }
  const detail = keys.map(k => {
    const n = total(k);
    const core = files['app/kh-core.js'] ? hits(k, 'app/kh-core.js') : 0;
    return { k, n, core };
  });
  const anyCode = detail.some(d => d.n > 0);

  if (blank) {
    if (anyCode) { note++; rows.push({ no: it.no, name: it.name, status: 'NOTE', detail: '清单标空白，但代码已出现：' + detail.filter(d => d.n).map(d => d.k + '(' + d.n + ')').join(', '), it }); }
    else { planned++; rows.push({ no: it.no, name: it.name, status: 'PLANNED', detail: '待做（' + it.batch + '）', it }); }
    continue;
  }
  if (!anyCode) { missing++; rows.push({ no: it.no, name: it.name, status: 'MISSING', detail: '代码里没有任何引用：' + keys.join(', '), it }); continue; }
  const noUi = detail.every(d => d.core === 0);
  const hit = uiHit(it.ui);
  if (hit === false) { review++; rows.push({ no: it.no, name: it.name, status: 'REVIEW', detail: '界面落点「' + it.ui + '」在渲染层找不到，需人工确认', it }); }
  else if (hit === true) { ok++; rows.push({ no: it.no, name: it.name, status: 'OK', detail: detail.map(d => d.k + ' x' + d.n).join(' ') + ' · 界面命中「' + it.ui + '」', it }); }
  else if (noUi) { review++; rows.push({ no: it.no, name: it.name, status: 'REVIEW', detail: '键在配置/事件层，kh-core 未直接引用，界面需人工确认', it }); }
  else { ok++; rows.push({ no: it.no, name: it.name, status: 'OK', detail: detail.map(d => d.k + ' x' + d.n).join(' '), it }); }
}

const covered = ok + review;
const implemented = ok + review + missing;
console.log('== 配置项覆盖率自检 ==');
console.log('清单版本 v' + data.version + ' · 共 ' + items.length + ' 项');
console.log('已实现 ' + implemented + ' 项：OK ' + ok + ' / REVIEW ' + review + ' / MISSING ' + missing);
console.log('待做 ' + planned + ' 项（PLANNED）' + (note ? ' · 表落后 ' + note + ' 项（NOTE）' : ''));
console.log('覆盖率（已实现项中接线正常）= ' + (implemented ? Math.round(ok / implemented * 100) : 0) + '%\n');

const SHOW = { MISSING: 1, REVIEW: 1, NOTE: 1 };
const tag = { OK: '  ok  ', REVIEW: 'review', MISSING: ' MISS ', NOTE: ' note ', PLANNED: 'plan  ', NO_KEY: 'nokey ' };
for (const r of rows) {
  if (!SHOW[r.status]) continue;
  console.log('[' + tag[r.status] + '] #' + r.no + ' ' + r.name + ' — ' + r.detail);
}
if (!missing && !review && !note) console.log('（没有缺失、没有待复核键、没有表落后项）');

if (process.argv.includes('--json')) {
  const out = path.join(ROOT, 'dist', 'config-coverage.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    version: data.version, generatedAt: new Date().toISOString(),
    total: items.length, ok, review, missing, planned, note, rows
  }, null, 2), 'utf8');
  console.log('\n已写出 dist/config-coverage.json');
}

if (process.argv.includes('--strict') && (missing > 0)) {
  console.error('\n[strict] 有 ' + missing + ' 项已标已实现但代码无引用，判为未通过');
  process.exit(1);
}
process.exit(0);
