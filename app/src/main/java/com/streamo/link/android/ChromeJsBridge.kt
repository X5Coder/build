/*
 * ChromeJsBridge — يُعرَّض باسم "StreamoNative" في chrome WebView.
 * الجسر الخام تحته adapter.js بيغلفه بـ window.streamoBridge و window.__streamoTabs.
 * IMPORTANT: دوال @JavascriptInterface بتشتغل على خلفية bridge thread —
 * النداءات المزامنة للـ WebView بتتعمل عبر runOnUiThread + CountDownLatch.
 */
package com.streamo.link.android

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ChromeJsBridge(private val activity: MainActivity) {

    private val main = Handler(Looper.getMainLooper())

    /* ============ عام ============ */

    @JavascriptInterface
    fun openExternal(url: String?) {
        if (url.isNullOrBlank() || !Defense.isHttp(url)) return
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
        } catch (_: Exception) { }
    }

    @JavascriptInterface
    fun isAdNavQuiet(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return Defense.decide(url, true, "") == Defense.FAIL
    }

    @JavascriptInterface
    fun hasGesture(id: Int): Boolean = NavigationGuard.hasGesture(id)

    /* ============ إنشاء وإدارة التبويبات (متزامن لـ JS) ============ */

    @JavascriptInterface
    fun createTab(url: String?): Int {
        val target = if (!url.isNullOrBlank() && Defense.isHttp(url)) url else "https://www.google.com/"
        return runOnUiSync { activity.tabs.createTab(target) } ?: -1
    }

    @JavascriptInterface
    fun tabLoadUrl(id: Int, url: String?) {
        if (url.isNullOrBlank()) return
        main.post { activity.tabs.loadUrl(id, url) }
    }

    @JavascriptInterface
    fun tabSetVisible(id: Int, visible: Boolean) {
        main.post { activity.tabs.setVisible(id, visible) }
    }

    @JavascriptInterface
    fun tabDestroy(id: Int) {
        main.post { activity.tabs.destroy(id) }
    }

    @JavascriptInterface
    fun tabGoBack(id: Int) = main.post { activity.tabs.goBack(id) }
    @JavascriptInterface
    fun tabGoForward(id: Int) = main.post { activity.tabs.goForward(id) }
    @JavascriptInterface
    fun tabReload(id: Int) = main.post { activity.tabs.reload(id) }

    @JavascriptInterface
    fun tabCanGoBack(id: Int): Boolean = runOnUiSync { activity.tabs.canGoBack(id) } ?: false

    @JavascriptInterface
    fun tabCanGoForward(id: Int): Boolean = runOnUiSync { activity.tabs.canGoForward(id) } ?: false

    @JavascriptInterface
    fun tabExecJs(id: Int, code: String?) {
        if (code.isNullOrBlank() || code.length > 200_000) return
        main.post { activity.tabs.execJs(id, code) }
    }

    /* ============ HotZones + حالة الواجهة ============ */

    @JavascriptInterface
    fun setUiState(state: String?) {
        activity.setUiState(state ?: "none")
    }

    @JavascriptInterface
    fun setChromeHotzones(toolbarBottom: Float, notifL: Float, notifT: Float, notifR: Float, notifB: Float) {
        activity.setHotzones(toolbarBottom, notifL, notifT, notifR, notifB)
    }

    /* ============ اختبار الروابط (probe) ============ */

    @JavascriptInterface
    fun testLink(id: Int, url: String?, pageUrl: String?) {
        if (url.isNullOrBlank()) return
        Probe.test(id, url, pageUrl ?: "") { testId, json ->
            activity.chromeJs("window.__testCb && window.__testCb($testId, $json)")
        }
    }

    /* ============ هوتزون للطباعة مزامنة عبر runOnUiThread ============ */

    private fun <T> runOnUiSync(block: () -> T): T? {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return try { block() } catch (_: Exception) { null }
        }
        val latch = CountDownLatch(1)
        var out: T? = null
        main.post {
            try { out = block() } catch (_: Exception) { } finally { latch.countDown() }
        }
        try { latch.await(1500, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { }
        return out
    }
}
