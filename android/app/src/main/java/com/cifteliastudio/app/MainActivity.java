package com.cifteliastudio.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.WebResourceRequest;
import android.net.Uri;

public class MainActivity extends Activity {
    private static final String HOME = "https://apajaziti230505-lgtm.github.io/ciftelia/";
    private WebView webView;
    private PermissionRequest pending;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings=webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                return !("https".equals(u.getScheme()) && "apajaziti230505-lgtm.github.io".equals(u.getHost()) && u.getPath().startsWith("/ciftelia/"));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(()-> {
                    Uri u=req.getOrigin();
                    if(!"https".equals(u.getScheme()) || !"apajaziti230505-lgtm.github.io".equals(u.getHost())) {req.deny();return;}
                    boolean mic=false;
                    for(String r:req.getResources()) {if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r))mic=true;else {req.deny();return;}}
                    if(!mic){req.deny();return;}
                    if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED) req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    else {pending=req;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},79);}
                });
            }
        });
        webView.loadUrl(HOME);
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        if(requestCode==79 && pending!=null){
            if(grantResults.length>0 && grantResults[0]==PackageManager.PERMISSION_GRANTED)pending.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pending.deny();
            pending=null;
        }
    }
    @Override public void onBackPressed() {if(webView.canGoBack()) webView.goBack(); else super.onBackPressed();}
    @Override protected void onDestroy() {if(webView!=null){webView.destroy();webView=null;} super.onDestroy();}
}
