/* HongHub 前端模块：本地二维码编码（1.7.94 · 清单 #65 「二维码/短链分享」）
   为什么要自己写：仓库 node_modules 里没有任何 qrcode 包，客户端又不能把分享链接
   丢给第三方在线接口（既慢又不安全），所以按 ISO/IEC 18004 实现一个够用的子集：
   字节模式（UTF-8）+ 纠错等级 M + 版本 1–10（最多 213 字节，分享链接足够）。
   只算模块矩阵，不碰 DOM；画布 / <img> 渲染在 kh-core.js 里做，便于单测。 */
(function(root, factory){
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KHQR = api;
})(typeof window !== 'undefined' ? window : this, function(){
  'use strict';

  /* ---------- GF(256) 与 Reed-Solomon ---------- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function(){
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b){ if (a === 0 || b === 0) return 0; return EXP[LOG[a] + LOG[b]]; }
  function polyMul(a, b){
    var r = new Array(a.length + b.length - 1).fill(0);
    for (var i = 0; i < a.length; i++) for (var j = 0; j < b.length; j++) r[i + j] ^= gmul(a[i], b[j]);
    return r;
  }
  function rsGen(deg){
    var g = [1];
    for (var i = 0; i < deg; i++) g = polyMul(g, [1, EXP[i]]);
    return g;
  }
  /* 返回 ecLen 个校验码字；调用方负责把 data 与校验码字拼成块 */
  function rsEncode(data, ecLen){
    var gen = rsGen(ecLen);
    var res = data.concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var f = res[i];
      if (!f) continue;
      for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], f);
    }
    return res.slice(data.length);
  }

  /* ---------- 版本 / 分块表（纠错等级 M，版本 1–10） ---------- */
  var VER = {
    1:  { ecPer: 10, blocks: [[1, 16, 0, 0]] },
    2:  { ecPer: 16, blocks: [[1, 28, 0, 0]] },
    3:  { ecPer: 26, blocks: [[1, 44, 0, 0]] },
    4:  { ecPer: 18, blocks: [[2, 32, 0, 0]] },
    5:  { ecPer: 24, blocks: [[2, 43, 0, 0]] },
    6:  { ecPer: 16, blocks: [[4, 27, 0, 0]] },
    7:  { ecPer: 18, blocks: [[4, 31, 0, 0]] },
    8:  { ecPer: 22, blocks: [[2, 38, 2, 39]] },
    9:  { ecPer: 22, blocks: [[3, 36, 2, 37]] },
    10: { ecPer: 26, blocks: [[4, 43, 1, 44]] }
  };
  var ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  var MAX_VER = 10, EC_LEVEL_M = 0;

  function dataCodewords(ver){
    var b = VER[ver].blocks[0];
    return b[0] * b[1] + b[2] * b[3];
  }
  /* 字节模式可用容量（版本 1–9 计数 8 位，10 起 16 位） */
  function capacity(ver){
    var bits = dataCodewords(ver) * 8 - 4 - (ver >= 10 ? 16 : 8);
    return Math.floor(bits / 8);
  }
  function pickVersion(byteLen){
    for (var v = 1; v <= MAX_VER; v++) if (byteLen <= capacity(v)) return v;
    return 0;
  }

  /* ---------- 位流 ---------- */
  function utf8Bytes(s){
    s = String(s == null ? '' : s);
    var out = [];
    if (typeof TextEncoder !== 'undefined') {
      var u = new TextEncoder().encode(s);
      for (var i = 0; i < u.length; i++) out.push(u[i]);
      return out;
    }
    for (var j = 0; j < s.length; j++) {
      var c = s.charCodeAt(j);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c <= 0xDBFF && j + 1 < s.length) {
        var c2 = s.charCodeAt(++j);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function buildCodewords(bytes, ver){
    var bits = [];
    function push(v, n){ for (var i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); }
    push(4, 4);                    /* 字节模式 0100 */
    push(bytes.length, ver >= 10 ? 16 : 8);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var cap = dataCodewords(ver) * 8;
    var term = Math.min(4, cap - bits.length);
    for (var t = 0; t < term; t++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var words = [];
    for (var b = 0; b < bits.length; b += 8) {
      var w = 0;
      for (var k = 0; k < 8; k++) w = (w << 1) | bits[b + k];
      words.push(w);
    }
    var pads = [0xEC, 0x11], p = 0;
    while (words.length < dataCodewords(ver)) words.push(pads[p++ % 2]);
    return words;
  }
  /* 分块 + 交织，返回按标准顺序排好的最终码字 */
  function interleave(words, ver){
    var cfg = VER[ver], blocks = [], off = 0;
    for (var g = 0; g < cfg.blocks.length; g++) {
      var cnt = cfg.blocks[g][0], dlen = cfg.blocks[g][1];
      for (var i = 0; i < cnt; i++) {
        var d = words.slice(off, off + dlen); off += dlen;
        blocks.push({ d: d, e: rsEncode(d, cfg.ecPer) });
      }
    }
    var out = [], maxD = 0, maxE = cfg.ecPer;
    for (var bi = 0; bi < blocks.length; bi++) if (blocks[bi].d.length > maxD) maxD = blocks[bi].d.length;
    for (var c = 0; c < maxD; c++) for (var b2 = 0; b2 < blocks.length; b2++) if (c < blocks[b2].d.length) out.push(blocks[b2].d[c]);
    for (var c2 = 0; c2 < maxE; c2++) for (var b3 = 0; b3 < blocks.length; b3++) out.push(blocks[b3].e[c2]);
    return out;
  }

  /* ---------- 矩阵 ---------- */
  function blank(size){ var m = []; for (var r = 0; r < size; r++) { var row = new Array(size).fill(null); m.push(row); } return m; }
  function setFn(m, r, c, v){ if (r >= 0 && c >= 0 && r < m.length && c < m.length) m[r][c] = v ? 1 : 0; }
  function finder(m, r, c){
    for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
      var rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      var inRing = (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6);
      var dark = inRing && ((dr === 0 || dr === 6 || dc === 0 || dc === 6) || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      setFn(m, rr, cc, dark);
    }
  }
  function align(m, ver){
    var pos = ALIGN[ver];
    if (!pos) return;
    for (var i = 0; i < pos.length; i++) for (var j = 0; j < pos.length; j++) {
      var r = pos[i], c = pos[j];
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
        var dark = (Math.abs(dr) === 2 || Math.abs(dc) === 2) || (dr === 0 && dc === 0);
        setFn(m, r + dr, c + dc, dark);
      }
    }
  }
  function timing(m){
    for (var i = 8; i < m.length - 8; i++) { var on = i % 2 === 0 ? 1 : 0; setFn(m, 6, i, on); setFn(m, i, 6, on); }
  }
  function formatBits(mask){
    var data = (EC_LEVEL_M << 3) | mask, v = data << 10, g = 0x537;
    for (var i = 4; i >= 0; i--) if ((v >> (i + 10)) & 1) v ^= g << i;
    return ((data << 10) | (v & 0x3FF)) ^ 0x5412;
  }
  function writeFormat(m, mask){
    var bits = formatBits(mask), n = m.length;
    for (var i = 0; i <= 5; i++) setFn(m, 8, i, (bits >> i) & 1);
    setFn(m, 8, 7, (bits >> 6) & 1);
    setFn(m, 8, 8, (bits >> 7) & 1);
    setFn(m, 7, 8, (bits >> 8) & 1);
    for (var j = 9; j <= 14; j++) setFn(m, 14 - j, 8, (bits >> j) & 1);
    /* 第二副本：bit0–6 沿第 8 列自下而上（7 格，第 n-8 行留给暗模块），
       bit7–14 沿第 8 行自右向左（8 格，n-8…n-1） */
    for (var k = 0; k <= 6; k++) setFn(m, n - 1 - k, 8, (bits >> k) & 1);
    for (var p = 7; p <= 14; p++) setFn(m, 8, n - 15 + p, (bits >> p) & 1);
    setFn(m, n - 8, 8, 1);
  }
  function writeVersion(m, ver){
    if (ver < 7) return;
    var v = ver << 12, g = 0x1F25;
    for (var i = 5; i >= 0; i--) if ((v >> (i + 12)) & 1) v ^= g << i;
    var bits = (ver << 12) | (v & 0xFFF), n = m.length;
    for (var k = 0; k < 18; k++) {
      var bit = (bits >> k) & 1, a = Math.floor(k / 3), b = k % 3;
      setFn(m, n - 11 + b, a, bit);
      setFn(m, a, n - 11 + b, bit);
    }
  }
  /* 掩码条件（标准 8 条），返回该格是否反转 */
  var MASKS = [
    function(r, c){ return (r + c) % 2 === 0; },
    function(r){ return r % 2 === 0; },
    function(r, c){ return c % 3 === 0; },
    function(r, c){ return (r + c) % 3 === 0; },
    function(r, c){ return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function(r, c){ var p = r * c; return (p % 2) + (p % 3) === 0; },
    function(r, c){ var p = r * c; return ((p % 2) + (p % 3)) % 2 === 0; },
    function(r, c){ return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
  ];
  function placeData(m, words, mask){
    var n = m.length, i = n - 1, up = true, idx = 0, total = words.length * 8;
    while (i > 0) {
      if (i === 6) i--;                       /* 跳过竖向时序列 */
      for (var k = 0; k < 2; k++) {
        var col = i - k;
        for (var v = 0; v < n; v++) {
          var row = up ? n - 1 - v : v;
          if (m[row][col] !== null) continue;
          var bit = 0;
          if (idx < total) bit = (words[idx >> 3] >> (7 - (idx & 7))) & 1;
          idx++;
          if (MASKS[mask](row, col)) bit ^= 1;
          m[row][col] = bit;
        }
      }
      up = !up; i -= 2;
    }
    return idx;
  }
  /* 掩码评分（标准 4 条规则），选分数最低的掩码 */
  function penalty(m){
    var n = m.length, score = 0;
    for (var r = 0; r < n; r++) {
      var run = 1;
      for (var c = 1; c < n; c++) {
        if (m[r][c] === m[r][c - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    for (var c2 = 0; c2 < n; c2++) {
      var run2 = 1;
      for (var r2 = 1; r2 < n; r2++) {
        if (m[r2][c2] === m[r2 - 1][c2]) run2++;
        else { if (run2 >= 5) score += run2 - 2; run2 = 1; }
      }
      if (run2 >= 5) score += run2 - 2;
    }
    for (var r3 = 0; r3 < n - 1; r3++) for (var c3 = 0; c3 < n - 1; c3++) {
      var v = m[r3][c3];
      if (v === m[r3][c3 + 1] && v === m[r3 + 1][c3] && v === m[r3 + 1][c3 + 1]) score += 3;
    }
    /* 1:1:3:1:1 且前后有 4 个同色（标准 3 条两种朝向） */
    var pat = [1, 0, 1, 1, 1, 0, 1];
    function at(arr, i){ return i >= 0 && i < arr.length ? arr[i] : -1; }
    function scanLine(arr){
      for (var s = 0; s + 6 < arr.length; s++) {
        var hit = true;
        for (var t = 0; t < 7; t++) if (arr[s + t] !== pat[t]) { hit = false; break; }
        if (!hit) continue;
        var before = true, after = true;
        for (var b = 1; b <= 4; b++) if (at(arr, s - b) !== 0) { before = false; break; }
        for (var a2 = 1; a2 <= 4; a2++) if (at(arr, s + 6 + a2) !== 0) { after = false; break; }
        if (before || after) score += 40;
      }
    }
    for (var r4 = 0; r4 < n; r4++) {
      var rowArr = m[r4];
      scanLine(rowArr);
    }
    for (var c4 = 0; c4 < n; c4++) {
      var colArr = [];
      for (var r5 = 0; r5 < n; r5++) colArr.push(m[r5][c4]);
      scanLine(colArr);
    }
    var dark = 0;
    for (var r6 = 0; r6 < n; r6++) for (var c6 = 0; c6 < n; c6++) if (m[r6][c6]) dark++;
    var pct = dark * 100 / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function buildBase(ver){
    var n = 17 + 4 * ver, m = blank(n);
    finder(m, 0, 0); finder(m, 0, n - 7); finder(m, n - 7, 0);
    timing(m); align(m, ver); writeVersion(m, ver);
    /* 预留格式信息区（正式写入在掩码确定后） */
    for (var i = 0; i < 9; i++) { if (m[8][i] === null) m[8][i] = 0; if (m[i][8] === null) m[i][8] = 0; }
    for (var j = 0; j < 8; j++) { if (m[8][n - 1 - j] === null) m[8][n - 1 - j] = 0; if (m[n - 1 - j][8] === null) m[n - 1 - j][8] = 0; }
    m[n - 8][8] = 1;
    return m;
  }
  function clone(m){ return m.map(function(r){ return r.slice(); }); }

  /* 主入口：文本 → {ok, size, version, mask, modules(bool[][])} */
  function encode(text, opts){
    var bytes = utf8Bytes(text);
    var ver = (opts && opts.version) || pickVersion(bytes.length);
    if (!ver) return { ok: false, error: '内容过长（' + bytes.length + ' 字节），超出 10 版容量 ' + capacity(MAX_VER) + ' 字节' };
    if (!VER[ver]) return { ok: false, error: '不支持的版本 ' + ver };
    if (bytes.length > capacity(ver)) return { ok: false, error: '内容超出该版本容量' };
    var words = interleave(buildCodewords(bytes, ver), ver);
    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var m = buildBase(ver);
      placeData(m, words, mask);
      writeFormat(m, mask);
      var score = penalty(m);
      if (!best || score < best.score) best = { score: score, mask: mask, m: m };
    }
    var out = [];
    for (var r = 0; r < best.m.length; r++) out.push(best.m[r].map(function(v){ return v === 1; }));
    return { ok: true, size: out.length, version: ver, mask: best.mask, modules: out, bytes: bytes.length, capacity: capacity(ver) };
  }

  /* 人类可读的自检信息（诊断报告里用）：版本、尺寸、掩码、数据量 */
  function info(text){
    var r = encode(text);
    if (!r.ok) return r;
    return { ok: true, version: r.version, size: r.size, mask: r.mask, bytes: r.bytes, capacity: r.capacity };
  }

  return {
    encode: encode, info: info, capacity: capacity, pickVersion: pickVersion,
    utf8Bytes: utf8Bytes, formatBits: formatBits, rsEncode: rsEncode, dataCodewords: dataCodewords,
    MAX_VER: MAX_VER
  };
});
