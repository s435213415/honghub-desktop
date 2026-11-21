'use strict';
/* 前端页面聚合视图（1.7.72 模块化配套）
   app/index.html 已拆成内核壳 + app/kh-*.js 外链脚本。所有门禁脚本原本按「单文件页面」
   做正则扫描，拆分后会扫不到函数与模板，从而假绿。这里把外链脚本按出现顺序内联回去，
   给出一个与拆分前等价的「逻辑源码」视图，门禁照旧工作。
   —— 只读工具，不写任何文件。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function inlineScripts(html, dir) {
  return html.replace(/<script([^>]*?)src="([^"]+)"([^>]*?)>\s*<\/script>/g, (m, pre, src, post) => {
    const file = path.resolve(dir, src);
    let code = '';
    try { code = fs.readFileSync(file, 'utf8'); }
    catch (e) { code = '/* [frontend-source] 外链脚本缺失：' + src + ' */'; }
    return '<script' + pre.replace(/\s*src="[^"]+"/, '') + post + '>\n' + code + '\n</script>';
  });
}

/* relPath 支持 'app/index.html' 这类相对仓库根的路径，也接受绝对路径 */
function merged(relPath) {
  const p = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  const html = fs.readFileSync(p, 'utf8');
  return inlineScripts(html, path.dirname(p));
}

/* 页面引用了哪些外链脚本（相对页面目录） */
function scriptsOfPage(relPath) {
  const p = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  const html = fs.readFileSync(p, 'utf8');
  return Array.from(html.matchAll(/<script[^>]*?src="([^"]+)"[^>]*?>\s*<\/script>/g)).map(m => m[1]);
}

module.exports = { ROOT, merged, inlineScripts, scriptsOfPage };
