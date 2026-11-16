#!/usr/bin/env node
'use strict';
/* 自动下发成品 · 不限内存大小都能看（零依赖、纯同步、可被服务端 / 脚本 / 自检独立调用）
 *
 * 背景：完整安装包约 77MB、需要安装；极小内存 / 低配机器装不动或装完播放卡顿。
 * 方案：一次发版同时产出三条下发通道，客户端按「架构 + 内存」自动选路，无需人工选择：
 *   1) lite  免安装在线影站（页面约 262KB、HLS 流式分片）→ 任意内存设备打开网址即可看
 *   2) hap   深开鸿设备端签名包（约 363KB）→ 设备端任意内存
 *   3) full  桌面完整安装包（x64 / ia32 / arm64）→ 内存充足时才推荐
 * 播放侧按内存档设「缓冲字节数 / 缓冲秒数 / 起始码率」硬上限，低内存自动降到最低码率，
 * 因此不会因为机器内存小就加载过量分片导致卡死或崩溃。
 *
 * 安全约束：不抬高应用版本号；只描述已存在的产物，不下载、不安装、不删除任何文件。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/* 内存档位表：所有数字都是「上限」，档位越低越保守。前端 khHlsConfig 内置同款默认值。 */
const TIERS = {
  tiny: {
    label: '极小内存（≤1GB）', maxMemGB: 1,
    maxBufferLength: 4, maxMaxBufferLength: 8, maxBufferSizeMB: 6,
    backBufferLength: 5, startLevel: 0, enableWorker: false,
    capLevel: 0, abrEwmaDefaultEstimate: 300000, abrBandWidthFactor: 0.7,
    fragmentTimeoutMs: 10000, guardIntervalMs: 30000
  },
  low: {
    label: '低内存（≤2GB）', maxMemGB: 2,
    maxBufferLength: 6, maxMaxBufferLength: 12, maxBufferSizeMB: 10,
    backBufferLength: 10, startLevel: 0, enableWorker: false,
    capLevel: 1, abrEwmaDefaultEstimate: 450000, abrBandWidthFactor: 0.8,
    fragmentTimeoutMs: 12000, guardIntervalMs: 25000
  },
  medium: {
    label: '常规内存（≤4GB）', maxMemGB: 4,
    maxBufferLength: 12, maxMaxBufferLength: 24, maxBufferSizeMB: 24,
    backBufferLength: 20, startLevel: -1, enableWorker: true,
    capLevel: -1, abrEwmaDefaultEstimate: 800000, abrBandWidthFactor: 0.9,
    fragmentTimeoutMs: 18000, guardIntervalMs: 20000
  },
  high: {
    label: '充足内存（>4GB）', maxMemGB: Infinity,
    maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSizeMB: 60,
    backBufferLength: 30, startLevel: -1, enableWorker: true,
    capLevel: -1, abrEwmaDefaultEstimate: 1200000, abrBandWidthFactor: 0.95,
    fragmentTimeoutMs: 20000, guardIntervalMs: 20000
  }
};
const TIER_ORDER = ['tiny', 'low', 'medium', 'high'];
const GUARANTEE = '所有包不限设备、不限内存：任意系统 / 架构 / 内存都有可用成品，未知设备与低内存自动保底走免安装在线影站；' +
  'Windows 各架构走原生包、深开鸿走轻量 HAP；播放缓冲与码率按内存档设硬上限；三条通道随发版自动更新，无需人工';

function parseMemGB(v, defaultGB) {
  if (v === undefined || v === null || v === '') return { gb: defaultGB, known: false };
  const raw = String(v).trim().toLowerCase();
  if (TIERS[raw]) return { gb: TIERS[raw].maxMemGB === Infinity ? 8 : TIERS[raw].maxMemGB, known: true, named: raw };
  let n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n < 0) return { gb: defaultGB, known: false };
  if (/mb/.test(raw) || n > 32) n = n / 1024;       // 512 / 512mb / 2048 都按 MB 处理
  return { gb: n, known: true };
}

