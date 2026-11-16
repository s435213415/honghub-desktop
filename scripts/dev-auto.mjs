#!/usr/bin/env node
/**
 * 鸿汇影桌面中枢 · 开发者端一键自动化
 *
 * 目标：把发版前散落在多条命令和人工核对里的动作收口成一个入口。
 * 默认执行（安全，不发布、不重新出包）：
 *   1. 版本一致性门禁：node scripts/version.js --check
 *   2. 静态工程检查：node scripts/check-static.js
 *   3. 发版数据同步：honghub-channel-gate/scripts/release.mjs（写 manifest/页面/端点/网关路径）
 *   4. 同步后复检：release.mjs --check + version.js --check
 *   5. 客户页与源文件一致性、关键脚本语法、签名材料存在性检查（不读私钥内容）
 *
 * 用法：
 *   npm run dev:auto              执行同步 + 全部检查
 *   npm run dev:auto:check        只检查不改文件
 *   node scripts/dev-auto.mjs --json   输出机器可读摘要
 *
 * 例外（无法由脚本代替人工）：Cloudflare OAuth 登录。私有网关部署仍需本人先
 * `npx wrangler login`；已激活的 WorkBuddy 云服务链路不受影响。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const CHECK_ONLY = ARGS.includes('--check');
const JSON_OUT = ARGS.includes('--json');
const GATE_RELEASE = path.resolve(ROOT, '..', '..', '2026-11-16-14-25-02', 'honghub-channel-gate', 'scripts', 'release.mjs');

const results = [];
function step(name, fn) {
  try {
    const detail = fn();
    results.push({ name, status: 'passed', detail: detail || '' });
    if (!JSON_OUT) console.log(`[OK] ${name}${detail ? ' · ' + detail : ''}`);
    return true;
  } catch (e) {
    results.push({ name, status: 'failed', detail: e && e.message ? e.message : String(e) });
    if (!JSON_OUT) console.error(`[FAIL] ${name} · ${e && e.message ? e.message : e}`);
    return false;
  }
}
function run(file, args = [], opts = {}) {
  const r = spawnSync(process.execPath, [file, ...args], {
    cwd: opts.cwd || ROOT, encoding: 'utf8', stdio: JSON_OUT ? 'pipe' : 'inherit'
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(file)} ${args.join(' ')} 退出码 ${r.status}`);
  return (r.stdout || '').trim();
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

step('版本一致性门禁', () => { run(path.join(ROOT, 'scripts', 'version.js'), ['--check']); return '全端版本一致'; });
step('静态工程检查', () => { run(path.join(ROOT, 'scripts', 'check-static.js')); return '通过'; });

const publishDir = path.join(ROOT, 'dist', 'public');
if (CHECK_ONLY) {
  step('发版数据一致性', () => {
    if (!fs.existsSync(GATE_RELEASE)) return '本地未挂载频道网关工程，跳过（CI 正常）';
    run(GATE_RELEASE, ['--dir', publishDir, '--check']); return '清单/页面/端点/网关路径一致';
  });
} else {
  step('发版数据同步', () => {
    if (!fs.existsSync(GATE_RELEASE)) return '本地未挂载频道网关工程，跳过';
    run(GATE_RELEASE, ['--dir', publishDir]); return '已写入';
  });
  step('同步后一致性复检', () => {
    if (!fs.existsSync(GATE_RELEASE)) return '跳过（无网关工程）';
    run(GATE_RELEASE, ['--dir', publishDir, '--check']); return '一致';
  });
  step('复检版本号', () => { run(path.join(ROOT, 'scripts', 'version.js'), ['--check']); return '一致'; });
}

step('客户成品页健康', () => {
  // v1.7.21+ 发版模式：manifest 不再带 pageHash，客户页 app-page.html 独立成版。
  // 这里校验真正影响客户的点：页面存在、非空、播放器结构齐全；manifest 有 pageHash 时仍校验（兼容旧版）。
  const pub = path.join(ROOT, 'dist', 'public', 'app-page.html');
  if (!fs.existsSync(pub)) throw new Error('缺少 app-page.html');
  const html = fs.readFileSync(pub, 'utf8');
  if (html.length < 10000) throw new Error('app-page.html 内容异常短');
  if (!/<video[\s>]/i.test(html)) throw new Error('app-page.html 缺少播放器 video 标签');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'public', 'remote-manifest.json'), 'utf8'));
  if (manifest.pageHash) {
    const h = sha256(pub);
    if (manifest.pageHash !== h) throw new Error('manifest.pageHash 与 app-page.html 不一致');
    return 'pageHash ' + h.slice(0, 12) + '…';
  }
  return 'v' + (manifest.versionName || '?') + ' · ' + html.length + ' 字符 · 播放器完整';
});

step('关键脚本语法', () => {
  const files = ['scripts/version.js', 'scripts/check-static.js', 'scripts/dev-auto.mjs'];
  if (fs.existsSync(GATE_RELEASE)) files.push('../../2026-11-16-14-25-02/honghub-channel-gate/scripts/release.mjs');
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', path.resolve(ROOT, f)], { encoding: 'utf8' });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(path.basename(f) + ' 语法错误');
  }
  return `${files.length} 个脚本`;
});

step('签名材料存在性（不读私钥）', () => {
  const dir = path.join(ROOT, 'harmony', 'signing', 'keys');
  const required = ['README.txt', 'sign-keys/app-key.p12', 'sign-keys/profile-key.p12', 'sign/app.p7b', 'sign_reuse.py'];
  const missing = required.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) throw new Error('缺失: ' + missing.join(', '));
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  if (!ignore.includes('harmony/signing/keys/') || !ignore.includes('*.p12')) throw new Error('.gitignore 未排除密钥');
  return '证书链/密钥包存在且已被忽略规则覆盖';
});

step('无根目录一次性脚本', () => {
  const leftovers = fs.readdirSync(ROOT).filter((f) => /^_.*\.(js|bat|py)$/.test(f));
  if (leftovers.length) throw new Error('仍存在: ' + leftovers.join(', '));
  return '已归档';
});

const failed = results.filter((r) => r.status === 'failed');
const summary = { ok: failed.length === 0, checkOnly: CHECK_ONLY, results };
if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
else {
  console.log('\n===== 开发者端自动化汇总 =====');
  console.log(`${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) {
    console.log('失败项：' + failed.map((r) => r.name).join('、'));
    console.log('未发布、未重新出包；请先修复失败项。');
  } else {
    console.log('本地开发端全部通过。站点发布仍由 WorkBuddy 发布工具执行；Cloudflare OAuth 需本人授权。');
  }
}
process.exit(failed.length ? 1 : 0);
