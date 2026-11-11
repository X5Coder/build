/*
 * Streamo Link — تصيير لوحتي "الروابط المسحوبة" (Streamo).
 * مُستخدم داخل chrome.html — يتعرض للكونسول عبر StreamoPanelUI.
 */
'use strict';

var StreamoPanelUI = (function () {

  var SVG = {
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    open: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    clock: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    renew: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    google: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12h7"/><path d="M12 8.5v7"/></svg>',
    search: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#C9CDD3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    link: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#C9CDD3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>'
  };

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function typeLabel(t) {
    if (!t) return 'Link';
    var map = { mp4: 'MP4', webm: 'WebM', mkv: 'MKV', mov: 'MOV', flv: 'FLV', mp3: 'MP3', hls: 'HLS', dash: 'DASH', audio: 'Audio', unknown: 'Link' };
    return map[t] || String(t).toUpperCase();
  }

  function statusChip(item) {
    if (item.status === 'testing') {
      return '<span class="chip chip-testing"><span class="dot"></span>Testing…</span>';
    }
    if (item.status === 'ok') {
      return '<span class="chip chip-ok">✓ Working</span>';
    }
    return '<span class="chip chip-fail">✗ Failed</span>';
  }

  function captureTime(item) {
    var t = StreamoStore.formatCaptureTime ? StreamoStore.formatCaptureTime(item.ts) : '';
    return t ? '<span class="card-time">' + SVG.clock + ' ' + StreamoStore.escapeHtml(t) + '</span>' : '';
  }

  function metaLine(item) {
    var bits = [];
    bits.push('<b>' + typeLabel(item.type) + '</b>');
    var size = StreamoStore.formatBytes(item.size);
    if (size) bits.push(size);
    if (item.httpStatus) bits.push('HTTP ' + item.httpStatus);
    var dur = StreamoStore.formatDuration(item.duration);
    if (dur) bits.push(dur);
    return bits.join(' · ');
  }

  function linkCard(item, actions) {
    var expiry = StreamoStore.parseExpiry(item.url);
    var hasRenew = typeof actions.onRenew === 'function';
    var hasPlay = typeof actions.onPlay === 'function';
    var onOpen = actions.onOpenGoogle || actions.onOpen;
    var buttons = [];
    if (item.status === 'ok') {
      // الرابط الشغال يعرض كل الأزرار
      if (onOpen) buttons.push('<button class="action-btn" data-act="google">' + SVG.open + 'Open</button>');
      if (hasPlay) buttons.push('<button class="action-btn" data-act="play">' + SVG.play + 'Player</button>');
      if (actions.onCopy) buttons.push('<button class="action-btn" data-act="copy">' + SVG.copy + 'Copy</button>');
      if (hasRenew) buttons.push('<button class="action-btn" data-act="renew">' + SVG.renew + 'Renew</button>');
    } else if (hasRenew) {
      // الرابط الفاشل أو لسه بيتفحص: بدون أزرار نسخ أو فتح — يجدد بس
      buttons.push('<button class="action-btn" data-act="renew">' + SVG.renew + 'Renew</button>');
    }

    var card = el(
      '<div class="card" data-id="' + StreamoStore.escapeHtml(item.id) + '">' +
        '<div class="card-top">' + statusChip(item) +
          '<span class="meta">' + metaLine(item) + '</span>' +
        '</div>' +
        '<div class="card-url" dir="ltr" title="' + StreamoStore.escapeHtml(item.finalUrl || item.url) + '">' + StreamoStore.escapeHtml(item.finalUrl || item.url) + '</div>' +
        '<div class="card-time-row">' + captureTime(item) +
          (expiry ? '<div class="expiry' + (expiry.expired ? ' expired' : '') + '" data-expires-at="' + expiry.expiresAt + '">' + SVG.clock + '<span class="expiry-text">' + StreamoStore.formatExpiry(expiry.remainingSeconds) + '</span></div>' : '') +
        '</div>' +
        (buttons.length ? '<div class="card-actions">' + buttons.join('') + '</div>' : '') +
      '</div>'
    );

    var googleBtn = card.querySelector('[data-act="google"]');
    if (googleBtn) googleBtn.addEventListener('click', function () {
      onOpen(item.finalUrl || item.url, item.type);
    });
    var playBtn = card.querySelector('[data-act="play"]');
    if (playBtn) playBtn.addEventListener('click', function () {
      actions.onPlay(item.finalUrl || item.url, item);
    });
    var copyBtn = card.querySelector('[data-act="copy"]');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      actions.onCopy(item.finalUrl || item.url);
    });
    var renewBtn = card.querySelector('[data-act="renew"]');
    if (renewBtn) renewBtn.addEventListener('click', function () {
      actions.onRenew(item.pageUrl || '', item);
    });
    return card;
  }

  /** يظهر الاستعلام بشكل محدود: الروابط تُقص لمضيف+مسار قصير، والنصوص الطويلة تُقص بـ … */
  function shortQuery(q) {
    q = String(q || '');
    if (/^https?:\/\//i.test(q)) {
      try {
        var u = new URL(q);
        var host = (u.hostname || '').replace(/^www\./i, '');
        var pathName = (u.pathname || '/').replace(/\/$/, '');
        var s = host + (pathName === '/' ? '' : pathName);
        return s.length > 64 ? s.slice(0, 64) + '…' : s;
      } catch (e) { /* نضيف … تحت */ }
    }
    return q.length > 90 ? q.slice(0, 90) + '…' : q;
  }

  /* كارد السجل (بلا أزرار): ضغطة → افتح، السحب يمين/يسار → احذف بكشحة */
  function searchCard(item, actions) {
    var card = el(
      '<div class="card search-card" role="button" tabindex="0" data-id="' + StreamoStore.escapeHtml(item.id) + '" title="' + StreamoStore.escapeHtml(item.url || item.q) + '">' +
        '<div class="search-query" dir="auto" title="' + StreamoStore.escapeHtml(item.q) + '">' + StreamoStore.escapeHtml(shortQuery(item.q)) + '</div>' +
        '<div class="search-meta">' +
          (item.engine ? '<span class="engine-tag">' + StreamoStore.escapeHtml(item.engine) + '</span>' : '') +
          '<span>' + StreamoStore.escapeHtml(StreamoStore.timeAgo(item.ts)) + ' · ' + StreamoStore.escapeHtml(StreamoStore.formatTime(item.ts)) + '</span>' +
        '</div>' +
        '<div class="card-swipe-trash" aria-hidden="true">' + SVG.trash + '</div>' +
      '</div>'
    );

    attachSearchCardGestures(card, item, actions);
    return card;
  }

  /** نفس نمط سحب الإشعارات: سحب → حذف، ضغطة → فتح */
  function attachSearchCardGestures(card, item, actions) {
    var startX = null, dx = 0, dragging = false, raf = 0, suppressUntil = 0;
    var THRESHOLD = 64, FLING_AT = 96;

    card.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX; dx = 0; dragging = true;
      try { card.setPointerCapture(e.pointerId); } catch (err) {}
      card.classList.add('dragging');
    });
    card.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dx = e.clientX - startX;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        card.style.transform = 'translateX(' + dx + 'px)';
        card.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / 260));
      });
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      card.classList.remove('dragging');
      var off = dx; dx = 0;
      if (Math.abs(off) > FLING_AT) {
        suppressUntil = Date.now() + 400;
        card.style.setProperty('--fling', (off >= 0 ? '' : '-') + '120%');
        card.classList.add('fling-out');
        window.setTimeout(function () {
          StreamoStore.removeSearch(item.id);
          card.parentNode && card.parentNode.removeChild(card);
          actions.onRefresh && actions.onRefresh();
        }, 310);
      } else {
        if (Math.abs(off) > 8) suppressUntil = Date.now() + 300;
        card.classList.add('settling');
        card.style.transform = '';
        card.style.opacity = '';
        window.setTimeout(function () { card.classList.remove('settling'); }, 330);
      }
      startX = null;
    }
    card.addEventListener('pointerup', endDrag);
    card.addEventListener('pointercancel', endDrag);

    function open() {
      actions.onOpen(item.url || ('https://www.google.com/search?q=' + encodeURIComponent(item.q)), 'search');
    }
    card.addEventListener('click', function (e) {
      if (Date.now() < suppressUntil) { e.stopPropagation(); e.preventDefault(); return; }
      open();
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  function emptyState(icon, title, desc) {
    return el('<div class="empty">' + icon + '<div class="empty-title">' + title + '</div><div class="empty-desc">' + desc + '</div></div>');
  }

  function renderList(container, items, cardFn, actions) {
    container.innerHTML = '';
    if (!items.length) return 0;
    var frag = document.createDocumentFragment();
    var ix = 0;
    items.forEach(function (item) {
      var card = cardFn(item, actions);
      card.style.animationDelay = Math.min(ix, 13) * 0.04 + 's';
      ix++;
      frag.appendChild(card);
    });
    container.appendChild(frag);
    return items.length;
  }

  /** مؤقت تحديث العدادات والإخفاء داخل البطاقات كل ثانية. */
  function ensureTicker(container) {
    if (container._streamoTicker) return;
    container._streamoTicker = setInterval(function () {
      var nodes = container.querySelectorAll('.expiry[data-expires-at]');
      for (var i = 0; i < nodes.length; i++) {
        var at = parseInt(nodes[i].getAttribute('data-expires-at'), 10);
        var remaining = Math.floor((at - Date.now()) / 1000);
        nodes[i].classList.toggle('expired', remaining <= 0);
        var t = nodes[i].querySelector('.expiry-text');
        if (t) t.textContent = StreamoStore.formatExpiry(remaining);
      }
    }, 1000);
  }

  function mountLinks(container, actions) {
    ensureTicker(container);
    var links = StreamoStore.getLinks();
    container.innerHTML = '';
    if (!links.length) {
      container.appendChild(emptyState(SVG.link, 'No extracted links yet',
        'Videos you play get captured here automatically — with size, type and a live test result.'));
      return;
    }
    // بدون تجميع — كل رابط بقالب منفصل
    var frag = document.createDocumentFragment();
    var ix = 0;
    links.forEach(function (item) {
      var card = linkCard(item, actions);
      card.style.animationDelay = Math.min(ix, 13) * 0.04 + 's';
      ix++;
      frag.appendChild(card);
    });
    container.appendChild(frag);
  }

  function mountSearch(container, actions) {
    ensureTicker(container);
    renderList(container, StreamoStore.getSearch(), searchCard, actions);
    if (!container.children.length) {
      container.appendChild(emptyState(SVG.search, 'No searches yet',
        'Your searches and the sources behind captured links will appear here.'));
    }
  }

  /** Clear-all: first click asks, second click clears. */
  function armClearAll(button, kind, onDone) {
    if (button._armed) {
      if (kind === 'links') StreamoStore.clearLinks(); else StreamoStore.clearSearch();
      button._armed = false;
      button.classList.remove('armed');
      button.textContent = 'Cleared ✓';
      setTimeout(function () {
        button.textContent = 'Clear all';
        onDone && onDone();
      }, 1400);
      return;
    }
    button._armed = true;
    button.classList.add('armed');
    button.textContent = 'Confirm? Click again';
    setTimeout(function () {
      if (button._armed) {
        button._armed = false;
        button.classList.remove('armed');
        button.textContent = 'Clear all';
      }
    }, 3000);
  }

  /** توميض رابط داخل اللوحة (يُستدعى بعد الضغط على إشعار مصغّر) */
  function flashEntry(container, entryId) {
    if (!container || !entryId) return;
    var node = container.querySelector('[data-id="' + CSS.escape(entryId) + '"]');
    if (!node) return;
    try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { node.scrollIntoView(); }
    node.classList.remove('flash');
    void node.offsetWidth; // إعادة تشغيل الأنيميشن
    node.classList.add('flash');
    setTimeout(function () { node.classList.remove('flash'); }, 1900);
  }

  return {
    mountLinks: mountLinks,
    mountSearch: mountSearch,
    armClearAll: armClearAll,
    flashEntry: flashEntry
  };
})();
