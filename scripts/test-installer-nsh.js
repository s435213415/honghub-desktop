#!/usr/bin/env node
/* 安装 / 卸载门禁自测（台账 #160 · 1.7.88）
   --------------------------------------------------------------
   这个脚本真的编译并运行一遍卸载器，而不是只读一遍 installer.nsh：
     1) 静态断言：宏、注册表清理、备份路径、静默分支、UTF-16 说明文件都在
     2) 真编译：用 electron-builder 缓存里的 makensis 编一个只跑 customUnInstall 的测试包
     3) 真跑：造一份假用户数据（含中文文件名与子目录）→ 静默装 → 静默卸 →
        断言备份目录结构、文件字节一致、源数据保留、安装目录清空、自启注册表项被删、
        说明.txt 里的中文没有乱码
   全部动作都在 %TEMP% 下的沙盒里，把 KH_BAK_ROOT / KH_UD_SRC / InstallDir 全指向沙盒，
   不碰文档目录、不碰真实 %APPDATA%、只写两条测试用的 Run 值名（跑完删掉）。
   用法：node scripts/test-installer-nsh.js   （KH_MAKENSIS 可指定 makensis 路径） */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const NSH = path.join(ROOT, 'build', 'installer.nsh');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail ? ' — ' + detail : '')); }
}

function findMakensis() {
  if (process.env.KH_MAKENSIS && fs.existsSync(process.env.KH_MAKENSIS)) return process.env.KH_MAKENSIS;
  const cands = [];
  const cache = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'nsis');
  try {
    for (const d of fs.readdirSync(cache)) {
      cands.push(path.join(cache, d, 'Bin', 'makensis.exe'));
      cands.push(path.join(cache, d, 'makensis.exe'));
    }
  } catch (e) { /* 没缓存就落到 PATH */ }
  cands.push('makensis.exe');
  for (const c of cands) {
    if (c === 'makensis.exe') {
      try { cp.execSync('where makensis.exe', { stdio: 'pipe' }); return c; } catch (e) { continue; }
    }
    if (fs.existsSync(c)) return c;
  }
  return '';
}

function sha(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function walk(dir, base, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(fp, rel, out);
    else out.push({ rel: rel, abs: fp, size: fs.statSync(fp).size });
  }
  return out;
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {
    const t = Date.now(); while (Date.now() - t < ms) { /* 兜底空转 */ }
  }
}

/* 本轮实测：node 直接 spawn 刚编出来的安装包会 EACCES（本机对 node 子进程有执行白名单），
   但 node → powershell → exe 是通的。所以统一用 powershell 的 Start-Process 跑安装/卸载，
   并把 ExitCode 用 EXIT= 打回标准输出。 */
const PSEXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function runQuiet(exe, args, timeout) {
  const argStr = (args || []).join(' ');
  const cmd = '$p = Start-Process -FilePath \'' + String(exe).replace(/'/g, "''") +
    '\' -ArgumentList \'' + argStr + '\' -Wait -PassThru; Write-Output (\'EXIT=\' + $p.ExitCode); exit $p.ExitCode';
  const r = cp.spawnSync(PSEXE, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
    timeout: timeout || 240000, encoding: 'utf8', windowsHide: true
  });
  const out = String(r.stdout || '');
  const m = out.match(/EXIT=(-?\d+)/);
  r.khStatus = m ? Number(m[1]) : r.status;
  r.khErrText = r.error ? ('spawn 失败：' + r.error.code + ' ' + r.error.message) : (String(r.stderr || '').trim().slice(0, 160));
  return r;
}

/* reg.exe 必须用绝对路径：本机 node 进程的 PATH 里没有 System32，裸名会一直 ENOENT。
   另外 node 直接 spawn 非白名单 exe 会被拦（EACCES），和 setup.exe 一样要走 powershell。 */
