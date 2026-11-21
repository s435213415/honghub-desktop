/* 内容指纹（单一实现，自动发版守候与手工出包共用）
   目的：
     ① 文件被同步/解压/备份碰过但内容没变 → 不算变更，不重复发版；
     ② 手工出包产生的中间改动（页面重建、深开鸿前端生成、清单回写）必须被「吸收」，
        否则守候进程会当成"用户改了代码"再 bump 一版，造成版本虚涨与两条流水线撞车。
   只统计会改变产品内容的东西，运行数据与构建产物全部排除。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const WATCH = ['app', 'server', 'features', 'assets', 'harmony', 'electron-main.js', 'preload.js', 'dev-auto-update.js', 'package.json'];
const IGNORE = [
  /\bserver[\\/]data[\\/]/i,
  /\bserver[\\/]snapshots[\\/]/i,
  /\bserver[\\/]manifest\.json$/i,
  /\bserver[\\/]remote-manifest\.json$/i,
  /\bserver[\\/]feature-version\.json$/i,
  /\bharmony[\\/](build|oh_modules|\.hvigor|\.hvigor_cache)[\\/]/i,
  /\bharmony[\\/][^\\/]+[\\/]build[\\/]/i,
  /\blogs[\\/]/i,
  /\bdist[\\/]/i,
  /\bnode_modules[\\/]/i,
  /\.log$/i, /\.tmp$/i, /\.bak$/i, /\.dev-backup$/i, /\.jsonl$/i,
  /access-token\.txt$/i
];

function ignored(p) { return IGNORE.some((re) => re.test(p)); }

function collect(abs, out) {
  let st;
  try { st = fs.statSync(abs); } catch (e) { return; }
  if (st.isDirectory()) {
    let names = [];
    try { names = fs.readdirSync(abs); } catch (e) { return; }
    for (const n of names) collect(path.join(abs, n), out);
    return;
  }
  if (ignored(abs)) return;
  try {
    const buf = st.size > 8 * 1024 * 1024 ? null : fs.readFileSync(abs);
    const digest = buf ? crypto.createHash('md5').update(buf).digest('hex') : String(st.size);
    out.push(path.relative(ROOT, abs).replace(/\\/g, '/') + ':' + digest);
  } catch (e) { /* 读不到就跳过，不阻断 */ }
}

function hash() {
  const out = [];
  for (const rel of WATCH) collect(path.join(ROOT, rel), out);
  out.sort();
  return crypto.createHash('md5').update(out.join('\n')).digest('hex').slice(0, 16) + '|' + out.length;
}

function currentVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''; } catch (e) { return ''; }
}

const LOG_DIR = path.join(ROOT, 'logs');
const STATE_FILE = path.join(LOG_DIR, 'auto-publish.state.json');
const MUTE_FILE = path.join(LOG_DIR, 'auto-publish.muted');

function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; } }
function writeState(patch) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(Object.assign({}, readState(), patch), null, 2) + '\n');
  } catch (e) {}
}

/* 手工出包静默窗口：手工流水线开着这个文件，守候进程看到就跳过，
   并且把当前内容当作"已发布内容"吸收，避免流水线自己改的文件被当成新改动再 bump。 */
function mute(reason) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(MUTE_FILE, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), reason: reason || 'manual' }, null, 2) + '\n');
  } catch (e) {}
}
function unmute() { try { fs.unlinkSync(MUTE_FILE); } catch (e) {} }
function muted(maxAgeMs) {
  try {
    const s = JSON.parse(fs.readFileSync(MUTE_FILE, 'utf8'));
    const age = Date.now() - Date.parse(s.at || 0);
    return age >= 0 && age < (maxAgeMs || 45 * 60 * 1000);
  } catch (e) { return false; }
}

/* 出包成功后把基线刷新成"此刻的内容"，version 取当前 package.json。 */
function absorb() {
  const h = hash();
  writeState({ okHash: h, version: currentVersion(), okAt: new Date().toISOString(), failHash: '', failVersion: '' });
  return h;
}

module.exports = { hash, currentVersion, readState, writeState, mute, unmute, muted, absorb, ROOT, WATCH, IGNORE, ignored };
