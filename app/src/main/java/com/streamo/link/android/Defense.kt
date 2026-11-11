/*
 * Streamo Link (Android) — درع الإعلانات، ترحيل حرفي من shared/defense/defense.js
 * NET + TABS + HEURISTIC + ALLOWLIST. نفس القواعد ونفس ملفات القوائم.
 */
package com.streamo.link.android

import android.content.Context
import android.util.Base64

object Defense {

    /* ================= قوائم مضيفة (نفس مصدر X5) ================= */

    private val CORE_HOSTS = listOf(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com",
        "adservice.google.com", "pagead2.googlesyndication.com", "ads.yahoo.com",
        "taboola.com", "outbrain.com", "criteo.com", "criteo.net", "pubmatic.com",
        "rubiconproject.com", "moatads.com", "adsrvr.org", "bidswitch.net",
        "casalemedia.com", "popads.net", "popcash.net", "adnxs.com",
        "amazon-adsystem.com", "audtd.com"
    )

    private val HOST_PATTERNS = listOf(
        Regex("^(?:[a-z0-9-]+\\.)*amd-cdn-\\d+\\.[a-z0-9]+\\.com$", RegexOption.IGNORE_CASE)
    )

    private val ALLOWLIST_HOSTS = listOf(
        // login / OAuth / SSO
        "accounts.google.com", "appleid.apple.com", "login.microsoftonline.com",
        "login.live.com", "github.com", "api.twitter.com", "auth0.com", "okta.com",
        // payments + bank 3DS
        "stripe.com", "paypal.com", "pay.google.com", "apple-pay-gateway.apple.com",
        // captcha / human verification
        "hcaptcha.com", "challenges.cloudflare.com", "arkoselabs.com", "cloudflare.com",
        // functional (embeds, maps, fonts, CDNs)
        "youtube.com", "youtu.be", "youtube-nocookie.com", "vimeo.com",
        "maps.google.com", "maps.googleapis.com",
        "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com",
        "cdn.jsdelivr.net", "unpkg.com", "cloudfront.net", "wikipedia.org", "wikimedia.org",
        // google نفسه (بيانات هوية وأصول — وليس نطاقات الإعلان المذكورة فوق)
        "google.com", "gstatic.com", "googleapis.com", "googleusercontent.com"
    )

    private val ALLOWLIST_PATHS = listOf(
        "/oauth", "/authorize", "/signin", "/sso", "/login",
        "/3ds", "/acs", "/challenge", "/checkout",
        "/recaptcha", "/captcha", "/turnstile", "/__ctn"
    )

    private val AD_PATH_PATTERNS = listOf(
        Regex("/ads?/", RegexOption.IGNORE_CASE),
        Regex("/adserver/", RegexOption.IGNORE_CASE),
        Regex("pagead", RegexOption.IGNORE_CASE),
        Regex("/banner/", RegexOption.IGNORE_CASE),
        Regex("prebid", RegexOption.IGNORE_CASE),
        Regex("/sponsor/", RegexOption.IGNORE_CASE),
        Regex("/popunder/", RegexOption.IGNORE_CASE),
        Regex("doubleclick", RegexOption.IGNORE_CASE)
    )
    private val VAST_PATTERNS = listOf(
        Regex("vast", RegexOption.IGNORE_CASE),
        Regex("vpaid", RegexOption.IGNORE_CASE),
        Regex("freewheel", RegexOption.IGNORE_CASE),
        Regex("springserve", RegexOption.IGNORE_CASE),
        Regex("vast_tracker", RegexOption.IGNORE_CASE),
        Regex("/ads/vast", RegexOption.IGNORE_CASE)
    )
    private val AD_BRAND_PATTERNS = listOf(
        Regex("1xbet", RegexOption.IGNORE_CASE),
        Regex("melbet", RegexOption.IGNORE_CASE),
        Regex("mostbet", RegexOption.IGNORE_CASE),
        Regex("betway", RegexOption.IGNORE_CASE),
        Regex("1win", RegexOption.IGNORE_CASE)
    )
    private val AFFILIATE_PARAMS = setOf(
        "tag", "pb", "aff", "affiliate", "aff_id", "clickid", "subid", "sub_id",
        "cid", "pid", "sid", "ref", "referral", "partner", "promo", "bonus"
    )

    /* ================= تحميل القوائم ================= */

    private var HOSTS = HashSet<String>(CORE_HOSTS)
    // بحث اللواحق من اليمين لليسار O(عدد-الأجزاء) — نفس أسلوب defense.js
    private var loaded = false