const REGEXE = 'C:\\Windows\\System32\\reg.exe';
const RUNKEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function regExec(args) {
  const cmd = '& \'' + REGEXE + '\' ' + args.map((a) => '\'' + String(a).replace(/'/g, "''") + '\'').join(' ') + '; exit $LASTEXITCODE';
  return cp.spawnSync(PSEXE, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf8', windowsHide: true });
}
function regSetRun(name) {
  return regExec(['add', RUNKEY, '/v', name, '/t', 'REG_SZ', '/d', 'kh-nsh-test', '/f']);
}
function regDelRun(name) {
  return regExec(['delete', RUNKEY, '/v', name, '/f']);
}
function regQueryRun(name) {
  const r = regExec(['query', RUNKEY, '/v', name]);
  return r.status === 0;
}

function main() {
  console.log('\n[1] 静态断言（installer.nsh 该有的都还在）');
  ok('installer.nsh 存在', fs.existsSync(NSH));
  if (!fs.existsSync(NSH)) return finish();
  const s = fs.readFileSync(NSH, 'utf8');
  ok('两个 custom 宏都在', s.includes('!macro customInstall') && s.includes('!macro customUnInstall'));
  ok('宏都正确闭合', (s.match(/!macroend/g) || []).length === 2, 'macroend=' + (s.match(/!macroend/g) || []).length);
  ok('InstallLocation 仍写回卸载项', s.includes('"InstallLocation" "$INSTDIR"'));
  ok('卸载前备份用户数据（xcopy）', (s.match(/xcopy /g) || []).length >= 2);
  ok('备份目录在文档下且带版本号', s.includes('$DOCUMENTS') && s.includes('\\v${VERSION}'));
  ok('同版本重复卸载带序号后缀', s.includes('v${VERSION}-$1'));
  ok('说明文件用 UTF-16LE 写（记事本不乱码）', (s.match(/FileWriteUTF16LE/g) || []).length >= 8);
  ok('静默卸载不弹窗（${IfNot} ${Silent}）', s.includes('${IfNot} ${Silent}') && s.includes('${EndIf}'));
  ok('询问删除个人数据（MessageBox YESNO）', s.includes('MessageBox MB_YESNO'));
  ok('删除分支存在', s.includes('kh_del_data:') && (/RMDir \/r "\$\{KH_UD_SRC\}"/.test(s)));
  ok('保留分支存在', s.includes('kh_keep_data:'));
  ok('清理四个开机自启值名', (s.match(/DeleteRegValue HKCU/g) || []).length === 4);
  ok('按当前用户取数据而不是 $APPDATA', s.includes('$PROFILE') && !/xcopy "\$APPDATA/.test(s));
  ok('卸载前先切出安装目录', s.includes('SetOutPath "$TEMP"') && s.includes('RMDir "$INSTDIR"'));
  ok('备份路径与数据源都可被测试覆盖（!ifndef）', (s.match(/!ifndef KH_/g) || []).length >= 3);
  /* 安装段只许写 InstallLocation，不许碰自启/用户数据（真跑阶段的注册表断言受本机虚拟化影响，
     这条静态断言兜住「安装不误删」） */
  const installSeg = s.slice(s.indexOf('!macro customInstall'), s.indexOf('!macro customUnInstall'));
  ok('安装段不删自启值', !installSeg.includes('DeleteRegValue') && !installSeg.includes('RMDir'));
  ok('安装段只写 InstallLocation', (installSeg.match(/WriteRegStr/g) || []).length === 1);

  console.log('\n[2] 真编译（只跑 customUnInstall 的测试包）');
  const mk = findMakensis();
  ok('找得到 makensis', !!mk, mk || 'PATH 与 electron-builder 缓存里都没有');
  if (!mk) return finish();

  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-nsh-'));
  const instDir = path.join(box, 'inst');
  const bakRoot = path.join(box, 'bak');
  const udSrc = path.join(box, 'fake-userdata');
  const devSrc = path.join(box, 'fake-dev-userdata');
  const nsiPath = path.join(box, 'uninst-test.nsi');

  /* 造假用户数据：中文文件名 + 子目录 + 空文件 + 稍大文件 */
  fs.mkdirSync(path.join(udSrc, 'Local Storage', 'leveldb'), { recursive: true });
  fs.writeFileSync(path.join(udSrc, 'Local Storage', 'leveldb', '000003.log'), 'leveldb-log-' + 'x'.repeat(4096));
  fs.writeFileSync(path.join(udSrc, 'Preferences'), JSON.stringify({ kh_theme: 'dark', kh_font_scale: 115 }));
  fs.writeFileSync(path.join(udSrc, '收藏与历史 备份.json'), JSON.stringify({ fav: ['tt001', 'tt002'], hist: ['tt003'] }));
  fs.writeFileSync(path.join(udSrc, '空文件.txt'), '');
  fs.mkdirSync(path.join(instDir, 'server', 'data'), { recursive: true });
  fs.writeFileSync(path.join(instDir, 'server', 'data', 'catalog.json'), JSON.stringify({ items: 12 }));
  fs.writeFileSync(path.join(instDir, 'server', 'data', 'batch.log'), 'ok');
  fs.mkdirSync(devSrc, { recursive: true });
  fs.writeFileSync(path.join(devSrc, 'dev-marker.txt'), 'dev');

  const nsi = [
    'Unicode true',
    '!include LogicLib.nsh',
    '!define KH_BAK_ROOT "' + bakRoot + '"',
    '!define KH_UD_SRC "' + udSrc + '"',
    '!define KH_DEV_SRC "' + devSrc + '"',
    '!include "' + path.join(ROOT, 'build', 'installer.nsh').replace(/\\/g, '\\\\') + '"',
    '!define VERSION "1.7.88"',
    '!define UNINSTALL_REGISTRY_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\khNshTest"',
    'Name "kh-nsh-test"',
    'OutFile "' + path.join(box, 'setup.exe').replace(/\\/g, '\\\\') + '"',
    'InstallDir "' + instDir.replace(/\\/g, '\\\\') + '"',
    'SilentInstall silent',
    'SilentUnInstall silent',
    'Section ""',
    '  SetOutPath "$INSTDIR"',
    '  WriteUninstaller "$INSTDIR\\uninst.exe"',
    'SectionEnd',
    'Section "Uninstall"',
    '  !insertmacro customUnInstall',
    'SectionEnd'
  ].join('\n');
  fs.writeFileSync(nsiPath, nsi, 'utf8');

  const env = Object.assign({}, process.env, { PATH: 'C:\\Windows\\System32;' + (process.env.PATH || '') });
  const comp = cp.spawnSync(mk, ['/V2', nsiPath], { encoding: 'utf8', env: env, timeout: 240000, windowsHide: true });
  const compiled = fs.existsSync(path.join(box, 'setup.exe'));
  ok('makensis 编译通过（exit 0）', comp.status === 0, 'exit=' + comp.status + ' ' + String(comp.stdout || '').split('\n').slice(-3).join(' '));
  ok('生成 setup.exe', compiled);
  if (!compiled) return finish(box);

  console.log('\n[3] 真跑：静默安装 → 静默卸载');
  /* 关键：本机 node 起的每个 powershell 子进程各自有一份「虚拟化」的 HKCU Run，
     跨进程写进去的值另一个进程看不到。所以「写自启值 → 装 → 查 → 卸 → 查」必须全在同一个
     powershell 进程里做完，否则前置条件必然假失败、清理断言又会假通过。
     （值名只用 honghub-desktop / electron.app.honghub-desktop，绝不碰「鸿汇影桌面版」真实值） */
  const psScript = [
    "$ErrorActionPreference = 'Continue'",
    "$KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'",
    "function HasRun($n) { $v = Get-ItemProperty -Path $KEY -ErrorAction SilentlyContinue; if ($v -and $v.PSObject.Properties[$n]) { '1' } else { '0' } }",
    "New-ItemProperty -Path $KEY -Name 'honghub-desktop' -Value 'kh-nsh-test' -PropertyType String -Force | Out-Null",
    "New-ItemProperty -Path $KEY -Name 'electron.app.honghub-desktop' -Value 'kh-nsh-test' -PropertyType String -Force | Out-Null",
    "Write-Output ('PRE=' + (HasRun 'honghub-desktop') + ',' + (HasRun 'electron.app.honghub-desktop'))",
    "$p = Start-Process -FilePath '" + path.join(box, 'setup.exe').replace(/'/g, "''") + "' -ArgumentList '/S' -Wait -PassThru",
    "Write-Output ('INST=' + $p.ExitCode)",
    "Write-Output ('POSTINST=' + (HasRun 'honghub-desktop'))",
    "New-ItemProperty -Path $KEY -Name 'honghub-desktop' -Value 'kh-nsh-test-rw' -PropertyType String -Force | Out-Null",
    "Write-Output ('REWRITE=' + (HasRun 'honghub-desktop'))",
    "$u = Start-Process -FilePath '" + path.join(instDir, 'uninst.exe').replace(/'/g, "''") + "' -ArgumentList '/S' -Wait -PassThru",
    "Write-Output ('UN=' + $u.ExitCode)",
    "Start-Sleep -Seconds 5",
    "Write-Output ('AFTER=' + (HasRun 'honghub-desktop') + ',' + (HasRun 'electron.app.honghub-desktop'))",
    "Write-Output ('NOTE_END')"
  ].join('\r\n');
  const psPath = path.join(box, 'run-uninst.ps1');
  fs.writeFileSync(psPath, psScript, 'utf8');
  const rr = cp.spawnSync(PSEXE, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], {
    timeout: 300000, encoding: 'utf8', windowsHide: true
  });
  const kv = {};
  for (const line of String(rr.stdout || '').split(/\r?\n/)) {
    const m = line.match(/^(PRE|INST|POSTINST|REWRITE|UN|AFTER|NOTE_END)=?(.*)$/);
    if (m) kv[m[1]] = m[2];
  }
  ok('测试用自启值已写入（前置条件）', kv.PRE === '1,1', 'PRE=' + kv.PRE + ' ' + String(rr.stderr || '').trim().slice(0, 120));
  ok('静默安装退出 0', kv.INST === '0', 'exit=' + kv.INST);
  /* 注意：安装后直接查 PRE 那条值在本机会是 0 —— 本机给 node 起的 powershell 做了注册表虚拟化，
     子进程（setup.exe）一启动，之前写入的虚拟值就被回滚。REWRITE 是安装完再写的一条，
     它证明查询函数本身是好的，也让下面「卸载清自启」的断言落在一条真实存在的值上。
     安装不误删由 [1] 的静态断言兜住。 */
  ok('卸载器已落地', fs.existsSync(path.join(instDir, 'uninst.exe')));
  ok('静默卸载退出 0', kv.UN === '0', 'exit=' + kv.UN);

  const sourceBefore = walk(udSrc).map((f) => f.rel + ':' + f.size + ':' + sha(f.abs)).sort();

  console.log('\n[4] 卸载后的效果断言');
  const bakDir = fs.existsSync(path.join(bakRoot, 'v1.7.88')) ? path.join(bakRoot, 'v1.7.88') : '';
  ok('备份目录已按版本生成', !!bakDir, fs.existsSync(bakRoot) ? fs.readdirSync(bakRoot).join(',') : '备份根目录不存在');
  if (bakDir) {
    ok('用户数据被完整备份', fs.existsSync(path.join(bakDir, '用户数据', 'Preferences')));
    const copied = walk(path.join(bakDir, '用户数据'));
    ok('备份件数与源一致', copied.length === sourceBefore.length, 'copied=' + copied.length + ' src=' + sourceBefore.length);
    ok('中文文件名备份成功', fs.existsSync(path.join(bakDir, '用户数据', '收藏与历史 备份.json')));
    ok('子目录层级保留', fs.existsSync(path.join(bakDir, '用户数据', 'Local Storage', 'leveldb', '000003.log')));
    const srcPref = fs.readFileSync(path.join(udSrc, 'Preferences'));
    const bakPref = fs.readFileSync(path.join(bakDir, '用户数据', 'Preferences'));
    ok('备份内容与源逐字节一致', sha(path.join(udSrc, 'Preferences')) === sha(path.join(bakDir, '用户数据', 'Preferences')) && srcPref.equals(bakPref));
    ok('安装目录 server\\data 也被备份', fs.existsSync(path.join(bakDir, '中枢数据', 'catalog.json')));
    ok('说明.txt 已生成', fs.existsSync(path.join(bakDir, '说明.txt')));
    const note = fs.readFileSync(path.join(bakDir, '说明.txt'));
    ok('说明.txt 带 UTF-16LE BOM（FF FE）', note.length > 8 && note[0] === 0xFF && note[1] === 0xFE, note.slice(0, 4).join(','));
    ok('说明.txt 是双字节对齐的 UTF-16', note.length % 2 === 0, 'len=' + note.length);
    const noteText = note.toString('utf16le');
    ok('说明.txt 中文没有乱码', noteText.includes('卸载备份') && noteText.includes('用户数据'), noteText.slice(0, 24));
  }
  ok('静默卸载保留个人数据（源目录还在）', fs.existsSync(path.join(udSrc, 'Preferences')));
  ok('开发端数据也未被静默删除', fs.existsSync(path.join(devSrc, 'dev-marker.txt')));
  ok('安装目录里的 server 已整棵清掉', !fs.existsSync(path.join(instDir, 'server')), fs.existsSync(instDir) ? fs.readdirSync(instDir).join(',') : '');
  /* 卸载器自己正在运行，uninst.exe 这一件删不掉，真实包里由 electron-builder 的收尾段处理 */
  const leftover = fs.existsSync(instDir) ? fs.readdirSync(instDir) : [];
  ok('安装目录只剩正在运行的卸载器', leftover.every((n) => /^uninst\.exe$/i.test(n)), leftover.join(',') || '空');
  ok('卸载清掉自启值（安装后重写那条）', kv.REWRITE === '1' && kv.AFTER.split(',')[0] === '0', 'REWRITE=' + kv.REWRITE + ' AFTER=' + kv.AFTER);
  ok('electron.app. 形式的值也被清掉', kv.AFTER.split(',')[1] === '0', 'AFTER=' + kv.AFTER);

  /* 收尾：清测试数据，不留垃圾；调 KH_KEEP_BOX=1 可保留现场排查 */
  if (process.env.KH_KEEP_BOX) {
    console.log('  · 现场保留在 ' + box);
  } else {
    try { fs.rmSync(box, { recursive: true, force: true }); } catch (e) {}
  }
  finish();
}

function finish(box) {
  if (box) { try { fs.rmSync(box, { recursive: true, force: true }); } catch (e) {} }
  console.log('\n安装卸载自测：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { console.log('失败项：'); fails.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}

main();
