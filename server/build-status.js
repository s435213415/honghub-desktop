/* 发版流水线状态：把「只有日志文件」和「只有命令行」的发版过程搬到界面。
   数据全部从磁盘真实读：版本四源、产物哈希、最近几次流水线的步骤/失败项、自动发版与锁状态。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOGS = path.join(ROOT, 'logs');
const DIST = path.join(ROOT, 'dist');

function jread(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } }
function sha256(p) { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch (e) { return ''; } }
function size(p) { try { return fs.statSync(p).size; } catch (e) { return 0; } }
function alive(pid) { try { process.kill(Number(pid), 0); return true; } catch (e) { return false; } }

/* 版本四源：任何一个对不上都算不一致，界面直接红掉 */
function versions() {
  const pkg = jread(path.join(ROOT, 'package.json'), {});
  const feat = jread(path.join(ROOT, 'server', 'feature-version.json'), {});
  const rel = jread(path.join(DIST, 'release.json'), {});
  const man = jread(path.join(ROOT, 'server', 'manifest.json'), {});
  const lat = (man.release && man.release.latest) || {};
  const list = [
    { key: 'package.json', name: pkg.version || '', code: null },
    { key: 'feature-version.json', name: feat.versionName || '', code: feat.versionCode || null },
    { key: 'dist/release.json', name: rel.versionName || '', code: rel.versionCode || null },
    { key: 'manifest.release.latest', name: lat.versionName || '', code: lat.versionCode || null }
  ];
  const names = Array.from(new Set(list.map((x) => x.name).filter(Boolean)));
  const codes = Array.from(new Set(list.map((x) => x.code).filter(Boolean)));
  return { list: list, consistent: names.length <= 1 && codes.length <= 1, versionName: names[0] || '', versionCode: codes[0] || null };
}

/* 产物：以 release.json 为准，逐项实测 sha256 对比 */
function artifacts() {
  const rel = jread(path.join(DIST, 'release.json'), {});
  const a = rel.artifacts || {};
  const out = [];
  const map = [
    ['桌面安装包', a.desktop, path.join(DIST, 'desktop-setup.exe')],
    ['开鸿 HAP', a.hap, path.join(DIST, 'honghub-harmony.hap')]
  ];
  for (const [label, meta, file] of map) {
    const real = sha256(file);
    out.push({
      label: label,
      file: file.replace(ROOT + path.sep, ''),
      exists: !!real,
      size: size(file),
      expect: (meta && meta.sha256) || '',
      actual: real,
      ok: !!(real && meta && meta.sha256 && real === meta.sha256)
    });
  }
  return out;
}

/* 最近几次流水线：按日志 mtime 取最新的若干个，解析「✔/✘ 步骤 · 耗时」与失败行 */
function pipelines(limit) {
  let files = [];
  try {
    const all = fs.readdirSync(LOGS).filter((f) => /\.log$/.test(f) && fs.statSync(path.join(LOGS, f)).size < 400 * 1024);
    // 只认真正的出包流水线（oneclick / manual / panel），verify-*.log 是验收复检、auto-publish.log 是守候流水
    const primary = all.filter((f) => /^(oneclick|manual|panel)-/.test(f));
    const pick = (primary.length ? primary : all).map((f) => {
      const p = path.join(LOGS, f);
      return { name: f, mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size };
    });
    files = pick.sort((x, y) => y.mtime - x.mtime).slice(0, limit || 4);
  } catch (e) { return []; }
  return files.map((f) => {
    let text = '';
    try { text = fs.readFileSync(path.join(LOGS, f.name), 'utf8'); } catch (e) {}
    const steps = [];
    const fails = [];
    const re = /(✔|✘)\s*([^\n·]{2,40})\s*·\s*(\d+)s/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      steps.push({ ok: m[1] === '✔', label: m[2].trim(), sec: Number(m[3]) });
    }
    const fre = /\[失败\]\s*([^\n]*)|\b✘\s*([^\n]*)$/g;
    while ((m = fre.exec(text)) !== null) fails.push((m[1] || m[2] || '').trim());
    const lines = text.split(/\r?\n/);
    const tail = lines.slice(Math.max(0, lines.length - 40)).join('\n');
    // 收尾行形如「=== 流水线结束：13 步成功 / 0 步失败 ===」，用它判定整体结果
    const fin = text.match(/流水线结束：\s*(\d+)\s*步成功\s*\/\s*(\d+)\s*步失败/);
    const finished = !!fin;
    const passed = !!fin && Number(fin[2]) === 0 && Number(fin[1]) > 0;
    const ver = (text.match(/当前版本\s*v?([0-9][0-9.]*)/) || [])[1] || '';
    const badSteps = steps.filter((s) => !s.ok).map((s) => s.label);
    return {
      name: f.name, mtime: f.mtime, sizeKB: Math.round(f.size / 1024),
      finished: finished, passed: passed, version: ver,
      okCount: fin ? Number(fin[1]) : steps.filter((s) => s.ok).length,
      failCount: fin ? Number(fin[2]) : badSteps.length,
      steps: steps, fails: (badSteps.length ? badSteps : fails).slice(0, 12), tail: tail
    };
  });
}

