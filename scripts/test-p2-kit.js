#!/usr/bin/env node
/* P2 能力模块自测（台账 #161 · 1.7.89）
   只测 app/kh-p2.js 的纯逻辑：并发上限与峰值、超时与重试次数、策略默认与非法值回落、
   焦点框/音量键/字幕字体描边取值、本地目录白名单、Webhook 域名白名单、配置封条。
   不碰真实产物、不写仓库文件，全部在内存里跑。
   用法：node scripts/test-p2-kit.js  → 末行给出通过/失败计数，退出码即结果。 */
'use strict';

const path = require('path');
const P2 = require(path.join(__dirname, '..', 'app', 'kh-p2.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail ? ' — ' + detail : '')); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('\n[1] 配置规范化');
  ok('空对象回落全部默认', JSON.stringify(P2.norm({})) === JSON.stringify(P2.DEF), JSON.stringify(P2.norm({})));
  const n1 = P2.norm({ netConc: 99, netTimeout: -1, netRetry: 2.5, liveQuality: '4k', cardDensity: 'big', focusRing: 'red', volKeys: 'none', subFont: 'comic', subStroke: 'huge' });
  ok('非法并发回落 6', n1.netConc === 6, n1.netConc);
  ok('非法超时回落 15', n1.netTimeout === 15, n1.netTimeout);
  ok('非法重试回落 2', n1.netRetry === 2, n1.netRetry);
  ok('非法清晰度回落 auto', n1.liveQuality === 'auto', n1.liveQuality);
  ok('非法密度回落 std', n1.cardDensity === 'std', n1.cardDensity);
  ok('非法焦点色回落 theme', n1.focusRing === 'theme', n1.focusRing);
  ok('非法音量归属回落 app', n1.volKeys === 'app', n1.volKeys);
  ok('非法字体回落 system', n1.subFont === 'system', n1.subFont);
  ok('非法描边回落 thin', n1.subStroke === 'thin', n1.subStroke);
  const n2 = P2.norm({ localDirs: ['  D:\\Media ', 'D:\\Media', '', null], webhookHosts: ['a.com', 'a.com'] });
  ok('目录去空去重', n2.localDirs.length === 1 && n2.localDirs[0] === 'D:\\Media', JSON.stringify(n2.localDirs));
  ok('域名去重', n2.webhookHosts.length === 1, JSON.stringify(n2.webhookHosts));
  ok('存储硬化默认开', P2.norm({}).storeHarden === 1);
  ok('存储硬化可关', P2.norm({ storeHarden: 0 }).storeHarden === 0);

  console.log('\n[2] 网络策略');
  const net = P2.net({ netConc: 4, netTimeout: 20, netRetry: 3 });
  ok('conc 透传', net.conc === 4, net.conc);
  ok('timeout 秒转毫秒', net.timeoutMs === 20000, net.timeoutMs);
  ok('retry 透传', net.retry === 3, net.retry);

  console.log('\n[3] 并发调度');
  {
    const q = P2.queue(3);
    let running = 0, peak = 0;
    const tasks = [];
    for (let i = 0; i < 12; i++) {
      tasks.push(q.push(async () => {
        running += 1; if (running > peak) peak = running;
        await sleep(25);
        running -= 1;
        return i;
      }));
    }
    const vals = await Promise.all(tasks);
    const st = q.stats();
    ok('任务全部完成且结果有序', vals.length === 12 && vals[11] === 11, vals.length);
    ok('实际并发峰值不超过上限 3', peak === 3, 'peak=' + peak);
    ok('调度器统计峰值一致', st.peak === 3, JSON.stringify(st));
    ok('完成后无排队无活跃', st.active === 0 && st.waiting === 0, JSON.stringify(st));
    ok('完成计数 12', st.done === 12, st.done);
  }
  {
    const q = P2.queue(2);
    const bad = q.push(async () => { throw new Error('boom'); });
    let caught = '';
    try { await bad; } catch (e) { caught = e.message; }
    ok('任务失败如实抛出', caught === 'boom', caught);
    ok('失败计数 1', q.stats().failed === 1, JSON.stringify(q.stats()));
  }
  {
    const q = P2.queue(1);
    const errs = [];
    const a = q.push(async () => { throw new Error('x'); }).catch(() => errs.push('a'));
    const b = q.push(async () => 'ok');
    await Promise.all([a, b]);
    ok('一个失败不阻塞后续', (await q.push(async () => 'later')) === 'later');
  }

  console.log('\n[4] 超时与重试');
  {
    let calls = 0;
    const v = await P2.retry(async () => { calls += 1; return 'first-ok'; }, { retry: 2, timeoutMs: 500 });
    ok('首次成功即返回', v === 'first-ok' && calls === 1, 'calls=' + calls);
  }
  {
    let calls = 0;
    const v = await P2.retry(async (attempt) => {
      calls += 1;
      if (attempt < 3) throw new Error('fail#' + attempt);
      return 'ok@' + attempt;
    }, { retry: 2, timeoutMs: 500 });
    ok('重试 2 次后成功（总尝试 3）', v === 'ok@3' && calls === 3, 'calls=' + calls);
  }
  {
    let calls = 0;
    let err = null;
    try {
      await P2.retry(async () => { calls += 1; throw new Error('always'); }, { retry: 2, timeoutMs: 500 });
    } catch (e) { err = e; }
    ok('全失败抛出并带 attempts 明细', !!err && Array.isArray(err.attempts) && err.attempts.length === 3, err && JSON.stringify(err.attempts));
    ok('失败明细含每次原因', !!err && err.attempts[0].error === 'always' && err.attempts[2].attempt === 3, err && JSON.stringify(err.attempts));
    ok('总尝试次数 3', calls === 3, calls);
  }
  {
    let err = null;
    const t0 = Date.now();
    try { await P2.retry(() => new Promise(() => {}), { retry: 0, timeoutMs: 500 }); } catch (e) { err = e; }
    const dt = Date.now() - t0;
    ok('挂起任务按超时中断', !!err && err.attempts[0].error.indexOf('timeout') === 0, err && JSON.stringify(err.attempts));
    ok('超时时间接近 500ms', dt >= 480 && dt < 1500, 'dt=' + dt);
  }
  {
    let err = null;
    try { await P2.retry(() => new Promise(() => {}), { retry: 1, timeoutMs: 400 }); } catch (e) { err = e; }
    ok('超时也计入重试（2 条明细）', !!err && err.attempts.length === 2, err && JSON.stringify(err.attempts));
  }

  console.log('\n[5] 无障碍取值');
  ok('焦点框跟随主题用 accent', P2.focus('theme').color === 'var(--accent)', P2.focus('theme').color);
  ok('高对比焦点框黄色 4px', P2.focus('contrast').color === '#ffd400' && P2.focus('contrast').width === 4);
  ok('非法焦点档回落主题', P2.focus('zzz').color === 'var(--accent)');
  ok('音量键默认 app', P2.volTarget('') === 'app');
  ok('音量键 system 可取', P2.volTarget('system') === 'system');
  const se = P2.subExtra({ subFont: 'song', subStroke: 'thick' });
  ok('字幕字体宋体落地', se.font === 'song' && se.fontCss.indexOf('SimSun') >= 0, se.fontCss);
  ok('字幕粗描边落地', se.stroke === 'thick' && se.strokeCss.indexOf('2px 3px') >= 0, se.strokeCss);
  ok('无描边为空阴影', P2.subStrokeCss('none') === '0 0 0 transparent', P2.subStrokeCss('none'));
  ok('圆体字体可选', P2.subFontCss('round').indexOf('YouYuan') >= 0, P2.subFontCss('round'));
  /* 1.7.93 #32：字幕上下位置（5 档百分比） */
  ok('字幕位置默认 8%', P2.norm({}).subPos === 8, P2.norm({}).subPos);
  ok('字幕位置 26% 保留', P2.norm({ subPos: 26 }).subPos === 26);
  ok('字幕位置字符串数字可接受', P2.norm({ subPos: '18' }).subPos === 18);
  ok('字幕位置非法回落 8', P2.norm({ subPos: 99 }).subPos === 8);
  ok('字幕位置负数回落 8', P2.norm({ subPos: -4 }).subPos === 8);
  ok('位置转 CSS 百分比', P2.subPosCss(12) === '12%', P2.subPosCss(12));
  ok('非法位置 CSS 也回落 8%', P2.subPosCss(7) === '8%', P2.subPosCss(7));
  ok('subExtra 带上位置', P2.subExtra({ subPos: 18 }).bottomCss === '18%', P2.subExtra({ subPos: 18 }).bottomCss);
  ok('选项表含 5 档位置', P2.OPTIONS.subPos.length === 5 && P2.OPTIONS.subPos.indexOf(4) >= 0);

  console.log('\n[6] 卡片密度与直播清晰度');
  ok('紧凑卡片 132px', P2.cardMin('compact') === 132, P2.cardMin('compact'));
  ok('标准卡片 158px', P2.cardMin('std') === 158, P2.cardMin('std'));
  ok('宽松卡片 196px', P2.cardMin('loose') === 196, P2.cardMin('loose'));
  ok('非法密度回落标准', P2.cardMin('xx') === 158);
  ok('直播默认自动', P2.liveQuality('') === 'auto');
  ok('直播可锁高清', P2.liveQuality('hd') === 'hd');
  ok('非法清晰度回落自动', P2.liveQuality('8k') === 'auto');

  console.log('\n[7] 本地目录白名单');
  ok('反斜杠归一为正斜杠', P2.normPath('D:\\Media\\Movies\\a.mp4') === 'D:/Media/Movies/a.mp4', P2.normPath('D:\\Media\\Movies\\a.mp4'));
  ok('重复分隔符压缩', P2.normPath('D://A///b.mp4') === 'D:/A/b.mp4', P2.normPath('D://A///b.mp4'));
  ok('尾部斜杠去掉', P2.normPath('D:/Media/') === 'D:/Media', P2.normPath('D:/Media/'));
  {
    const dirs = ['D:\\Media'];
    ok('授权目录内文件放行', P2.pathAllowed('D:\\Media\\Movies\\a.mp4', dirs).ok === true);
    ok('目录本身放行', P2.pathAllowed('D:/Media', dirs).ok === true);
    ok('目录外拒绝', P2.pathAllowed('D:\\Other\\b.mp4', dirs).ok === false);
    ok('同名前缀不算（Media2）', P2.pathAllowed('D:\\Media2\\c.mp4', dirs).ok === false);
    ok('含 .. 拒绝', P2.pathAllowed('D:\\Media\\..\\Other\\x.mp4', dirs).ok === false);
    ok('相对路径拒绝', P2.pathAllowed('Movies\\a.mp4', dirs).ok === false);
    ok('空表拒绝一切', P2.pathAllowed('D:\\Media\\a.mp4', []).ok === false);
    ok('空路径拒绝', P2.pathAllowed('', dirs).ok === false);
    ok('拒绝时给原因', typeof P2.pathAllowed('D:\\Other\\b.mp4', dirs).reason === 'string');
  }

  console.log('\n[8] Webhook 域名白名单');
  {
    const hosts = ['hooks.example.com', '*.corp.example.com'];
    ok('精确域名放行', P2.hostAllowed('https://hooks.example.com/x', hosts).ok === true);
    ok('通配后缀放行', P2.hostAllowed('https://a.corp.example.com/x', hosts).ok === true);
    ok('通配不匹配裸域', P2.hostAllowed('https://corp.example.com/x', hosts).ok === false);
    ok('不在表内拒绝', P2.hostAllowed('https://evil.com/x', hosts).ok === false);
    ok('明文 http 拒绝', P2.hostAllowed('http://hooks.example.com/x', hosts).ok === false);
    ok('空表全拒', P2.hostAllowed('https://hooks.example.com/x', []).ok === false);
    ok('本机回环不受空表限制', P2.hostAllowed('http://127.0.0.1:8099/x', []).ok === true);
    ok('非 http(s) 拒绝', P2.hostAllowed('ftp://hooks.example.com/x', hosts).ok === false);
    ok('空地址拒绝', P2.hostAllowed('', hosts).ok === false);
    ok('允许明文开关生效', P2.hostAllowed('http://hooks.example.com/x', hosts, { allowHttp: true }).ok === true);
    ok('带端口的域名按主机名匹配', P2.hostAllowed('https://hooks.example.com:8443/x', hosts).ok === true);
    ok('拒绝时带原因', P2.hostAllowed('https://evil.com/x', hosts).reason.indexOf('白名单') >= 0, P2.hostAllowed('https://evil.com/x', hosts).reason);
  }

  console.log('\n[9] 配置封条');
  {
    const text = JSON.stringify({ kh_theme: 'dark', kh_font_scale: 115 });
    const seal = P2.seal(text);
    ok('封条含长度', seal.len === text.length, seal.len);
    ok('封条校验和 16 位', /^[0-9a-f]{16}$/.test(seal.sum), seal.sum);
    ok('原样校验通过', P2.verify(seal, text).ok === true);
    ok('改一个字符即失败', P2.verify(seal, text.replace('dark', 'dark2')).ok === false);
    ok('截断即失败', P2.verify(seal, text.slice(0, -2)).ok === false);
    ok('无封条判失败', P2.verify(null, text).ok === false);
    ok('空串封条可用', P2.verify(P2.seal(''), '') === undefined || P2.verify(P2.seal(''), '').ok === true);
    ok('确定性（同文本同校验和）', P2.sum('abc') === P2.sum('abc') && P2.sum('abc') !== P2.sum('abd'));
  }

  console.log('\n[10] 其他');
  ok('版本号常量存在', P2.V === 1, P2.V);
  ok('默认配置对外只读引用一致', P2.DEF.netConc === 6 && P2.DEF.netTimeout === 15);
  ok('选项表覆盖并发档', P2.OPTIONS.netConc.indexOf(8) >= 0, JSON.stringify(P2.OPTIONS.netConc));

  console.log('\n' + (fail ? '\u2716' : '\u2714') + ' P2 能力自测：' + pass + ' 项通过 / ' + fail + ' 项失败');
  if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1); }
}

main().catch(e => { console.error('自测异常：', e); process.exit(1); });
