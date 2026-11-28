/**
 * 鸿汇影 · 简体 → 繁体（zh-Hant）界面转换（1.7.95 / 台账 P2-B15 的简繁一档）
 * ---------------------------------------------------------------------------
 * 做法与边界（先说清，免得误会）：
 *   · 这是「显示层转换」：界面文案在渲染后用字表转成繁体，不改源文案、不改存储值。
 *   · 只覆盖界面高频字（约 220 字），未收录的字保持原样——不会把不认识的字瞎改。
 *   · 一词多形的字统一取一个常见形：台→臺 / 后→後 / 里→裡 / 只→隻 / 干→幹 / 系→係(仅「关系」类词用系)。
 *     个别词在繁体里习惯用另一形（如「头发」应为「頭髮」），界面文案里不出现，风险低。
 *   · 输入框、下拉框、脚本内容不转；placeholder / title / aria-label 一起转，方便读屏。
 *   · 与英文（en）互斥：选繁体时英文词条不生效，反之亦然。
 */
(function (root) {
  'use strict';

  /* 简 → 繁 单字表（只收界面里确实出现的字与易混字） */
  var MAP = {
    爱: '愛', 帮: '幫', 办: '辦', 边: '邊', 变: '變', 标: '標',
    别: '別', 补: '補', 参: '參', 仓: '倉', 测: '測', 层: '層',
    产: '產', 长: '長', 场: '場', 车: '車', 称: '稱', 尘: '塵',
    迟: '遲', 冲: '衝', 处: '處', 传: '傳', 创: '創', 词: '詞',
    从: '從', 错: '錯', 达: '達', 带: '帶', 单: '單', 当: '當',
    档: '檔', 导: '導', 灯: '燈', 点: '點', 电: '電', 调: '調',
    顶: '頂', 订: '訂', 东: '東', 动: '動', 读: '讀', 断: '斷',
    对: '對', 队: '隊', 额: '額', 儿: '兒', 发: '發', 范: '範',
    访: '訪', 费: '費', 丰: '豐', 风: '風', 复: '復', 该: '該',
    盖: '蓋', 干: '幹', 个: '個', 给: '給', 关: '關', 观: '觀',
    馆: '館', 规: '規', 国: '國', 过: '過', 还: '還', 号: '號',
    后: '後', 户: '戶', 划: '劃', 画: '畫', 环: '環', 换: '換',
    缓: '緩', 汇: '匯', 会: '會', 机: '機', 积: '積', 极: '極',
    级: '級', 几: '幾', 记: '記', 计: '計', 际: '際', 驾: '駕',
    检: '檢', 见: '見', 间: '間', 将: '將', 节: '節', 结: '結',
    进: '進', 键: '鍵', 钮: '鈕', 仅: '僅', 畅: '暢', 锁: '鎖',
    凭: '憑', 触: '觸', 册: '冊', 败: '敗', 负: '負', 责: '責',
    击: '擊', 获: '獲', 择: '擇', 递: '遞', 缩: '縮', 闭: '閉',
    储: '儲', 经: '經', 静: '靜', 剧: '劇', 据: '據', 开: '開',
    库: '庫', 块: '塊', 扩: '擴', 来: '來', 栏: '欄', 览: '覽',
    类: '類', 里: '裡', 历: '歷', 联: '聯', 连: '連', 两: '兩',
    临: '臨', 铃: '鈴', 领: '領', 录: '錄', 轮: '輪', 论: '論',
    码: '碼', 满: '滿', 没: '沒', 门: '門', 内: '內', 盘: '盤',
    频: '頻', 评: '評', 启: '啟', 气: '氣', 签: '簽', 钱: '錢',
    强: '強', 亲: '親', 区: '區', 驱: '驅', 权: '權', 确: '確',
    让: '讓', 热: '熱', 认: '認', 软: '軟', 删: '刪', 设: '設',
    声: '聲', 时: '時', 实: '實', 识: '識', 视: '視', 试: '試',
    输: '輸', 数: '數', 双: '雙', 顺: '順', 随: '隨', 台: '臺',
    态: '態', 谈: '談', 体: '體', 题: '題', 条: '條', 贴: '貼',
    听: '聽', 头: '頭', 图: '圖', 网: '網', 为: '為', 温: '溫',
    无: '無', 务: '務', 误: '誤', 显: '顯', 现: '現', 线: '線',
    项: '項', 协: '協', 写: '寫', 谢: '謝', 选: '選', 学: '學',
    询: '詢', 压: '壓', 验: '驗', 样: '樣', 页: '頁', 业: '業',
    议: '議', 应: '應', 优: '優', 于: '於', 语: '語', 预: '預',
    员: '員', 远: '遠', 云: '雲', 运: '運', 载: '載', 暂: '暫',
    则: '則', 张: '張', 账: '賬', 诊: '診', 证: '證', 只: '隻',
    质: '質', 终: '終', 种: '種', 着: '著', 准: '準', 资: '資',
    总: '總', 组: '組'
  };

  /* 词组优先替换（避免单字误伤，如「关系」→「關係」「平台」→「平臺」） */
  var PHRASE = {
    '关系': '關係', '系列': '系列', '后台': '後臺', '台前': '臺前', '平台': '平臺', '发布': '發佈',
    '头发': '頭髮', '一只': '一隻', '只有': '只有', '只是': '只是', '内存': '記憶體', '文件': '檔案',
    '默认': '預設', '打印': '列印', '视频': '影片', '在线': '線上', '信息': '資訊', '支持': '支援',
    '服务器': '伺服器', '网络': '網路', '软件': '軟體', '硬件': '硬體', '质量': '品質', '代码': '程式碼',
    '项目': '專案', '鼠标': '滑鼠', '打印机': '印表機', '界面': '介面', '菜单': '選單', '窗口': '視窗',
    '批量': '批次', '搜索': '搜尋', '缓存': '快取', '保存': '儲存', '设备': '裝置', '桌面': '桌面',
    '短信': '簡訊', '邮件': '郵件', '账号': '帳號', '登录': '登入', '注销': '登出', '截图': '截圖'
  };

  /* 按键名/英文缩写/单位不转 */
  var SKIP_TAG = { INPUT: 1, TEXTAREA: 1, SELECT: 1, SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1 };
  /* 常见英文缩写与单位，转过去反而看不懂，统一保留原样 */
  var KEEP = /(URL|HTTP|HTTPS|HLS|MP4|JSON|DNS|IPv4|IPv6|CPU|GPU|KB|MB|GB|TB|ms|fps|kh_|\.js|\.json|\.exe|\.hap|OK)/g;

  function hasCJK(s) { return /[\u4e00-\u9fa5]/.test(s); }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var PHRASE_KEYS = Object.keys(PHRASE).sort(function (a, b) { return b.length - a.length; });
  var PHRASE_RE = new RegExp(PHRASE_KEYS.map(escapeRe).join('|'), 'g');

  function toHant(text) {
    var s = String(text == null ? '' : text);
    if (!s || !hasCJK(s)) return s;
    /* 一、先把英文词与代码片段抽出来占位，避免被逐字表误伤 */
    var keep = [];
    s = s.replace(KEEP, function (m) { keep.push(m); return '\u0001' + (keep.length - 1) + '\u0002'; });
    /* 二、词组整体替换也占位：这样「只有」不会被后面的逐字表再转成「隻有」 */
    var ph = [];
    s = s.replace(PHRASE_RE, function (m) { ph.push(PHRASE[m]); return '\u0003' + (ph.length - 1) + '\u0004'; });
    /* 三、剩下的单字逐个转 */
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      out += MAP[ch] || ch;
    }
    /* 四、还原占位：先词组再英文，顺序不重要，但两轮都要还原 */
    out = out.replace(/\u0003(\d+)\u0004/g, function (_, n) { return ph[Number(n)] || ''; });
    return out.replace(/\u0001(\d+)\u0002/g, function (_, n) { return keep[Number(n)] || ''; });
  }

  /* 遍历 DOM 文本节点与常见可读属性 */
  function walk(node) {
    if (!node) return 0;
    var n = 0;
    try {
      var w = (root.document || (node.ownerDocument || {})).createTreeWalker(node, 4 /* SHOW_TEXT */, null, false);
      var cur = w.nextNode();
      while (cur) {
        var p = cur.parentNode;
        var tag = p && p.nodeName;
        if (tag && !SKIP_TAG[tag]) {
          var t = cur.nodeValue || '';
          var h = toHant(t);
          if (h !== t) { cur.nodeValue = h; n++; }
        }
        cur = w.nextNode();
      }
      var els = node.querySelectorAll ? node.querySelectorAll('[placeholder],[title],[aria-label],[alt]') : [];
      for (var i = 0; i < els.length; i++) {
        ['placeholder', 'title', 'aria-label', 'alt'].forEach(function (a) {
          if (els[i].hasAttribute && els[i].hasAttribute(a)) {
            var v = els[i].getAttribute(a) || '';
            var hv = toHant(v);
            if (hv !== v) { els[i].setAttribute(a, hv); n++; }
          }
        });
      }
    } catch (e) { /* 无 DOM 环境（单测）直接跳过 */ }
    return n;
  }

  function apply(rootEl) {
    try { if (String((root.getStore ? root.getStore('kh_lang', 'zh') : 'zh')) !== 'zh-hant') return 0; } catch (e) { return 0; }
    return walk(rootEl);
  }

  var api = { toHant: toHant, walk: walk, apply: apply, MAP: MAP, PHRASE: PHRASE };
  root.KHHANT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
