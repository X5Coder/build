/*
 * Streamo Link — Browser window logic (Windows).
 * Multi-tabs + compact dark toolbar + smart search + internal player + ad-shield.
 * Domain lock: while you are inside a site (tracked per tab), any navigation/redirect to a
 * foreign eTLD+1 is blocked unless it is the site itself, a hop of a user-initiated action,
 * or it matches the anchor the user actually clicked.
 */
'use strict';

(function () {
  /* ANDROID BUILD: الغلاف الأصلي (Kotlin + Android WebView) يحل محل Electron.
     window.StreamoNative = الجسر الخام، adapter.js يغلفه بالشكل المعتاد للواجهة. */

  /* ================= Elements ================= */
  var viewsContainer = document.getElementById('views');
  var notifStack = document.getElementById('notifStack');
  var toastEl = document.getElementById('toast');
  var badge = document.getElementById('badgeLinks');
  var scrim = document.getElementById('scrim');
  var panelRight = document.getElementById('panelRight');
  var panelLeft = document.getElementById('panelLeft');
  var panelTabs = document.getElementById('panelTabs');
  var linksListContent = document.getElementById('linksListContent');
  var searchListContent = document.getElementById('searchListContent');
  var tabsList = document.getElementById('tabsList');
  var linksCount = document.getElementById('linksCount');
  var searchCount = document.getElementById('searchCount');
  var tabsCount = document.getElementById('tabsCount');
  var normalBar = document.getElementById('normalBar');
  var searchBar = document.getElementById('searchBar');
  var searchInput = document.getElementById('searchInput');
  var btnBack = document.getElementById('btnBack');
  var btnForward = document.getElementById('btnForward');
  var urlText = document.getElementById('urlText');
  var urlPill = document.getElementById('urlPill');
  var urlInput = document.getElementById('urlInput');
  var urlLock = document.getElementById('urlLock');
  var btnCopyUrl = document.getElementById('btnCopyUrl');
  var btnUrlGo = document.getElementById('btnUrlGo');
  var lockIconLocked = document.getElementById('lockIconLocked');
  var lockIconUnlocked = document.getElementById('lockIconUnlocked');

  var HOOK =
    "(function(){try{if(window.__streamoHookReady)return;window.__streamoHookReady=true;" +
    "function send(u,isMedia,tagName){try{if(!u)return;var a=document.createElement('a');a.href=u;" +
    "if(a.protocol==='http:'||a.protocol==='https:'){window.__streamoHook.send(a.href, !!isMedia, tagName||'');}}catch(e){}}" +
    "var gesture=function(){try{window.__streamoHook.gesture();}catch(e){}};" +
    "document.addEventListener('click',gesture,true);" +
    "document.addEventListener('pointerdown',gesture,true);" +
    // comment
    "var anchorSend=function(e){try{var t=e.target;var a=t&&t.closest?t.closest('a[href]'):null;" +
    "if(a&&a.href){window.__streamoHook.anchor(a.href);}}catch(e){}};" +
    "document.addEventListener('pointerdown',anchorSend,true);" +
    "document.addEventListener('click',anchorSend,true);" +
    // comment
    "document.addEventListener('click',function(e){try{var t=e.target;var a=t&&t.closest?t.closest('a[href]'):null;" +
    "if(a&&a.href&&window.__streamoHook&&window.__streamoHook.navIntent){window.__streamoHook.navIntent(a.href, !!e.defaultPrevented);}}catch(e){}},false);" +
    "var of=window.fetch;if(of){window.fetch=function(){try{var a=arguments[0];var u=(typeof a==='string')?a:(a&&a.url);send(u,false);}catch(e){}return of.apply(this,arguments);};}" +
    "var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{send(u,false);}catch(e){}return oo.apply(this,arguments);};" +
    "function seen(){try{if(window.__streamoHook&&window.__streamoHook.seen&&window.location&&window.location.href){window.__streamoHook.seen(window.location.href);}}catch(e){}}" +
    "seen();setInterval(seen,2000);" +
    "function scan(){try{var n=document.querySelectorAll('video,source');for(var i=0;i<n.length;i++){var t=n[i];send(t.currentSrc||t.src,true,'video');}}catch(e){}}" +
    "if(window.MutationObserver){new MutationObserver(function(){scan();}).observe(document.documentElement||document,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});}" +
    "scan();setInterval(scan,3000);" +
    "}catch(e){}})();";

  var LINK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" stroke="#FFFFFF" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

  /* ================= Tabs ================= */
  var tabs = [];
  var tabSeq = 0;
  var activeTabId = null;
  var urlByTab = new Map();
  var titleByTab = new Map();
  var extractionLogged = new Set();
  var lastTestAt = new Map();
  var pendingTests = new Map(); // comment
  var anchorClicks = new Map(); // webContentsId -> { etld, ts }
  var pageByWebContents = new Map(); // webContentsId -> href (last known page for a webview)
  var strikes = new Map();
  var STRIKE_MS = 15000;
  var INTENT_MS = 8000;
  var ANCHOR_INTENT_MS = 5000;

  function isHttp(u) { return /^https?:\/\//i.test(String(u || '')); }

  function hostOf(u) {
    try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
  }
  function etld1(host) {
    var p = String(host || '').split('.').filter(Boolean);
    return p.length <= 2 ? p.join('.') : p.slice(-2).join('.');
  }
  function isGoogleHost(host) {
    return /(^|\.)google\.[a-z.]{2,7}$/i.test(String(host || ''));
  }
  function shortHost(url) {
    var h = hostOf(url).replace(/^www\./, '');
    return h || 'link';
  }
  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '...' : s;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isAdDestination(url) {
    try {
      if (!window.streamoBridge.isAdNavQuiet) return false;
      return !!window.streamoBridge.isAdNavQuiet(url);
    } catch (e) { return false; }
  }

  /** Recent user gesture inside this webview (trusted click within 2s) */
  function gestureFresh(tab) {
    try {
      var wcId = tab.webContentsId;
      if (wcId == null || !window.streamoBridge.hasGesture) return false;
      return !!window.streamoBridge.hasGesture(wcId);
    } catch (e) { return false; }
  }

  function activeTab() {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === activeTabId) return tabs[i];
    return null;
  }
  function activeView() {
    var t = activeTab();
    return t ? t.view : null;
  }

  function trimAnchorMap() {
    if (anchorClicks.size <= 60) return;
    var now = Date.now();
    anchorClicks.forEach(function (v, k) {
      if (now - v.ts > ANCHOR_INTENT_MS) anchorClicks.delete(k);
    });
  }

  /** Recent anchor-click intent for this webview (anchor the user actually clicked) */
  function anchorIntent(wcId) {
    var rec = anchorClicks.get(wcId);
    if (!rec) return null;
    if (Date.now() - rec.ts > ANCHOR_INTENT_MS) { anchorClicks.delete(wcId); return null; }
    return rec;
  }

  /**
   * Smart navigation guard.
   */
  function decideNavigation(tab, destUrl, kind) {
    if (!isHttp(destUrl)) return 'allow';
    var dHost = hostOf(destUrl);
    var d = etld1(dHost);
    var c = etld1(hostOf(tab.url || ''));
    if (!d) return 'allow';
    if (c && d === c) return 'allow'; // same site
    if (isGoogleHost(hostOf(tab.url || '')) && isGoogleHost(dHost)) return 'allow'; // google -> google

    if (isAdDestination(destUrl)) {
      // comment
      var now = Date.now();
      var last = strikes.get(d);
      if (last && (now - last) < STRIKE_MS && gestureFresh(tab)) {
        strikes.delete(d);
        return 'allow';
      }
      if (gestureFresh(tab)) {
        strikes.set(d, now);
        return 'strike';
      }
      return 'block'; // no user gesture -> silently blocked
    }

    // comment
    if (tab.hostIntent && tab.hostIntent.freshTs && (Date.now() - tab.hostIntent.freshTs) < INTENT_MS) {
      return 'allow';
    }

    // comment
    var wcId = tab.webContentsId;
    var a = wcId != null ? anchorIntent(wcId) : null;
    if (a) {
      if (a.etld === d) return 'allow';       // the click was on an anchor to this domain
      if (kind === 'redirect') return 'allow'; // 3xx redirect chain of that same click (bit.ly type)
    }
    return 'block';
  }

  function makeWebview(url) {
    // ANDROID: عنصر 'webview' مش موجود — الغلاف الأصلي بينشئ Android WebView أصيل
    // ويرجّعلنا واجهة (facade) بنفس شكل الـ API. اللمس بيعدّيها تلقائيًا للـ WebView الأصلي.
    return window.__streamoTabs.create(url || 'https://www.google.com/');
  }

  /** Host-initiated navigation (typed URL / search / renew) — open transfer window */
  function hostNavigate(tab, url) {
    if (tab) {
      try { tab.hostIntent = { etld: etld1(hostOf(url)), freshTs: Date.now() }; } catch (e) {}
      try { tab.view.src = url; } catch (e) {}
    }
  }

  function createTab(url) {
    tabSeq += 1;
    var id = 't' + tabSeq;
    var view = makeWebview(url);
    try { if (view instanceof Element && viewsContainer.appendChild) viewsContainer.appendChild(view); } catch (e) {}
    var tab = { id: id, webContentsId: null, url: url || '', title: url || 'New Tab', view: view, hostIntent: { etld: etld1(hostOf(url || 'https://www.google.com/')), freshTs: Date.now() } };
    tabs.push(tab);
    attachViewHooks(tab);
    activateTab(id);
    return tab;
  }

  function attachViewHooks(tab) {
    var view = tab.view;

    view.addEventListener('dom-ready', function () {
      try {
        tab.webContentsId = view.getWebContentsId();
        urlByTab.set(tab.webContentsId, tab.url);
        view.executeJavaScript(HOOK).catch(function () {});
      } catch (e) {}
    });
    view.addEventListener('did-finish-load', function () {
      try { view.executeJavaScript(HOOK).catch(function () {}); } catch (e) {}
      updateBackForward(tab);
      updateUrlPill(tab);
      renderTabsList();
    });

    var onNav = function (e) {
      tab.url = e.url || tab.url;
      if (tab.webContentsId != null) urlByTab.set(tab.webContentsId, tab.url);
      // comment
      tab.hostIntent = null;
      trackSearch(e.url, tab);
      updateBackForward(tab);
      updateUrlPill(tab);
      renderTabsList();
    };
    view.addEventListener('did-navigate', onNav);
    view.addEventListener('did-navigate-in-page', onNav);

    view.addEventListener('page-title-updated', function (e) {
      tab.title = e.title || tab.url;
      if (tab.webContentsId != null) titleByTab.set(tab.webContentsId, tab.title);
      renderTabsList();
    });

    // ANDROID: قرار الحظر بيحصل في الغلاف الأصلي (shouldOverrideUrlLoading) — متزامن وبنفس القواعد.
  }

  function updateUrlPill(tab) {
    if (!tab || tab.id !== activeTabId) return;
    var u = tab.url || '';
    urlText.textContent = u;
    urlPill.title = u + ' - click to copy (click the lock to type)';
    if (editMode) urlInput.value = u;
  }

  function updateBackForward(tab) {
    tab = tab || activeTab();
    if (!tab || tab.id !== activeTabId) return;
    var view = tab.view;
    try {
      var canBack = (typeof view.canGoBack === 'function') ? view.canGoBack() : true;
      var canFwd = (typeof view.canGoForward === 'function') ? view.canGoForward() : true;
      btnBack.disabled = !canBack;
      btnForward.disabled = !canFwd;
    } catch (e) {
      btnBack.disabled = true;
      btnForward.disabled = true;
    }
  }

  function activateTab(id) {
    activeTabId = id;
    for (var i = 0; i < tabs.length; i++) {
      // ANDROID: إظهار/إخفاء الـ WebView الأصلي المقابل (النداء بياخد الـ native id)
      window.__streamoTabs.setVisible(tabs[i].view && tabs[i].view._nativeId, tabs[i].id === id);
    }
    var t = activeTab();
    if (t) {
      urlText.textContent = t.url || '';
      urlPill.title = (t.url || '') + ' - click to copy (click the lock to type)';
      if (editMode) urlInput.value = t.url || '';
    }
    updateTabsCount();
    updateBackForward(t);
    renderTabsList();
  }

  function destroyTab(tab) {
    try {
      if (typeof tab.view.destroy === 'function') tab.view.destroy();
      else if (tab.view.parentNode) tab.view.parentNode.removeChild(tab.view);
    } catch (e) {
      try { if (tab.view.parentNode) tab.view.parentNode.removeChild(tab.view); } catch (e2) {}
    }
    if (tab.webContentsId != null) {
      urlByTab.delete(tab.webContentsId);
      titleByTab.delete(tab.webContentsId);
      anchorClicks.delete(tab.webContentsId);
    }
  }

  function closeTab(id) {
    var idx = -1;
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var wasActive = tabs[idx].id === activeTabId;
    destroyTab(tabs[idx]);
    tabs.splice(idx, 1);
    if (tabs.length === 0) {
      createTab('https://www.google.com/');
      return;
    }
    if (wasActive) activateTab(tabs[tabs.length - 1].id);
    else { updateTabsCount(); renderTabsList(); }
  }

  function closeAllTabs() {
    for (var i = 0; i < tabs.length; i++) destroyTab(tabs[i]);
    tabs = [];
    activeTabId = null;
    createTab('https://www.google.com/');
  }

  function renderTabsList() {
    if (!tabsList) return;
    tabsList.innerHTML = '';
    for (var i = 0; i < tabs.length; i++) (function (tab) {
      var isActive = tab.id === activeTabId;
      var name = (tab.title || tab.url || 'Tab').trim();
      var initial = (hostOf(tab.url).replace(/^www\./, '') || 'T').charAt(0).toUpperCase();
      var item = document.createElement('div');
      item.className = 'tab-item' + (isActive ? ' active' : '');
      item.setAttribute('role', 'button');
      item.innerHTML =
        '<div class="tab-favicon">' + escapeHtml(initial) + '</div>' +
        '<div class="tab-info">' +
          '<div class="tab-title">' + escapeHtml(name) + '</div>' +
          '<div class="tab-url" dir="ltr">' + escapeHtml(tab.url || '') + '</div>' +
        '</div>' +
        '<button class="tab-close" title="Close tab">X</button>';
      item.addEventListener('click', function (ev) {
        if (ev.target && ev.target.classList.contains('tab-close')) return;
        activateTab(tab.id);
        closePanel();
      });
      item.querySelector('.tab-close').addEventListener('click', function (ev) {
        ev.stopPropagation();
        closeTab(tab.id);
      });
      tabsList.appendChild(item);
    })(tabs[i]);
  }

  function updateTabsCount() {
    if (tabsCount) tabsCount.textContent = String(tabs.length);
  }

  /* ================= Search tracking ================= */
  function trackSearch(url) {
    try {
      var r = window.StreamoSearch.extract(url);
      if (r) {
        window.StreamoStore.addSearch(r.q, url, r.engine);
        refreshSearchIfOpen();
      }
    } catch (e) {}
  }

  /* ================= Toast ================= */
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }

  /* ================= Mini capture cards — منطق بسيط ================= */
  function flingNotif(div) {
    if (!div) return;
    div.classList.add('out');
    window.setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); if (window.__streamoReportNotifs) window.__streamoReportNotifs(); }, 280);
  }

  function clearAllNotifs() {
    var nodes = notifStack.querySelectorAll('.notif');
    for (var i = 0; i < nodes.length; i++) flingNotif(nodes[i]);
    if (window.__streamoReportNotifs) window.__streamoReportNotifs();
  }

  function addMiniCard(entry) {
    var div = document.createElement('div');
    div.className = 'notif';
    div.setAttribute('data-entry', entry.id);
    div.innerHTML =
      '<div class="notif-icon">' + LINK_SVG + '</div>' +
      '<div class="notif-text">' +
        '<div class="notif-title">' + escapeHtml(shortHost(entry.url)) + '</div>' +
        '<div class="notif-sub" dir="ltr">' + escapeHtml(truncate(entry.url, 58)) + '</div>' +
      '</div>' +
      '<div class="notif-end"><div class="spinner-ring"></div></div>';
    /* ✗ الفاشل: تطير وتنمسح من غير ما تفتح اللوحة · ✓ الناجح: تفتح اللوحة وتخفي كل الكروت */
    div.addEventListener('click', function (e) {
      e.stopPropagation();
      if (div.classList.contains('failed')) { flingNotif(div); return; }
      openPanel('links');
      clearAllNotifs();
      window.setTimeout(function () {
        var storedId = null;
        try {
          var all = window.StreamoStore.getLinks();
          for (var i = 0; i < all.length; i++) if (all[i].url === entry.url) { storedId = all[i].id; break; }
        } catch (e) {}
        if (storedId) window.StreamoPanelUI.flashEntry(linksListContent, storedId);
      }, 140);
    });
    notifStack.appendChild(div);
    if (window.__streamoReportNotifs) window.__streamoReportNotifs();
    // حد أقصى 5 كروت — أسقط الأقدم لما يدخل سادس
    while (notifStack.children.length > 5) {
      var first = notifStack.firstChild;
      if (first) flingNotif(first);
    }
  }

  function updateMiniCard(entryId, ok) {
    var div = notifStack.querySelector('.notif[data-entry="' + entryId + '"]');
    if (!div) return;
    div.classList.toggle('failed', !ok);
    var end = div.querySelector('.notif-end');
    if (end) {
      end.innerHTML = ok
        ? '<span class="notif-badge ok"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.5l4.5 4.5L18.5 7"/></svg></span>'
        : '<span class="notif-badge fail"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M17 7L7 17"/></svg></span>';
    }
    var title = div.querySelector('.notif-title');
    if (title) title.textContent = ok ? 'Link captured' : 'Link failed';
    // نجاح: 10 ثوان · فشل: 5 ثوان · لسه لودنج: لا يزول لو وجد تقرون
    window.setTimeout(function () {
      if (!div.parentNode) return;
      flingNotif(div);
    }, ok ? 10000 : 5000);
  }

  /* شارة "روابط جديدة" — بتظهر مرة واحدة بس قبل أول فتح للوحتها، ومش مطلوب تفتح اللوحة تاني في أي وقت */
  var STREAMO_BADGE_KEY = 'streamo.links.firstBadge';
  var badgeCount = 0;
  function refreshLinkBadge() {
    var seen = false;
    try { seen = localStorage.getItem(STREAMO_BADGE_KEY) === 'seen'; } catch (e) {}
    var n = 0;
    try { n = window.StreamoStore.getLinks().length; } catch (e) { n = 0; }
    badgeCount = Math.min(99, n);
    badge.textContent = String(badgeCount);
    badge.style.display = (!seen && badgeCount > 0) ? 'flex' : 'none';
  }
  function markBadgeSeen() {
    try { localStorage.setItem(STREAMO_BADGE_KEY, 'seen'); } catch (e) {}
    badge.style.display = 'none';
  }

  /* ANDROID: حالة الواجهة المودالية — الغلاف الأصلي يستخدمها في زر الرجوع */
  function reportUiState() {
    try {
      var pl = document.getElementById('player');
      var p = pl && pl.classList.contains('open');
      var searchOpen = searchBar && searchBar.style.display !== 'none';
      var st = p ? 'player' : (openSide ? 'panel' : (editMode ? 'edit' : (searchOpen ? 'search' : 'none')));
      if (window.__streamoSetUiState) window.__streamoSetUiState(st);
    } catch (e) {}
  }

  /* ================= Panels ================= */
  var openSide = null; // 'links' | 'search' | 'tabs' | null
  var linksSignature = '';
  var searchSignature = '';

  var linkActions = {
    onCopy: function (text) {
      var done = function () { toast('Copied OK'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    },
    onOpenGoogle: function (url) { try { window.streamoBridge.openExternal(url); } catch (e) {} closePanel(); },
    onOpen: function (url, kind) { try { window.streamoBridge.openExternal(url); } catch (e) {} closePanel(); },
    onPlay: function (url) { openPlayer(url); closePanel(); },
    onRenew: function (pageUrl, item) {
      if (!pageUrl) { toast('No source page for this link'); return; }
      var t = activeTab();
      if (t) {
        if (item && item.url) lastTestAt.delete(item.url);
        t.hostIntent = { etld: etld1(hostOf(pageUrl)), freshTs: Date.now() };
        t.view.src = pageUrl;
        toast('Re-capturing from the same page...');
      }
      closePanel();
    },
    onOpenPage: function (pageUrl) { createTab(pageUrl); closePanel(); },
    onRefresh: function () { renderLinks(true); }
  };

  var searchActions = {
    onCopy: linkActions.onCopy,
    onOpen: function (url) { createTab(url); closePanel(); },
    onRefresh: function () { renderSearch(true); }
  };

  function renderLinks(force) {
    var sig = JSON.stringify(window.StreamoStore.getLinks());
    if (!force && sig === linksSignature) return;
    linksSignature = sig;
    window.StreamoPanelUI.mountLinks(linksListContent, linkActions);
    linksCount.textContent = String(window.StreamoStore.getLinks().length);
  }
  function renderSearch(force) {
    var sig = JSON.stringify(window.StreamoStore.getSearch());
    if (!force && sig === searchSignature) return;
    searchSignature = sig;
    window.StreamoPanelUI.mountSearch(searchListContent, searchActions);
    searchCount.textContent = String(window.StreamoStore.getSearch().length);
  }
  function refreshSearchIfOpen() { if (openSide === 'search') renderSearch(true); }

  function openPanel(side) {
    if (openSide === side) { closePanel(); return; }
    openSide = side;
    clearAllNotifs(); // فتح أي لوحة — اخفي الإشعارات المُعلّقة على الإطلاق
    panelRight.classList.toggle('open', side === 'links');
    panelLeft.classList.toggle('open', side === 'search');
    panelTabs.classList.toggle('open', side === 'tabs');
    scrim.classList.add('show');
    reportUiState();
    if (window.__streamoReportNotifs) window.__streamoReportNotifs();
    if (side === 'links') { markBadgeSeen(); renderLinks(true); }
    else if (side === 'search') renderSearch(true);
    else if (side === 'tabs') renderTabsList();
  }
  function closePanel() {
    openSide = null;
    panelRight.classList.remove('open');
    panelLeft.classList.remove('open');
    panelTabs.classList.remove('open');
    scrim.classList.remove('show');
    reportUiState();
  }

  /** Close the player if it is open — first thing toolbar buttons do */
  function closePlayerIfOpen() {
    if (playerEl && playerEl.classList.contains('open')) closePlayer();
  }

  document.getElementById('btnLinks').addEventListener('click', function () { closePlayerIfOpen(); openPanel('links'); });
  document.getElementById('btnHistory').addEventListener('click', function () { closePlayerIfOpen(); openPanel('search'); });
  document.getElementById('btnTabs').addEventListener('click', function () { closePlayerIfOpen(); openPanel('tabs'); });
  document.getElementById('closeLinks').addEventListener('click', closePanel);
  document.getElementById('closeSearch').addEventListener('click', closePanel);
  document.getElementById('closeTabs').addEventListener('click', closePanel);
  scrim.addEventListener('click', closePanel);
  document.getElementById('newTabBtn').addEventListener('click', function () { closePlayerIfOpen(); createTab('https://www.google.com/'); closePanel(); });
  document.getElementById('closeAllTabsBtn').addEventListener('click', closeAllTabs);

  document.getElementById('clearLinksBtn').addEventListener('click', function () {
    window.StreamoPanelUI.armClearAll(this, 'links', function () { renderLinks(true); });
  });
  document.getElementById('clearSearchBtn').addEventListener('click', function () {
    window.StreamoPanelUI.armClearAll(this, 'search', function () { renderSearch(true); });
  });
  var creditLinks = document.querySelectorAll('.credit-link');
  for (var ci = 0; ci < creditLinks.length; ci++) {
    creditLinks[ci].addEventListener('click', function (ev) {
      ev.preventDefault();
      var url = this.getAttribute('data-url');
      if (url) window.streamoBridge.openExternal(url);
    });
  }

  setInterval(function () {
    if (openSide === 'links') renderLinks(false);
    else if (openSide === 'search') renderSearch(false);
  }, 1500);

  /* comment */
  var editMode = false;

  function setEditMode(on) {
    editMode = !!on;
    urlPill.classList.toggle('editing', editMode);
    lockIconLocked.style.display = editMode ? 'none' : '';
    lockIconUnlocked.style.display = editMode ? '' : 'none';
    btnCopyUrl.style.display = editMode ? 'none' : '';
    if (editMode) {
      var t = activeTab();
      urlInput.value = (t && t.url) || '';
      urlPill.title = 'Type a URL or search - Enter to go';
      // comment
      window.setTimeout(function () { try { urlInput.focus(); urlInput.select(); } catch (e) {} }, 30);
    } else {
      urlPill.title = 'Current page - click to copy (click the lock to type)';
    }
    reportUiState();
  }

  function copyUrlToClipboard() {
    var t = activeTab();
    var text = (t && t.url) ? t.url : urlText.textContent;
    if (!text) return;
    var done = function () { toast('Copied OK'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  }

  function isLikelyUrl(s) {
    if (/^https?:\/\//i.test(s)) return true;
    return /^[^\s\/]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(s);
  }

  function commitUrlEdit() {
    var raw = (urlInput.value || '').trim();
    if (!raw) { setEditMode(false); return; }
    var target;
    if (/^https?:\/\//i.test(raw)) target = raw;
    else if (isLikelyUrl(raw)) target = 'https://' + raw;
    else target = 'https://www.google.com/search?q=' + encodeURIComponent(raw);
    var t = activeTab();
    if (t) hostNavigate(t, target);
    setEditMode(false);
  }

  urlPill.addEventListener('click', function (ev) {
    if (editMode) return; // editing inside the address bar
    if (ev.target && (ev.target === urlLock || urlLock.contains(ev.target) || ev.target === urlReload || urlReload.contains(ev.target))) return;
    copyUrlToClipboard();
  });
  urlLock.addEventListener('click', function (ev) {
    ev.stopPropagation();
    setEditMode(!editMode);
  });
  urlLock.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setEditMode(!editMode); }
  });
  var urlReload = document.getElementById('urlReload');
  if (urlReload) {
    urlReload.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var v = activeView();
      urlPill.classList.remove('spinning');
      void urlPill.offsetWidth; // restart animation
      urlPill.classList.add('spinning');
      try { if (v && typeof v.reload === 'function') v.reload(); } catch (e) {}
    });
    urlReload.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.click(); }
    });
  }
  btnCopyUrl.addEventListener('click', function (ev) { ev.stopPropagation(); copyUrlToClipboard(); });
  btnUrlGo.addEventListener('click', function (ev) { ev.stopPropagation(); commitUrlEdit(); });
  urlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commitUrlEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditMode(false); }
  });
  urlInput.addEventListener('blur', function () { setEditMode(false); });

  /* ================= Back / Forward ================= */
  function goBack() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
    if (playerEl && playerEl.classList.contains('open')) { closePlayer(); return; }
    var v = activeView();
    if (v) { try { v.goBack(); } catch (e) {} }
  }
  function goForward() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
    if (playerEl && playerEl.classList.contains('open')) { closePlayer(); return; }
    var v = activeView();
    if (v) { try { v.goForward(); } catch (e) {} }
  }
  btnBack.addEventListener('click', goBack);
  btnForward.addEventListener('click', goForward);

  /* comment */
  window.addEventListener('mouseup', function (e) {
    if (e.button === 3) { e.preventDefault(); goBack(); }
    else if (e.button === 4) { e.preventDefault(); goForward(); }
  });

  /* ================= Search mode ================= */
  function enterSearchMode() {
    closePanel();
    closePlayerIfOpen();
    normalBar.style.display = 'none';
    normalBar.classList.remove('bar-enter');
    searchBar.style.display = 'flex';
    searchBar.classList.remove('bar-leave');
    // comment
    void searchBar.offsetWidth;
    searchBar.classList.add('bar-enter');
    searchInput.value = '';
    searchInput.focus();
    reportUiState();
  }
  function exitSearchMode() {
    if (searchBar.style.display === 'none') return;
    searchBar.classList.remove('bar-enter');
    searchBar.classList.add('bar-leave');
    reportUiState();
    window.setTimeout(function () {
      if (searchBar.classList.contains('bar-leave')) {
        searchBar.style.display = 'none';
        searchBar.classList.remove('bar-leave');
        normalBar.style.display = 'flex';
        normalBar.classList.remove('bar-enter');
        void normalBar.offsetWidth;
        normalBar.classList.add('bar-enter');
      }
    }, 150);
  }

  /** Auto-prefix the user's query: "مشاهدة <text> اونلاين" — applies to both the button and Enter */
  function composeSearchQuery(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    return 'مشاهدة ' + t + ' اونلاين';
  }

  function doSearch() {
    var q = composeSearchQuery(searchInput.value);
    if (!q) return;
    var t = activeTab();
    if (t) hostNavigate(t, 'https://www.google.com/search?q=' + encodeURIComponent(q));
    exitSearchMode();
  }

  document.getElementById('btnSearch').addEventListener('click', enterSearchMode);
  document.getElementById('btnSearchBack').addEventListener('click', exitSearchMode);
  document.getElementById('btnDoSearch').addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSearch();
    else if (e.key === 'Escape') exitSearchMode();
  });

  /* ================= Link capture from main ================= */

  if (window.streamoBridge.onLinkFound) {
    window.streamoBridge.onLinkFound(function (payload) {
      var url = payload && payload.url;
      if (!url) return;
      var activeForPage = activeTab();
      var tabId = payload.tabId;
      var reqInitiator = (typeof payload.initiator === 'string' && payload.initiator) ? payload.initiator : '';
      var pageUrl =
        (payload.pageUrl && payload.pageUrl) ||
        (tabId != null && pageByWebContents.get(tabId)) ||
        (tabId != null && urlByTab.get(tabId)) ||
        reqInitiator ||
        (activeForPage && activeForPage.url) || '';

      var now = Date.now();
      var tmpEntry = {
        id: 'pending-' + now.toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36),
        url: url,
        type: (window.StreamoStore.guessType ? window.StreamoStore.guessType(url) : 'unknown'),
        size: null, httpStatus: null, contentType: null, duration: null,
        status: 'testing', error: null, via: null, finalUrl: null,
        pageUrl: pageUrl, ts: now, testedAt: null
      };
      pendingTests.set(url, { tmp: tmpEntry, pageUrl: pageUrl });
      lastTestAt.set(url, now);

      // comment
      addMiniCard(tmpEntry);

      // comment
      runLinkTest(url, pageUrl);

      // comment
      if (pageUrl && !extractionLogged.has(pageUrl)) {
        extractionLogged.add(pageUrl);
        window.StreamoStore.addSearch(pageUrl, pageUrl, 'Capture');
        refreshSearchIfOpen();
      }
    });
  }

  /* comment */
  function applyTestResult(r) {
    if (!r || !r.url) return;
    var url = r.url;
    var ok = r.status === 'ok';
    var pending = pendingTests.get(url) || null;
    var entryId = pending ? pending.tmp.id : null;

    if (pending) { pendingTests.delete(url); }

    if (ok) {
      // comment
      var res = window.StreamoStore.addLink(url, pending ? (pending.pageUrl || '') : '');
      window.StreamoStore.updateLinkByUrl(url, {
        status: 'ok',
        type: r.type || 'unknown',
        size: (r.size === undefined ? null : r.size),
        httpStatus: (r.httpStatus === undefined ? null : r.httpStatus),
        contentType: (r.contentType === undefined ? null : r.contentType),
        duration: (r.duration === undefined ? null : r.duration),
        via: (r.via === undefined ? null : r.via),
        finalUrl: (r.finalUrl === undefined ? null : r.finalUrl),
        error: (r.error === undefined ? null : r.error)
      });
      if (entryId) updateMiniCard(entryId, true);
      refreshLinkBadge();
      renderLinks(true);
      return;
    }

    // comment
    try { window.StreamoStore.removeLinkByUrl(url); } catch (e) {}
    if (entryId) updateMiniCard(entryId, false);
    renderLinks(true);
  }

  function runLinkTest(url, pageUrl) {
    try {
      if (window.streamoBridge.testLink) {
        window.streamoBridge.testLink(url, pageUrl || '').then(applyTestResult, function () {
          applyTestResult({ url: url, status: 'fail', error: 'NETWORK' });
        });
        return;
      }
    } catch (e) {}
    applyTestResult({ url: url, status: 'fail', error: 'NO_BRIDGE' });
  }

  /* New windows policy: same-domain -> new tab, blocked otherwise. */
  if (window.streamoBridge.onPopup) {
    window.streamoBridge.onPopup(function (payload) {
      if (!payload) return;
      var dest = typeof payload.url === 'string' ? payload.url : '';
      if (!isHttp(dest)) return; // blob: / javascript: / file: -> blocked
      var srcPage = (typeof payload.srcUrl === 'string' && payload.srcUrl)
        || (payload.wcId != null && (pageByWebContents.get(payload.wcId) || urlByTab.get(payload.wcId)))
        || (activeTab() && activeTab().url) || '';
      var dHost = hostOf(dest);
      var d = etld1(dHost);
      var c = etld1(hostOf(srcPage || ''));
      if (d && c && d === c) { createTab(dest); return; }           // same site -> open in a tab
      if (isGoogleHost(hostOf(srcPage || '')) && isGoogleHost(dHost)) { createTab(dest); return; }
      // comment
    });
  }

  /* comment */
  if (window.streamoBridge.onSeenPage) {
    window.streamoBridge.onSeenPage(function (payload) {
      if (!payload || payload.wcId == null) return;
      if (typeof payload.href !== 'string' || !/^https?:\/\//i.test(payload.href)) return;
      pageByWebContents.set(payload.wcId, payload.href);
      if (pageByWebContents.size > 120) {
        var first = pageByWebContents.keys().next();
        if (!first.done) pageByWebContents.delete(first.value);
      }
    });
  }

  /* Rescue: swallowed-click intent (same-domain) -> new tab */
  if (window.streamoBridge.onNavIntent) {
    window.streamoBridge.onNavIntent(function (payload) {
      if (!payload) return;
      var dest = typeof payload.href === 'string' ? payload.href : '';
      if (!isHttp(dest)) return;
      if (!payload.prevented) return; // the page did not prevent default
      var srcPage = (payload.wcId != null && (pageByWebContents.get(payload.wcId) || urlByTab.get(payload.wcId)))
        || (activeTab() && activeTab().url) || '';
      var dHost = hostOf(dest);
      var d = etld1(dHost);
      var c = etld1(hostOf(srcPage || ''));
      if (d && c && d === c) { createTab(dest); toast('Opened in new tab'); return; }
      if (isGoogleHost(hostOf(srcPage || '')) && isGoogleHost(dHost)) { createTab(dest); return; }
      // comment
    });
  }

  /* comment */
  if (window.streamoBridge.onAnchorClick) {
    window.streamoBridge.onAnchorClick(function (payload) {
      if (!payload || !payload.href) return;
      var wcId = payload.wcId;
      var etld = etld1(hostOf(payload.href));
      if (wcId == null || !etld) return;
      anchorClicks.set(wcId, { etld: etld, ts: Date.now() });
      trimAnchorMap();
    });
  }

  /* comment */
  var playerEl = document.getElementById('player');
  var playerStage = document.getElementById('playerStage');
  var playerVideo = document.getElementById('playerVideo');
  var playerTitle = document.getElementById('playerTitle');
  var playerToggle = document.getElementById('playerToggle');
  var iconPlay = document.getElementById('iconPlay');
  var iconPause = document.getElementById('iconPause');
  var playerTime = document.getElementById('playerTime');
  var progress = document.getElementById('progress');
  var progressTrack = document.getElementById('progressTrack');
  var progressFill = document.getElementById('progressFill');
  var progressThumb = document.getElementById('progressThumb');
  var progressTooltip = document.getElementById('progressTooltip');
  var playerSkipBack = document.getElementById('playerSkipBack');
  var playerSkipForward = document.getElementById('playerSkipForward');
  var playerTapFlash = document.getElementById('playerTapFlash');
  var tapFlashIcon = document.getElementById('tapFlashIcon');
  var playerRetry = document.getElementById('playerRetry');
  var playerClose = document.getElementById('playerClose');
  var playerFullscreenBtn = document.getElementById('playerFullscreen');
  var shakaPlayer = null;
  var currentPlayerUrl = '';
  var tapFlashTimer = null;
  var controlsTimer = null;
  var controlsDismissedByUser = false;
  var seeking = false;
  var seekPreview = null;       // seconds during drag
  var seekDraggingPointer = null;

  // comment
  try { if (window.shaka && window.shaka.polyfill && window.shaka.polyfill.installAll) window.shaka.polyfill.installAll(); } catch (e) {}

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0
      ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
      : m + ':' + String(s).padStart(2, '0');
  }
  function setPlayIcon(playing) {
    iconPlay.style.display = playing ? 'none' : '';
    iconPause.style.display = playing ? '' : 'none';
  }
  function isManifest(url) {
    return /\.m3u8(\?|#|$)|\.mpd(\?|#|$)/i.test(url || '');
  }
  function setPlayerLoading(on) { playerEl.classList.toggle('loading', !!on); }
  function setPlayerError(on) { playerEl.classList.toggle('error', !!on); }

  /* comment */
  function currentDuration() {
    var d = playerVideo.duration;
    return isFinite(d) && d > 0 ? d : 0;
  }
  function setProgressPercent(percent) {
    var p = Math.max(0, Math.min(100, percent));
    progressTrack.style.setProperty('--p', p + '%');
    progress.setAttribute('aria-valuenow', String(Math.round(p)));
  }
  function shownTime() {
    return seekPreview != null ? seekPreview : (isFinite(playerVideo.currentTime) ? playerVideo.currentTime : 0);
  }
  function currentSeekPercent() {
    var dur = currentDuration();
    return dur > 0 ? (shownTime() / dur) * 100 : 0;
  }
  function renderProgressFromPreview(preview) {
    var dur = currentDuration();
    if (seekTooltipPosition(preview)) { /* position already set */ }
    setProgressPercent(seekPreviewToPercent(preview));
  }
  function seekPreviewToPercent(preview) {
    var dur = currentDuration();
    return dur > 0 ? (preview / dur) * 100 : 0;
  }
  function seekFromClientX(clientX) {
    var rect = progressTrack.getBoundingClientRect();
    var dur = currentDuration();
    var ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    ratio = Math.max(0, Math.min(1, ratio));
    return dur > 0 ? ratio * dur : 0;
  }
  function seekTooltipPosition(seconds) {
    var dur = currentDuration();
    if (dur <= 0 || !isFinite(seconds)) return null;
    var ratio = Math.max(0, Math.min(1, seconds / dur));
    progressTooltip.style.left = (ratio * 100).toFixed(2) + '%';
    progressTooltip.textContent = fmtTime(seconds);
    return ratio;
  }
  function syncSeekPosition(pct) {
    var p = Math.max(0, Math.min(100, pct));
    progressTrack.style.setProperty('--p', p.toFixed(1) + '%');
    progressTooltip.style.left = p.toFixed(2) + '%';
    progress.setAttribute('aria-valuenow', String(Math.round(p)));
  }

  progressTrack.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    seeking = true;
    seekDraggingPointer = e.pointerId;
    try { progressTrack.setPointerCapture(e.pointerId); } catch (err) {}
    progress.classList.add('dragging');
    seekPreview = seekFromClientX(e.clientX);
    seekTooltipPosition(seekPreview);
    syncSeekPosition(seekPreviewToPercent(seekPreview));
  });
  progressTrack.addEventListener('pointermove', function (e) {
    if (seeking) {
      seekPreview = seekFromClientX(e.clientX);
      seekTooltipPosition(seekPreview);
      syncSeekPosition(seekPreviewToPercent(seekPreview));
    } else {
      // comment
      var t = seekFromClientX(e.clientX);
      seekTooltipPosition(t);
    }
  });
  function commitSeek() {
    if (!seeking) return;
    seeking = false;
    progress.classList.remove('dragging');
    var target = seekPreview;
    seekPreview = null;
    if (target != null && isFinite(target)) {
      try { playerVideo.currentTime = target; } catch (e) {}
    }
    syncSeekPosition(currentSeekPercent());
  }
  progressTrack.addEventListener('pointerup', commitSeek);
  progressTrack.addEventListener('pointercancel', commitSeek);
  progressTrack.addEventListener('lostpointercapture', commitSeek);
  progressTrack.addEventListener('mouseleave', function () {
    if (!seeking) progressTooltip.style.display = '';
  });
  progressTrack.addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 30 : 10;
    if (e.key === 'ArrowLeft') { e.preventDefault(); playerVideo.currentTime = Math.max(0, playerVideo.currentTime - step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); playerVideo.currentTime = Math.min(currentDuration(), playerVideo.currentTime + step); }
  });

  /* ===== Lifecycle ===== */
  function openPlayer(url) {
    currentPlayerUrl = url || '';
    playerTitle.textContent = url || '';
    playerEl.classList.add('open');
    playerEl.setAttribute('aria-hidden', 'false');
    reportUiState();
    playerEl.classList.remove('controls-hidden');
    setPlayerError(false);
    setPlayerLoading(true);
    playerVideo.pause();
    playerVideo.removeAttribute('src');
    playerVideo.load();
    playerTime.textContent = '0:00 / 0:00';
    syncSeekPosition(0);

    var settled = false;
    var hardTimeout = window.setTimeout(function () {
      if (!settled) { settled = true; setPlayerLoading(false); setPlayerError(true); }
    }, 10000);
    function settleOk() { if (settled) return; settled = true; window.clearTimeout(hardTimeout); setPlayerLoading(false); }
    function settleErr() { if (settled) return; settled = true; window.clearTimeout(hardTimeout); setPlayerLoading(false); setPlayerError(true); }

    playerVideo.volume = 1;

    if (isManifest(url) && window.shaka && window.shaka.Player && (window.shaka.Player.isBrowserSupported ? window.shaka.Player.isBrowserSupported() : true)) {
      try {
        shakaPlayer = new shaka.Player();
        shakaPlayer.attach(playerVideo).then(function () {
          return shakaPlayer.load(url);
        }).then(function () {
          settleOk();
          playerVideo.play().catch(function () {});
        }).catch(function (e) {
          try { console.log('[player] shaka error', e && e.code, e && e.category, e && e.message); } catch (e2) {}
          settleErr();
        });
        shakaPlayer.addEventListener('error', function (ev) {
          try { var d = ev && ev.detail ? ev.detail : null; console.log('[player] shaka error', d && d.code, d && d.category, d && d.message); } catch (e2) {}
          settleErr();
        });
      } catch (e) {
        playerVideo.src = url;
        playerVideo.play().catch(settleErr);
      }
    } else {
      playerVideo.src = url;
      playerVideo.play().catch(settleErr);
      playerVideo.addEventListener('loadedmetadata', settleOk, { once: true });
      playerVideo.addEventListener('canplay', settleOk, { once: true });
      playerVideo.addEventListener('error', settleErr, { once: true });
    }
    setPlayIcon(true);
  }

  function closePlayer() {
    try {
      playerVideo.pause();
      if (shakaPlayer) { try { shakaPlayer.destroy(); } catch (e) {} shakaPlayer = null; }
      playerVideo.removeAttribute('src');
      playerVideo.load();
      playerEl.classList.remove('open');
      playerEl.setAttribute('aria-hidden', 'true');
      reportUiState();
      playerEl.classList.remove('loading', 'error');
      playerEl.classList.remove('controls-hidden');
      setPlayIcon(false);
      if (controlsTimer) { window.clearTimeout(controlsTimer); controlsTimer = null; }
    } catch (e) {}
  }

  /* ===== Controls show/hide + auto-hide ===== */
  function showControls() {
    playerEl.classList.remove('controls-hidden');
    scheduleControlsHide();
  }
  function hideControls() {
    if (seeking) return; // comment
    playerEl.classList.add('controls-hidden');
  }
  function scheduleControlsHide() {
    if (controlsTimer) window.clearTimeout(controlsTimer);
    if (!playerVideo.paused && !playerEl.classList.contains('controls-hidden')) {
      controlsTimer = window.setTimeout(hideControls, 3800);
    }
  }
  playerStage.addEventListener('mousemove', function () {
    if (controlsDismissedByUser) return;
    showControls();
  });
  playerStage.addEventListener('mouseleave', function () {
    if (playerVideo.paused) return;
    if (controlsTimer) window.clearTimeout(controlsTimer);
    controlsTimer = window.setTimeout(hideControls, 900);
  });

  /* ===== Inputs ===== */
  function togglePlayPause() {
    if (playerVideo.paused) playerVideo.play().catch(function () {});
    else playerVideo.pause();
  }
  function seekDelta(delta) {
    var dur = currentDuration();
    playerVideo.currentTime = Math.max(0, Math.min(dur || 0, playerVideo.currentTime + delta));
  }
  if (playerToggle) playerToggle.addEventListener('click', function () { togglePlayPause(); });
  if (playerSkipBack) playerSkipBack.addEventListener('click', function () { seekDelta(-10); });
  if (playerSkipForward) playerSkipForward.addEventListener('click', function () { seekDelta(+10); });
  if (playerFullscreenBtn) playerFullscreenBtn.addEventListener('click', function () {
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
    var target = playerEl.requestFullscreen ? playerEl : (document.documentElement.requestFullscreen ? document.documentElement : null);
    if (target && target.requestFullscreen) target.requestFullscreen().catch(function () {});
  });
  if (playerRetry) playerRetry.addEventListener('click', function () { if (currentPlayerUrl) openPlayer(currentPlayerUrl); });
  if (playerClose) playerClose.addEventListener('click', closePlayer);

  function flashTap(kind) {
    if (!playerTapFlash || !tapFlashIcon) return;
    tapFlashIcon.innerHTML = kind === 'play'
      ? '<path d="M8 5v14l11-7z"/>'
      : '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
    playerTapFlash.classList.remove('flash-on');
    void playerTapFlash.offsetWidth; // restart the flash animation
    playerTapFlash.classList.add('flash-on');
    if (tapFlashTimer) window.clearTimeout(tapFlashTimer);
    tapFlashTimer = window.setTimeout(function () { playerTapFlash.classList.remove('flash-on'); }, 460);
  }

  /* comment */
  playerStage.addEventListener('click', function (e) {
    // comment
    if (e.target.closest('.progress') || e.target.closest('.player-bottom') || e.target.closest('.player-top')) return;
    var rect = playerStage.getBoundingClientRect();
    var x = (e.clientX - rect.left) / Math.max(1, rect.width);
    var y = (e.clientY - rect.top) / Math.max(1, rect.height);
    var isCenter = x > 0.32 && x < 0.68 && y > 0.24 && y < 0.76;
    if (isCenter) {
      togglePlayPause();
      flashTap(playerVideo.paused ? 'pause' : 'play');
      scheduleControlsHide();
    } else {
      if (playerEl.classList.contains('controls-hidden')) {
        controlsDismissedByUser = false;
        playerEl.classList.remove('controls-hidden');
        scheduleControlsHide();
      } else {
        controlsDismissedByUser = true;
        playerEl.classList.add('controls-hidden');
      }
    }
  });
  playerStage.addEventListener('dblclick', function (e) {
    if (e.target.closest('.progress') || e.target.closest('.player-bottom') || e.target.closest('.player-top')) return;
    if (playerFullscreenBtn) playerFullscreenBtn.click();
  });

  playerVideo.addEventListener('play', function () { setPlayIcon(true); setPlayerLoading(false); scheduleControlsHide(); });
  playerVideo.addEventListener('pause', function () { setPlayIcon(false); if (controlsTimer) { window.clearTimeout(controlsTimer); } showControls(); });
  playerVideo.addEventListener('loadstart', function () { setPlayerLoading(true); });
  playerVideo.addEventListener('waiting', function () { setPlayerLoading(true); });
  playerVideo.addEventListener('playing', function () { setPlayerLoading(false); scheduleControlsHide(); });
  playerVideo.addEventListener('timeupdate', function () {
    playerTime.textContent = fmtTime(playerVideo.currentTime) + ' / ' + fmtTime(playerVideo.duration);
    if (!seeking) syncSeekPosition(currentSeekPercent());
  });
  playerVideo.addEventListener('loadedmetadata', function () {
    playerTime.textContent = '0:00 / ' + fmtTime(playerVideo.duration);
    if (isFinite(playerVideo.duration)) progress.setAttribute('aria-valuemax', String(Math.round(playerVideo.duration)));
  });
  playerVideo.addEventListener('durationchange', function () {
    if (isFinite(playerVideo.duration) && !seeking) syncSeekPosition(currentSeekPercent());
  });
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement) return;
  });

  /* ================= Keyboard ================= */
  document.addEventListener('keydown', function (e) {
    // comment
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'Left')) { e.preventDefault(); goBack(); return; }
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'Right')) { e.preventDefault(); goForward(); return; }
    if (e.key === 'Escape') {
      if (document.fullscreenElement) return; // fullscreen exit is the browser's job
      if (playerEl.classList.contains('open')) { closePlayer(); return; }
      if (searchBar.style.display !== 'none') { exitSearchMode(); return; }
      if (editMode) { setEditMode(false); return; }
      closePanel();
    }
  });

  /* ================= ANDROID: مسارات الرجوع + الطلبات من الغلاف الأصلي ================= */
  window.__closePlayer = closePlayer;
  window.__closePanel = closePanel;
  window.__exitSearchMode = exitSearchMode;
  window.__exitEditMode = function () { setEditMode(false); };
  window.__closeActiveTab = function () { if (activeTabId) closeTab(activeTabId); };
  window.__onBlocked = function () { toast('Blocked - redirect to a different site was stopped'); };
  window.__onBlockedStrike = function () { toast('Blocked - click again to continue'); };

  /* ================= Boot ================= */
  reportUiState();
  if (window.__streamoReportNotifs) window.__streamoReportNotifs();
  createTab('https://www.google.com/');
  renderLinks(true);
  refreshLinkBadge();
})();
