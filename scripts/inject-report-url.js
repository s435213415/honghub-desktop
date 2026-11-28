/* 把公网收集地址写进页面内嵌 kh-sources 基线（index.html）。
   为什么必须写进基线：客户版启动时先读内嵌 kh-sources（readEmbeddedSources → applySourceData
   的 package 分支），云端清单要过 /api 口令，客户纯净版不一定拿得到。基线里 remoteUrl 是空的，
   客户就永远没有默认地址。出包前跑一次，隧道换域名就重跑。
   用法：node scripts/inject-report-url.js [https://xxx/api/report]
        不传参时读 ~/HongHubServer/current-url.txt。 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'app', 'index.html');

function fromTunnelFile() {
  try {
    const f = path.join(os.homedir(), 'HongHubServer', 'current-url.txt');
    const base = fs.readFileSync(f, 'utf8').trim().replace(/\/$/, '');
    if (/^https?:\/\//i.test(base)) return base + '/api/report';
  } catch (e) {}
  return '';
}

const url = (process.argv[2] || fromTunnelFile() || '').trim();
if (!/^https?:\/\//i.test(url)) {
  console.error('[上报地址] 没有可用地址：传参或让 HongHubServer/current-url.txt 有内容');
  process.exit(2);
}
let html = fs.readFileSync(PAGE, 'utf8');
const m = html.match(/<script id="kh-sources" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('[上报地址] 页面里没找到 kh-sources 块');
  process.exit(3);
}
let data;
try { data = JSON.parse(m[1]); } catch (e) {
  console.error('[上报地址] kh-sources 解析失败：' + e.message);
  process.exit(4);
}
const before = data.remoteUrl || '';
if (before === url) {
  console.log('[上报地址] 已是 ' + url + '，无需改动');
  process.exit(0);
}
data.remoteUrl = url;
const block = '<script id="kh-sources" type="application/json">' + JSON.stringify(data) + '</script>';
html = html.slice(0, m.index) + block + html.slice(m.index + m[0].length);
fs.writeFileSync(PAGE, html, 'utf8');
console.log('[上报地址] ' + (before || '(空)') + ' -> ' + url + ' · v' + (data.v || 0) + ' / ' + (data.count || 0) + ' 路');
