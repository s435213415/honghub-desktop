#!/usr/bin/env node
'use strict';
/* 依赖审计 + CycloneDX-lite SBOM（零新增依赖）。
   npm audit 需要网络，离线时标 unavailable，不阻断出包。 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const lockFile = path.join(ROOT, 'package-lock.json');
fs.mkdirSync(DIST, { recursive: true });

let components = [];
try {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const pkgs = lock.packages || {};
  for (const [p, meta] of Object.entries(pkgs)) {
    if (!p || !meta || !meta.version) continue;
    const name = String(p).replace(/^node_modules\//, '').split('/node_modules/').pop();
    components.push({ type: 'library', name, version: meta.version,
      purl: 'pkg:npm/' + encodeURIComponent(name) + '@' + meta.version,
      scope: meta.dev ? 'optional' : 'required' });
  }
} catch (e) { console.error('  读取 package-lock.json 失败：' + e.message); process.exit(1); }
const bom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: 'urn:uuid:honghub-' + Date.now(),
  version: 1,
  metadata: { timestamp: new Date().toISOString(),
    component: { type: 'application', name: 'honghub-desktop', version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version } },
  components
};
fs.writeFileSync(path.join(DIST, 'sbom.json'), JSON.stringify(bom, null, 2) + '\n');
console.log('  SBOM：' + components.length + ' 个组件 → dist/sbom.json');

let summary = { available: false, vulnerabilities: null };
if (process.env.KH_SKIP_AUDIT === '1') {
  summary = { available: false, reason: '已设置 KH_SKIP_AUDIT=1（离线构建可跳过网络审计）' };
} else {
  const audit = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--omit=dev', '--json'],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  if (!audit.error && audit.stdout) {
    try {
      const a = JSON.parse(audit.stdout);
      summary = { available: true, vulnerabilities: (a.metadata && a.metadata.vulnerabilities) || {}, exitCode: audit.status };
    } catch (e) { summary = { available: false, reason: 'npm audit 输出无法解析' }; }
  } else summary = { available: false, reason: 'npm audit 不可用（离线或超时）' };
}
fs.writeFileSync(path.join(DIST, 'audit.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('  依赖审计：' + (summary.available ? JSON.stringify(summary.vulnerabilities) : summary.reason));
console.log('  注意：审计为只读报告，未自动升级依赖（避免破坏已验证的构建链）。');
