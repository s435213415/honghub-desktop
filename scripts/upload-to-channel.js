#!/usr/bin/env node
'use strict';
/**
 * 成品上传通道 CLI —— 把本地成品上传到自建镜像站（鉴权 + SHA-256 校验 + 原子写入）
 *
 * 三种入口共用本脚本：
 *   1) 开发端面板「发布并校验」按钮：配 KH_DEPLOY_CMD 指向本脚本（见 .env.example）
 *   2) 豆包/AI：以 --role doubao 调用，令牌从本机私密文件/环境变量读取
 *   3) 命令行：node scripts/upload-to-channel.js [--version 1.7.24] [--release dist/release.json]
 *
 * 令牌来源优先级：--token > 环境变量 KH_UPLOAD_TOKEN > 本机私密文件 .secrets.local.json.upload_tokens[role].token
 * 安全：令牌绝不打印到日志；明文只存本机 gitignore 文件，镜像站只存其 SHA-256。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const ROOT = path.join(__dirname, '..');
// 令牌文件定位：环境变量 > 本工程同级工作区的 honghub-channel-gate/.secrets.local.json。
// 两份脚本副本（HongHub-Desktop 与 honghub-channel-gate）都能通过向上查找 WorkBuddy 工作区命中。
function findSecrets() {
  if (process.env.KH_SECRETS_FILE) return process.env.KH_SECRETS_FILE;
  const os = require('os');
  const bases = [
    path.join(os.homedir(), 'WorkBuddy'),
    path.dirname(path.dirname(ROOT)) // HongHub-Desktop 的父级的父级 = WorkBuddy 工作区根
  ];
  for (const b of bases) {
    try {
      for (const d of fs.readdirSync(b)) {
        const p = path.join(b, d, 'honghub-channel-gate', '.secrets.local.json');
        if (fs.existsSync(p)) return p;
      }
    } catch (e) {}
  }
  return path.join(os.homedir(), 'WorkBuddy', '2026-11-16-14-25-02', 'honghub-channel-gate', '.secrets.local.json');
}
const SECRETS = findSecrets();
const ENDPOINT_FILE = path.join(ROOT, 'server', 'public-endpoint.json');
const CURRENT_URL = 'C:/Users/admin/HongHubServer/current-url.txt';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
function flag(name) { return process.argv.indexOf('--' + name) >= 0; }

function loadToken(role) {
  if (arg('token')) return arg('token');
  if (process.env.KH_UPLOAD_TOKEN) return process.env.KH_UPLOAD_TOKEN;
  try {
    const d = JSON.parse(fs.readFileSync(SECRETS, 'utf8'));
    const t = d.upload_tokens && d.upload_tokens[role] && d.upload_tokens[role].token;
    if (t) return t;
  } catch (e) {}
  return '';
}

function endpoint() {
  /* 上传网关地址（≠客户下载域名）：默认连本机 127.0.0.1:8099 的上传网关，
     经鉴权 + SHA256 校验后由网关发布。远程调用可显式指定公网上传网关。
     注意：这里只是"上传通道"，不改写 client 的下载域名（那由 public-endpoint.json 决定）。 */
  if (arg('endpoint')) return arg('endpoint').replace(/\/+$/, '');
  if (process.env.KH_UPLOAD_ENDPOINT) return process.env.KH_UPLOAD_ENDPOINT.replace(/\/+$/, '');
  if (process.env.KH_UPLOAD_LOCAL === '0') {
    try {
      const u = fs.readFileSync(CURRENT_URL, 'utf8').trim();
      if (u.startsWith('https://')) return u;
    } catch (e) {}
  }
  return process.env.KH_UPLOAD_GATEWAY || 'http://127.0.0.1:8099';
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', d => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function postFile(base, params, file) {
  return new Promise((resolve, reject) => {
    const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    const url = base + '/api/upload?' + qs;
    const size = fs.statSync(file).size;
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': size,
        'X-Upload-Token': params._token || ''
      },
      timeout: 0
    }, res => {
      let body = '';
      res.on('data', d => body += d.toString());
      res.on('end', () => {
        let d = {}; try { d = JSON.parse(body); } catch (e) {}
        resolve({ status: res.statusCode, body: d, raw: body });
      });
    });
    req.on('error', reject);
    fs.createReadStream(file).pipe(req);
  });
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    req = lib.get(url, { timeout: 20000 }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad json')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
let req;

async function main() {
  const role = arg('role', 'panel');
  const token = loadToken(role);
  if (!token) { console.error('[失败] 未找到上传令牌（--token / KH_UPLOAD_TOKEN / 本机私密文件）'); process.exit(1); }

  // 桌面工程根：默认本脚本所在工程；channel-gate 副本可通过 --desktop-root 指向 HongHub-Desktop
  const projectRoot = arg('desktop-root')
    ? path.resolve(arg('desktop-root'))
    : ROOT;

  // 读取版本与产物清单
  const releasePath = path.resolve(projectRoot, arg('release', 'dist/release.json'));
  if (!fs.existsSync(releasePath)) { console.error('[失败] 缺少 ' + releasePath); process.exit(1); }
  const rel = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  const version = arg('version', rel.versionName);
  const vcode = arg('version-code', String(rel.versionCode));
  if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error('[失败] 版本号非法：' + version); process.exit(1); }

  const vdir = path.join(projectRoot, 'dist', 'honghub', 'v' + version);
  const candidates = {
    exe: fs.existsSync(path.join(vdir, 'desktop-setup.exe')) ? path.join(vdir, 'desktop-setup.exe') : path.join(projectRoot, 'dist', 'desktop-setup.exe'),
    hap: fs.existsSync(path.join(vdir, 'HongHubMovie.hap')) ? path.join(vdir, 'HongHubMovie.hap') : path.join(projectRoot, 'dist', 'HongHubMovie.hap'),
    bin: fs.existsSync(path.join(vdir, 'honghub-desktop-' + version + '-win.bin'))
      ? path.join(vdir, 'honghub-desktop-' + version + '-win.bin')
      : path.join(projectRoot, 'dist', 'honghub-desktop-' + version + '-win.bin')
  };
  const names = {
    exe: 'desktop-setup.exe',
    hap: 'HongHubMovie.hap',
    bin: 'honghub-desktop-' + version + '-win.bin'
  };
  // 只上传真实存在的成品；exe/hap 缺失即报错，bin 允许缺席（部分版本只发 exe+hap）
  const items = [];
  for (const k of ['exe', 'hap', 'bin']) {
    if (fs.existsSync(candidates[k])) items.push({ k, file: candidates[k], name: names[k] });
  }
  if (!items.some(x => x.k === 'exe') || !items.some(x => x.k === 'hap')) {
    console.error('[失败] dist 下缺少 desktop-setup.exe 或 HongHubMovie.hap'); process.exit(1);
  }

  const base = endpoint();
  console.log('[上传通道] endpoint=' + base + '  version=' + version + ' (#' + vcode + ')  role=' + role);
  let ok = 0;
  for (const it of items) {
    const sha = await sha256File(it.file);
    const size = fs.statSync(it.file).size;
    const params = {
      version, file: it.name, sha256: sha, size: String(size), versionCode: vcode, _token: token
    };
    if (flag('dry-run')) { console.log('  [预览] ' + it.name + ' (' + size + ' B, sha=' + sha.slice(0, 12) + ')'); ok++; continue; }
    try {
      const r = await postFile(base, params, it.file);
      if (r.status >= 200 && r.status < 300 && r.body.ok) {
        const mf = r.body.manifest;
        console.log('  [完成] ' + it.name + ' (' + size + ' B)' + (mf && mf.ok ? ' · 清单已抬到 v' + mf.versionName : ' · 清单待三件齐全'));
        ok++;
      } else {
        console.error('  [失败] ' + it.name + ' HTTP ' + r.status + ' ' + (r.body.error || r.raw.slice(0, 200)));
      }
    } catch (e) {
      console.error('  [失败] ' + it.name + ' ' + e.message);
    }
  }
  if (!flag('dry-run')) {
    try {
      const st = await getJSON(base + '/api/status');
      console.log('  [回读] 远端 v' + st.versionName + ' (#' + st.versionCode + ') 文件 ' + (st.files || []).length + ' 件');
      if (st.versionName !== version) console.warn('  [提示] 远端版本未抬升，可能 bin 未上传导致三件不齐');
    } catch (e) { console.warn('  [提示] 回读状态失败：' + e.message); }
  }
  console.log('\n结果：' + ok + '/' + items.length + (ok === items.length ? ' 全部成功' : ' 部分失败'));
  if (ok !== items.length) process.exitCode = 1;
}

main().catch(e => { console.error('[异常] ' + (e && e.stack || e)); process.exitCode = 1; });
