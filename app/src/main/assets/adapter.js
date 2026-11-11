/*
 * Streamo Link (Android) — adapter بين chrome.js الأصلية والغلاف الأصلي (Kotlin).
 * يعيد نفس أسطح window.streamoBridge و <webview> اللي كانت بتوفرها Electron،
 * مبني على الجسر الأصلي window.StreamoNative (JavascriptInterface).
 * ماينكسرش لو فُتح الملف في متصفح عادي — كل النداءات بقت noop هادئة.
 */
'use strict';

(function () {
  var hasNative = typeof window.StreamoNative !== 'undefined' && window.StreamoNative !== null;
  var N = hasNative ? window.StreamoNative : null;

  function safeJson(obj) {
    try { return JSON.stringify(obj); } catch (e) { return '{}'; }
  }

  /* ================= Tab facades (بديل عناصر <webview>) ================= */
  var tabSeq = 1000;
  var facades = {};            // nativeId -> facade
  var tabListeners = {};       // nativeId -> { type: [cb] }

  function nativeId(facade) { return facade ? facade._nativeId : -1; }

  function makeFacade(nId, initialSrc) {
    var f = {
      _nativeId: nId,
      id: 'n' + nId,
      className: 'tab-view',
      style: {},
      setAttribute: function () {},
      getAttribute: function () { return null; },
      getWebContentsId: function () { return nId; },
      addEventListener: function (type, cb) {
        if (!tabListeners[nId]) tabListeners[nId] = {};
        if (!tabListeners[nId][type]) tabListeners[nId][type] = [];
        tabListeners[nId][type].push(cb);
      },
      removeEventListener: function (type, cb) {
        var m = tabListeners[nId];
        if (!m || !m[type]) return;
        m[type] = m[type].filter(function (x) { return x !== cb; });
      },
      executeJavaScript: function (code) {
        try { if (N) N.tabExecJs(nId, String(code || '')); } catch (e) {}
        return Promise.resolve('');
      },
      canGoBack: function () { try { return !!N && N.tabCanGoBack(nId); } catch (e) { return false; } },
      canGoForward: function () { try { return !!N && N.tabCanGoForward(nId); } catch (e) { return false; } },
      goBack: function () { try { if (N) N.tabGoBack(nId); } catch (e) {} },
      goForward: function () { try { if (N) N.tabGoForward(nId); } catch (e) {} },
      reload: function () { try { if (N) N.tabReload(nId); } catch (e) {} },
      reloadIgnoringCache: function () { try { if (N) N.tabReload(nId); } catch (e) {} },
      destroy: function () {
        try { if (N) N.tabDestroy(nId); } catch (e) {}
        delete tabListeners[nId];
        delete facades[nId];
      },
      focus: function () {}
    };
    // src خاصية: الكتابة عليه = تحميل URL (القيمة الأولى جاية من الإنشاء نفسه)
    var currentSrc = initialSrc || '';
    Object.defineProperty(f, 'src', {
      get: function () { return currentSrc; },
      set: function (v) {
        currentSrc = String(v || '');
        try { if (N && currentSrc) N.tabLoadUrl(nId, currentSrc); } catch (e) {}
      }
    });
    return f;
  }

  window.__streamoTabs = {
    create: function (url) {
      var target = String(url || 'https://www.google.com/');
      var nId = null;
      try { nId = N ? N.createTab(target) : null; } catch (e) { nId = null; }
      if (nId == null || nId <= 0) nId = tabSeq++;
      var f = makeFacade(nId, target);
      facades[nId] = f;
      return f;
    },
    setVisible: function (id, visible) {
      try { if (N) N.tabSetVisible(id, !!visible); } catch (e) {}
    }
  };

  /* أحداث من الغلاف الأصلي: window.__tabEvent(id, type, payloadJsonText) */
  window.__tabEvent = function (id, type, payloadText) {
    var m = tabListeners[id];
    if (!m) return;
    var list = m[type];
    if (!list || !list.length) return;
    var payload = {};
    try { payload = (typeof payloadText === 'string') ? JSON.parse(payloadText) : (payloadText || {}); } catch (e) { payload = {}; }
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) {}
    }
  };

  /* ================= streamoBridge (بديل Electron preload) ================= */
  var testSeq = 0;
  var testCbs = {};

  window.streamoBridge = {
    openExternal: function (url) { try { if (N) N.openExternal(String(url || '')); } catch (e) {} },
    isAdNavQuiet: function (url) { try { return !!N && N.isAdNavQuiet(String(url || '')); } catch (e) { return false; } },
    isAdNav: function (url) { try { return !!N && N.isAdNavQuiet(String(url || '')); } catch (e) { return false; } },
    hasGesture: function (id) { try { return !!N && N.hasGesture(Number(id) || 0); } catch (e) { return false; } },
    testLink: function (url, pageUrl) {
      return new Promise(function (resolve) {
        var id = ++testSeq;
        testCbs[id] = resolve;
        try { if (N) N.testLink(id, String(url || ''), String(pageUrl || '')); else resolve({ url: url, status: 'fail', error: 'NO_BRIDGE' }); }
        catch (e) { resolve({ url: url, status: 'fail', error: 'EXCEPTION' }); }
        window.setTimeout(function () {
          if (testCbs[id]) { var cb = testCbs[id]; delete testCbs[id]; try { cb({ url: url, status: 'fail', error: 'TIMEOUT' }); } catch (e2) {} }
        }, 12000);
      });
    },
    onLinkFound: function (cb) { window.__onLinkFound = cb; },
    onPopup: function (cb) { window.__onPopup = cb; },
    onSeenPage: function (cb) { window.__onSeenPage = cb; },
    onNavIntent: function (cb) { window.__onNavIntent = cb; },
    onAnchorClick: function (cb) { window.__onAnchorClick = cb; }
  };

  /* نتيجة اختبار الرابط من الغلاف الأصلي */
  window.__testCb = function (id, payloadText) {
    var cb = testCbs[id];
    if (!cb) return;
    delete testCbs[id];
    var payload = {};
    try { payload = (typeof payloadText === 'string') ? JSON.parse(payloadText) : (payloadText || {}); } catch (e) { payload = { status: 'fail', error: 'BAD_JSON' }; }
    try { cb(payload); } catch (e) {}
  };

  /* أقفال نظيفة عشان native يدفع الأحداث حتى قبل تسجيل chrome.js ليها */
  if (typeof window.__onLinkFound !== 'function') window.__onLinkFound = function () {};
  if (typeof window.__onPopup !== 'function') window.__onPopup = function () {};
  if (typeof window.__onSeenPage !== 'function') window.__onSeenPage = function () {};
  if (typeof window.__onNavIntent !== 'function') window.__onNavIntent = function () {};
  if (typeof window.__onAnchorClick !== 'function') window.__onAnchorClick = function () {};

  /* ================= تتبع الهوتزون (تمرير اللمس) ================= */
  var dpr = window.devicePixelRatio || 1;
  function toolbarBottomPx() {
    var tb = document.getElementById('toolbar');
    if (!tb) return Math.round(44 * dpr);
    try { return Math.ceil(tb.getBoundingClientRect().bottom * dpr); } catch (e) { return Math.round(44 * dpr); }
  }
  var notifRect = [0, 0, 0, 0];
  window.__streamoReportNotifs = function () {
    try {
      var stack = document.getElementById('notifStack');
      if (!stack || !stack.children.length) { notifRect = [0, 0, 0, 0]; }
      else {
        var r = stack.getBoundingClientRect();
        notifRect = [Math.floor(r.left * dpr), Math.floor(r.top * dpr), Math.ceil(r.right * dpr), Math.ceil(r.bottom * dpr)];
      }
    } catch (e) { notifRect = [0, 0, 0, 0]; }
    reportHotzones();
  };
  function reportHotzones() {
    try {
      if (N && N.setChromeHotzones) {
        N.setChromeHotzones(toolbarBottomPx(), notifRect[0], notifRect[1], notifRect[2], notifRect[3]);
      }
    } catch (e) {}
  }
  window.addEventListener('resize', window.__streamoReportNotifs);
  window.addEventListener('load', function () {
    window.setTimeout(window.__streamoReportNotifs, 60);
    window.setTimeout(window.__streamoReportNotifs, 500);
  });

  /* ================= حالة الواجهة المودالية (player/panel) ================= */
  window.__streamoSetUiState = function (s) {
    try { if (N && N.setUiState) N.setUiState(String(s || 'none')); } catch (e) {}
  };
})();
