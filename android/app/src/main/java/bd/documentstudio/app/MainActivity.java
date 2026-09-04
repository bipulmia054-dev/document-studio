package bd.documentstudio.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.*;
import android.widget.*;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.google.mlkit.vision.documentscanner.*;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;

public class MainActivity extends ComponentActivity {
    private WebView web;
    private TextView status;
    private String server, scanId;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private String pendingDownload, pendingCookie;
    private boolean pageFailed;
    private final java.util.concurrent.ExecutorService io = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<IntentSenderRequest> scannerLauncher;
    private ActivityResultLauncher<Intent> fileLauncher, saveLauncher;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        server = getPreferences(0).getString("server", "http://100.96.199.117:8765/");
        scannerLauncher = registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            if (result.getResultCode() != RESULT_OK) { scanResult(null, "cancelled"); return; }
            GmsDocumentScanningResult scan = GmsDocumentScanningResult.fromActivityResultIntent(result.getData());
            if (scan == null || scan.getPages() == null || scan.getPages().isEmpty()) { scanResult(null, "কোনো scan পাওয়া যায়নি"); return; }
            Uri image = scan.getPages().get(0).getImageUri();
            io.execute(() -> {
                try (InputStream in = getContentResolver().openInputStream(image)) {
                    byte[] bytes = readLimited(in, 24 * 1024 * 1024);
                    runOnUiThread(() -> scanResult("data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP), null));
                } catch (Exception e) { runOnUiThread(() -> scanResult(null, "Scan পড়া যায়নি। আবার চেষ্টা করুন।")); }
            });
        });
        fileLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            Uri[] values = null;
            if (result.getResultCode() == RESULT_OK) {
                Uri picked = result.getData() == null ? null : result.getData().getData();
                if (picked == null) picked = cameraUri;
                if (picked != null) values = new Uri[]{picked};
            }
            if (fileCallback != null) fileCallback.onReceiveValue(values);
            fileCallback = null; cameraUri = null;
        });
        saveLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            String source = pendingDownload, cookie = pendingCookie;
            pendingDownload = null; pendingCookie = null;
            if (result.getResultCode() != RESULT_OK || result.getData() == null) return;
            Uri target = result.getData().getData();
            io.execute(() -> {
                try {
                    byte[] bytes;
                    if (source.startsWith("data:")) {
                        int comma = source.indexOf(',');
                        if (comma < 0 || !source.substring(0, comma).endsWith(";base64")) throw new IOException();
                        bytes = Base64.decode(source.substring(comma + 1), Base64.DEFAULT);
                    } else {
                        HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
                        connection.setInstanceFollowRedirects(false);
                        connection.setConnectTimeout(20000); connection.setReadTimeout(60000);
                        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
                        try {
                            if (connection.getResponseCode() != 200) throw new IOException();
                            try (InputStream in = connection.getInputStream()) { bytes = readLimited(in, 100 * 1024 * 1024); }
                        } finally { connection.disconnect(); }
                    }
                    try (OutputStream out = getContentResolver().openOutputStream(target)) { out.write(bytes); }
                    runOnUiThread(() -> notice("ফাইল Save হয়েছে"));
                } catch (Exception e) { runOnUiThread(() -> notice("Download হয়নি। Login ও server connection দেখুন।")); }
            });
        });
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.WHITE);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
        });
        LinearLayout bar = new LinearLayout(this); bar.setPadding(12, 4, 12, 4);
        TextView title = new TextView(this); title.setText("Document Studio"); title.setTextSize(19); title.setTextColor(Color.rgb(22,70,62)); title.setGravity(17);
        bar.addView(title, new LinearLayout.LayoutParams(0, 48, 1));
        Button settings = new Button(this); settings.setText("Server"); settings.setOnClickListener(v -> settings()); bar.addView(settings);
        Button reload = new Button(this); reload.setText("↻"); reload.setContentDescription("Reload"); reload.setOnClickListener(v -> new AlertDialog.Builder(this).setMessage("Save না করা তথ্য মুছে যাবে। Reload করবেন?").setPositiveButton("Reload", (d,w) -> web.reload()).setNegativeButton("না", null).show()); bar.addView(reload);
        root.addView(bar);
        status = new TextView(this); status.setPadding(14, 8, 14, 8); status.setText("Server-এ সংযোগ হচ্ছে…"); root.addView(status);
        web = new WebView(this); root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(root);
        WebSettings config = web.getSettings(); config.setJavaScriptEnabled(true); config.setDomStorageEnabled(true);
        config.setAllowFileAccess(false); config.setAllowContentAccess(false); config.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        config.setUserAgentString(config.getUserAgentString() + " DocumentStudioAndroid/1");
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { pageFailed = false; }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (request.isForMainFrame() && trusted(view.getUrl()) && url.startsWith("documentstudio://")) {
                    Uri u = request.getUrl();
                    if ("scan".equals(u.getHost())) startScan(u.getQueryParameter("id"));
                    if ("download".equals(u.getHost())) download(u.getQueryParameter("data"), u.getQueryParameter("name"));
                    if ("preview".equals(u.getHost())) previewPdf(u.getQueryParameter("data"));
                    return true;
                }
                if (trusted(url)) return false;
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!trusted(url)) return;
                if (!pageFailed) status.setVisibility(android.view.View.GONE); CookieManager.getInstance().flush();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { pageFailed = true; status.setVisibility(android.view.View.VISIBLE); status.setText("সংযোগ হয়নি। PC server ও ফোনের Tailscale চালু করুন, তারপর ↻ চাপুন। Server বাটনে ঠিকানা বদলাতে পারবেন।"); }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("হ্যাঁ", (d,w) -> result.confirm()).setNegativeButton("না", (d,w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show(); return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK", (d,w) -> result.confirm()).setOnCancelListener(d -> result.cancel()).show(); return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!trusted(view.getUrl())) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                new AlertDialog.Builder(MainActivity.this).setTitle("ছবি যোগ করুন").setItems(new String[]{"Camera", "Gallery / Files"}, (d, which) -> {
                    try {
                        if (which == 0) {
                            File dir = new File(getCacheDir(), "pictures"); dir.mkdirs();
                            File photo = File.createTempFile("capture-", ".jpg", dir);
                            cameraUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", photo);
                            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE); camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                            camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            fileLauncher.launch(camera);
                        } else {
                            cameraUri = null;
                            Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT); pick.addCategory(Intent.CATEGORY_OPENABLE); pick.setType("image/*"); fileLauncher.launch(pick);
                        }
                    } catch (Exception e) { fileCallback.onReceiveValue(null); fileCallback = null; notice("Camera পাওয়া যায়নি। Gallery ব্যবহার করুন।"); }
                }).setOnCancelListener(d -> { if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = null; }).show(); return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (url.startsWith("blob:") && trusted(web.getUrl())) {
                web.evaluateJavascript("fetch(" + JSONObject.quote(url) + ").then(r=>r.blob()).then(b=>{const r=new FileReader();r.onload=()=>{location.href='documentstudio://download?name=Document.pdf&data='+encodeURIComponent(r.result)};r.readAsDataURL(b)})", null);
            } else download(url, URLUtil.guessFileName(url, disposition, mime));
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { if (web.canGoBack()) web.goBack(); else new AlertDialog.Builder(MainActivity.this).setMessage("অ্যাপ বন্ধ করবেন? Save না করা তথ্য হারাতে পারে।").setPositiveButton("বন্ধ করুন", (d,w) -> finish()).setNegativeButton("না", null).show(); }
        });
        web.loadUrl(server);
    }
    private boolean trusted(String url) {
        if (url == null) return false;
        Uri a = Uri.parse(server), b = Uri.parse(url);
        return a.getScheme().equals(b.getScheme()) && a.getHost().equals(b.getHost()) && a.getPort() == b.getPort();
    }
    private void settings() {
        EditText field = new EditText(this); field.setSingleLine(true); field.setText(server);
        new AlertDialog.Builder(this).setTitle("Server address").setMessage("PC চালু রাখুন। বাইরে থেকে ব্যবহার করতে একই Tailscale account-এ ফোন যুক্ত করুন। ঠিকানা বদলালে অসম্পূর্ণ ফর্ম reset হবে।").setView(field).setNegativeButton("Cancel", null).setPositiveButton("Save", (d,w) -> {
            String value = field.getText().toString().trim();
            Uri uri = Uri.parse(value); String host = uri.getHost();
            boolean local = host != null && (host.matches("10\\.\\d+\\.\\d+\\.\\d+") || host.matches("192\\.168\\.\\d+\\.\\d+") || host.matches("172\\.(1[6-9]|2[0-9]|3[01])\\.\\d+\\.\\d+") || host.matches("100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.\\d+\\.\\d+") || host.endsWith(".ts.net"));
            if (host == null || uri.getUserInfo() != null || !("https".equals(uri.getScheme()) || ("http".equals(uri.getScheme()) && local))) { notice("HTTPS অথবা private LAN/Tailscale address দিন"); return; }
            server = uri.buildUpon().path("/").clearQuery().fragment(null).build().toString();
            getPreferences(0).edit().putString("server", server).apply(); web.loadUrl(server);
        }).show();
    }
    private void startScan(String id) {
        if (id == null || scanId != null) return;
        scanId = id;
        notice("Scanner প্রস্তুত হচ্ছে। প্রথমবার internet লাগবে।");
        GmsDocumentScannerOptions options = new GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(1).setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build();
        GmsDocumentScanning.getClient(options).getStartScanIntent(this).addOnSuccessListener(sender -> scannerLauncher.launch(new IntentSenderRequest.Builder(sender).build())).addOnFailureListener(error -> scanResult(null, "ML Kit চালু হয়নি। Google Play Services update ও internet connection দেখুন।"));
    }
    private void scanResult(String image, String error) {
        try {
            JSONObject result = new JSONObject(); result.put("id", scanId); result.put("image", image); result.put("error", error);
            if (trusted(web.getUrl())) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('documentstudio-scan-result',{detail:" + result + "}))", null);
        } catch (Exception ignored) {} finally { scanId = null; }
    }
    private void download(String url, String name) {
        if (url == null || pendingDownload != null || !trusted(web.getUrl())) return;
        if (!url.startsWith("data:application/pdf;base64,") && !url.startsWith("data:image/") && !trusted(url)) { notice("এই download সমর্থিত নয়"); return; }
        pendingDownload = url; pendingCookie = CookieManager.getInstance().getCookie(server);
        String filename = name == null ? "Document.pdf" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (filename.length() > 150) filename = "Document.pdf";
        String mime = filename.toLowerCase(java.util.Locale.ROOT).endsWith(".zip") ? "application/zip" : filename.toLowerCase(java.util.Locale.ROOT).endsWith(".png") ? "image/png" : filename.toLowerCase(java.util.Locale.ROOT).endsWith(".jpg") ? "image/jpeg" : "application/pdf";
        Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT); save.addCategory(Intent.CATEGORY_OPENABLE); save.setType(mime); save.putExtra(Intent.EXTRA_TITLE, filename); saveLauncher.launch(save);
    }
    private void previewPdf(String data) {
        if (data == null || !data.startsWith("data:application/pdf;") || data.length() > 40000000) return;
        notice("PDF Preview তৈরি হচ্ছে…");
        io.execute(() -> {
            File file = null;
            try {
                file = File.createTempFile("preview", ".pdf", getCacheDir());
                try (FileOutputStream output = new FileOutputStream(file)) { output.write(Base64.decode(data.substring(data.indexOf(',') + 1), Base64.DEFAULT)); }
                java.util.ArrayList<android.graphics.Bitmap> images = new java.util.ArrayList<>();
                try (android.os.ParcelFileDescriptor fd = android.os.ParcelFileDescriptor.open(file, android.os.ParcelFileDescriptor.MODE_READ_ONLY); android.graphics.pdf.PdfRenderer renderer = new android.graphics.pdf.PdfRenderer(fd)) {
                    for (int i = 0; i < Math.min(renderer.getPageCount(), 10); i++) {
                        try (android.graphics.pdf.PdfRenderer.Page page = renderer.openPage(i)) {
                            int width = 1100, height = Math.round(width * (float)page.getHeight() / page.getWidth());
                            android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.ARGB_8888);
                            bitmap.eraseColor(Color.WHITE); page.render(bitmap, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); images.add(bitmap);
                        }
                    }
                }
                runOnUiThread(() -> {
                    ScrollView scroll = new ScrollView(this); LinearLayout pages = new LinearLayout(this); pages.setOrientation(LinearLayout.VERTICAL); scroll.addView(pages);
                    for (android.graphics.Bitmap bitmap : images) { ImageView image = new ImageView(this); image.setImageBitmap(bitmap); image.setAdjustViewBounds(true); pages.addView(image, new LinearLayout.LayoutParams(-1, -2)); }
                    new AlertDialog.Builder(this).setTitle("PDF Preview").setView(scroll).setPositiveButton("বন্ধ করুন", null).setNeutralButton("Save PDF", (d,w) -> download(data, "Document.pdf")).show();
                });
            } catch (Exception e) { runOnUiThread(() -> notice("Preview হয়নি। PDF download করে দেখুন।")); }
            finally { if (file != null) file.delete(); }
        });
    }
    private static byte[] readLimited(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[16384]; int count;
        while ((count = in.read(buffer)) != -1) { if (out.size() + count > limit) throw new IOException("File too large"); out.write(buffer, 0, count); }
        return out.toByteArray();
    }
    private void notice(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    @Override protected void onDestroy() { if (web != null) web.destroy(); io.shutdown(); super.onDestroy(); }
}
