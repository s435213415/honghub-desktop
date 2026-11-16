/* 收尾对齐：LIVE_STATUS 补齐 94 个频道键（实测通过的置 true）；manifest sources.v 用数字 23，
   与页面 kh-sources 的 v:23 保持同类型，避免客户端比较版本时类型不一致。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'app/index.html');
const MAN = path.join(ROOT, 'server/manifest.json');

let html = fs.readFileSync(PAGE, 'utf8');
const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));

const ch = html.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/)[0];
const ids = [...ch.matchAll(/\{id:"([^"]+)"/g)].map((m) => m[1]);
const stMatch = html.match(/var LIVE_STATUS = (\{[\s\S]*?\});/);
const st = JSON.parse(stMatch[1]);
for (const id of ids) if (!(id in st)) st[id] = true;
const ordered = {};
for (const id of ids) ordered[id] = st[id];
html = html.replace(stMatch[0], 'var LIVE_STATUS = ' + JSON.stringify(ordered) + ';');
fs.writeFileSync(PAGE, html);

man.sources.v = 23;
fs.writeFileSync(MAN, JSON.stringify(man, null, 2) + '\n');

const check = new Function(html.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/)[0].replace('var LIVE_CHANNELS', 'var X') + '; var E=[]; return [X, 1];');
console.log('频道 ' + ids.length + ' 个 · LIVE_STATUS ' + Object.keys(ordered).length + ' 个键 · manifest v=' + man.sources.v);
console.log('状态为 false 的频道：' + ids.filter((i) => ordered[i] === false).length + ' 个');