/* 自动发版三层状态：暂停标记 / 静默窗口 / 守候进程 / 出包锁 */
function autopublish() {
  const paused = jread(path.join(LOGS, 'auto-publish.paused.json'), null);
  const state = jread(path.join(LOGS, 'auto-publish.state.json'), {});
  let locked = null;
  try { locked = jread(path.join(LOGS, 'auto-publish.lock'), null); } catch (e) {}
  let muted = null;
  try { muted = jread(path.join(LOGS, 'auto-publish.muted'), null); } catch (e) {}
  let distLock = null;
  try { distLock = require(path.join(ROOT, 'scripts', 'lib', 'dist-lock.js')).check(); } catch (e) {}
  return {
    paused: !!(paused && paused.paused),
    pausedReason: (paused && paused.reason) || '',
    muted: !!muted,
    mutedReason: (muted && muted.reason) || '',
    watcherPid: (locked && locked.pid) || null,
    watcherAlive: !!(locked && locked.pid && alive(locked.pid)),
    baseline: (state && state.okHash) || '',
    baselineVersion: (state && state.version) || '',
    distLock: distLock || null
  };
}

/* 签名链：把「这次出包的 HAP 到底用谁的密钥签的」直接摆到面板上，
   避免以后再靠口头确认。读 dist/.hap-build.json + keys-kaihong 材料是否存在。 */
function signing() {
  const chain = {
    'official-openharmony': { own: false, bundle: 'com.honghub.harmony', type: 'release', note: 'OpenHarmony SDK 公开密钥（口令公开 123456）' },
    'kaihong-platform-debug': { own: true, bundle: 'com.kaihong.movie', type: 'debug', note: '开鸿平台证书，私钥自持' },
    'kaihong-platform-release': { own: true, bundle: 'com.kaihong.movie', type: 'release', note: '开鸿平台 release 链（正式分发），release 应用证书待补' },
    'legacy-self-ca': { own: true, bundle: 'com.honghub.harmony', type: 'self-signed', note: '已停用的旧自签链' }
  };
  let stamp = null;
  try { stamp = JSON.parse(fs.readFileSync(path.join(DIST, '.hap-build.json'), 'utf8')); } catch (e) {}
  const keyDir = path.join(ROOT, 'harmony', 'signing', 'keys-kaihong');
  const mats = {};
  ['kaihong.p12', 'app.cer', 'app.p7b', 'kaihong.csr', 'profile-release.p7b', 'app-release.cer'].forEach(function (f) {
    try { mats[f] = fs.statSync(path.join(keyDir, f)).size; } catch (e) { mats[f] = 0; }
  });
  const info = stamp ? (chain[stamp.chain] || null) : null;
  const warnings = [];
  if (!stamp) warnings.push('还没有出过 HAP（缺 dist/.hap-build.json）');
  if (stamp && !info) warnings.push('产物签名链未登记：' + stamp.chain);
  if (info && !info.own) warnings.push('当前产物用的是 SDK 公开密钥，不是自持私钥');
  if (!mats['kaihong.p12']) warnings.push('自持私钥缺失：harmony/signing/keys-kaihong/kaihong.p12');
  if (!mats['app.cer'] || !mats['app.p7b']) warnings.push('自持证书或 Profile 缺失');
  if (mats['profile-release.p7b'] && !mats['app-release.cer']) warnings.push('release Profile 已就位，release 应用证书 app-release.cer 待平台签发');
  if (!mats['profile-release.p7b']) warnings.push('release 链 Profile 缺失：profile-release.p7b');
  return {
    chain: stamp ? stamp.chain : '',
    owner: stamp ? (stamp.chainOwner || (info && info.own ? 'self' : 'sdk-public')) : '',
    bundle: stamp ? stamp.bundle || '' : '',
    version: stamp ? stamp.versionName + ' / #' + stamp.versionCode : '',
    size: stamp ? stamp.size : 0,
    sha256: stamp ? String(stamp.sha256 || '').slice(0, 16) : '',
    builtAt: stamp ? stamp.builtAt || '' : '',
    ownKeyMaterials: mats,
    warnings: warnings,
    map: 'harmony/signing/KEYS-MAP.md'
  };
}

function status() {
  const v = versions();
  return {
    ok: true,
    at: new Date().toISOString(),
    versions: v,
    artifacts: artifacts(),
    pipelines: pipelines(4),
    autopublish: autopublish(),
    signing: signing()
  };
}

/* 从界面触发一次发版：与手工命令行完全同一条流水线（会自己挂静默窗口、自己吸收基线）。
   先看锁：别人正在出包就直接拒绝，避免两条流水线抢 dist。 */
function runOnce(extraArgs) {
  let lock;
  try { lock = require(path.join(ROOT, 'scripts', 'lib', 'dist-lock.js')).check(); } catch (e) {}
  if (lock && lock.held) {
    return { ok: false, error: '已有出包任务在跑（' + (lock.owner || '未知') + '），等它结束再点' };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOGS, 'panel-' + stamp + '.log');
  const args = [path.join(ROOT, 'scripts', 'oneclick-release.js')].concat(extraArgs || []);
  const out = fs.openSync(logFile, 'a');
  const p = child.spawn(process.execPath, args, {
    cwd: ROOT, detached: true, windowsHide: true,
    stdio: ['ignore', out, out],
    env: Object.assign({}, process.env)
  });
  try { p.unref(); } catch (e) {}
  try { fs.closeSync(out); } catch (e) {}
  return { ok: true, started: true, pid: p.pid, log: 'logs/' + path.basename(logFile) };
}

module.exports = { status: status, runOnce: runOnce, versions: versions, artifacts: artifacts, pipelines: pipelines };
