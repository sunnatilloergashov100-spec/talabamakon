package uz.talabamakon.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * TalabaMakon — Android ilova.
 * Saytni (Firebase Hosting) ilova ichida ochadi: bitta kirish, huquqlar va maʼlumotlar sayt bilan bir xil.
 * Sayt manzili res/values/strings.xml dagi app_url da.
 */
public class MainActivity extends Activity {
    private static final int FILE_REQUEST = 1001;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String appUrl;
    private String appHost;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        appUrl = getString(R.string.app_url);
        appHost = Uri.parse(appUrl).getHost();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // sayt ilova ichida ochilganini biladi (masalan, APK yuklab olish havolasini yashiradi)
        s.setUserAgentString(s.getUserAgentString() + " TalabaMakonApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                // oʻz saytimiz va Firebase kirish sahifalari ilova ichida qoladi, qolgan havolalar brauzerda ochiladi
                if ("https".equals(u.getScheme()) && u.getHost() != null
                        && (u.getHost().equals(appHost) || u.getHost().endsWith(".firebaseapp.com"))) {
                    return false;
                }
                openExternal(u);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                            + "<body style='font-family:sans-serif;padding:32px;color:#13262B;background:#EDF1F0'>"
                            + "<h2>Internet bilan aloqa yoʻq</h2><p>Ulanishni tekshiring va qayta urining.</p>"
                            + "<p><a href='" + appUrl + "' style='display:inline-block;padding:12px 18px;background:#0D6772;color:#fff;"
                            + "border-radius:8px;text-decoration:none'>Qayta urinish</a></p></body></html>";
                    view.loadDataWithBaseURL(appUrl, html, "text/html", "UTF-8", null);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/vnd.ms-excel",
                        "application/octet-stream"});
                try {
                    startActivityForResult(Intent.createChooser(pick, "Excel faylni tanlang"), FILE_REQUEST);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Excel shablon va boshqa fayllar telefon brauzeri orqali yuklab olinadi
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> openExternal(Uri.parse(url)));

        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(appUrl);
        }
    }

    private void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception ignored) {
            // mos ilova topilmadi
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) {
            web.saveState(out);
        }
    }
}