    fun loadLists(ctx: Context) {
        if (loaded) return
        val merged = HashSet<String>(HOSTS)
        for (name in listOf("hagezi.txt", "custom.txt")) {
            try {
                ctx.assets.open("shared/defense/$name").bufferedReader().useLines { lines ->
                    for (raw in lines) {
                        val entry = raw.substringBefore('#').trim().lowercase()
                        if (entry.isNotEmpty() && ' ' !in entry && '.' in entry) merged.add(entry)
                    }
                }
            } catch (_: Exception) {
                // القائمة اختيارية — النواة تكفي لو فشل التحميل
            }
        }
        HOSTS = merged
        loaded = true
    }

    /* ================= أدوات ================= */

    fun isHttp(u: String): Boolean = u.startsWith("http://", true) || u.startsWith("https://", true)

    fun hostOf(url: String): String {
        return try {
            java.net.URI(url).host?.lowercase() ?: ""
        } catch (_: Exception) {
            try {
                val after = url.substringAfter("://", "")
                after.substringBefore('/').substringBefore('?').substringBefore('#').lowercase()
                    .substringAfterLast('@').substringBefore(':')
            } catch (_: Exception) { "" }
        }
    }

    fun pathQueryOf(url: String): String {
        return try {
            val u = java.net.URI(url)
            (u.rawPath ?: "") + "?" + (u.rawQuery ?: "")
        } catch (_: Exception) { "" }
    }

    /* نطاقات المستوى الثاني الشائعة (co.uk / com.eg / com.sa ...) — حتى يُحسب etld+1 بشكل صحيح */
    private val SECOND_LEVEL_TLDS = setOf(
        "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk",
        "com.eg", "net.eg", "org.eg", "gov.eg", "edu.eg",
        "com.sa", "net.sa", "org.sa", "gov.sa", "edu.sa",
        "com.au", "net.au", "org.au", "com.tr", "net.tr",
        "com.br", "net.br", "org.br", "com.cn", "net.cn", "com.hk", "com.tw",
        "com.sg", "com.my", "com.ph", "com.mx", "com.ar", "com.co", "com.pe", "com.ve",
        "co.jp", "ne.jp", "or.jp", "com.pk", "com.bd", "com.ng", "co.nz", "com.vn",
        "com.ly", "com.tn", "com.dz", "com.ma", "co.za", "com.om", "com.bh", "com.kw",
        "com.qa", "com.lb", "com.jo", "com.sy", "com.iq", "co.il"
    )

    fun etld1(host: String): String {
        val p = host.split('.').filter { it.isNotEmpty() }
        if (p.size <= 2) return p.joinToString(".")
        val last2 = p.subList(p.size - 2, p.size).joinToString(".").lowercase()
        if (p.size >= 3 && SECOND_LEVEL_TLDS.contains(last2)) {
            return p.subList(p.size - 3, p.size).joinToString(".")
        }
        return last2
    }

    fun sameSite(url: String, pageUrl: String): Boolean {
        val h = hostOf(url); val p = hostOf(pageUrl)
        if (h.isEmpty() || p.isEmpty()) return false
        return etld1(h) == etld1(p)
    }

    private fun hasHostSuffix(host: String, entry: String): Boolean =
        host == entry || host.endsWith(".$entry")

    fun isAdHost(url: String): Boolean {
        val host = hostOf(url)
        if (host.isEmpty()) return false
        for (pattern in HOST_PATTERNS) if (pattern.matches(host)) return true
        // فحص اللواحق من اليمين لليسار
        val labels = host.split('.')
        var suffix = labels.last()
        for (i in labels.size - 2 downTo 0) {
            suffix = labels[i] + "." + suffix
            if (HOSTS.contains(suffix)) return true
        }
        return false
    }

    private fun looksLikeAdPath(url: String) = AD_PATH_PATTERNS.any { it.containsMatchIn(pathQueryOf(url)) }
    private fun looksLikeVast(url: String) = VAST_PATTERNS.any { it.containsMatchIn(pathQueryOf(url)) }
    private fun looksLikeAdBrand(url: String) = AD_BRAND_PATTERNS.any { it.containsMatchIn(pathQueryOf(url)) }

