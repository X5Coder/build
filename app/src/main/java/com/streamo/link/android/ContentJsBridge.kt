/*
 * ContentJsBridge — يُعرَّض باسم "__streamoHook" داخل كل WebView تبويب.
 * نفس سطح browser-preload.js: send/gesture/anchor/seen/navIntent.
 * الصفحات ما تقدر تعمل بيها غير تسجيل روابط وسائط — نفس نموذج contextIsolation في Electron.
 */
package com.streamo.link.android

import android.webkit.JavascriptInterface
import org.json.JSONObject

class ContentJsBridge(private val mgr: TabsManager, private val tab: Tab) {

    @JavascriptInterface
    fun send(url: String?, isMediaElement: Boolean) {
        if (url == null || !Defense.isHttp(url)) return
        if (Defense.decide(url, false, "") != Defense.ALLOW) return
        // وسوم الوسائط تُقبل كاملة؛ باقي JS فقط ما يطابق الامتداد (مقاطع .ts مستبعدة)
        if (isMediaElement || Capture.isMediaUrl(url)) {
            if (Capture.shouldSend(url)) {
                mgr.notifyLink(url, tab.id, "js", pageUrl = tab.currentUrl)
            }
        }
    }

    @JavascriptInterface
    fun gesture() {
        NavigationGuard.noteGesture(tab.id)
    }

    @JavascriptInterface
    fun anchor(href: String?) {
        if (href != null && Defense.isHttp(href)) NavigationGuard.noteAnchor(tab.id, href)
    }

    @JavascriptInterface
    fun seen(href: String?) {
        if (href != null && Defense.isHttp(href)) mgr.emitSeenPage(tab.id, href)
    }

    @JavascriptInterface
    fun navIntent(href: String?, prevented: Boolean) {
        if (href != null && Defense.isHttp(href)) mgr.emitNavIntent(tab.id, href, prevented)
    }

    @JavascriptInterface
    fun ping() { /* keepalive — لا شيء */ }
}
