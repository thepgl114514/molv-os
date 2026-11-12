#!/usr/bin/env bash
# 在没有 Android Studio / Gradle 的 Linux CI 上构建墨绿OS APK。
# 依赖：JDK 17+、Android SDK platform 35、build-tools 35.0.0、7zip、node。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/android"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
BT="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
BUILD="$ANDROID/build"
DIST="$ROOT/dist"

rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$DIST"
node "$ROOT/scripts/make-android-integrity.js"

"$BT/aapt2" compile --dir "$ANDROID/res" -o "$BUILD/res.zip"
"$BT/aapt2" link -o "$BUILD/app-unsigned.apk" -I "$PLATFORM" \
  --manifest "$ANDROID/AndroidManifest.xml" -R "$BUILD/res.zip" \
  -A "$ANDROID/assets" --java "$BUILD/gen" --auto-add-overlay

find "$ANDROID/java" "$BUILD/gen" -name '*.java' > "$BUILD/sources.txt"
javac -encoding UTF-8 -source 11 -target 11 -classpath "$PLATFORM" \
  -d "$BUILD/classes" @"$BUILD/sources.txt"

find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
"$BT/d8" --lib "$PLATFORM" --min-api 26 --output "$BUILD/dex" @"$BUILD/classes.txt"

STAGE="$BUILD/apk-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
( cd "$STAGE" && unzip -q "$BUILD/app-unsigned.apk" )
cp "$BUILD/dex/classes.dex" "$STAGE/classes.dex"
( cd "$STAGE" && zip -q -0 -r "$BUILD/app-fixed.apk" . )
"$BT/zipalign" -f 4 "$BUILD/app-fixed.apk" "$BUILD/app-aligned.apk"

KS="$BUILD/debug.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -alias androiddebugkey \
    -keypass android -dname "CN=MolvOS Debug,O=MolvOS,C=CN" -keyalg RSA -keysize 2048 -validity 10000
fi

"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$DIST/MolvOS-0.1.0-android.apk" "$BUILD/app-aligned.apk"
"$BT/apksigner" verify --verbose "$DIST/MolvOS-0.1.0-android.apk"
