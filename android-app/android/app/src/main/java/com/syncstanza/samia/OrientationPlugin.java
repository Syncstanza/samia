package com.syncstanza.samia;

import android.content.pm.ActivityInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Lets the page choose the screen direction: landscape everywhere, portrait for the page (mushaf) view.
@CapacitorPlugin(name = "Orientation")
public class OrientationPlugin extends Plugin {
    @PluginMethod
    public void set(PluginCall call) {
        final boolean portrait = "portrait".equals(call.getString("mode", "landscape"));
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(portrait
                ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            call.resolve();
        });
    }
}
