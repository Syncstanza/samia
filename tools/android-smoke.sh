#!/usr/bin/env bash
# Runs on an Android emulator (see dev-build.yml): installs the APK, starts it and waits until
# the page reports that the speech engine is ready. Prints what the page logged either way.
# Usage: tools/android-smoke.sh path/to/app.apk com.package.id
set -u
APK="$1"; PKG="$2"
adb install -r "$APK" || exit 1
adb shell pm grant "$PKG" android.permission.RECORD_AUDIO
adb logcat -c
adb shell am start -n "$PKG/com.syncstanza.samia.MainActivity" || exit 1
ok=0
for i in $(seq 1 90); do
  sleep 2
  if adb logcat -d | grep -q "SAMIA_READY asr=true"; then ok=1; break; fi
  if adb logcat -d | grep -q "SAMIA_ERROR"; then break; fi
done
echo "---- what the page logged ----"
adb logcat -d | grep -E "Capacitor|SAMIA|chromium|AndroidRuntime" | tail -60
if [ "$ok" = 1 ]; then echo "PASS: speech engine ready inside the Android WebView"; adb exec-out screencap -p > smoke.png 2>/dev/null; exit 0; fi
echo "FAIL: the speech engine did not report ready"; exit 1
