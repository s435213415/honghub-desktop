#!/usr/bin/env node
'use strict';
/* 校验「渠道专属 token」：本地明文 token → SHA-256 → 与云端 D1 里登记的 token_hash 比对。
 * 明文 token 只在内存里算哈希，不打印、不落盘；输出只给哈希前 12 位。
 *
 * 用法：
 *   node scripts/verify-channel-token.js                 # 校验本机私密文件里所有角色
 *   node scripts/verify-channel-token.js --role doubao   # 只校验某个角色
 *   node scripts/verify-channel-token.js --hash-only     # 不查云端，只算本地哈希
 *
 * 云端查询走 wrangler d1（需要已 npx wrangler login，且 D1 库名默认 honghub-gate-db）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
const ONLY = arg('role', '');
const HASH_ONLY = process.argv.includes('--hash-only');
const DB = process.env.D1_DB || 'honghub-gate-db';

function findSecrets() {
  if (process.env.KH_SECRETS_FILE) return process.env.KH_SECRETS_FILE;
  const wb = path.join(os.homedir(), 'WorkBuddy');
  try {
    for (const d of fs.readdirSync(wb)) {
      const p = path.join(wb, d, 'honghub-channel-gate', '.secrets.local.json');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {}
  return null;
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const secretsPath = findSecrets();
if (!secretsPath) { console.error('找不到 .secrets.local.json（可用 KH_SECRETS_FILE 指定）'); process.exit(1); }
const sec = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
const tokens = (sec.upload_tokens) || {};
const roles = Object.keys(tokens).filter((r) => !ONLY || r === ONLY);
if (!roles.length) { console.error('私密文件里没有匹配的上传令牌'); process.exit(1); }

function query(hash) {
  const cmd = `SELECT id, client, label, status, quota, used, expires_at FROM tokens WHERE token_hash='${hash}';`;
  try {
    // Windows 上 execFileSync 直接拉 npx.cmd 会 EINVAL，统一走 execSync 的 shell，SQL 用双引号包住
    const out = require('child_process').execSync(
      `npx wrangler d1 execute ${DB} --remote --command "${cmd}" --json`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(__dirname, '..') });
    const arr = JSON.parse(out);
    const block = Array.isArray(arr) ? arr[0] : arr;
    return { ok: true, rows: (block && block.results) || [] };
  } catch (e) {
    const msg = ((e.stdout || '') + (e.stderr || '') + (e.message || '')).replace(/\u001b\[[0-9;]*m/g, '');
    return { ok: false, error: msg.split('\n').filter(Boolean).slice(-3).join(' / ') };
  }
}

console.log('私密文件：' + secretsPath);
console.log('云端库：' + DB + '（wrangler d1）');
for (const role of roles) {
  const t = tokens[role] && tokens[role].token;
  if (!t) { console.log('  ' + role + '：无 token 字段'); continue; }
  const h = sha(t);
  console.log('\n[' + role + '] sha256=' + h.slice(0, 12) + '…（全长 ' + h.length + '）');
  if (HASH_ONLY) continue;
  const q = query(h);
  if (!q.ok) { console.log('  云端校验失败：' + q.error); console.log('  提示：先 npx wrangler login，或设 D1_DB=库名；仅算哈希用 --hash-only'); continue; }
  if (!q.rows.length) { console.log('  ✘ 未登记：云端没有这条 token_hash（令牌已换过或未签发）'); continue; }
  for (const r of q.rows) {
    const exp = r.expires_at ? new Date(r.expires_at * 1000).toISOString().slice(0, 10) : '永不过期';
    console.log('  ✔ 匹配 id=' + r.id + ' client=' + r.client + ' status=' + r.status +
      ' 配额=' + (r.quota === 0 ? '不限' : r.quota) + ' 已用=' + r.used + ' 过期=' + exp);
    if (r.status !== 'active') console.log('  ⚠ 该凭证状态不是 active，上传会被网关拒绝');
  }
}
console.log('\n说明：明文 token 没有打印，也没有写入任何文件；云端只存 SHA-256。');
