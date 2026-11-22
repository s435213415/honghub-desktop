/* 设备端（HAP / ArkWeb）能力桥补齐
   桌面端有 11 类本机能力桥，设备端原先只有方向 / 返回 / 设备信息，
   导致下载队列、系统通知、环境信息在设备上点开只会提示「当前环境不支持」。
   这里用原生代理 KHHap（Index.ets 的 HapBridge）补上能真正落地的这几类，
   并把同步代理结果包装成网页需要的 Promise 契约，业务代码不需要分支。

   仍然接不通、也不假装接通的（受系统权限或没有真机联调）：
     DLNA 组播投屏、开机自启、全局媒体键、本机文件直读、HAP 静默安装
   这几项前端继续走既有「当前环境不支持」的降级文案。
*/
(function () {
  var ua = navigator.userAgent || '';
  var isHap = /ArkWeb|OpenHarmony|Kaihong/i.test(ua);
  if (!isHap) { return; }
  window.KH_HARMONY = true;

  function P(v) { return Promise.resolve(v); }
  function parse(s, d) {
    try { var o = JSON.parse(s); return o === null || o === undefined ? d : o; } catch (e) { return d; }
  }
  function has(name) {
    return !!(window.KHHap && typeof window.KHHap[name] === 'function');
  }

  /* 下载事件：原生下载任务通过 __KH_DL_EVT 推 add / progress / done / failed。
     网页侧除了直接订阅，还会用 khDl.on(cb) 拿整份队列快照（与桌面 same contract），
     这里把高频 progress 合并成 200ms 一次列表刷新，避免每帧读一遍列表。 */
  var dlSubs = [];
  var dlTimer = 0;
  function pushView() {
    dlTimer = 0;
    if (!dlSubs.length || !window.khDl) { return; }
    window.khDl.list().then(function (v) {
      for (var i = 0; i < dlSubs.length; i++) {
        try { dlSubs[i](v); } catch (e) { /* 单个订阅异常不影响其它 */ }
      }
    }).catch(function () {});
  }
  window.__KH_DL_EVT = function (evt) {
    if (dlSubs.length && !dlTimer) { dlTimer = setTimeout(pushView, 200); }
  };

  /* 环境信息：khEnvInfo.get() */
  if (!window.khEnvInfo) {
    window.khEnvInfo = {
      get: function () {
        if (!has('getEnv')) { return P({ platform: 'harmony' }); }
        return P(parse(window.KHHap.getEnv(), { platform: 'harmony' }));
      }
    };
  }

  /* 外部打开：复用 KaihongBridge.openExternal（系统浏览器），失败交回前端回退应用内浏览 */
  if (!window.khExternal) {
    window.khExternal = {
      open: function (url) {
        var ok = false;
        try {
          if (window.KaihongBridge && typeof window.KaihongBridge.openExternal === 'function') {
            ok = !!window.KaihongBridge.openExternal(String(url || ''));
          }
        } catch (e) { ok = false; }
        return P({ ok: ok });
      }
    };
  }

  /* 系统通知：khNotify.send(title, body) */
  if (!window.khNotify) {
    window.khNotify = {
      send: function (title, body) {
        if (!has('notify')) { return P({ ok: false, reason: '当前设备没有通知桥' }); }
        return P(parse(window.KHHap.notify(String(title || ''), String(body || '')), {}));
      }
    };
  }

  /* 下载队列：与桌面 khDl 同名同形状（list 返回 {items:[...]}） */
  if (!window.khDl && has('dlList')) {
    window.khDl = {
      list: function () { return P(parse(window.KHHap.dlList(), { items: [] })); },
      add: function (arg) {
        return P(parse(window.KHHap.dlAdd(JSON.stringify(arg || {})), { ok: false, reason: '设备端未响应' }));
      },
      remove: function (id) { return P(parse(window.KHHap.dlRemove(String(id)), { ok: false })); },
      clear: function (which) { return P(parse(window.KHHap.dlClear(String(which || 'finished')), { ok: false })); },
      pause: function () { return P({ ok: false, reason: '设备端暂不支持暂停单个任务' }); },
      resume: function () { return P({ ok: false, reason: '设备端暂不支持断点续传' }); },
      opt: function () { return P({ ok: true, conc: 1, limitKB: 0, reason: '设备端串行下载' }); },
      reveal: function () { return P(parse(window.KHHap.dlReveal(), { ok: false })); },
      /* 与桌面 khDl.on 同语义：订阅后先推一次全量队列，之后有进度就推快照 */
      on: function (cb) {
        if (typeof cb !== 'function') { return function () {}; }
        dlSubs.push(cb);
        var self = this;
        setTimeout(function () { self.list().then(function (v) { cb(v); }).catch(function () {}); }, 0);
        return function () {
          var i = dlSubs.indexOf(cb);
          if (i >= 0) { dlSubs.splice(i, 1); }
        };
      }
    };
  }
  /* 文件导出 / 导入：原生 saveText / openText 只同步返回 {ok,id}，结果经 __KH_FILE_EVT
     回推（选文件、写盘、读盘都要等用户操作）。这里包装成 Promise，前端照桌面同一套写法用。
     用户可能在文件管理器里停留很久，所以不做短超时打断，只在 3 分钟无响应时收口。 */
  var fileWait = {};
  window.__KH_FILE_EVT = function (evt) {
    try {
      if (!evt) { return; }
      var cb = fileWait[evt.id];
      if (cb) {
        delete fileWait[evt.id];
        cb(evt);
      }
    } catch (e) { /* 单个回调异常不影响其它 */ }
  };
  function callFile(method, a, b) {
    return new Promise(function (resolve) {
      if (!has(method)) { resolve({ ok: false, reason: '当前设备没有文件桥' }); return; }
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      var id = 0;
      try {
        var r = parse(window.KHHap[method](a, b), null);
        if (!r || !r.ok) { finish({ ok: false, reason: (r && r.reason) || '文件桥调用失败' }); return; }
        id = r.id;
      } catch (e) {
        finish({ ok: false, reason: (e && e.message) || String(e) });
        return;
      }
      fileWait[id] = function (evt) {
        finish({
          ok: !!evt.ok, reason: evt.reason || '', path: evt.path || '',
          text: evt.text || '', name: evt.name || ''
        });
      };
      setTimeout(function () {
        if (fileWait[id]) { delete fileWait[id]; }
        finish({ ok: false, reason: '没有收到系统文件选择结果（可能被系统拦下或已超时）' });
      }, 180000);
    });
  }
  window.khFile = {
    saveText: function (name, text) { return callFile('saveText', String(name || 'honghub.txt'), String(text || '')); },
    openText: function (accept) { return callFile('openText', String(accept || '.json'), ''); }
  };
})();
