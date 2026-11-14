package com.syncstanza.samia;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrientationPlugin.class);
        super.onCreate(savedInstanceState);
        // Draw edge to edge and never shrink for the system bars: when the status bar is pulled down it now
        // slides over the app instead of pushing it aside and showing dark bars.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // The screen stays on while Sami'a is open (a recitation can be long, and the phone may be propped up).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // The microphone starts by itself when the speech engine is ready, with no tap first.
        WebSettings s = getBridge().getWebView().getSettings();
        s.setMediaPlaybackRequiresUserGesture(false);
    }
}
