/*
 * TabWebViewClient — مثيل WebViewClient لكل تبويب:
 *  1) الدرع NET في shouldInterceptRequest (stub/fail => 200 فاضي مناسب للنوع)
 *  2) التقاط الوسائط بالـ URL (dedupe)
 *  3) حارس التنقل (Domain Lock) في shouldOverrideUrlLoading
 *  4) تحديث tab.currentUrl + إشعار chrome.js بالتنقلات
 *
 * نوع المورد يُستنتج من URL (WebResourceRequest.getResourceType() غير متاح قبل API 33).
 */
package com.streamo.link.android

import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.ByteArrayInputStream

class TabWebViewClient(private val mgr: TabsManager, private val tab: Tab) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // الحكم متزامن: decideNavigation الأصلية لكن في Kotlin
        val kind = if (request.hasGesture() || NavigationGuard.hasGesture(tab.id)) "navigate" else "redirect"
        val verdict = NavigationGuard.decide(
            tabUrl = tab.currentUrl,
            hostIntentEtld = tab.hostIntentEtld,
            hostIntentTs = tab.hostIntentTs,
            tabId = tab.id,
            destUrl = request.url.toString(),
            kind = kind
        )
        return when (verdict) {
            NavigationGuard.ALLOW -> false
            NavigationGuard.STRIKE -> {
                mgr.onJs("window.__onBlockedStrike && window.__onBlockedStrike()")
                true
            }
            else -> {
                mgr.onJs("window.__onBlocked && window.__onBlocked()")
                true
            }
        }
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url.toString()
        val pageUrl = tab.currentUrl

        // (1) الدرع NET — الطلبات الفرعية فقط؛ الإطار الرئيسي محكوم من shouldOverrideUrlLoading
        if (!request.isForMainFrame) {
            val verdict = Defense.decide(url, false, pageUrl)
            if (verdict == Defense.STUB || verdict == Defense.FAIL) {
                val stub = Defense.stubFor(resourceTypeFromUrl(url), url)
                val headers = mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to "no-store",
                    "Content-Type" to stub.mime
                )
                return WebResourceResponse(stub.mime, "UTF-8", 200, "OK", headers, ByteArrayInputStream(stub.body))
            }
        }

        // (2) التقاط الوسائط — المرور من الدرع أولاً للحماية من إعلانات الفيديو
        if (Capture.isMediaUrl(url) && Capture.shouldSend(url)) {
            mgr.notifyLink(url, tab.id, "request", pageUrl = pageUrl)
        }
        return null
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        if (url != null) {
            tab.currentUrl = url
            tab.clearHostIntent()   // التنقل حصل — النية انتهت (نفس onNav في chrome.js)
            val p = JSONObject().put("url", url)
            mgr.emitTabEvent(tab.id, "did-navigate", p)
            mgr.emitSeenPage(tab.id, url)
        }
    }

    override fun onPageFinished(view: WebView, url: String?) {
        if (url != null) {
            tab.currentUrl = url
        }
        val p = JSONObject().put("url", url ?: tab.currentUrl)
        // dom-ready أولاً — chrome.js بيحقن HOOK تلقائي هنا
        mgr.emitTabEvent(tab.id, "dom-ready", p)
        mgr.emitTabEvent(tab.id, "did-finish-load", p)
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
        if (url != null && url != tab.currentUrl) {
            tab.currentUrl = url
            val p = JSONObject().put("url", url)
            mgr.emitTabEvent(tab.id, "did-navigate-in-page", p)
            mgr.emitSeenPage(tab.id, url)
        }
    }

    private fun resourceTypeFromUrl(url: String): String {
        val u = url.lowercase()
        return when {
            Regex("\\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)(\\?|#|$|%25)").containsMatchIn(u) -> "image"
            u.contains(".css") -> "stylesheet"
            Regex("\\.(woff2?|ttf|otf|eot)(\\?|#|$|%25)").containsMatchIn(u) -> "font"
            Regex("\\.(mp4|webm|mkv|mov|avi|mp3|m4a|wav|aac|opus|flac)(\\?|#|$|%25)").containsMatchIn(u) -> "media"
            u.contains(".m3u8") || u.contains(".mpd") -> "media"
            Regex("\\.(xml|json)(\\?|#|$|%25)").containsMatchIn(u) -> "manifest"
            u.contains("iframe") -> "subframe"
            else -> ""
        }
    }
}
