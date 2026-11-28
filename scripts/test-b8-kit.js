/* 1.7.91 B 档纯逻辑自测（音轨 / 字幕 / 通知 / 快捷键 / 外部播放器 / 儿童模式 / 配置体检）
   用法：node scripts/test-b8-kit.js */
const P = require('../app/kh-pref.js');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + ' [' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ']', JSON.stringify(a) === JSON.stringify(b), a); }

/* 1. 默认值 */
eq('DEF.audioLang', P.DEF.audioLang, 'auto');
eq('DEF.subAuto', P.DEF.subAuto, 1);
eq('DEF.notify', P.DEF.notify, 'all');
eq('DEF.top', P.DEF.top, 0);
eq('DEF.kid', P.DEF.kid, 0);
eq('DEF.hotkeys', P.DEF.hotkeys, { toggle: '', next: '', prev: '', mute: '', top: '' });
eq('DEF.playerArgs', P.DEF.playerArgs, '');
eq('DEF.notifySound', P.DEF.notifySound, 1);
eq('DEF.kidMin', P.DEF.kidMin, 0);

/* 2. norm 回落与夹取 */
const n1 = P.norm({ audioLang: 'xx', notify: 'xx', subAuto: 0, kid: '1', top: 0, kidPin: '12a3b4' });
eq('norm.audioLang 非法', n1.audioLang, 'auto');
eq('norm.notify 非法', n1.notify, 'all');
eq('norm.subAuto 0', n1.subAuto, 0);
eq('norm.kid 1', n1.kid, 1);
eq('norm.kidPin 只留数字且 4 位', n1.kidPin, '1234');
const n2 = P.norm({ playerArgs: 'a'.repeat(300), subDir: 'b'.repeat(500) });
ok('norm.playerArgs 截断 200', n2.playerArgs.length === 200);
ok('norm.subDir 截断 400', n2.subDir.length === 400);
eq('norm.hotkeys 规范化', P.norm({ hotkeys: { toggle: 'ctrl+shift+p' } }).hotkeys.toggle, 'Ctrl+Shift+P');
const n3 = P.norm({ audioLang: 'zh' });
eq('norm 保持 audioLang', n3.audioLang, 'zh');
eq('norm 空对象 hotkeys', n3.hotkeys.toggle, '');

/* 3. normHotkey */
eq('hk 大写化', P.normHotkey('ctrl+alt+p'), 'Ctrl+Alt+P');
eq('hk 任意大小写', P.normHotkey('CTRL+SHIFT+F5'), 'Ctrl+Shift+F5');
eq('hk 单键字母', P.normHotkey('p'), 'P');
eq('hk 单键数字', P.normHotkey('7'), '7');
eq('hk F 键', P.normHotkey('shift+f2'), 'Shift+F2');
eq('hk 空', P.normHotkey(''), '');
eq('hk 只有修饰键', P.normHotkey('ctrl'), '');
eq('hk 中文非法', P.normHotkey('中文键'), '');
eq('hk 媒体键别名', P.normHotkey('mediaplaypause'), 'MediaPlayPause');
eq('hk 修饰键去重', P.normHotkey('ctrl+ctrl+p'), 'Ctrl+P');
eq('hk cmd 归一 Meta', P.normHotkey('cmd+k'), 'Meta+K');
eq('hk space', P.normHotkey('ctrl+space'), 'Ctrl+Space');

/* 4. hotkeyPlan */
eq('plan 空', P.hotkeyPlan({}), []);
eq('plan 两个不同', P.hotkeyPlan({ hotkeys: { toggle: 'Ctrl+P', next: 'Ctrl+N' } }),
   [{ action: 'toggle', accel: 'Ctrl+P' }, { action: 'next', accel: 'Ctrl+N' }]);
eq('plan 重复键只留先到', P.hotkeyPlan({ hotkeys: { toggle: 'Ctrl+P', next: 'Ctrl+P', mute: 'Ctrl+M' } }),
   [{ action: 'toggle', accel: 'Ctrl+P' }, { action: 'mute', accel: 'Ctrl+M' }]);
eq('plan 非法键被丢弃', P.hotkeyPlan({ hotkeys: { toggle: 'xyz+?', next: 'Ctrl+N' } }),
   [{ action: 'next', accel: 'Ctrl+N' }]);

/* 5. pickAudioTrack */
eq('audio auto -1', P.pickAudioTrack([{ lang: 'zh', name: '中文' }], 'auto'), -1);
eq('audio zh 命中 lang', P.pickAudioTrack([{ lang: 'en', name: 'English' }, { lang: 'zh', name: '中文' }], 'zh'), 1);
eq('audio zh 命中名称', P.pickAudioTrack(['国语', 'English'], 'zh'), 0);
eq('audio ja 未命中', P.pickAudioTrack([{ lang: 'zh', name: '中文' }], 'ja'), -1);
eq('audio 空列表', P.pickAudioTrack([], 'zh'), -1);
eq('audio 前缀匹配 zho', P.pickAudioTrack([{ lang: 'zho', name: '' }], 'zh'), 0);

