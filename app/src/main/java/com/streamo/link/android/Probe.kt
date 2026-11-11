/*
 * Probe — اختبار الرابط (وحدة مستقلة): طلب Range 4KB + magic bytes + اتباع التحويلات (≤5).
 * ترحيل حرفي لمنطق probe.js — يُنفَّذ على خلفية Executor، والنتيجة ترجع كـ JSON string.
 */
package com.streamo.link.android

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

object Probe {

    private const val TEST_TIMEOUT_MS = 8_000
    private const val MAX_REDIRECTS = 5
    private const val MAX_BODY = 8192

    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "streamo-probe").apply { isDaemon = true }
    }

    private const val UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

    fun test(id: Int, url: String, pageUrl: String, cb: (Int, String) -> Unit) {
        executor.execute {
            val t0 = System.currentTimeMillis()
            val out = JSONObject()
            out.put("url", url)
            out.put("status", "fail")
            out.put("type", typeFromUrl(url))
            out.put("duration", JSONObject.NULL)
            out.put("size", JSONObject.NULL)
            out.put("httpStatus", JSONObject.NULL)
            out.put("contentType", JSONObject.NULL)
            out.put("via", "http")
            out.put("finalUrl", JSONObject.NULL)
            out.put("error", JSONObject.NULL)

            var referer = ""
            if (Defense.isHttp(pageUrl)) {
                try {
                    val p = URL(pageUrl)
                    referer = "${p.protocol}://${p.host}${if (p.port > 0) ":${p.port}" else ""}/"
                } catch (_: Exception) { }
            }

            var hops = 0
            var current = url
            var done = false

            while (!done) {
                val u = try { URL(current) } catch (_: Exception) {
                    out.put("error", "BAD_URL"); break
                }
                if (u.protocol != "http" && u.protocol != "https") {
                    out.put("error", "UNSUPPORTED"); break
                }

                var conn: HttpURLConnection? = null
                try {
                    conn = u.openConnection() as HttpURLConnection
                    conn.instanceFollowRedirects = false
                    conn.requestMethod = "GET"
                    conn.connectTimeout = TEST_TIMEOUT_MS
                    conn.readTimeout = TEST_TIMEOUT_MS
                    conn.setRequestProperty("Range", "bytes=0-4095")
                    conn.setRequestProperty("User-Agent", UA)
                    conn.setRequestProperty("Accept", "*/*")
                    if (referer.isNotEmpty()) conn.setRequestProperty("Referer", referer)

                    val status = try { conn.responseCode } catch (_: Exception) {
                        out.put("error", "NETWORK"); done = true; -1
                    }
                    if (done) break

                    val location = conn.getHeaderField("Location")
                    if (status in listOf(301, 302, 303, 307, 308) && !location.isNullOrBlank()) {
                        try { conn.inputStream.use { it.readBytes() } } catch (_: Exception) { }
                        conn.disconnect()
                        if (hops >= MAX_REDIRECTS) {
                            out.put("httpStatus", status)
                            out.put("error", "TOO_MANY_REDIRECTS")
                            break
                        }
                        hops += 1
                        current = try { URL(u, location).toString() } catch (_: Exception) {
                            out.put("httpStatus", status); out.put("error", "BAD_REDIRECT"); break
                        }
                        continue
                    }

                    val ct = (conn.getHeaderField("Content-Type") ?: "").lowercase()
                    var size: Long? = null
                    val contentRange = conn.getHeaderField("Content-Range")
                    if (!contentRange.isNullOrBlank()) {
                        val m = Regex("""/(\d+)\s*$""").find(contentRange)
                        size = m?.groupValues?.get(1)?.toLongOrNull()
                    }
                    if (size == null && status != 206) {
                        val cl = conn.getHeaderField("Content-Length")
                        size = cl?.toLongOrNull()
                    }

                    // اقرأ أول بايتات ثم اطلب الإلغاء (نفس منطق 4KB + destroy المبكر)
                    val bytes = try {
                        val stream = if (status >= 400) conn.errorStream else conn.inputStream
                        readLimited(stream, MAX_BODY)
                    } catch (_: Exception) {
                        ByteArray(0)
                    } finally {
                        try { conn.disconnect() } catch (_: Exception) { }
                    }

                    val magic = sniffMagic(bytes)
                    val okRange = status in 200..299
                    val finalUrl = if (current != url) current else null
                    if (finalUrl != null) out.put("finalUrl", finalUrl)
                    out.put("httpStatus", status)
                    out.put("contentType", ct.ifEmpty { JSONObject.NULL })
                    if (size != null) out.put("size", size)

                    when {
                        !okRange -> out.put("error", "HTTP_$status")
                        magic != null -> {
                            out.put("status", "ok")
                            out.put("type", magic)
                            out.put("error", JSONObject.NULL)
                        }
                        isManifestType(ct, current) -> {
                            val dash = Regex("""\.mpd(\?|#|$|%25)""", RegexOption.IGNORE_CASE).containsMatchIn(current) || ct.contains("dash+xml")
                            out.put("status", "ok")
                            out.put("type", if (dash) "dash" else "hls")
                            out.put("error", JSONObject.NULL)
                        }
                        isMediaMime(ct) -> {
                            out.put("status", "ok")
                            var t = typeFromUrl(current)
                            if (t == "unknown") t = if (ct.startsWith("audio/")) "audio" else "mp4"
                            out.put("type", t)
                            out.put("error", JSONObject.NULL)
                        }
                        isMediaExt(current) &&
                            Regex("""^(video/|audio/|application/octet-stream|binary/octet-stream|application/binary)""", RegexOption.IGNORE_CASE).containsMatchIn(ct.ifEmpty { "application/octet-stream" }) -> {
                            out.put("status", "ok")
                            out.put("type", typeFromUrl(current))
                            out.put("error", JSONObject.NULL)
                        }
                        else -> out.put("error", "NOT_MEDIA")
                    }
                    done = true
                } catch (_: Exception) {
                    try { conn?.disconnect() } catch (_: Exception) { }
                    out.put("error", "NETWORK")
                    done = true
                }
            }

            out.put("testedInMs", System.currentTimeMillis() - t0)
            cb(id, out.toString())
        }
    }

    private fun readLimited(stream: java.io.InputStream?, max: Int): ByteArray {
        if (stream == null) return ByteArray(0)
        val buf = ByteArray(max)
        var off = 0
        stream.use { s ->
            while (off < max) {
                val n = s.read(buf, off, max - off)
                if (n <= 0) break
                off += n
            }
        }
        return buf.copyOf(off)
    }

    private fun typeFromUrl(url: String): String {
        val m = Regex(
            """\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd|ts)(\?|#|$|%25)""",
            RegexOption.IGNORE_CASE
        ).find(url) ?: return "unknown"
        val ext = m.groupValues[1].lowercase()
        return when (ext) {
            "m3u8" -> "hls"
            "mpd" -> "dash"
            "mp3", "m4a", "wav", "aac", "opus", "flac" -> "audio"
            else -> ext
        }
    }

    private fun isMediaExt(url: String): Boolean = Regex(
        """\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd|ts)(\?|#|$|%25)""",
        RegexOption.IGNORE_CASE
    ).containsMatchIn(url)

    private fun isManifestType(ct: String, url: String): Boolean =
        ct.contains("mpegurl") || ct.contains("dash+xml") ||
            Regex("""\.m3u8(\?|#|$|%25)|\.mpd(\?|#|$|%25)""", RegexOption.IGNORE_CASE).containsMatchIn(url)

    private fun isMediaMime(ct: String): Boolean =
        ct.startsWith("video/") || ct.startsWith("audio/") ||
            ct.contains("mpegurl") || ct.contains("dash+xml") ||
            ct == "application/octet-stream" || ct == "binary/octet-stream" || ct == "application/binary"

    /** بصمة الملف (magic bytes) — تفصح بالنوع الحقيقي مهما كان الامتداد */
    private fun sniffMagic(bytes: ByteArray): String? {
        if (bytes.size < 12) return null
        val head = String(bytes, 0, minOf(bytes.size, 16), Charsets.ISO_8859_1)
        if (head.contains("ftyp") || (bytes.size >= 8 && String(bytes, 4, 4, Charsets.ISO_8859_1) == "ftyp")) return "mp4"
        if (bytes.size >= 4 && bytes[0] == 0x1A.toByte() && bytes[1] == 0x45.toByte() &&
            bytes[2] == 0xDF.toByte() && bytes[3] == 0xA3.toByte()
        ) return "webm"
        if (head.contains("OggS")) return "ogg"
        if (head.startsWith("FLV")) return "flv"
        if (head.contains("#EXTM3U")) return "hls"
        if (head.lowercase().contains("<mpd")) return "dash"
        if (head.startsWith("ID3")) return "audio"
        if (bytes[0] == 0xFF.toByte() && (bytes[1].toInt() and 0xE0) == 0xE0) return "audio"
        if (head.startsWith("RIFF") && head.contains("WAVE")) return "wav"
        if (head.startsWith("fLaC")) return "audio"
        return null
    }
}
