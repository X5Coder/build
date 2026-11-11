/*
 * Streamo Link — درع الإعلانات (منقول من X5 Agent / browser_control/defense).
 * نفس القواعد ونفس الهيكل: NET + TABS + HEURISTIC + ALLOWLIST.
 * يعمل في نواة Electron (node) — الأندرويد له نسخة جافا مطابقة (Defense.java)
 * ونفس ملفات القوائم.
 *
 * المبادئ (قاعدة X5: استقبل الإعلان ثم احبسه على مستوى الشبكة):
 *   1. الإعلان يُطلب عادي، ثم الرد يصل بـ 200 + جسم فاضي مناسب للنوع (stub)
 *   2. الإعلان main-frame (تحويلة/صفحة إعلان كاملة) => صفحة منع نظيفة
 *   3. الروابط المعتمدة (login/OAuth/payment/captcha + Google نفسه) لا تُحبس أبدًا
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ================= قوائم مضيفة (نفس مصدر X5) ================= */

const CORE_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adservice.google.com', 'pagead2.googlesyndication.com', 'ads.yahoo.com',
  'taboola.com', 'outbrain.com', 'criteo.com', 'criteo.net', 'pubmatic.com',
  'rubiconproject.com', 'moatads.com', 'adsrvr.org', 'bidswitch.net',
  'casalemedia.com', 'popads.net', 'popcash.net', 'adnxs.com',
  'amazon-adsystem.com', 'audtd.com'
];

const HOST_PATTERNS = [
  /^(?:[a-z0-9-]+\.)*amd-cdn-\d+\.[a-z0-9]+\.com$/i
];

const ALLOWLIST_HOSTS = [
  // login / OAuth / SSO
  'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com',
  'login.live.com', 'github.com', 'api.twitter.com', 'auth0.com', 'okta.com',
  // payments + bank 3DS
  'stripe.com', 'paypal.com', 'pay.google.com', 'apple-pay-gateway.apple.com',
  // captcha / human verification
  'hcaptcha.com', 'challenges.cloudflare.com', 'arkoselabs.com', 'cloudflare.com',
  // functional (embeds, maps, fonts, CDNs)
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'vimeo.com',
  'maps.google.com', 'maps.googleapis.com',
  'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net', 'unpkg.com', 'cloudfront.net', 'wikipedia.org', 'wikimedia.org',
  // google نفسه (بيانات هوية وأصول — وليس نطاقات الإعلان المذكورة فوق)
  'google.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com'
];

const ALLOWLIST_PATHS = [
  '/oauth', '/authorize', '/signin', '/sso', '/login',
  '/3ds', '/acs', '/challenge', '/checkout',
  '/recaptcha', '/captcha', '/turnstile', '/__ctn'
];