/* 6. subKey / pickSubtitle */
eq('subKey 去扩展与语言后缀', P.subKey('Movie.Name.2024.zh.srt'), 'moviename2024');
eq('subKey 路径', P.subKey('/a/b/流浪地球2.ass'), '流浪地球2');
eq('subKey 去标点空格', P.subKey('Some Movie [2020].vtt'), 'somemovie2020');
const files = ['流浪地球2.zh.srt', '流浪地球.zh.srt', 'Other.en.vtt'];
eq('sub 完全同名优先', P.pickSubtitle(files, '流浪地球2'), '流浪地球2.zh.srt');
eq('sub 包含匹配', P.pickSubtitle(files, '流浪地球'), '流浪地球.zh.srt');
eq('sub 中文后缀优先', P.pickSubtitle(['Movie.en.srt', 'Movie.zh.srt'], 'Movie'), 'Movie.zh.srt');
eq('sub 无匹配', P.pickSubtitle(files, '不存在的片'), '');
eq('sub 对象形态', P.pickSubtitle([{ name: 'X.zh.srt' }], 'X'), 'X.zh.srt');

/* 7. srtToVtt */
const vtt = P.srtToVtt('1\n00:00:01,000 --> 00:00:02,500\n你好\n');
ok('srt 有 WEBVTT 头', vtt.indexOf('WEBVTT') === 0);
ok('srt 逗号换点', vtt.indexOf('00:00:01.000 --> 00:00:02.500') > 0);
ok('srt 已 vtt 原样', P.srtToVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nx\n').indexOf('WEBVTT') === 0 &&
   P.srtToVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nx\n').indexOf('WEBVTT\n\nWEBVTT') < 0);
ok('srt 去 BOM', P.srtToVtt('\uFEFF1\n00:00:01,000 --> 00:00:02,000\nx\n').indexOf('WEBVTT') === 0);

/* 8. notifyAllow */
ok('notify all/download', P.notifyAllow('all', 'download') === true);
ok('notify all/other', P.notifyAllow('all', 'other') === true);
ok('notify download/other 拒', P.notifyAllow('download', 'other') === false);
ok('notify download/download 放', P.notifyAllow('download', 'download') === true);
ok('notify download/update 放', P.notifyAllow('download', 'update') === true);
ok('notify off 全拒', P.notifyAllow('off', 'download') === false);
ok('notify 非法回落 all', P.notifyAllow('zzz', 'other') === true);

/* 9. kidAllows */
ok('kid 关全放', P.kidAllows(0, { category: '科幻' }) === true);
ok('kid 开儿童分类放', P.kidAllows(1, { category: '儿童' }) === true);
ok('kid 开动画放', P.kidAllows(1, { category: '动画片' }) === true);
ok('kid 开标签命中', P.kidAllows(1, { category: '电影', tags: ['亲子'] }) === true);
ok('kid 开科幻拒', P.kidAllows(1, { category: '科幻', tags: ['太空'] }) === false);
ok('kid 开空对象拒', P.kidAllows(1, null) === false);

/* 10. argsBuild */
eq('args 空模板', P.argsBuild('', 'u'), []);
eq('args 替换 url', P.argsBuild('--fullscreen {url}', 'http://a/b'), ['--fullscreen', 'http://a/b']);
eq('args 引号成对', P.argsBuild('"--title" "{url}"', 'u'), ['--title', 'u']);
eq('args 无占位符', P.argsBuild('--loop', 'u'), ['--loop']);
eq('args 多个 {url}', P.argsBuild('{url} {url}', 'u'), ['u', 'u']);

/* 11. audit */
const a0 = P.audit({ damaged: 0, histLen: 10, cap: 30, missing: [], unknown: 0, bytes: 1024 });
eq('audit 全好分 100', a0.score, 100);
ok('audit 全好 ok', a0.ok === true && a0.items.length === 0);
const a1 = P.audit({ damaged: 1, histLen: 10, cap: 30, missing: [], unknown: 0, bytes: 1024 });
eq('audit 损坏扣 20', a1.score, 80);
eq('audit 损坏 code', a1.items[0].code, 'seal');
eq('audit 损坏 fix', a1.items[0].fix, 'dmg-clear');
const a2 = P.audit({ damaged: 0, histLen: 40, cap: 30, missing: ['kh_a', 'kh_b'], unknown: 2, bytes: 4 * 1024 * 1024 });
ok('audit 多项扣分', a2.score < 100 && a2.items.length >= 4);
ok('audit 有 missing 建议', a2.items.some(function(x){ return x.code === 'missing' && x.fix === 'defaults'; }));
ok('audit 有 hist 建议', a2.items.some(function(x){ return x.code === 'hist' && x.fix === 'trim'; }));
ok('audit 有 quota 警告', a2.items.some(function(x){ return x.code === 'quota'; }));
const a3 = P.audit({ damaged: 8 });
eq('audit 同类问题只扣一次（8 个损坏仍是 1 条）', a3.score, 80);
const a4 = P.audit({ damaged: 3, histLen: 99, cap: 30, missing: ['a', 'b', 'c'], unknown: 9, bytes: 9 * 1024 * 1024 });
ok('audit 多类叠加仍不为负', a4.score >= 0 && a4.score < 80, a4.score);

/* 12. 1.7.91 补：通知提示音与儿童时长上限 */
eq('norm.notifySound 0', P.norm({ notifySound: 0 }).notifySound, 0);
eq('norm.notifySound 非法回落 1', P.norm({ notifySound: 'x' }).notifySound, 1);
eq('norm.kidMin 30', P.norm({ kidMin: 30 }).kidMin, 30);
eq('norm.kidMin 夹取上限 240', P.norm({ kidMin: 999 }).kidMin, 240);
eq('norm.kidMin 负数归零', P.norm({ kidMin: -5 }).kidMin, 0);
eq('norm.kidMin 非数字回落', P.norm({ kidMin: 'abc' }).kidMin, 0);

console.log('\nB 档纯逻辑：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
