// afterPack 钩子：直接调用 rcedit 写入图标与版本信息。
// 背景：electron-builder 内部经 app-builder 调 rcedit 在本机偶发
// "Unable to commit changes"；直接 spawn rcedit 被验证稳定可用。
// 此钩子在打包后、生成安装包前执行；失败仅告警，不阻断构建。
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  try {
    const appOutDir = context.appOutDir;
    const productName = (context.packager && context.packager.appInfo && context.packager.appInfo.productFilename) || '鸿汇影桌面版';
    const exe = path.join(appOutDir, productName + '.exe');
    if (!fs.existsSync(exe)) { console.log('[afterPack] 未找到 exe，跳过:', exe); return; }

    const cache = process.env.LOCALAPPDATA || '';
    const rcedit = path.join(cache, 'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0', 'rcedit-x64.exe');
    if (!fs.existsSync(rcedit)) { console.log('[afterPack] 未找到 rcedit，跳过'); return; }

    const icon = path.join(context.packager.projectDir, 'assets', 'icon.ico');
    const ver = (context.packager.appInfo && context.packager.appInfo.version) || '1.7.0';
    const args = [
      exe,
      '--set-icon', icon,
      '--set-version-string', 'FileDescription', '鸿汇影桌面版',
      '--set-version-string', 'ProductName', '鸿汇影桌面版',
      '--set-version-string', 'CompanyName', 'HongHub',
      '--set-file-version', ver,
      '--set-product-version', ver + '.0'
    ];
    execFileSync(rcedit, args, { stdio: 'inherit' });
    console.log('[afterPack] rcedit 写入图标/版本成功');
  } catch (e) {
    console.warn('[afterPack] rcedit 跳过:', e && e.message);
  }
};