const AD_PATH_PATTERNS = [/\/ads?\//i, /\/adserver\//i, /pagead/i, /\/banner\//i, /prebid/i, /\/sponsor\//i, /\/popunder\//i, /doubleclick/i];
const VAST_PATTERNS = [/vast/i, /vpaid/i, /freewheel/i, /springserve/i, /vast_tracker/i, /\/ads\/vast/i];
const AD_BRAND_PATTERNS = [/1xbet/i, /melbet/i, /mostbet/i, /betway/i, /1win/i];
const AFFILIATE_PARAMS = new Set([
  'tag', 'pb', 'aff', 'affiliate', 'aff_id', 'clickid', 'subid', 'sub_id',
  'cid', 'pid', 'sid', 'ref', 'referral', 'partner', 'promo', 'bonus'
]);
const TRACKING_PARAMS = new Set(['gclid', 'fbclid', 'msclkid', 'dclid', 'wbraid', 'gbraid']);

/* ================= تحميل القوائم ================= */

let HOSTS = new Set(CORE_HOSTS);
let HOSTS_SUFFIX = new Set(CORE_HOSTS); // بحث سريع: hasHostSuffix عبر (labels) بدل لوب على آلاف القوائم
let loaded = false;

function rebuildSuffixIndex() {
  HOSTS_SUFFIX = new Set(HOSTS);
}

function loadLists(defenseDir) {
  if (loaded) return;
  const dir = defenseDir || path.join(__dirname);
  for (const name of ['hagezi.txt', 'custom.txt']) {
    try {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      for (const line of text.split('\n')) {
        const entry = line.split('#', 1)[0].trim().toLowerCase();
        if (entry && !entry.includes(' ') && entry.includes('.')) HOSTS.add(entry);
      }
    } catch (e) {
      // القائمة اختيارية — النواة (CORE_HOSTS) تكفي لو فشل التحميل
    }
  }
  rebuildSuffixIndex();
  loaded = true;
}

/* ================= أدوات ================= */

function hostOf(url) {
  try { return (new URL(url).hostname || '').toLowerCase(); } catch { return ''; }
}
function pathQueryOf(url) {
  try { const u = new URL(url); return (u.pathname || '') + '?' + (u.search || ''); } catch { return ''; }
}
function fullUrlLower(url) { return String(url || '').toLowerCase(); }

function etld1(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

function sameSite(url, pageUrl) {
  const h = hostOf(url), p = hostOf(pageUrl);
  if (!h || !p) return false;
  return etld1(h) === etld1(p);
}

function hasHostSuffix(host, entry) {
  return host === entry || host.endsWith('.' + entry);
}

function isAdHost(url) {
  const host = hostOf(url);
  if (!host) return false;
  for (const pattern of HOST_PATTERNS) if (pattern.test(host)) return true;
  if (!loaded) rebuildSuffixIndex();
  // فحص اللواحق من اليمين لليسار بأسلوب O(عدد-الأجزاء) بدل لوب على القائمة كلها
  const labels = host.split('.');
  let suffix = labels[labels.length - 1];
  for (let i = labels.length - 2; i >= 0; i--) {
    suffix = labels[i] + '.' + suffix;
    if (HOSTS_SUFFIX.has(suffix)) return true;
  }
  return false;
}

function looksLikeAdPath(url) {
  const h = pathQueryOf(url);
  return AD_PATH_PATTERNS.some((re) => re.test(h));
}
function looksLikeVast(url) {
  const h = pathQueryOf(url);
  return VAST_PATTERNS.some((re) => re.test(h));
}
function looksLikeAdBrand(url) {
  const h = pathQueryOf(url);
  return AD_BRAND_PATTERNS.some((re) => re.test(h));
}
function looksLikeAffiliateRedirect(url, minParams) {
  minParams = minParams == null ? 1 : minParams;
  let query = '';
  try { query = new URL(url).search; } catch { return false; }
  if (!query) return false;
  const keys = new Set();
  for (const part of query.slice(1).split('&')) {
    const k = part.split('=')[0].toLowerCase();
    if (k) keys.add(k);
  }
  let hits = 0;
  for (const k of keys) if (AFFILIATE_PARAMS.has(k)) hits++;
  return hits >= Math.max(1, minParams);
}

function isProtected(url) {
  const host = hostOf(url);
  if (host) {
    for (const entry of ALLOWLIST_HOSTS) if (hasHostSuffix(host, entry)) return true;
  }
  const p = pathQueryOf(url).toLowerCase();
  return ALLOWLIST_PATHS.some((fragment) => p.includes(fragment));
}

function isAdUrl(url, pageUrl) {
  if (isAdHost(url)) return true;
  if (looksLikeAdPath(url) || looksLikeVast(url) || looksLikeAdBrand(url)) return true;
  if (pageUrl && looksLikeAffiliateRedirect(url, 1) && !sameSite(url, pageUrl)) return true;
  if (!pageUrl && looksLikeAffiliateRedirect(url, 2)) return true;
  return false;
}

/* ================= الحكم ================= */

/**
 * الحكم النهائي على الطلب.
 * @returns {'allow'|'stub'|'fail'}
 */
function decide(url, opts) {
  opts = opts || {};
  const isMainFrame = !!opts.isMainFrame;
  const pageUrl = opts.pageUrl || '';

  if (!/^https?:\/\//i.test(String(url || ''))) return 'allow';
  if (isProtected(url)) return 'allow';

  const hostAd = isAdHost(url);
  const adPath = looksLikeAdPath(url);
  const adVast = looksLikeVast(url);
  const adBrand = looksLikeAdBrand(url);
  const affiliate = looksLikeAffiliateRedirect(url, 1) && pageUrl && !sameSite(url, pageUrl);

  // same-site: يمر بلطف إلا لو إعلان صريح (listed + ad path)
  if (sameSite(url, pageUrl) && !(hostAd && adPath)) {
    if (hostAd || adPath) return 'stub';
    return 'allow';
  }

  if (isMainFrame) {
    if (hostAd || adPath || affiliate || adVast) return 'fail';
    return 'allow';
  }
  if (hostAd || adVast || adBrand || adPath) return 'stub';
  return 'allow';
}

/* ================= الـ stub (رد 200 بجسم فاضي) ================= */

const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');
const EMPTY_VAST = Buffer.from('<VAST version="3.0"></VAST>', 'utf8');
const EMPTY_HTML = Buffer.from('<html></html>', 'utf8');

/** جسم و mime مناسبان لنوع المورد المحجوب */
function stubFor(resourceType, url) {
  if (looksLikeVast(url)) return { body: EMPTY_VAST, mime: 'application/xml' };
  const type = String(resourceType || '').toLowerCase();
  if (type === 'image' || type === 'imageset') return { body: GIF_1PX, mime: 'image/gif' };
  if (type === 'stylesheet' || type === 'font') return { body: Buffer.from(''), mime: 'text/css' };
  if (type === 'manifest' || type === 'fetch' || type === 'xhr' || type === 'xmlhttprequest' || type === 'ping') return { body: Buffer.from('{}'), mime: 'application/json' };
  if (type === 'media') return { body: Buffer.from(''), mime: 'video/mp4' };
  if (type === 'document' || type === 'subframe' || type === 'iframe') return { body: EMPTY_HTML, mime: 'text/html' };
  const lowered = fullUrlLower(url);
  if (lowered.includes('googletag') || lowered.includes('adsbygoogle') || lowered.includes('prebid')) {
    return { body: Buffer.from(''), mime: 'application/javascript' };
  }
  return { body: Buffer.from(''), mime: 'text/plain' };
}

/** صفحة "تم منع الإعلان" للإطار الرئيسي (هوية Streamo) */
const BLOCKED_PAGE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تم منع الإعلان</title></head>
<body style="margin:0;background:#000000;color:#FFFFFF;font-family:Arial,Tahoma,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px">
<div style="font-size:44px;margin-bottom:14px">🚫</div>
<h2 style="margin:0 0 8px;font-size:21px">تم منع إعلان / تحويلة</h2>
<p style="color:#C9CDD3;font-size:13px;margin:0 0 26px;max-width:420px;line-height:1.9">هذه الصفحة وصلتك كإعلان أو تحويلة دعائية، وتم حظرها تلقائيًا بواسطة درع Streamo.</p>
<button onclick="history.length>1?history.back():(location.href='https://google.com/')" style="background:#FFFFFF;color:#000000;border:none;padding:13px 40px;border-radius:999px;font-size:15px;font-weight:bold;cursor:pointer">رجوع</button>
</body></html>`;

/* ================= العدادات ================= */

const stats = { blockedTotal: 0, blockedThisSession: 0 };

function noteBlock() {
  stats.blockedTotal++;
  stats.blockedThisSession++;
}
function report() {
  return { total: stats.blockedTotal, session: stats.blockedThisSession };
}

module.exports = {
  loadLists,
  isAdHost,
  isAdUrl,
  isProtected,
  sameSite,
  looksLikeAffiliateRedirect,
  looksLikeAdBrand,
  looksLikeAdPath,
  looksLikeVast,
  decide,
  stubFor,
  BLOCKED_PAGE_HTML,
  noteBlock,
  report,
  // للاختبارات
  _hostsCount: () => HOSTS.size
};
