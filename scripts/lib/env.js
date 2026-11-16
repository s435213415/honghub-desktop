'use strict';
/* 轻量 .env 读取：不引入 dotenv，避免为一段配置增加运行时依赖。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

/* .env 定位：显式文件 > 本仓库 .env > 同级/邻居 HongHubMovie 工程 .env。
   签名口令 OH_KEY_PWD 一直放在深开鸿工程里，构建脚本却在桌面工程里，
   只认 ROOT/.env 会让每次出包都卡在「缺少 OH_KEY_PWD」。 */
function envCandidates() {
  const home = os.homedir();
  const list = [path.join(ROOT, '.env'), path.join(ROOT, '..', 'HongHubMovie', '.env')];
  try {
    for (const d of fs.readdirSync(path.join(home, 'WorkBuddy')) .sort().reverse()) {
      list.push(path.join(home, 'WorkBuddy', d, 'HongHubMovie', '.env'));
    }
  } catch (e) { /* 无 WorkBuddy 目录时忽略 */ }
  list.push(path.join(home, 'Desktop', 'HongHubMovie', '.env'));
  return list;
}

function loadEnv(file) {
  if (!file) {
    const found = envCandidates().find(p => fs.existsSync(p));
    if (!found) return {};
    file = found;
  }
  const p = file;
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k) out[k] = v;
  }
  return out;
}

// 环境变量优先于 .env，命令行注入不会被本地文件覆盖
function apply(file) {
  const e = loadEnv(file);
  for (const k of Object.keys(e)) if (process.env[k] === undefined) process.env[k] = e[k];
  return e;
}

// 定位 hdc：显式 KH_HDC > PATH > 已安装 SDK 的 toolchains。
// 深开鸿 SDK 自带 hdc.exe，但默认不加入 PATH；只找 PATH 会误报「未安装」。
function findHdc() {
  const win = process.platform === 'win32';
  const exe = win ? 'hdc.exe' : 'hdc';
  const explicit = process.env.KH_HDC;
  if (explicit) return fs.existsSync(explicit) ? explicit : explicit;
  const probe = spawnSync(win ? 'where' : 'which', [exe], { encoding: 'utf8', timeout: 4000, windowsHide: true });
  if (!probe.error && probe.status === 0 && String(probe.stdout || '').trim()) return exe;
  const home = os.homedir();
  const bases = [
    process.env.OH_SDK_HOME, process.env.OHOS_SDK_HOME, process.env.HOS_SDK_HOME,
    path.join(home, 'Desktop', 'command-line-tools'),
    path.join(ROOT, '..', 'command-line-tools'),
    path.join(home, 'AppData', 'Local', 'Huawei', 'Sdk', 'command-line-tools'),
    path.join(home, 'AppData', 'Local', 'OpenHarmony', 'Sdk'),
    path.join(home, 'OpenHarmony', 'Sdk')
  ].filter(Boolean);
  for (const base of bases) {
    const sdkDir = path.join(base, 'sdk');
    let versions = [];
    try { versions = fs.readdirSync(sdkDir); } catch (e) { /* 无 sdk/ 分层 */ }
    // 高版本优先
    for (const v of versions.sort().reverse()) {
      const p = path.join(sdkDir, v, 'toolchains', exe);
      if (fs.existsSync(p)) return p;
    }
    for (const p of [path.join(base, 'toolchains', exe), path.join(sdkDir, 'toolchains', exe)]) {
      if (fs.existsSync(p)) return p;
    }
  }
  return exe; // 回落为命令名，由调用方明确报 SKIP，绝不假装可用
}

module.exports = { ROOT, loadEnv, apply, findHdc };
