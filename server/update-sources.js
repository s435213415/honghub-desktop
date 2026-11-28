'use strict';
/* 更新源多路（#158）：把一个下载地址变成"按优先级排列的候选列表 + 依次重试"。
   背景：清单拉取早有 mirrors 多源，但安装包下载只认 manifest 里的单个 desktopUrl，
   那一源 404 / 超时 / 返回错版本时整条更新链就断，客户端只能把用户甩到下载页。
   这里只做两件事：拼候选、按顺序试，失败原因逐条留档。

   候选优先级（去重后保持顺序）：
     1) 显式指定（KH_UPDATE_DOWNLOAD_URL）—— 调试 / 灰度 / 指定版本用
     2) 清单里给的绝对地址（已发布清单的 desktopUrl / 随包端点）
     3) 各镜像的版本目录：{base}/honghub/v{ver}/desktop-setup.exe{share}
     4) 各镜像的旧路径兼容：{base}/download/desktop-setup.exe{share}
     5) 本机镜像站（仅当与上面同址时跳过）：127.0.0.1:8099 的版本目录
   不含下载页这类人工兜底，它们不参与自动下载。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normBase(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

/* shareQuery 统一带前导 ?，避免拼出 //? 或重复问号 */
function normQuery(q) {
  const s = String(q || '').trim();
  if (!s) return '';
  return s[0] === '?' ? s : '?' + s;
}

function isHttp(u) {
  return /^https?:\/\//i.test(String(u || ''));
}

function verDir(ver) {
  return 'honghub/v' + String(ver || '').replace(/[^\w.\-]/g, '');
}

/* 生成候选列表。opts:
     versionName  当前要装的版本名（拼版本目录用）
     mirrors      [{baseUrl, shareQuery}]（来自 distribute.config().mirrors）
     manifest     published() 的清单对象（可能带 desktopUrl / desktopSha256 / desktopSize）
     envUrl       显式覆盖地址
     envSha / envSize
     localMirror  本机镜像站基址（默认 http://127.0.0.1:8099，传空则不加）
*/
function candidates(opts) {
  const o = opts || {};
  const ver = o.versionName || (o.manifest && o.manifest.versionName) || '';
  const out = [];
  const seen = {};

  const push = (url, label, src) => {
    const u = String(url || '').trim();
    if (!isHttp(u) || seen[u]) return;
    seen[u] = 1;
    out.push({
      url: u,
      label: label || src || u,
      from: src || '',
      sha256: null,
      size: 0,
      versionName: ver || null,
      versionCode: (o.manifest && o.manifest.versionCode) || null
    });
  };

  /* 1) 显式指定 */
  if (isHttp(o.envUrl)) {
    push(o.envUrl, 'env-override', 'env');
    if (o.envSha) out[out.length - 1].sha256 = String(o.envSha).toLowerCase();
    if (o.envSize) out[out.length - 1].size = Number(o.envSize) || 0;
  }

  /* 2) 清单给的绝对地址（带校验值，命中就不再往下试） */
  const man = o.manifest || {};
  if (isHttp(man.desktopUrl)) {
    push(man.desktopUrl, 'manifest', 'manifest');
    const last = out[out.length - 1];
    if (last && last.url === man.desktopUrl) {
      if (man.desktopSha256) last.sha256 = String(man.desktopSha256).toLowerCase();
      if (man.desktopSize) last.size = Number(man.desktopSize) || 0;
    }
  }

  /* 3) / 4) 各镜像：版本目录优先，旧路径兜底（同一镜像只加两个，避免候选爆炸） */
  const mirrors = Array.isArray(o.mirrors) ? o.mirrors : [];
  mirrors.forEach((m, i) => {
    const base = normBase(m && m.baseUrl);
    if (!base) return;
    const q = normQuery(m && m.shareQuery);
    const tag = 'mirror' + (i + 1);
    if (ver) push(base + '/' + verDir(ver) + '/desktop-setup.exe' + q, tag + '-vdir', 'mirror');
    push(base + '/download/desktop-setup.exe' + q, tag + '-download', 'mirror');
  });

  /* 5) 本机镜像站：与远程清单同版本目录，联调 / 内网直连用 */
  const localBase = o.localMirror === '' ? '' : normBase(o.localMirror || 'http://127.0.0.1:8099');
  if (localBase && ver) {
    push(localBase + '/' + verDir(ver) + '/desktop-setup.exe', 'local-mirror', 'local-mirror');
  }

  /* 校验值补位：清单只给了一个源的哈希，其余源用同一个期望值（同版本同包） */
  const expectSha = (man && man.desktopSha256) || (o.envSha ? String(o.envSha).toLowerCase() : '') || null;
  const expectSize = Number((man && man.desktopSize) || o.envSize || 0) || 0;
  out.forEach((c) => {
    if (!c.sha256 && expectSha) c.sha256 = String(expectSha).toLowerCase();
    if (!c.size && expectSize) c.size = expectSize;
  });

  return out;
}