function memoryTier(v, defaultGB) {
  const m = parseMemGB(v, defaultGB === undefined ? 4 : defaultGB);
  if (m.named) return m.named;
  const gb = m.gb;
  for (const t of TIER_ORDER) if (gb <= TIERS[t].maxMemGB) return t;
  return 'high';
}

/* 交给 hls.js 的配置子集（未知配置项会被组件忽略，因此兼容不同版本） */
function playback(tier) {
  const t = TIERS[tier] || TIERS.medium;
  return {
    enableWorker: t.enableWorker,
    lowLatencyMode: false,
    backBufferLength: t.backBufferLength,
    maxBufferLength: t.maxBufferLength,
    maxMaxBufferLength: t.maxMaxBufferLength,
    maxBufferSize: t.maxBufferSizeMB * 1000 * 1000,
    capLevelToPlayerSize: true,
    startLevel: t.startLevel,
    autoLevelCapping: t.capLevel,
    abrEwmaDefaultEstimate: t.abrEwmaDefaultEstimate,
    abrBandWidthFactor: t.abrBandWidthFactor,
    abrBandWidthUpFactor: t.capLevel === 0 ? 0.5 : 0.7,
    maxLoadingDelay: t.maxBufferLength / 2,
    fragLoadingMaxRetry: 3,
    manifestLoadingMaxRetry: 2,
    levelLoadingMaxRetry: 3,
    fragLoadingTimeOut: t.fragmentTimeoutMs,
    manifestLoadingTimeOut: Math.max(6000, t.fragmentTimeoutMs - 2000),
    levelLoadingTimeOut: Math.max(6000, t.fragmentTimeoutMs - 2000)
  };
}

function archKey(a) {
  const s = String(a || '').toLowerCase();
  if (/arm|aarch64/.test(s)) return 'arm64';
  if (/ia32|x86[^6]|32/.test(s)) return 'ia32';
  return 'x64';
}

function json(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }

