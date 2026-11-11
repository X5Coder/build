/*
 * Capture — التقاط الوسائط (نفس MEDIA_RE/TS_RE/DEDUPE في main.js)
 * ملاحظة منصات: Android WebView لا يرى Content-Type/Content-Length للردود،
 * فالالتقاط بالـ URL pattern + حقن JS — ويغطي .mp4/.m3u8/.mpd وامتدادات الوسائط.
 * مقاطع .ts لا تُلتقط (تكافئ الشرط < 25MB في نسخة Electron).
 */
package com.streamo.link.android

object Capture {

    private val MEDIA_RE = Regex(
        """\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd)([?#].*)?$""",
        RegexOption.IGNORE_CASE
    )
    private val TS_RE = Regex("""\.ts([?#].*)?$""", RegexOption.IGNORE_CASE)

    private const val DEDUPE_MS = 10L * 60L * 1000L
    private const val MAX_ENTRIES = 300

    private val recent = java.util.LinkedHashMap<String, Long>()

    fun isMediaUrl(url: String): Boolean {
        if (isAudioOnlyUrl(url)) return false
        return MEDIA_RE.containsMatchIn(url) && !TS_RE.containsMatchIn(url)
    }

    private val AUDIO_EXT_RE = Regex("""\.(mp3|m4a|aac|wav|opus|flac)(\?|#|$|%25)""", RegexOption.IGNORE_CASE)
    private val AUDIO_URL_RE = Regex("""(^|[/_-])(audio|aac|m4a|mp4a)([/_.-]|\?|#|$|%25)""", RegexOption.IGNORE_CASE)

    /** Skip audio-only URLs — the user wants video only. Manifests stay valid. */
    fun isAudioOnlyUrl(url: String): Boolean {
        if (Regex("""\.(m3u8|mpd)(\?|#|$|%25)""", RegexOption.IGNORE_CASE).containsMatchIn(url)) return false
        return AUDIO_EXT_RE.containsMatchIn(url) || AUDIO_URL_RE.containsMatchIn(url)
    }

    @Synchronized
    fun shouldSend(url: String): Boolean {
        val now = System.currentTimeMillis()
        val last = recent[url]
        if (last != null && now - last < DEDUPE_MS) return false
        if (recent.size > MAX_ENTRIES) recent.clear()
        recent[url] = now
        return true
    }
}
