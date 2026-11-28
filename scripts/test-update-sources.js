'use strict';
/* #158 自测：更新源多路。
   覆盖三件事：
     1) 候选列表的优先级与去重、shareQuery 归一化
     2) 多源依次重试：404 → 换源；SHA256 不符 → 删坏包再换源；最终命中可用源
     3) 全部失败时 attempts 明细齐全（客户端要靠它说清"试过哪些源、各报什么错"）
   只跑本机回环端口，不联网、不触碰真实安装包目录。
   用法：node scripts/test-update-sources.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const us = require('../server/update-sources');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(a, b, name) { ok(a === b, name, 'expect=' + b + ' actual=' + a); }

/* ---------- 1) 候选列表 ---------- */
console.log('1) 候选列表优先级');
const cands = us.candidates({
  versionName: '1.7.86',
  envUrl: '',
  manifest: {
    desktopUrl: 'https://m.example.com/honghub/v1.7.86/desktop-setup.exe?sharecode=SHARE',
    desktopSha256: 'ABCDEF'.toLowerCase() + '0'.repeat(58),
    desktopSize: 1234,
    versionName: '1.7.86',
    versionCode: 1000200
  },
  mirrors: [
    { baseUrl: 'https://a.example.com/', shareQuery: 'sharecode=A1' },
    { baseUrl: 'https://a.example.com', shareQuery: '?sharecode=A1' },   /* 重复基址应被跳过 */
    { baseUrl: 'https://b.example.com', shareQuery: '?sharecode=B2' }
  ],
  localMirror: 'http://127.0.0.1:8099'
});
const urls = cands.map((c) => c.url);
eq(urls[0], 'https://m.example.com/honghub/v1.7.86/desktop-setup.exe?sharecode=SHARE', '清单地址排第一');
ok(urls.indexOf('https://a.example.com/honghub/v1.7.86/desktop-setup.exe?sharecode=A1') >= 0, '镜像版本目录 + shareQuery 归一化(? 补齐)');
ok(urls.indexOf('https://a.example.com/download/desktop-setup.exe?sharecode=A1') >= 0, '镜像旧路径兜底');
eq(urls.filter((u) => u.indexOf('https://a.example.com/') === 0).length, 2, '重复镜像基址只展开一次');
ok(urls.indexOf('https://b.example.com/honghub/v1.7.86/desktop-setup.exe?sharecode=B2') >= 0, '第二镜像进入候选');
eq(urls[urls.length - 1], 'http://127.0.0.1:8099/honghub/v1.7.86/desktop-setup.exe', '本机镜像站压尾');
ok(urls.indexOf('https://m.example.com/honghub/v1.7.86/desktop-setup.exe?sharecode=SHARE') === 0, '清单地址不会重复展开');
ok(cands[0].sha256 === 'abcdef' + '0'.repeat(58), '清单哈希下发到候选');
ok(cands[cands.length - 1].sha256 === 'abcdef' + '0'.repeat(58), '其余源共用同一期望哈希');
ok(urls.every((u) => /^https?:/.test(u)), '所有候选都是 http(s)，不含下载页/相对路径');

const envOnly = us.candidates({ versionName: '1.7.86', envUrl: 'https://e.example.com/fix.exe', mirrors: [] });
eq(envOnly[0].url, 'https://e.example.com/fix.exe', 'env 候选排第一');
eq(envOnly[0].from, 'env', 'env 候选带来源标记（server.js 据此只试它）');
eq(envOnly.filter((c) => c.from === 'env').length, 1, 'env 候选不重复');

/* ---------- 2) 多源依次重试 ---------- */
console.log('2) 依次重试（真实 HTTP）');
const SIZE = 11 * 1024 * 1024;                      /* > 10MB，贴近真实安装包闸门 */
const good = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i += 4096) crypto.randomBytes(4096).copy(good, i);
const goodSha = crypto.createHash('sha256').update(good).digest('hex');
const bad = Buffer.alloc(SIZE, 7);                   /* 体积相同、内容不同 → 只可能被 SHA 挡住 */
const badSha = crypto.createHash('sha256').update(bad).digest('hex');

