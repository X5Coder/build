/*
 * Streamo Link — كشف روابط البحث من محركات البحث المعروفة.
 * تُستخدم على الويندوز (chrome) وتقابلها نفس الخوارزمية في كود الأندرويد (BrowserActivity.java).
 */
'use strict';

var StreamoSearch = (function () {
  var ENGINES = [
    { hosts: ['google.'], path: '/search', param: 'q', name: 'Google' },
    { hosts: ['bing.com'], path: '/search', param: 'q', name: 'Bing' },
    { hosts: ['duckduckgo.com'], path: '/', param: 'q', name: 'DuckDuckGo' },
    { hosts: ['search.yahoo.com'], path: '/search', param: 'p', name: 'Yahoo' },
    { hosts: ['yandex.'], path: '/search', param: 'text', name: 'Yandex' },
    { hosts: ['search.brave.com'], path: '/search', param: 'q', name: 'Brave' },
    { hosts: ['search.marginalia.nu'], path: '/search', param: 'query', name: 'Marginalia' },
    { hosts: ['qwant.com'], path: '/', param: 'q', name: 'Qwant' },
    { hosts: ['youtube.com'], path: '/results', param: 'search_query', name: 'YouTube' }
  ];

  /**
   * يستخرج الاستعلام من رابط صفحة نتائج البحث.
   * @returns {{q:string, engine:string}|null}
   */
  function extract(url) {
    try {
      var u = new URL(url);
      var host = u.hostname.toLowerCase();
      var path = u.pathname.toLowerCase();
      for (var i = 0; i < ENGINES.length; i++) {
        var e = ENGINES[i];
        var hostMatch = false;
        for (var j = 0; j < e.hosts.length; j++) {
          var h = e.hosts[j];
          if (host.indexOf(h) !== -1 || host.lastIndexOf(h) === host.length - h.length) { hostMatch = true; break; }
        }
        if (!hostMatch) continue;
        if (path.indexOf(e.path) !== 0 && e.path !== '/') continue;
        var q = u.searchParams.get(e.param);
        if (e.path === '/' && path !== '/') continue; // مثل qwant.com/ بدقة
        if (q && q.trim()) return { q: q.trim(), engine: e.name };
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  return { extract: extract };
})();