/* 单台设备的自动选路：返回可直接使用的成品地址 + 播放参数，无需人工判断 */
function plan(query) {
  const q = query || {};
  const arch = archKey(q.arch);
  const platform = String(q.platform || '').toLowerCase();
  const mem = parseMemGB(q.mem !== undefined ? q.mem : q.memory, 4);
  const tier = memoryTier(q.mem !== undefined ? q.mem : q.memory, 4);
  const t = TIERS[tier];
  const archsSnap = q.archs || json(path.join(DIST, 'archs.json'), {});
  const delivery = q.delivery || json(path.join(DIST, 'delivery.json'), {});
  const files = archsSnap.archs || (delivery.archs) || {};
  const picked = files[arch] && files[arch].status === 'ready' ? files[arch] :
    (files.x64 && files.x64.status === 'ready' ? files.x64 : null);
  const hap = archsSnap.hap || delivery.channels && delivery.channels.hap || null;
  /* 所有包不限设备：识别系统族，未知 / 非 Windows 设备一律保底走免安装在线版，
     绝不把装不了的 exe 下发给手机、macOS、Linux 或未识别设备。 */
  const os = String(q.os || q.device || platform || '').toLowerCase();
  const family = /harmony|kaihong|openharmony|ohos|arkweb/.test(os) ? 'harmony'
    : /windows|win32|win64|winnt/.test(os) ? 'windows'
      : /android|linux|mac|darwin|ios|ipad|iphone|chromeos/.test(os) ? 'other' : 'unknown';
  const liteUrl = '/?mem=' + tier + '&arch=' + arch + '&os=' + encodeURIComponent(os || family);

  /* 自动更新：清单自带本次发版版本与产物 SHA256，客户端带本地版本码来比对，
     内容（功能 / 源 / 播放档位）始终自动同步；仅完整包与 HAP 才需要提示安装。 */
  const rel = json(path.join(DIST, 'release.json'), {});
  const mf = json(path.join(ROOT, 'server', 'manifest.json'), {});
  const lat = (mf.release && mf.release.latest) || {};
  const clientCode = Number(q.code) || 0;
  const latestCode = Number(lat.versionCode) || Number(rel.versionCode) || 0;
  const shaDesk = (rel.artifacts && rel.artifacts.desktop && rel.artifacts.desktop.sha256) || lat.desktopSha256 || null;
  const shaHap = (rel.artifacts && rel.artifacts.hap && rel.artifacts.hap.sha256) || lat.hapSha256 || null;

  let channel, artifact, reason;
  if (family === 'harmony' || platform === 'harmony' || platform === 'kaihong' || platform === 'openharmony') {
    channel = 'hap';
    artifact = hap ? { name: hap.file, url: hap.url, size: hap.size, sha256: hap.sha256 } : null;
    reason = '深开鸿 / OpenHarmony 设备端：下发轻量签名 HAP（约 363KB），设备任意内存均可安装观看';
  } else if (family !== 'windows' || tier === 'tiny' || tier === 'low') {
    channel = 'lite';
    artifact = { name: '在线影站（免安装）', url: liteUrl, size: null, sha256: null };
    reason = t.label + '：' + (family !== 'windows' ? '非 Windows / 未识别设备自动保底在线版，不下发 exe；' :
      '自动走免安装轻量通道，不下载 77MB 安装包；') + '缓冲上限 ' +
      t.maxBufferSizeMB + 'MB / ' + t.maxBufferLength + 's，码率锁定最低档';
  } else {
    channel = 'full';
    artifact = picked ? { name: picked.file, url: picked.url, size: picked.size, sha256: picked.sha256 } : null;
    reason = t.label + '：可安装完整桌面版（' + arch + '）；无原生包自动回退 x64 通用包，并保留免安装通道备用';
  }

  const needUpdate = clientCode > 0 && latestCode > clientCode && channel !== 'lite';
  return {
    ok: true, auto: true, noReview: true,
    arch: arch, platform: platform || 'desktop',
    device: {
      unrestricted: true, anyDevice: true, family: family, os: os || null, arch: arch,
      note: '所有包不限设备：Windows 各架构 / 深开鸿 / 其它系统 / 未知设备均有可用通道'
    },
    memoryTier: tier, memoryLabel: t.label, memGB: mem.gb, memoryKnown: !!mem.known,
    channel: channel, install: channel === 'full',
    artifact: artifact,
    liteUrl: liteUrl,
    hap: hap ? { name: hap.file, url: hap.url, size: hap.size, sha256: hap.sha256 } : null,
    alternatives: channel === 'lite'
      ? [{ channel: 'hap', note: '深开鸿设备端轻量签名包' }, { channel: 'full', note: 'Windows 且内存充足时可装完整版' }]
      : [{ channel: 'lite', note: '免安装在线影站（任意设备 / 任意内存可看）' }],
    playback: playback(tier),
    update: {
      auto: true, noReview: true, autoContentUpdate: true,
      clientVersionCode: clientCode || null,
      latest: {
        versionName: lat.versionName || rel.versionName || null,
        versionCode: latestCode || null,
        downloadUrl: lat.downloadUrl || '/download/desktop-setup.exe',
        hapUrl: lat.hapUrl || '/download/honghub-harmony.hap',
        desktopSha256: shaDesk, hapSha256: shaHap
      },
      needUpdate: needUpdate,
      channel: channel,
      installRequiresConfirm: channel !== 'lite',
      note: channel === 'lite'
        ? '免安装在线版随服务端实时更新：功能 / 源 / 播放档位自动保持最新，无需下载安装包'
        : (needUpdate ? '发现新版本：自动提示并核对 SHA256，安装仍需用户在向导 / 系统安装器确认' : '已是最新版本，内容仍自动同步')
    },
    reason: reason,
    guarantee: GUARANTEE
  };
}