const tmpDir = path.join(os.tmpdir(), 'kh_updsrc_test_' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

const server = http.createServer((req, res) => {
  if (req.url.indexOf('/a/') === 0) { res.writeHead(404); res.end('not found'); return; }
  if (req.url.indexOf('/b/') === 0) { res.writeHead(200, { 'Content-Length': bad.length }); res.end(bad); return; }
  if (req.url.indexOf('/c/') === 0) { res.writeHead(200, { 'Content-Length': good.length }); res.end(good); return; }
  res.writeHead(500); res.end('boom');
});

/* 与 server.js 的 downloadToFile 同构：先写 .part 再原子改名，便于验证换源清 .part */
function download(url, dest, cb) {
  const got = url.indexOf('http') === 0 ? url : 'http://127.0.0.1:' + port + url;
  const part = dest + '.part';
  let settled = false;
  const done = (e, n) => { if (!settled) { settled = true; cb(e, n); } };
  http.get(got, { timeout: 8000 }, (r) => {
    if (r.statusCode !== 200) { r.resume(); return done(new Error('HTTP ' + r.statusCode)); }
    const out = fs.createWriteStream(part);
    r.pipe(out);
    out.on('finish', () => {
      try { fs.renameSync(part, dest); } catch (e) { return done(e); }
      done(null, fs.statSync(dest).size);
    });
    out.on('error', done);
  }).on('error', (e) => done(e)).on('timeout', function () { this.destroy(); done(new Error('timeout')); });
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  const list = us.candidates({
    versionName: '1.7.86',
    manifest: { desktopUrl: base + '/a/desktop-setup.exe', desktopSha256: goodSha, desktopSize: SIZE },
    mirrors: [
      { baseUrl: base + '/b', shareQuery: '' },
      { baseUrl: base + '/c', shareQuery: '' }
    ],
    localMirror: ''
  });
  /* 只留三个有意义的候选：/a（404）、/b（内容被篡改）、/c（正确） */
  const seq = [
    { url: base + '/a/desk.exe', label: 'srcA', sha256: goodSha, size: 0 },
    { url: base + '/b/desk.exe', label: 'srcB', sha256: goodSha, size: 0 },
    { url: base + '/c/desk.exe', label: 'srcC', sha256: goodSha, size: 0 }
  ];
  ok(list.length >= 3, '候选里含镜像展开的地址（' + list.length + ' 条）');

  us.tryDownloadAll(seq, { dir: tmpDir, download: download }, (err, hit) => {
    ok(!err, '三次尝试后拿到可用包', err && err.message);
    if (!err && hit) {
      eq(hit.from, 'srcC', '命中的是第三个源');
      eq(hit.sha256, goodSha, '落盘内容 SHA256 与期望一致');
      eq(hit.size, SIZE, '体积一致');
      eq(hit.attempts.length, 2, '前两个源各留一条失败记录');
      ok(/HTTP 404/.test(hit.attempts[0].error), '第一个源记的是 404', hit.attempts[0].error);
      ok(/SHA256 不符/.test(hit.attempts[1].error), '第二个源记的是哈希不符', hit.attempts[1].error);
      ok(!fs.existsSync(path.join(tmpDir, 'desktop-setup.exe.part')), '成功时不留 .part');
    }

    /* 全失败：只剩 404 与坏包 */
    const seq2 = seq.slice(0, 2);
    const tmpDir2 = tmpDir + '_2';
    us.tryDownloadAll(seq2, { dir: tmpDir2, download: download }, (err2, hit2) => {
      ok(!!err2 && !hit2, '全部源失败时返回错误');
      eq(err2 && err2.attempts && err2.attempts.length, 2, '失败明细 2 条');
      ok(err2 && /全部更新源均失败/.test(err2.message), '错误文案说明"全部源失败"', err2 && err2.message);
      ok(!fs.existsSync(path.join(tmpDir2, 'desktop-setup.exe')), '坏包不留在下载目录');

      /* 体积不符分支：返回被截断的半包 */
      const seq3 = [{ url: base + '/trunc/desk.exe', label: 'short', sha256: goodSha, size: SIZE }];
      const srv2 = http.createServer((rq, rs) => { rs.writeHead(200); rs.end(good.slice(0, 1024)); });
      srv2.listen(0, '127.0.0.1', () => {
        const b3 = 'http://127.0.0.1:' + srv2.address().port;
        us.tryDownloadAll([{ url: b3 + '/t.exe', label: 'short', sha256: goodSha, size: SIZE }],
          { dir: tmpDir + '_3', download: download }, (err3) => {
            ok(!!err3, '半包也会被拒');
            ok(err3 && /体积不符/.test(err3.attempts[0].error), '记体积不符', err3 && err3.attempts[0].error);
            srv2.close();
            finish();
          });
      });
    });
  });

  function finish() {
    server.close(() => {});
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(tmpDir + '_2', { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(tmpDir + '_3', { recursive: true, force: true }); } catch (e) {}
    console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
    process.exit(fail ? 1 : 0);
  }
});
