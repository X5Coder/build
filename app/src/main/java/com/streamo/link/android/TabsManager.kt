/*
 * Tab + TabsManager — تبويبات Android WebView الأصلية خلف واجهة موحدة.
 * الأحداث ترجع لـ chrome.js عبر onEvent (window.__tabEvent / __onLinkFound / ...).
 */
package com.streamo.link.android

import android.content.Context
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONObject

class Tab(val id: Int, val webView: WebView, initialUrl: String) {
    var currentUrl: String = initialUrl
    var hostIntentEtld: String? = etldOf(initialUrl)
    var hostIntentTs: Long = System.currentTimeMillis()

    fun markHostIntent(url: String) {
        hostIntentEtld = etldOf(url)
        hostIntentTs = System.currentTimeMillis()
    }

    fun clearHostIntent() {
        hostIntentEtld = null
        hostIntentTs = 0L
    }

    companion object {
        fun etldOf(url: String): String = Defense.etld1(Defense.hostOf(url))
    }
}

class TabsManager(
    private val context: Context,
    private val frame: FrameLayout,
    private val onEvent: (String) -> Unit
) {
    private val tabs = LinkedHashMap<Int, Tab>()
    private var activeId = -1
    private var seq = 0

    fun activeTab(): Tab? = tabs[activeId]
    fun getTab(id: Int): Tab? = tabs[id]
    fun tabCount(): Int = tabs.size
    fun allTabs(): List<Tab> = tabs.values.toList()

    fun createTab(url: String): Int {
        seq += 1
        val target = if (Defense.isHttp(url)) url else "https://www.google.com/"
        val webView = WebView(context)
        val tab = Tab(seq, webView, target)
        webView.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        )
        configureWebView(webView)
        webView.webViewClient = TabWebViewClient(this, tab)
        webView.webChromeClient = TabWebChromeClient(this, tab)
        webView.addJavascriptInterface(ContentJsBridge(this, tab), "__streamoHook")
        webView.visibility = android.view.View.GONE
        frame.addView(webView)
        tabs[seq] = tab
        webView.loadUrl(target)
        return seq
    }

    private fun configureWebView(wv: WebView) {
        val s = wv.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = true
        s.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.mediaPlaybackRequiresUserGesture = false
        s.javaScriptCanOpenWindowsAutomatically = false
        s.setSupportMultipleWindows(true)   // عشان onCreateWindow يلتقط الـ popups ويطبق سياسة الدومين
        s.loadsImagesAutomatically = true
        s.blockNetworkImage = false
        s.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        try {
            android.webkit.CookieManager.getInstance().setAcceptCookie(true)
            if (android.os.Build.VERSION.SDK_INT >= 21) {
                android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
            }
        } catch (_: Exception) { }
    }

    fun setVisible(id: Int, visible: Boolean) {
        val tab = tabs[id] ?: return
        if (visible) {
            activeId = id
            tab.webView.visibility = android.view.View.VISIBLE
            frame.bringChildToFront(tab.webView)
        } else {
            tab.webView.visibility = android.view.View.GONE
        }
    }

    fun loadUrl(id: Int, url: String) {
        val tab = tabs[id] ?: return
        if (!Defense.isHttp(url)) return
        tab.markHostIntent(url)
        tab.webView.loadUrl(url)
    }

    fun goBack(id: Int) { tabs[id]?.webView?.goBack() }
    fun goForward(id: Int) { tabs[id]?.webView?.goForward() }
    fun reload(id: Int) { tabs[id]?.webView?.reload() }
    fun canGoBack(id: Int): Boolean = tabs[id]?.webView?.canGoBack() ?: false
    fun canGoForward(id: Int): Boolean = tabs[id]?.webView?.canGoForward() ?: false

    fun execJs(id: Int, code: String) {
        tabs[id]?.webView?.evaluateJavascript(code, null)
    }

    fun destroy(id: Int) {
        val tab = tabs.remove(id) ?: return
        frame.removeView(tab.webView)
        try { tab.webView.destroy() } catch (_: Exception) { }
        NavigationGuard.clearTab(id)
    }

    fun destroyAll() {
        val ids = tabs.keys.toList()
        for (id in ids) destroy(id)
        activeId = -1
    }

    fun activateTab(id: Int) = setVisible(id, true)

    /** نداء خام لتنفيذ JS في واجهة chrome (fire-and-forget) */
    fun onJs(code: String) = onEvent(code)

    /* ================= الأحداث نحو chrome.js ================= */

    fun emitTabEvent(tabId: Int, type: String, payload: JSONObject) {
        onEvent("window.__tabEvent && window.__tabEvent($tabId,'$type',${js(payload)})")
    }

    fun notifyLink(url: String, tabId: Int, source: String, pageUrl: String? = null) {
        val payload = JSONObject()
            .put("url", url)
            .put("source", source)
            .put("tabId", tabId)
            .put("pageUrl", pageUrl ?: tabs[tabId]?.currentUrl ?: "")
        onEvent("window.__onLinkFound && window.__onLinkFound($payload)")
    }

    fun emitPopup(tabId: Int, url: String, srcUrl: String) {
        val payload = JSONObject().put("wcId", tabId).put("url", url).put("srcUrl", srcUrl)
        onEvent("window.__onPopup && window.__onPopup($payload)")
    }

    fun emitSeenPage(tabId: Int, href: String) {
        val payload = JSONObject().put("wcId", tabId).put("href", href)
        onEvent("window.__onSeenPage && window.__onSeenPage($payload)")
    }

    fun emitNavIntent(tabId: Int, href: String, prevented: Boolean) {
        val payload = JSONObject().put("wcId", tabId).put("href", href).put("prevented", prevented)
        onEvent("window.__onNavIntent && window.__onNavIntent($payload)")
    }

    private fun js(o: JSONObject): String = o.toString()
}
