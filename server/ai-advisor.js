/**
 * 鸿汇影 · AI 辅助诊断（开发端，#98）
 * --------------------------------------------------------------
 *  - 仅开发端调用：把本机诊断摘要（上报问题 / 健康快照 / 源健康）发给兼容
 *    OpenAI Chat Completions 协议的模型，返回排查建议文本。
 *  - 密钥只在服务端读取环境变量，不下发前端、不写进成品包；不上传片源直链与账号。
 *  - AI 只给建议，不自动改码、不自动发布；未配置密钥 / 端点时如实返回 not-configured。
 *  - 配置项（环境变量，可写入本机 .env，不进仓库）：
 *      KH_AI_BASE_URL  兼容接口 base，如 https://api.deepseek.com/v1
 *      KH_AI_API_KEY   模型密钥
 *      KH_AI_MODEL     模型名（按供应商要求填写）
 *      KH_AI_TIMEOUT_MS 超时毫秒，默认 20000
 *
 * 预留外部数据源配置位（#111，当前未接通，不做实拉取，待合规与凭证齐备后再实现）：
 *      KH_SUBTITLE_API   在线字幕库接口 base（需逐条核验授权与合规）
 *      KH_METADATA_API   元数据补全接口 base（如 TMDB 兼容协议），配套 KH_METADATA_KEY
 * 这些项未在代码里发起请求；仅在此登记配置位，避免在客户端内置未授权的第三方聚合。
 */
'use strict';
const https = require('https');
const http = require('http');
const { URL } = require('url');

function config() {
  return {
    base: String(process.env.KH_AI_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.KH_AI_API_KEY || '',
    model: process.env.KH_AI_MODEL || '',
    timeoutMs: Number(process.env.KH_AI_TIMEOUT_MS || 20000)
  };
}
function isConfigured() {
  const c = config();
  return !!(c.base && c.apiKey && c.model);
}

function postChat(messages, c, opts) {
  opts = opts || {};
  const maxTokens = opts.maxTokens || 600;
  return new Promise((resolve) => {
    let u;
    try { u = new URL(c.base + '/chat/completions'); } catch (e) { resolve({ ok: false, reason: 'bad endpoint' }); return; }
    const body = JSON.stringify({ model: c.model, messages, temperature: 0.2, max_tokens: maxTokens });
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + c.apiKey,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: c.timeoutMs
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) { resolve({ ok: false, reason: 'HTTP ' + res.statusCode }); return; }
        try {
          const j = JSON.parse(chunks);
          const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
          resolve(reply.trim() ? { ok: true, reply: String(reply).slice(0, 2000) } : { ok: false, reason: 'empty reply' });
        } catch (e) { resolve({ ok: false, reason: 'bad model response' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, reason: String(e && e.message || 'network error').slice(0, 120) }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ ok: false, reason: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

function buildMessages(ctx) {
  const system = '你是鸿汇影影视聚合客户端的运维辅助。根据下方本机诊断摘要，给出简短、可执行的排查建议：先判断最可能的原因，再列 2-4 条处理动作。不要编造片源、版本或设备信息；不要执行修改或发布，只给建议。不输出密钥与完整直链。';
  const summary = JSON.stringify(ctx || {}, null, 2).slice(0, 6000);
  return [
    { role: 'system', content: system },
    { role: 'user', content: '本机诊断摘要：\n' + summary + '\n\n请给出排查建议。' }
  ];
}

async function diagnose(ctx) {
  const c = config();
  if (!isConfigured()) return { ok: false, configured: false, reason: 'not-configured' };
  try {
    const r = await postChat(buildMessages(ctx), c);
    return Object.assign({ configured: true }, r);
  } catch (e) {
    return { ok: false, configured: true, reason: String(e && e.message || 'error').slice(0, 120) };
  }
}

/* 剥离模型回复里可能包裹的 ```json 围栏，便于 JSON.parse */
function stripFence(s) {
  return String(s || '').replace(/^```(json|JSON)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/* 结构化分析（#111）：从诊断摘要里自动提取问题、给根因、列处理动作与建议补丁片段，
   并提炼可落地的新功能/改进建议。安全口径不变——patch 只是「建议代码片段」，
   需开发端人工审核后应用；服务端不自动写码、不自动发布。JSON 解析失败时回退纯文本。 */
async function analyze(ctx) {
  const c = config();
  if (!isConfigured()) return { ok: false, configured: false, reason: 'not-configured' };
  const system = '你是鸿汇影影视聚合客户端的开发辅助。基于本机诊断摘要，只输出严格 JSON，不要加多余说明或解释：\n'
    + '{\n'
    + '  "issues": [{"title":"问题标题","cause":"最可能原因","actions":["处理动作1","处理动作2"],"patch":"建议修改的代码片段或 diff，无则留空字符串"}],\n'
    + '  "suggestions": [{"title":"新功能或改进建议","why":"依据摘要中的哪一点提出"}]\n'
    + '}\n'
    + '规则：不编造片源、版本或设备信息；patch 仅为建议片段，不得输出可直接执行的写文件、发布、删除命令；不输出密钥与完整直链；issues 最多 4 条，suggestions 最多 3 条。';
  const summary = JSON.stringify(ctx || {}, null, 2).slice(0, 6000);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: '本机诊断摘要：\n' + summary }
  ];
  try {
    const r = await postChat(messages, c, { maxTokens: 1200 });
    if (!r.ok) return Object.assign({ configured: true }, r);
    let parsed = null;
    try { parsed = JSON.parse(stripFence(r.reply)); } catch (e) { parsed = null; }
    if (parsed && typeof parsed === 'object') return { ok: true, configured: true, analysis: parsed };
    return { ok: true, configured: true, reply: r.reply };
  } catch (e) {
    return { ok: false, configured: true, reason: String(e && e.message || 'error').slice(0, 120) };
  }
}

/* 文本 / 字幕翻译（#111）：复用同一模型通道，只返回译文；目标语言默认中文。 */
async function translate(text, targetLang) {
  const c = config();
  if (!isConfigured()) return { ok: false, configured: false, reason: 'not-configured' };
  const lang = String(targetLang || '中文').trim() || '中文';
  const messages = [
    { role: 'system', content: '你是影视字幕翻译。只输出译文本身，不要解释、不要保留原文、不要加引号或编号。' },
    { role: 'user', content: '把下面内容翻译成' + lang + '：\n' + String(text || '').slice(0, 2000) }
  ];
  try {
    const r = await postChat(messages, c, { maxTokens: 400 });
    return Object.assign({ configured: true }, r);
  } catch (e) {
    return { ok: false, configured: true, reason: String(e && e.message || 'error').slice(0, 120) };
  }
}

module.exports = { diagnose, analyze, translate, isConfigured, config };
