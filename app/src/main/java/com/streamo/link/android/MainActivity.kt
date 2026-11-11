/*
 * Streamo Link (Android) — الغلاف الأصلي للتطبيق.
 * تخطيط: FrameLayout بجافا/XML فيه تبويبات WebView أصيلة + WebView لواجهة chrome (شفافة).
 * الواجهة (HTML/CSS/JS الأصلية) تترسم فوق المتصفح وتمرر اللمس غير المستهلك للتبويب النشط.
 * زر الرجوع: بلاير → لوحة → وضع بحث/تحرير → تاريخ التبويب → إغلاق التبويب → خروج بضغطة تانية.
 */
package com.streamo.link.android

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import java.util.concurrent.atomic.AtomicLong

class MainActivity : Activity() {

    lateinit var tabs: TabsManager
        private set

    private lateinit var chromeWebView: WebView

    @Volatile private var uiState = "none"          // none | player | panel | search | edit
    @Volatile private var toolbarBottomPx = 0f
    @Volatile private var notifL = 0f; @Volatile private var notifT = 0f
    @Volatile private var notifR = 0f; @Volatile private var notifB = 0f
    private val lastBackMs = AtomicLong(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // حمّل قوائم الحظر في الخلفية (4.5MB) — تكفي النواة حتى يكتمل التحميل
        Thread { Defense.loadLists(applicationContext) }.start()

        val frame = findViewById<FrameLayout>(R.id.contentFrame)
        chromeWebView = findViewById(R.id.chromeWebView)

        // التبويبات تترسم هنا (تحته مباشرة)
        tabs = TabsManager(this, frame) { code -> chromeJs(code) }

        /* واجهة chrome — خلفية شفافة عشان متصفح التبويب يظهر من تحتها */
        chromeWebView.setBackgroundColor(Color.TRANSPARENT)
        val chromeSettings = chromeWebView.settings
        chromeSettings.javaScriptEnabled = true
        chromeSettings.domStorageEnabled = true
        chromeSettings.allowFileAccess = true          // file:///android_asset
        chromeSettings.allowContentAccess = false
        chromeSettings.databaseEnabled = true
        chromeSettings.mediaPlaybackRequiresUserGesture = false
        chromeWebView.addJavascriptInterface(ChromeJsBridge(this), "StreamoNative")
        chromeWebView.loadUrl("file:///android_asset/chrome.html")

        /* اللمس: الواجهة تستهلك المودال/التولبار/الإشعارات فقط — الباقي للتبويب الأصلي */
        chromeWebView.setOnTouchListener { _, ev ->
            if (uiState != "none") return@setOnTouchListener false
            val y = ev.y
            if (y <= toolbarBottomPx) return@setOnTouchListener false
            if (notifR > 0f && ev.x in notifL..notifR && y in notifT..notifB) {
                return@setOnTouchListener false
            }
            val active = tabs.activeTab() ?: return@setOnTouchListener false
            active.webView.dispatchTouchEvent(ev)
            true
        }

        /* زر الرجوع: Android 13+ له مسار خاص */
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                onBackInvokedDispatcher.registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
                ) { handleBack() }
            } catch (_: Exception) { }
        }
    }

    fun setUiState(state: String) {
        uiState = state
    }

    fun setHotzones(toolbarBottom: Float, l: Float, t: Float, r: Float, b: Float) {
        toolbarBottomPx = toolbarBottom
        notifL = l; notifT = t; notifR = r; notifB = b
    }

    /** تنفيذ JS في chrome — من أي خيط، دائمًا على الـ UI thread */
    fun chromeJs(code: String) {
        runOnUiThread { chromeWebView.evaluateJavascript(code, null) }
    }

    /* ================= زر الرجوع ================= */

    fun handleBack() {
        when (uiState) {
            "player" -> chromeJs("window.__closePlayer && window.__closePlayer()")
            "panel"  -> chromeJs("window.__closePanel && window.__closePanel()")
            "search" -> chromeJs("window.__exitSearchMode && window.__exitSearchMode()")
            "edit"   -> chromeJs("window.__exitEditMode && window.__exitEditMode()")
            else -> {
                val active = tabs.activeTab()
                if (active != null && active.webView.canGoBack()) {
                    active.webView.goBack()
                    return
                }
                if (tabs.tabCount() > 1) {
                    chromeJs("window.__closeActiveTab && window.__closeActiveTab()")
                    return
                }
                doubleBackExit()
            }
        }
    }

    private fun doubleBackExit() {
        val now = System.currentTimeMillis()
        val last = lastBackMs.getAndSet(now)
        if (now - last < 2000) {
            finish()
        } else {
            Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show()
        }
    }

    @Deprecated("Legacy back — فقط للأجهزة أقل من Android 13")
    override fun onBackPressed() {
        if (Build.VERSION.SDK_INT < 33) handleBack()
        // Android 13+ يعالج عبر OnBackInvokedCallback المسجّلة أعلاه
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && Build.VERSION.SDK_INT < 33) {
            handleBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    /* ================= الدورة ================= */

    override fun onDestroy() {
        super.onDestroy()
        try { tabs.destroyAll() } catch (_: Exception) { }
    }
}
