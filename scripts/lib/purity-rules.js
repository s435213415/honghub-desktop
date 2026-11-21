'use strict';
/* 客户包纯净性判定规则（#99）：被 check-client-purity.js 与单测共用。
   归一化路径后返回违规类别；合规返回 null。 */

const APP_PREFIX = 'win-unpacked/resources/app/';

function norm(p) {
  let s = String(p).replace(/\\/g, '/');
  if (s.indexOf(APP_PREFIX) === 0) s = s.slice(APP_PREFIX.length);
  return s;
}

/* 返回违规类别；合规返回 null */
function violation(rel) {
  const s = norm(rel);
  if (!s) return null;
  const base = s.split('/').pop();
  const inServer = /^server\//.test(s);
  const inData = /^server\/data\//.test(s);

  // 敏感凭证 / 证书 / 令牌文件（任意位置）
  if (/^\.env/.test(base)) return '环境变量文件';
  if (/secrets/i.test(base)) return '私密凭证文件';
  if (/\.(p12|cer|p7b|csr|pfx)$/i.test(base)) return '签名证书文件';
  if (/^access-token\.txt$/i.test(base)) return '访问令牌文件';

  // 开发端运维面板静态页
  if (inServer && /-admin\.html$/i.test(base)) return '开发端运维面板';

  // 开发端自更新模块（客户包应已删除）
  if (base === 'dev-auto-update.js') return '开发端自更新模块';

  // data 历史快照 / 备份目录
  if (/^server\/data\/snapshots\//.test(s)) return 'data 页面快照目录';
  if (/^server\/data\/catalog-backups\//.test(s)) return 'data 清单备份目录';

  // data 历史日志 / 缓存 / 报告 / 轮转快照（白名单种子 JSON 不命中）
  if (inData) {
    if (/\.(jsonl|gz|log|md|txt)$/i.test(base)) return 'data 历史日志/报告';
    if (/^catalog-snapshot-.*\.json$/.test(base)) return 'data 轮转快照';
    if (/^manifest\.before-.*\.json$/.test(base)) return 'data 回滚备份';
    if (/^app\.page\.(html|json)$/.test(base)) return 'data 页面缓存';
  }
  return null;
}

module.exports = { violation, norm, APP_PREFIX };