/* 一次发版的完整下发清单：由 build-archs.js 在出包末尾写出 dist/delivery.json */
function buildDelivery(archsSnap, opts) {
  const o = opts || {};
  const a = archsSnap || {};
  const m = json(path.join(ROOT, 'server', 'manifest.json'), {});
  const lat = (m.release && m.release.latest) || {};
  const rel = json(path.join(DIST, 'release.json'), {});
  const tiers = {};
  TIER_ORDER.forEach(function (k) {
    tiers[k] = Object.assign({ key: k, recommendedChannel: (k === 'tiny' || k === 'low') ? 'lite' : 'full' },
      TIERS[k], { playback: playback(k) });
  });
  return {
    schema: 1, auto: true, noReview: true,
    versionName: a.versionName || lat.versionName || (rel.versionName) || json(path.join(ROOT, 'package.json'), {}).version || null,
    versionCode: lat.versionCode || null,
    generatedAt: new Date().toISOString(),
    guarantee: GUARANTEE,
    devicePolicy: {
      unrestricted: true, anyDevice: true, anyMemory: true,
      devices: ['windows-x64', 'windows-ia32', 'windows-arm64', 'kaihongos', 'openharmony', 'macos', 'linux', 'android', 'ios', 'unknown'],
      fallbackChannel: 'lite',
      note: '所有包不限设备：未识别 / 非 Windows 设备与低内存设备自动保底走免安装在线版，永不提示装不了的包'
    },
    autoUpdate: {
      auto: true, noReview: true, contentAlwaysLatest: true,
      policy: '两端启动与定时轮询自动比对 versionCode；功能 / 源清单 / 播放档位自动同步；安装包与 HAP 仅提示并校验 SHA256，由用户确认安装',
      note: '内容发布不抬高应用版本，治理循环不制造假更新'
    },
    memoryTiers: tiers,
    recommendedByTier: { tiny: 'lite', low: 'lite', medium: 'full', high: 'full' },
    channels: {
      lite: {
        install: false, anyDevice: true, minMemoryMB: 0, url: '/', size: null,
        note: '免安装在线影站：任意设备 / 任意内存打开网址即看，HLS 分片流式加载、缓冲按内存档设硬上限，永远随服务端最新'
      },
      hap: a.hap ? Object.assign({ install: true, minMemoryMB: 0, anyDevice: false, os: ['kaihongos', 'openharmony'], note: '深开鸿 / OpenHarmony 设备端轻量签名包' }, a.hap) :
        { install: true, minMemoryMB: 0, status: 'fallback', url: '/download/honghub-harmony.hap' },
      full: {
        install: true, minMemoryMB: 2048, os: ['windows'], archs: a.archs || {},
        note: '完整安装包：按架构自动选包，无原生包回退 x64 通用包；内存低于 2GB 或非 Windows 设备自动改走免安装通道'
      }
    },
    archs: a.archs || {},
    hap: a.hap || null,
    features: a.features || json(path.join(ROOT, 'server', 'feature-version.json'), {}),
    // 跟随所有操作系统版本：设备回传后自动生成的 OS 适配矩阵（由 device-optimizer 写出）
    osProfiles: (function () {
      const p = json(path.join(DIST, 'os-profiles.json'), null);
      return p ? { generatedAt: p.generatedAt, followAllOSVersions: true, families: p.families, summary: p.summary }
        : { followAllOSVersions: true, note: '每个 OS 家族均有基线适配，设备回传后自动细化' };
    })(),
    deviceOptimization: {
      auto: true, noReview: true, endpoint: '/api/device/report',
      syncEndpoint: '/api/device/optimization',
      note: '检测 OS 版本 → 回传 → 自动优化 → 自动修复 → 自动下发同步更新，全程无需人工'
    },
    release: rel || null
  };
}

function writeDelivery(archsSnap, outFile) {
  const d = buildDelivery(archsSnap);
  try {
    fs.mkdirSync(DIST, { recursive: true });
    fs.writeFileSync(outFile || path.join(DIST, 'delivery.json'), JSON.stringify(d, null, 2) + '\n');
    return d;
  } catch (e) { return d; }   // 只读环境仍返回清单，不阻断出包
}

module.exports = {
  TIERS: TIERS, TIER_ORDER: TIER_ORDER, GUARANTEE: GUARANTEE,
  memoryTier: memoryTier, parseMemGB: parseMemGB, playback: playback,
  plan: plan, buildDelivery: buildDelivery, writeDelivery: writeDelivery, archKey: archKey
};
