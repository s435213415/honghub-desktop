// 把 dist/release.json 的 hap 条目同步为 dist 里 HAP 的真实 size/sha256（幂等）
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const hap = 'dist/honghub-harmony.hap';
const buf = fs.readFileSync(hap);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
const size = buf.length;
const p = 'dist/release.json';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
r.artifacts = r.artifacts || {};
r.artifacts.hap = { file: 'honghub-harmony.hap', size, sha256: sha };
fs.writeFileSync(p, JSON.stringify(r, null, 2) + '\n', 'utf8');
console.log('release.json hap →', size, sha.slice(0, 12));
