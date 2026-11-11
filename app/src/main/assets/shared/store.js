/*
 * Streamo Link — التخزين المشترك للسجل (يعمل على الأندرويد والويندوز)
 * المصدر الوحيد للبيانات: localStorage بمفاتيح:
 *   streamo.links.v1   → سجل الروابط المسحوبة
 *   streamo.search.v1  → سجل البحث
 */
'use strict';

var StreamoStore = (function () {
  var LINKS_KEY = 'streamo.links.v1';
  var SEARCH_KEY = 'streamo.search.v1';
  var MAX_LINKS = 300;
  var MAX_SEARCH = 200;

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('StreamoStore: تعذر الحفظ', e);
      return false;
    }
  }

  function now() { return Date.now(); }

  function uid(prefix) {
    return prefix + now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  /**
   * تطبيع قيمة وقت: أرقام بالثواني تُقبل كما هي، وما هو بالمللي يُقسم على 1000.
   * (بعض المواقع تكتب الرقم بالمللي أو بالثانية — نحسم بالأُس)
   */
  function normUnixSeconds(v) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return null;
    if (n > 1e13) return Math.floor(n / 1000); // ميلي ثانية/مايكرو تقريبًا
    if (n > 1e11) return Math.floor(n / 1000);
    return n;
  }

  /** يستخرج وقت الانتهاء من s (وقت الإنشاء) و e (مدة الصلاحية) أو exp (وقت الانتهاء المطلق). */
  function parseExpiry(url) {
    try {
      var u = new URL(url);
      var exp = u.searchParams.get('exp');
      if (exp && /^\d+$/.test(exp)) {
        var expS = normUnixSeconds(exp);
        if (expS) return expiryFromExpiresAt(expS * 1000);
      }
      var s = u.searchParams.get('s');
      var e = u.searchParams.get('e');
      if (s && /^\d+$/.test(s)) {
        var sNorm = normUnixSeconds(s);
        if (sNorm === null) return null;
        if (e && /^\d+$/.test(e)) {
          var eNorm = normUnixSeconds(e);
          if (eNorm === null) return null;
          // تفسير «e»: تاريخ انتهاء مطلق لو يبدو يونكس حقيقي (> 1e9 ≈ 2001+)، وإلا مدة بالثواني من s
          if (eNorm > 1e9) return expiryFromExpiresAt(eNorm * 1000);
          return expiryFromExpiresAt((sNorm + eNorm) * 1000);
        }
        return null;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  /* ---------- تنظيف لمرة واحدة: الروابط الفاشلة + التكرارات ---------- */
  function sanitizeLinks() {
    var links = read(LINKS_KEY);
    if (!links.length) return;
    var seen = {};
    var out = [];
    for (var i = 0; i < links.length; i++) {
      var item = links[i];
      if (item.status === 'fail') continue; // الروابط الفاشلة ما فيش منها فات
      var key = linkDedupeKey(item.url);
      if (seen[key]) continue;
      seen[key] = true;
      out.push(item);
    }
    if (out.length !== links.length) write(LINKS_KEY, out);
  }

  /* ---------- تنظيف لمرة واحدة: الروابط الخام في سجل البحث ← الاستعلام/المحرك الحقيقي ---------- */
  var ENGINE_PARAMS = [
    { hosts: ['google.'], param: 'q', name: 'Google' },
    { hosts: ['bing.com'], param: 'q', name: 'Bing' },
    { hosts: ['duckduckgo.com'], param: 'q', name: 'DuckDuckGo' },
    { hosts: ['search.yahoo.com'], param: 'p', name: 'Yahoo' },
    { hosts: ['yandex.'], param: 'text', name: 'Yandex' },
    { hosts: ['search.brave.com'], param: 'q', name: 'Brave' },
    { hosts: ['search.marginalia.nu'], param: 'query', name: 'Marginalia' },
    { hosts: ['qwant.com'], param: 'q', name: 'Qwant' },
    { hosts: ['youtube.com'], param: 'search_query', name: 'YouTube' }
  ];

  function sanitizeSearchLog() {
    var items = read(SEARCH_KEY);
    if (!items.length) return;
    var changed = false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var q = String(it.q || '').trim();
      if (!/^https?:\/\//i.test(q)) continue; // مش رابط — سيبه
      var cleanQ = '';
      var cleanEngine = it.engine || '';
      try {
        var u = new URL(q);
        var host = (u.hostname || '').toLowerCase().replace(/^www\./, '');
        var hit = null;
        for (var j = 0; j < ENGINE_PARAMS.length; j++) {
          var e = ENGINE_PARAMS[j];
          if (host.indexOf(e.hosts[0]) !== -1 || host.endsWith('.' + e.hosts[0])) { hit = e; break; }
        }
        if (hit) {
          var v = u.searchParams.get(hit.param);
          if (v && v.trim()) { cleanQ = v.trim(); cleanEngine = hit.name; }
        }
        if (!cleanQ) cleanQ = host; // fallback — hostname نظيف بدل الرابط كامل
      } catch (e2) {
        cleanQ = q.split('?')[0].replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
      }
      if (cleanQ && cleanQ !== q) {
        items[i] = Object.assign({}, it, { q: cleanQ, engine: cleanEngine });
        changed = true;
      }
    }
    if (changed) write(SEARCH_KEY, items);
  }

  /* ---------- سجل الروابط المسحوبة ---------- */

  function getLinks() { return read(LINKS_KEY); }

  /* روابط التوقيع المتغير لنفس الملف (مثل token/exp في HLS) تُعامل كرابط واحد */
  function linkDedupeKey(url) {
    try {
      var u = new URL(String(url || ''));
      var p = (u.pathname || '').toLowerCase();
      if (/\.(m3u8|mpd|ts)$/i.test(p)) return (u.origin || '').toLowerCase() + p;
      return String(u.href);
    } catch (e) {
      return String(url || '');
    }
  }

  /**
   * إضافة رابط. **لا يمكن أن يظهر نفس الرابط مرتين في القائمة** — إن وُجد تُعيد المدخل نفسه.
   * يعيد { entry, added }.
   */
  function addLink(url, pageUrl) {
    var links = read(LINKS_KEY);
    var t = now();
    var key = linkDedupeKey(url);
    var dup = null;
    for (var i = 0; i < links.length; i++) {
      if (linkDedupeKey(links[i].url) === key) { dup = links[i]; break; }
    }
    if (dup) {
      // حدّث مصدر الصفحة لو كان فاضيًا — وإلا لا نفعل شيئًا
      if (pageUrl && !dup.pageUrl) {
        var copy = {}; for (var k in dup) copy[k] = dup[k];
        copy.pageUrl = pageUrl;
        links[i] = copy;
        write(LINKS_KEY, links);
        return { entry: copy, added: false };
      }
      return { entry: dup, added: false };
    }

    var entry = {
      id: uid('l'),
      url: url,
      type: guessType(url),       // امتداد/نوع أولي — يُحدَّث بعد الاختبار
      size: null,
      httpStatus: null,
      contentType: null,
      duration: null,
      status: 'testing',          // testing | ok | fail
      error: null,
      via: null,                  // json لو الرابط كان وسيط
      finalUrl: null,
      pageUrl: pageUrl || '',     // الصفحة اللي اتسحب منها (للتجميع)
      ts: t,
      testedAt: null
    };
    links.unshift(entry);
    if (links.length > MAX_LINKS) links.length = MAX_LINKS;
    write(LINKS_KEY, links);
    return { entry: entry, added: true };
  }

  /** تحديث نتيجة اختبار رابط. */
  function updateLink(id, patch) {
    var links = read(LINKS_KEY);
    for (var i = 0; i < links.length; i++) {
      if (links[i].id === id) {
        var merged = {};
        for (var k in links[i]) merged[k] = links[i][k];
        for (var p in patch) merged[p] = patch[p];
        merged.testedAt = now();
        links[i] = merged;
        write(LINKS_KEY, links);
        return merged;
      }
    }
    return null;
  }

  /** حذف كل مدخل لنفس الـ key (توين التوقيع المختلف) */
  function removeLinkByUrl(url) {
    var key = linkDedupeKey(url);
    write(LINKS_KEY, read(LINKS_KEY).filter(function (l) { return linkDedupeKey(l.url) !== key; }));
  }

  function removeLink(id) { write(LINKS_KEY, read(LINKS_KEY).filter(function (l) { return l.id !== id; })); }
  function clearLinks() { write(LINKS_KEY, []); }

  /** مسح كل الروابط الفاشلة دفعة واحدة */
  function deleteFailed() {
    write(LINKS_KEY, read(LINKS_KEY).filter(function (l) { return l.status !== 'fail'; }));
  }

  /** إيجاد أحدث مدخل لنفس الرابط (يفضل المدخل الجاري اختباره). */
  function findLinkByUrl(url) {
    var links = read(LINKS_KEY);
    for (var i = 0; i < links.length; i++) {
      if (links[i].url === url && links[i].status === 'testing') return links[i];
    }
    for (var j = 0; j < links.length; j++) {
      if (links[j].url === url) return links[j];
    }
    return null;
  }

  function updateLinkByUrl(url, patch) {
    var entry = findLinkByUrl(url);
    if (!entry) return null;
    return updateLink(entry.id, patch);
  }

  /* ---------- سجل البحث ---------- */

  function getSearch() { return read(SEARCH_KEY); }

  /** إضافة عملية بحث. يمنع التكرار المتتالي فقط — نفس الاستعلام لا يتكرر ورا بعض حرفيًا؛ بعد حاجه مختلفة مسموح عادي */
  function addSearch(q, url, engine) {
    q = (q || '').trim();
    if (!q) return null;
    var items = read(SEARCH_KEY);
    var t = now();
    if (items.length &&
        items[0].q === q &&
        (items[0].engine || '') === (engine || '')) {
      return items[0]; // مكرر على التوالي — مرفوض بصمت
    }
    var entry = { id: uid('s'), q: q, url: url || '', engine: engine || '', ts: t };
    items.unshift(entry);
    if (items.length > MAX_SEARCH) items.length = MAX_SEARCH;
    write(SEARCH_KEY, items);
    return entry;
  }

  function removeSearch(id) { write(SEARCH_KEY, read(SEARCH_KEY).filter(function (s) { return s.id !== id; })); }
  function clearSearch() { write(SEARCH_KEY, []); }

  /* ---------- مساعدات ---------- */

  var EXT_REGEX = /\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd|ts)(\?|#|$)/i;

  function guessType(url) {
    var m = EXT_REGEX.exec(url || '');
    if (!m) return 'unknown';
    var ext = m[1].toLowerCase();
    if (ext === 'm3u8') return 'hls';
    if (ext === 'mpd') return 'dash';
    if (ext === 'mp3' || ext === 'm4a' || ext === 'wav' || ext === 'aac' || ext === 'opus' || ext === 'flac') return 'audio';
    return ext;
  }

  function expiryFromExpiresAt(expiresAtMs) {
    var remaining = Math.floor((expiresAtMs - now()) / 1000);
    return { expiresAt: expiresAtMs, remainingSeconds: remaining, expired: remaining <= 0 };
  }

  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return null;
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0, n = Number(bytes);
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)) + ' ' + units[i];
  }

  function formatDuration(sec) {
    if (sec === null || sec === undefined || !isFinite(sec) || sec < 0) return null;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
    return m + ':' + pad2(s);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function formatExpiry(remainingSeconds) {
    if (remainingSeconds <= 0) return 'Link expired';
    var h = Math.floor(remainingSeconds / 3600);
    var m = Math.floor((remainingSeconds % 3600) / 60);
    var s = remainingSeconds % 60;
    if (h > 0) return 'Expires in ' + h + 'h ' + m + 'm';
    if (m > 0) return 'Expires in ' + m + 'm ' + s + 's';
    return 'Expires in ' + s + 's';
  }

  function timeAgo(ts) {
    var diff = Math.max(0, Math.floor((now() - ts) / 1000));
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  /** وقت الالتقاط: اليوم/أمس + 12 ساعة */
  function formatCaptureTime(ts) {
    try {
      var d = new Date(ts);
      var n = new Date();
      var dayMs = 24 * 3600 * 1000;
      var startOfDay = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
      var label = (d.getTime() >= startOfDay) ? 'Today'
        : (d.getTime() >= startOfDay - dayMs) ? 'Yesterday'
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return label + ', ' + time;
    } catch (e) {
      return new Date(ts).toLocaleString('en-US');
    }
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, month: 'short', day: 'numeric' });
    } catch (e) {
      return new Date(ts).toLocaleString();
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // تنظيف لمرة واحدة لسجل البحث + سجل الروابط (يُطبَّق عند الإقلاع)
  sanitizeLinks();
  sanitizeSearchLog();

  return {
    getLinks: getLinks,
    addLink: addLink,
    updateLink: updateLink,
    findLinkByUrl: findLinkByUrl,
    updateLinkByUrl: updateLinkByUrl,
    removeLink: removeLink,
    removeLinkByUrl: removeLinkByUrl,
    clearLinks: clearLinks,
    getSearch: getSearch,
    addSearch: addSearch,
    removeSearch: removeSearch,
    clearSearch: clearSearch,
    guessType: guessType,
    parseExpiry: parseExpiry,
    formatBytes: formatBytes,
    formatDuration: formatDuration,
    formatExpiry: formatExpiry,
    timeAgo: timeAgo,
    formatTime: formatTime,
    formatCaptureTime: formatCaptureTime,
    escapeHtml: escapeHtml,
    deleteFailed: deleteFailed
  };
})();