function sha256File(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* 依次尝试候选下载到 ctx.dir/desktop-setup.exe：
     - 每个源失败（网络 / HTTP 错误码 / 体积不符 / SHA256 不符）都记一条 attempt，换下一个
     - 全部失败 → cb(err, null)，err.attempts 带明细，便于界面对用户说清"试过哪些源"
     - 成功 → cb(null, {file, sha256, size, from, url, attempts})
   ctx: {dir, download(url,dest,cb), sha256?(p), unlink?(p)}
   注意：sha256 比对是这里做的，调用方拿到结果后仍会再校验一次（幂等）。 */
function tryDownloadAll(cands, ctx, cb) {
  const list = Array.isArray(cands) ? cands : [];
  const attempts = [];
  if (!list.length) {
    const e = new Error('没有任何可用的更新源');
    e.attempts = attempts;
    return cb(e, null);
  }
  const dest = path.join(ctx.dir, 'desktop-setup.exe');
  const sha256 = ctx.sha256 || sha256File;
  const unlink = ctx.unlink || ((p) => { try { fs.unlinkSync(p); } catch (e) { /* 不存在 */ } });
  /* 换源前必须清掉 .part：续传是按"同一个 URL 的同一份半包"设计的，
     跨源续传会把两个源的字节拼成一个必然校验不过的坏包。 */
  const purge = (p) => { unlink(p); unlink(p + '.part'); };
  let i = 0;

  (function next() {
    if (i >= list.length) {
      const e = new Error('全部更新源均失败（共 ' + list.length + ' 个候选）');
      e.attempts = attempts;
      return cb(e, null);
    }
    const c = list[i++];
    if (i > 1) purge(dest);
    try { fs.mkdirSync(ctx.dir, { recursive: true }); } catch (e) { /* 已存在 */ }
    ctx.download(c.url, dest, (err, size) => {
      if (err) {
        attempts.push({ url: c.url, label: c.label, error: '下载失败：' + (err.message || err) });
        return next();
      }
      const got = Number(size) || 0;
      if (c.size && got && got !== Number(c.size)) {
        attempts.push({ url: c.url, label: c.label, error: '体积不符：期望 ' + c.size + ' B，实得 ' + got + ' B' });
        purge(dest);
        return next();
      }
      let sha = '';
      try { sha = sha256(dest); } catch (e) {
        attempts.push({ url: c.url, label: c.label, error: '读取安装包失败：' + (e.message || e) });
        return next();
      }
      if (c.sha256 && sha !== String(c.sha256).toLowerCase()) {
        attempts.push({
          url: c.url, label: c.label,
          error: 'SHA256 不符：期望 ' + String(c.sha256).slice(0, 16) + '…，实得 ' + sha.slice(0, 16) + '…'
        });
        purge(dest);   /* 坏包不留，避免下一次续传把它当半包继续用 */
        return next();
      }
      return cb(null, { file: dest, sha256: sha, size: got, from: c.label, url: c.url, attempts: attempts });
    });
  })();
}

module.exports = { candidates, tryDownloadAll, sha256File, verDir, normQuery, normBase };
