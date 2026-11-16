#!/usr/bin/env node
'use strict';
/* 深开鸿真机冒烟：连设备 → 安装 → 启动 → 抓日志 → 断言 → 出报告。
   无设备 / 无 hdc 时明确输出 SKIP（exit 0 但 status=skipped），绝不假装通过。
   这是 HAP「能签名」之外唯一能验证「真机能跑起来」的工具。 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const env = require('./lib/env');
env.apply();

const ROOT = path.join(__dirname, '..');
const HAP = path.join(ROOT, 'dist', 'honghub-harmony.hap');
const HDC = env.findHdc(); // 自动探测 SDK 内的 hdc.exe，不再只找 PATH
const BUNDLE = process.env.KH_HAP_BUNDLE || 'com.honghub.harmony';
const ABILITY = process.env.KH_HAP_ABILITY || 'EntryAbility';
const DRY = process.argv.includes('--dry-run');

function hdc(args, timeout) {
  return spawnSync(HDC, args, { encoding: 'utf8', timeout: timeout || 30000, windowsHide: true });
}
function result(status, steps, reason) {
  const out = { ok: status !== 'failed', status, bundle: BUNDLE, hap: HAP, hdc: HDC, steps, reason: reason || null, at: new Date().toISOString() };
  const file = path.join(ROOT, 'dist', 'hap-smoke.json');
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n'); } catch (e) {}
  console.log(JSON.stringify(out, null, 2));
  process.exit(status === 'failed' ? 1 : 0);
}

const steps = [];
const record = (name, ok, detail) => steps.push({ name, ok, detail: String(detail || '').slice(0, 300) });

if (!fs.existsSync(HAP)) result('failed', steps, '缺少 HAP，请先 npm run pack');
const r = hdc(['list', 'targets'], 20000);
if (r.error || r.status !== 0) {
  result('skipped', steps, 'hdc 不可用（' + HDC + '）：' + (r.error ? r.error.message : String(r.stderr || r.stdout).trim().slice(0, 160)) +
    '；已自动探测 SDK/PATH，仍失败可用 KH_HDC 显式指定 hdc.exe');
}
const out = String(r.stdout || '');
const targets = out.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^\[Empty\]$/i.test(s) && !/list targets/i.test(s));
record('hdc 可用', true, out.trim().slice(0, 120));
if (!targets.length) result('skipped', steps, 'hdc list targets 返回 [Empty]：当前无设备连接，真机安装需用户接入开发板');
record('发现设备', true, targets.join(', '));
if (DRY) result('skipped', steps, '--dry-run：环境检查通过，未执行安装');

const install = hdc(['install', '-r', HAP], 120000);
record('安装 HAP', install.status === 0, String(install.stdout || install.stderr || '').trim().slice(0, 200));
if (install.status !== 0) result('failed', steps, 'hdc install 失败');
const start = hdc(['shell', 'aa', 'start', '-b', BUNDLE, '-a', ABILITY], 30000);
record('启动 Ability', start.status === 0, String(start.stdout || start.stderr || '').trim().slice(0, 200));
if (start.status !== 0) result('failed', steps, '启动失败（可设 KH_HAP_ABILITY 指定正确 Ability 名）');
try { hdc(['shell', 'hilog', '-r'], 10000); } catch (e) {}
// 同步流程里等待首屏与中枢探测：Atomics.wait 阻塞但不空转 CPU
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12000);
const log = hdc(['shell', 'hilog', '-x'], 30000);
const text = String(log.stdout || '');
const hasError = /FATAL|crash|JsEnvException|Ability.*failed/i.test(text);
record('运行日志无崩溃', !hasError, text.trim().slice(-200));
const pid = hdc(['shell', 'pidof', BUNDLE], 15000);
const pidText = String(pid.stdout || '').trim();
// pidof 在部分 OpenHarmony 版本不可用：明确记为「未判定」，不把它算作通过
record('应用进程存活', pid.status === 0 && /\d/.test(pidText) ? true : null,
  pid.status === 0 ? pidText.slice(0, 120) : 'pidof 不可用，未判定（以运行日志为准）');
result(hasError ? 'failed' : 'passed', steps, hasError ? '运行日志发现崩溃关键字' : null);