    fun looksLikeAffiliateRedirect(url: String, minParams: Int = 1): Boolean {
        val query = try { java.net.URI(url).rawQuery ?: "" } catch (_: Exception) { return false }
        if (query.isEmpty()) return false
        val keys = HashSet<String>()
        for (part in query.split('&')) {
            val k = part.substringBefore('=').lowercase()
            if (k.isNotEmpty()) keys.add(k)
        }
        var hits = 0
        for (k in keys) if (AFFILIATE_PARAMS.contains(k)) hits++
        return hits >= maxOf(1, minParams)
    }

    private fun isProtected(url: String): Boolean {
        val host = hostOf(url)
        if (host.isNotEmpty()) {
            for (entry in ALLOWLIST_HOSTS) if (hasHostSuffix(host, entry)) return true
        }
        val p = pathQueryOf(url).lowercase()
        return ALLOWLIST_PATHS.any { p.contains(it) }
    }

    /* ================= الحكم ================= */

    const val ALLOW = "allow"
    const val STUB = "stub"
    const val FAIL = "fail"

    fun decide(url: String, isMainFrame: Boolean, pageUrl: String): String {
        if (!isHttp(url)) return ALLOW
        if (isProtected(url)) return ALLOW

        val hostAd = isAdHost(url)
        val adPath = looksLikeAdPath(url)
        val adVast = looksLikeVast(url)
        val adBrand = looksLikeAdBrand(url)
        val affiliate = pageUrl.isNotEmpty() && looksLikeAffiliateRedirect(url, 1) && !sameSite(url, pageUrl)

        // same-site: يمر بلطف إلا لو إعلان صريح (listed + ad path)
        if (sameSite(url, pageUrl) && !(hostAd && adPath)) {
            if (hostAd || adPath) return STUB
            return ALLOW
        }

        if (isMainFrame) {
            if (hostAd || adPath || affiliate || adVast) return FAIL
            return ALLOW
        }
        if (hostAd || adVast || adBrand || adPath) return STUB
        return ALLOW
    }

    /* ================= الـ stub (رد 200 بجسم فاضي) ================= */

    private val GIF_1PX = Base64.decode("R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", Base64.DEFAULT)
    private val EMPTY_VAST = "<VAST version=\"3.0\"></VAST>".toByteArray(Charsets.UTF_8)
    private val EMPTY_HTML = "<html></html>".toByteArray(Charsets.UTF_8)

    data class Stub(val body: ByteArray, val mime: String)

    /** جسم و mime مناسبان لنوع المورد المحجوب — نفس stubFor في defense.js */
    fun stubFor(resourceType: String?, url: String): Stub {
        if (VAST_PATTERNS.any { it.containsMatchIn(pathQueryOf(url)) }) return Stub(EMPTY_VAST, "application/xml")
        val type = resourceType?.lowercase() ?: ""
        if (type.contains("image")) return Stub(GIF_1PX, "image/gif")
        if (type.contains("stylesheet") || type.contains("font")) return Stub(ByteArray(0), "text/css")
        if (type in listOf("manifest", "fetch", "xmlhttprequest", "ping")) return Stub("{}".toByteArray(), "application/json")
        if (type.contains("media")) return Stub(ByteArray(0), "video/mp4")
        if (type.contains("document") || type.contains("subframe") || type.contains("iframe") || type.contains("main_frame"))
            return Stub(EMPTY_HTML, "text/html")
        val lowered = url.lowercase()
        if (lowered.contains("googletag") || lowered.contains("adsbygoogle") || lowered.contains("prebid"))
            return Stub(ByteArray(0), "application/javascript")
        return Stub(ByteArray(0), "text/plain")
    }

    /** صفحة "تم منع الإعلان" للإطار الرئيسي */
    val BLOCKED_PAGE_HTML = """<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تم منع الإعلان</title></head>
<body style="margin:0;background:#000000;color:#FFFFFF;font-family:Arial,Tahoma,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px">
<h2 style="margin:0 0 8px;font-size:21px">تم منع إعلان / تحويلة</h2>
<p style="color:#C9CDD3;font-size:13px;margin:0 0 26px;max-width:420px;line-height:1.9">هذه الصفحة وصلتك كإعلان أو تحويلة دعائية، وتم حظرها تلقائيًا بواسطة درع Streamo.</p>
<button onclick="history.length>1?history.back():(location.href='https://google.com/')" style="background:#FFFFFF;color:#000000;border:none;padding:13px 40px;border-radius:999px;font-size:15px;font-weight:bold;cursor:pointer">رجوع</button>
</body></html>"""

    /* حارس التنقل الذكي (Domain Lock) في NavigationGuard — كما هو في نسخة Electron. */
}
