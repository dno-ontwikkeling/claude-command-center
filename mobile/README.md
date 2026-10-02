# CommandCenter remote (Android)

Phone client for Claude Command Center's [remote access](../README.md#remote-access).
Personal use: the APK is **sideloaded**, not published on the Play Store.

- Capacitor 8 + plain ES modules in `www/` (no bundler), xterm.js for terminals.
- A Kotlin foreground service (`RemoteService`) owns a cert-pinned OkHttp
  WebSocket to the PC, keeps it alive in the background and raises the
  needs-input notifications. The WebView only sends and receives protocol frames;
  the token never reaches it.

## Install (sideload)

1. Download `command-center-remote-<version>.apk` from the
   [GitHub release](https://github.com/dno-ontwikkeling/claude-command-center/releases).
2. Open it on the phone and allow **Install unknown apps** for your browser or
   file manager when Android asks.
3. Updates: install the newer APK over the old one; the pairing is kept.

Only APKs from releases are signed with the release key. The `command-center-remote-debug`
APK from a CI run uses a debug key and **cannot be installed over a release
APK** (uninstall first — that drops the pairing).

On first start, scan the pairing QR (PC: Settings → Remote → Show pairing QR),
allow notifications, and allow **unrestricted battery use** so Android doesn't
stall the background connection.

## Build locally

Needs Node 22+ and JDK 21. Android Studio's bundled JDK works:

```bash
# Git Bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"

cd mobile
npm ci
npm test                         # JS unit tests (shared fixtures in ../test/fixtures)
npm run build                    # copy xterm/capacitor/diff-parse into www/vendor
npx cap sync android
android/gradlew.bat -p android testDebugUnitTest assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

`adb install -r android/app/build/outputs/apk/debug/app-debug.apk` installs it on
a phone with USB debugging on.

OkHttp is pinned to 5.4.0: 5.5.0+ requires compileSdk 37, while Capacitor 8's
Android Gradle Plugin tops out at 36.

## Release signing (one-time setup)

Every release APK must be signed with the **same** key, or Android refuses to
install the update over the previous one. Create the key once:

```bash
keytool -genkeypair -v -keystore cc-remote-release.jks -alias cc-remote \
  -keyalg RSA -keysize 4096 -validity 10000
```

Then add four repository secrets (GitHub → Settings → Secrets and variables →
Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 cc-remote-release.jks` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cc-remote-release.jks"))`) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `cc-remote` |
| `ANDROID_KEY_PASSWORD` | the key password |

**Back up the `.jks` file and both passwords offline** (password manager plus a
copy off this machine). Lose them and no future APK can update the installed
app: you would have to uninstall and re-pair. Never commit the keystore
(`*.jks` / `*.keystore` are gitignored).

Until these secrets exist, the release workflow's `android` job fails on
purpose — and since a release is only published once both the Windows and the
Android build succeed, **add the secrets before the next `feat:` / `fix:` merge**.

The release workflow derives the versionCode from the version
(`major*10000 + minor*100 + patch`, see `scripts/version-code.mjs`) and refuses to
build a versionCode that isn't higher than every existing release.

## On-device acceptance checklist

- [ ] Fresh install → scan the QR → list shows the same agents/status as the PC.
- [ ] Wrong network / PC asleep → "PC offline — reconnecting"; reconnects by itself after the PC wakes.
- [ ] Open an agent → screen fits the phone, recent output is replayed, typing and Esc/Ctrl/arrows work.
- [ ] Use the agent on the PC again → the PC terminal snaps back to its own size.
- [ ] Pinch → font size changes and stays after restarting the app; PC font unchanged.
- [ ] New agent → appears on the PC sidebar without stealing focus; phone opens it.
- [ ] Agent menu: Rename, Sleep / Resume, Forget (worktree: delete folder + branch). Tap a sleeping agent → resumes and opens.
- [ ] Filter All / Active / Sleeping; New agent → Add project / New workspace via the folder browser.
- [ ] Git → diff stat, diff viewer, Fetch, Pull.
- [ ] Lock the phone, make an agent ask for permission → notification; tap → that terminal. Answer on the PC → notification disappears.
- [ ] PC: Settings → Remote → Regenerate → phone shows "Re-pair needed" and stops retrying.
- [ ] PC: Disconnect all → phone shows "Disconnected by the PC" with Reconnect.
