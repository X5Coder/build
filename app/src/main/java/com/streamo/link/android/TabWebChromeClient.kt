/*
 * TabWebChromeClient — popups (window.open / target=_blank) تتبع سياسة الدومين،
 * والـ JS dialogs (alert/confirm/prompt) شغالة بدل ما تتجمد الصفحة.
 */
package com.streamo.link.android

import android.app.Activity
import android.content.Context
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import android.app.AlertDialog

class TabWebChromeClient(private val mgr: TabsManager, private val tab: Tab) : WebChromeClient() {

    /* أي window.open: مايتفتحش كـ popup — نمسك الرابط الأول ونطبق سياسة الدومين في chrome.js */
    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: android.os.Message
    ): Boolean {
        val temp = WebView(view.context)
        temp.settings.javaScriptEnabled = false
        temp.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, req: android.webkit.WebResourceRequest): Boolean {
                val dest = req.url.toString()
                mgr.emitPopup(tab.id, dest, tab.currentUrl)
                // تنظيف — الرابط راح لسياسة الدومين في chrome.js (نفس الدومين => تبويب جديد)
                view.post { try { temp.destroy() } catch (_: Exception) {} }
                return true
            }
        }
        val transport = resultMsg.obj as WebView.WebViewTransport
        transport.setWebView(temp)
        resultMsg.sendToTarget()
        return true
    }

    override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
        val ctx = view.context
        try {
            if (ctx is Activity) {
                AlertDialog.Builder(ctx)
                    .setMessage(message ?: "")
                    .setPositiveButton("OK") { _, _ -> result.confirm() }
                    .setCancelable(false)
                    .show()
                return true
            }
        } catch (_: Exception) { }
        result.confirm()
        return true
    }

    override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
        val ctx = view.context
        try {
            if (ctx is Activity) {
                AlertDialog.Builder(ctx)
                    .setMessage(message ?: "")
                    .setPositiveButton("OK") { _, _ -> result.confirm() }
                    .setNegativeButton("Cancel") { _, _ -> result.cancel() }
                    .setCancelable(false)
                    .show()
                return true
            }
        } catch (_: Exception) { }
        result.confirm()
        return true
    }

    override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsResult): Boolean {
        val ctx = view.context
        try {
            if (ctx is Activity) {
                val input = EditText(ctx)
                input.setText(defaultValue ?: "")
                val layout = LinearLayout(ctx)
                layout.orientation = LinearLayout.HORIZONTAL
                layout.setPadding(48, 24, 48, 0)
                layout.addView(input, LinearLayout.LayoutParams(-1, -2))
                AlertDialog.Builder(ctx)
                    .setMessage(message ?: "")
                    .setView(layout)
                    .setPositiveButton("OK") { _, _ -> result.confirm(input.text.toString()) }
                    .setNegativeButton("Cancel") { _, _ -> result.cancel() }
                    .setCancelable(false)
                    .show()
                return true
            }
        } catch (_: Exception) { }
        result.cancel()
        return true
    }

    /* صفحات الفيديو اللي بتطلب fullscreen الأصلي — لا تتعطل */
    override fun onShowCustomView(view: android.view.View?, callback: CustomViewCallback?) {}
    override fun onHideCustomView() {}

    override fun getDefaultVideoPoster() = null
    override fun getVideoLoadingProgressView(): android.view.View? = null
}
