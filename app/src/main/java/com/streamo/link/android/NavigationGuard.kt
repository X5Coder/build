/*
 * NavigationGuard — Smart Domain Lock، ترحيل حرفي لـ decideNavigation من chrome.js
 * نفس الثوابت ونفس الترتيب: same-site → Google → ads (strike/block) → hostIntent → anchor.
 */
package com.streamo.link.android

object NavigationGuard {

    const val ALLOW = "allow"
    const val STRIKE = "strike"
    const val BLOCK = "block"

    private const val STRIKE_MS = 15_000L
    private const val INTENT_MS = 8_000L
    private const val ANCHOR_INTENT_MS = 5_000L
    private const val GESTURE_MS = 2_000L
    private const val MAX_ENTRIES = 300

    private val strikes = HashMap<String, Long>()        // etld -> ts
    private val anchorClicks = HashMap<Int, Pair<String, Long>>() // nativeTabId -> (etld, ts)
    private val gestures = HashMap<Int, Long>()          // nativeTabId -> ts

    private fun now() = System.currentTimeMillis()

    private fun prune(map: HashMap<Int, Long>) {
        if (map.size <= MAX_ENTRIES) return
        val cutoff = now() - GESTURE_MS
        map.entries.removeAll { it.value < cutoff }
    }

    fun noteGesture(tabId: Int) {
        gestures[tabId] = now()
        prune(gestures)
    }

    fun hasGesture(tabId: Int): Boolean {
        val ts = gestures[tabId] ?: return false
        return now() - ts < GESTURE_MS
    }

    fun noteAnchor(tabId: Int, href: String) {
        val d = Defense.etld1(Defense.hostOf(href))
        if (d.isEmpty()) return
        anchorClicks[tabId] = d to now()
        if (anchorClicks.size > MAX_ENTRIES) {
            val cutoff = now() - ANCHOR_INTENT_MS
            anchorClicks.entries.removeAll { it.value.second < cutoff }
        }
    }

    fun clearAnchor(tabId: Int) = anchorClicks.remove(tabId)
    fun clearTab(tabId: Int) { gestures.remove(tabId); anchorClicks.remove(tabId) }

    private fun anchorIntent(tabId: Int): Pair<String, Long>? {
        val rec = anchorClicks[tabId] ?: return null
        if (now() - rec.second > ANCHOR_INTENT_MS) { anchorClicks.remove(tabId); return null }
        return rec
    }

    /** google-style hosts: JS .test semantics — containsMatchIn مش matches */
    private fun isGoogleHost(host: String): Boolean =
        Regex("(^|\\.)google\\.[a-z.]{2,7}$", RegexOption.IGNORE_CASE).containsMatchIn(host)

    /**
     * @param tabUrl الرابط الحالي للتبويب
     * @param hostIntentEtld etld+1 لنية آخر تنقل بدأها المضيف (null لو لا يوجد)
     * @param hostIntentTs   وقت بداية نية المضيف
     */
    fun decide(
        tabUrl: String,
        hostIntentEtld: String?,
        hostIntentTs: Long,
        tabId: Int,
        destUrl: String,
        kind: String
    ): String {
        if (!Defense.isHttp(destUrl)) return ALLOW
        val dHost = Defense.hostOf(destUrl)
        val d = Defense.etld1(dHost)
        val c = Defense.etld1(Defense.hostOf(tabUrl))
        if (d.isEmpty()) return ALLOW
        if (c.isNotEmpty() && d == c) return ALLOW                         // same site
        if (isGoogleHost(Defense.hostOf(tabUrl)) && isGoogleHost(dHost)) return ALLOW  // google -> google

        if (isAdDestination(destUrl)) {
            val t = now()
            val last = strikes[d]
            val gesture = hasGesture(tabId)
            if (last != null && t - last < STRIKE_MS && gesture) {
                strikes.remove(d)
                return ALLOW
            }
            if (gesture) {
                strikes[d] = t
                return STRIKE
            }
            return BLOCK                                                    // no user gesture -> silently blocked
        }

        // نية تنقل من المضيف (رابط مكتوب / بحث / renew) — نافذة زمنية قصيرة
        if (hostIntentEtld != null && hostIntentTs > 0 && now() - hostIntentTs < INTENT_MS) {
            return ALLOW
        }

        // ضغطة حقيقية على anchor — اسمح بنفس الدومين (أو سلسلة تحويلاته)
        val a = anchorIntent(tabId)
        if (a != null) {
            if (a.first == d) return ALLOW
            if (kind == "redirect") return ALLOW   // 3xx chain of that same click (bit.ly type)
        }
        return BLOCK
    }

    /** حكم "هو ده دومين إعلان main-frame؟" — نفس streamo:should-block-nav */
    fun isAdDestination(url: String): Boolean =
        Defense.decide(url, true, "") == Defense.FAIL
}
