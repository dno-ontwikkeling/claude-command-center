# Mobile remote app (Android, sideloaded)

## Goal
Work on the PC's Claude agents from a phone. The desktop app gains an opt-in, authenticated WSS server that exposes what the desktop window already sees: the agent list with live status, PTY streams with scrollback replay, spawn/resume/kill, and git diff/fetch/pull. A sideloaded Android app (Capacitor 8 + xterm.js, with a native Kotlin foreground service holding a cert-pinned OkHttp socket) connects over Tailscale or a port forward. It pairs by scanning a QR code and raises a notification when an agent needs input, even when the phone is locked. GitHub Actions builds the APK in CI and attaches a signed APK to each release.

Design decisions (user, 2026-10-02):
- Native Android app via Capacitor, APK sideloaded, personal use only.
- Network: Tailscale or router port forward, so the server may face the internet.
- Security: TLS with a desktop-generated self-signed cert, plus a pairing token. The QR carries `{v,url,token,certSha256}` and the app pins the cert fingerprint.
- Background alerts: an Android foreground service owns the socket (no FCM).
- v1 scope: attach/type, spawn/resume/kill, needs-input notifications, git diff/fetch/pull.
- Terminal settings are per device. The phone keeps its own font size, font family, theme (following the phone OS by default) and scrollback length, stored on the phone. Desktop settings stay in renderer localStorage (`renderer/settings.js:69-74`) and are never sent over the protocol.
- PTY size: last-active client wins. Opening an agent or typing on the phone resizes the PTY to fit the phone, and the desktop re-fits when you use it again.
- APK pipeline: CI builds and tests on PRs. A release job signs the APK with a fixed keystore and attaches it to the same GitHub pre-release as the Windows installer.
- Phone spawn **follows the desktop bypass setting** (`renderer/agents.js:206`). This is the user's explicit choice; see Risks.
- Phone Kill behaves like the desktop's **Close** (`removeAgent`, `renderer/sidebar.js:180`): a used session stays resumable as a dormant row, and an unused one is dropped. The confirm dialog says so. (Corrected in step 6: the earlier wording assumed `killAndWait`, which the desktop uses only for worktree/folder deletion.)
- The phone notifies for needs-input **always**, even while the desktop is focused. The notification is auto-dismissed when the agent leaves needs-input.
- A phone spawn does **not** activate the agent on the desktop. It is added to the sidebar in the background.

Current-state facts this design builds on:
- PTYs live in main (`main.js:40` `agents` Map, `main.js:328` `pty.spawn` at 80x30, `main.js:331`). Output goes only to the desktop window (`main.js:54` `sendToRenderer`, `main.js:340` `term.onData`).
- The agent registry, labels, sessionId and status live in the **renderer** (`renderer/state.js:22`), persisted to localStorage (`renderer/state.js:113`). Status is computed in `renderer/agent-status.mjs:17` (`setStatus`), which does not fire `notifyAgentsChanged` (`renderer/state.js:80`). `state.js` exists to avoid import cycles (`renderer/state.js:63-67`).
- `spawn()` generates its own id, returns nothing, and calls `activate(id)` (`renderer/agents.js:62`, `:209`). `refit()` sends a resize every time it is called and is a no-op while the element is hidden (`renderer/agents.js:173`).
- The hook server binds to `127.0.0.1` only (`main.js:313`). Its handler is electron-free with injected dependencies (`hookserver.js:23`), the pattern to copy. A timing-safe compare exists in `hookauth.js`. `isKnownDir` (`main.js:171`) trusts `knownAgentDirs`, which `spawnAgent` itself grows.
- Tests: `node --test` (`package.json`). CI runs bare `node --test` **without installing dependencies** (`.github/workflows/ci.yml:12-23`). `npm run typecheck` checks `preload.js` against `types/ipc.d.ts`. `package.json` `build.files` is an explicit whitelist (`package.json:28-44`).
- Release: `release.yml` has a tag job and a Windows build that creates the draft via `softprops/action-gh-release@v2` and then publishes it (`release.yml:126`). `paths-ignore` covers only root `test/**` (`release.yml:23-29`).
- Android SDK is present at `%LOCALAPPDATA%\Android\Sdk`. Java is not on PATH; the JDK lives at `C:\Program Files\Android\Android Studio\jbr`.

**Architecture:**
- **Source of truth:** the renderer stays the source of truth for agents. Main keeps a mirror snapshot pushed by the renderer and forwards remote spawn/resume/kill to the renderer as a request/response `remote:command`, so the desktop sidebar and the phone never split-brain.
- **Scrollback:** main owns the per-agent scrollback ring buffer, because PTY data arrives there first.
- **Auth:** at WebSocket upgrade, using `Authorization: Bearer <token>` and an `x-cc-proto: 1` header with `ws` `noServer` plus `handleUpgrade`. Unauthenticated sockets never exist.
- **Phone layers:** the native service is a thin transport. It authenticates (the token never reaches the WebView), keeps the connection alive, parses only `agents` frames for needs-input detection, and forwards every frame untouched to the WebView. The WebView (`proto.mjs`) owns all other protocol logic.
- **Contract:** one set of JSON fixtures in `test/fixtures/remote-proto/` is consumed by the desktop Node tests, the mobile Node tests and the Kotlin JVM tests, so the three implementations cannot drift.

**Protocol v1** (JSON text frames. node-pty `onData` already yields decoded strings, so there is no per-chunk UTF-8 split):
- **Server to client:**
  - `agents{seq,desktopUi,list:[{id,label,dir,cwd,branch,status,dormant}]}`
  - `replay{id,lastSeq,data}`
  - `data{id,seq,data}`
  - `exit{id,exitCode}`
  - `rpc-result{reqId,ok,result|error}`
- **Client to server:**
  - `attach{id,cols,rows}`, `detach{id}`
  - `input{id,data}` (max 16 KB)
  - `resize{id,cols,rows}` (integers 2–500)
  - `rpc{reqId,method,args}`, where method is one of `projects.list`, `workspaces.list`, `worktrees.list`, `spawn{dir,cwd,cols,rows}`, `resume{id}`, `kill{id}`, `git.diffstat`, `git.diff`, `git.fetch`, `git.pull`.
- **Close codes:** `4001` (pairing revoked by Regenerate: re-pair needed), `4002` (proto mismatch) and `4003` (kicked by Disconnect all: no auto-retry, but the stored pairing stays valid so the user can reconnect manually). A bad token at upgrade gets HTTP 401, and a version mismatch gets HTTP 426.

## Success criteria
- [ ] Remote access is **off by default**. Once enabled, Settings shows a pairing QR, the listen status (port in use or firewall errors are visible), and connected devices (IP, since when) with "Disconnect all". Regenerate rotates token and cert, closes every client, and the old QR stops working.
- [ ] The QR URL uses an **advertised host**, pre-filled from `os.networkInterfaces()` (Tailscale `100.x` preferred, then LAN) and editable for a DDNS or public name.
- [x] Connections are rejected for:
  - a wrong token (HTTP 401),
  - a wrong cert fingerprint (TLS failure on the phone),
  - plain `ws://`,
  - a protocol mismatch (426).
  
  After 5 failed auths from one IP, that IP gets 401 for 15 min even with the right token, and the lockout check runs before the token compare. A stale phone (after Regenerate) stops retrying and shows "Re-pair needed" instead of hammering the server.
- [ ] The token is stored encrypted at rest on the desktop (`safeStorage`) and on the phone (Keystore AES-GCM, `allowBackup=false`), and never appears in logs. Connections and auth failures are logged with the IP.
- [ ] The phone lists every live and dormant agent with the same status as the desktop sidebar, updating within about 1s. When the desktop window is unavailable the list shows "desktop UI unavailable" instead of stale data.
- [ ] Opening an agent on the phone first resizes the PTY to the phone, then shows a clean screen (reset plus replay), then streams live with no lost or duplicated output. Typing, including Esc/Tab/Ctrl/arrows from the extra-keys bar, reaches the PTY. A PTY that exits shows its exit status and offers Resume.
- [ ] Spawn on a project/worktree, resume a dormant agent, and kill an agent work from the phone. The new agent appears in the desktop sidebar without stealing desktop focus, and the phone auto-attaches to a spawned agent at phone size.
- [ ] Changing font size, font family, theme or scrollback on the phone does not change the desktop, and the reverse. Phone settings survive an app restart. Pinch-to-zoom changes the phone font size and resizes the PTY.
- [ ] Resize ownership:
  - Opening or typing in an agent on the phone resizes the PTY to the phone.
  - Activating the agent or typing in it on the desktop restores the desktop size once, not on every keystroke.
  - An unchanged size sends no resize.
- [ ] Diff stat, the diff viewer, fetch and pull work from the phone for an agent's cwd.
- [ ] With the phone locked and the app backgrounded, an agent moving to `needs-input` raises an Android notification (also for agents already in needs-input at reconnect that were not yet notified). The notification is dismissed when the agent leaves needs-input. Tapping opens that agent's terminal, or the list if the agent is gone. While backgrounded the phone streams only `agents` frames, not PTY data.
- [ ] When the PC sleeps or the network drops, the phone shows "PC offline, reconnecting". Within about 60s it detects a half-open socket (25s ping) and reconnects with jittered backoff once the PC is back. The cert persists across desktop restarts, so no re-pair is needed.
- [ ] A PR touching `mobile/` runs the CI `mobile` job (tests plus debug APK artifact), and it is green. The root `test` job still passes after the new desktop dependencies.
- [ ] A `feat:`/`fix:` push to main produces **one** GitHub pre-release holding both the Windows installer and a signed `command-center-remote-<version>.apk`. That APK installs **over** the previous release (same key, higher versionCode). A `workflow_dispatch` with a lower version fails the android job.
- [x] `npm test`, `npm run typecheck`, `cd mobile && npm test`, `gradlew testDebugUnitTest assembleDebug` and `actionlint` all pass.

## Out of scope
- iOS, the Play Store, release signing beyond a single personal keystore.
- A cloud relay, FCM push, multiple users or multiple paired phones with separate tokens (one token shared by all paired devices).
- Running without the desktop app, Wake-on-LAN, and waking a sleeping PC.
- From the phone: creating/removing worktrees or workspaces, adding projects, opening VS/VS Code/Explorer, deleting branches.
- File browsing/editing on the phone.
- A server-side terminal emulator (xterm-headless) for perfect replay. Raw replay plus repaint on resize is enough for Claude's TUI.
- Upgrading existing CI action pins (`@v4`) beyond the jobs this plan touches. The runner forces them onto Node 24 and they keep working.

## Steps
- [x] Step 1: Add shared protocol fixtures `test/fixtures/remote-proto/*.json` (valid/invalid frames for every message type, an agents snapshot sequence with needs-input transitions, and a pairing payload) plus `ringbuffer.js`, with tests first. The ring buffer is a capped per-agent scrollback (default 512 KB): `append(data)` returns a monotonic seq, `snapshot()` returns `{data,lastSeq}`, and `clear()`. Truncation never splits a surrogate pair or an escape sequence (CSI/OSC) and advances to the next line boundary when possible. Add `ringbuffer.js` to `build.files` — files: ringbuffer.js, test/ringbuffer.test.js, test/fixtures/remote-proto/frames.json, test/fixtures/remote-proto/agents-sequence.json, test/fixtures/remote-proto/pairing.json, package.json — verify: `node --test test/ringbuffer.test.js`
  - note: cut at a safe boundary and prefix the replay with `ESC c` to reset stale SGR/charset state (terminal best practice: ttyd/xterm.js; best-practices research).
- [x] Step 2: Add `remoteauth.js` with tests first, and add it to `build.files`. It covers:
  - 32-byte token generation,
  - `checkBearer(header, token)` via `hookauth.secretMatches`,
  - a per-IP lockout (5 failures, then a 15 min block) whose `isLocked(ip)` is checked **before** the compare. The state is in-memory and resets on app restart, which is documented.
  - pairing payload encode/decode `{v:1,url,token,certSha256}` validated against `pairing.json`,
  - `normalizeFingerprint()` (strip colons, lowercase).
  
  files: remoteauth.js, test/remoteauth.test.js, package.json — verify: `node --test test/remoteauth.test.js`
  - note: Node `X509Certificate.fingerprint256` is uppercase colon-separated hex. The QR carries the normalized lowercase form, so both sides normalize (Node docs; framework research).
- [x] Step 3: Add `remoteproto.js`, an electron-free per-connection handler with injected dependencies (pty map, ring buffers, snapshot getter, `rpc(method,args)` returning a Promise, size-owner tracker, log). Tests first, driven by `frames.json`. Add it to `build.files`. Behavior:
  - It validates every frame and closes on the first malformed one.
  - `attach` resizes first, then in **one synchronous tick** takes a snapshot and subscribes, then sends `replay` followed by live `data` frames with `seq > lastSeq`.
  - `resize` is validated (integer 2–500) and sent only when the size differs, and it marks the owner as `remote`.
  - `input` is capped at 16 KB.
  - `exit` is forwarded.
  - An `rpc` error returns `{ok:false,error}`.
  
  files: remoteproto.js, test/remoteproto.test.js, package.json — verify: `node --test test/remoteproto.test.js`
- [x] Step 4: Add `remotecert.js` and `remoteserver.js`, plus a real WSS integration test.
  - **`remotecert.js`:** generates with `await selfsigned.generate()` (v5 is async-only): EC P-256, sha256, 10-year validity, SANs for the advertised host plus `localhost`/`127.0.0.1`. It persists cert and key in the given dir, loads them, and computes the fingerprint.
  - **`remoteserver.js`:** `https.createServer` plus `ws` `WebSocketServer({noServer:true, maxPayload: 256*1024})`.
    - The upgrade handler checks the lockout, the Bearer token and `x-cc-proto`, answering 401/426 before any upgrade.
    - A 25s ping/pong heartbeat terminates dead sockets.
    - A client with `bufferedAmount > 1 MB` is terminated.
    - It exposes `closeAll(code)`, `clients()` (ip, since) and `setSecureContext()` for cert rotation.
  - **Integration test:** runs on 127.0.0.1:0 with a `ws` client that pins the generated cert. It covers good token, bad token, lockout, proto mismatch, attach/replay/data ordering, and closeAll.
  - Add the `ws` and `selfsigned` dependencies and the new files to `build.files`. Make the CI `test` job run `npm ci --ignore-scripts` and scope `npm test` to `node --test test/` so `mobile/test` is not picked up.
  
  files: remotecert.js, remoteserver.js, test/remoteserver.test.js, package.json, package-lock.json, .github/workflows/ci.yml — verify: `npm test`
  - note: selfsigned 5.5.0 is CJS-compatible but `generate()` returns a Promise, and the `days` option was removed (use `notAfterDate`). ws 8.22: `verifyClient` is discouraged, so authenticate in the `'upgrade'` event (framework research).
  - note: a 10-year validity is fine because the phone pins the exact cert and skips expiry checks (best-practices research).
- [x] Step 5: Wire up main.
  - **Store:** `remote.json` in userData holds `enabled`, `port` (default 47820), `bindHost` (default `0.0.0.0`), `advertisedHost`, and the token encrypted with `safeStorage` after app ready. If encryption is unavailable, refuse to enable.
  - **Server lifecycle:** start or stop on config change, record listen errors in `status`, and run a heartbeat pass on `powerMonitor` `resume`.
  - **PTY output:** tee `term.onData` into the ring buffer and subscribers, and clear both on exit.
  - **Spawn:** `spawnAgent` accepts `opts.cols/rows`.
  - **`remote:agents` IPC:** receives the renderer snapshot `{seq,list}`, drops stale seqs, and marks `desktopUi:false` on renderer `did-start-loading`/destroyed.
  - **`remote:command`:** an invoke-style round trip to the renderer (reqId, 5s timeout, error when the window is gone). Remote spawn validates `dir` against the **saved projects/workspaces stores**, not `knownAgentDirs`.
  - **Shared handlers:** move the git diffstat/diff/fetch/pull, projects:list, workspaces:list and projects:worktrees handler bodies into named functions shared by IPC and the rpc table, keeping the guards.
  - **Size owner:** track the size owner per agent, and push `agent:sizeOwner` to the renderer.
  - **Settings IPC:** `remote:getConfig` (including status and clients), `remote:setConfig`, `remote:regenerate` (closeAll, then a new cert and token via `setSecureContext`) and `remote:disconnectAll`.
  - **Audit log:** connections and auth failures via `logger.js`, never the token.
  - **Plumbing:** update preload and types.
  
  files: main.js, preload.js, types/ipc.d.ts, types/electron.d.ts, package.json — verify: `npm test && npm run typecheck`
  - note: `safeStorage` uses DPAPI on Windows. Use it only after `app.whenReady()` and check `isEncryptionAvailable()` first. A listening socket survives sleep, but established sockets go half-open, so heartbeat on resume (framework research).
- [x] Step 6: Add renderer sync.
  - **Snapshot:** a pure `buildRemoteSnapshot(agents, dormant)` and `snapshotChanged(prev, next)` in `renderer/remote-sync.mjs`, tests first.
  - **Status events:** add an `onStatusChanged` pub/sub to `state.js`, fired by `setStatus`, so there is no import cycle.
  - **Pushing:** `remote-sync` subscribes to `onAgentsChanged` and `onStatusChanged`, debounces 150ms, and pushes only on change with an incrementing seq.
  - **Commands:** handle `remote:command`.
    - `spawn` calls `spawn(..., {background:true, cols, rows})`, which skips `activate` and returns `{id}`.
    - `resume` returns `{id}`.
    - `kill` calls `removeAgent` (same as desktop Close).
  - **Resize:** on `agent:sizeOwner` = remote, the next desktop activate or the first keystroke re-fits **once** and reclaims ownership.
  
  files: renderer/remote-sync.mjs, renderer/state.js, renderer/agents.js, renderer/agent-status.mjs, renderer/app.js, preload.js, types/ipc.d.ts, test/remote-sync.test.mjs — verify: `npm test && npm run typecheck`
- [x] Step 7: Add a desktop Settings "Remote access" section.
  - **Settings:** enable toggle, port, bind host, and an advertised host dropdown pre-filled from `os.networkInterfaces()` (Tailscale `100.64.0.0/10` first) with free text.
  - **Pairing QR:** rendered in main with `qrcode` as a data URL, keeping the CSP `script-src 'self'`. It is shown only on click.
  - **Status and controls:** a status line for listen errors and a firewall hint, a connected-devices list, Disconnect all, and Regenerate with a confirm.
  - **Inputs:** port must be an integer 1024–65535 and bindHost a valid IP.
  
  files: renderer/settings.js, renderer/index.html, renderer/style.css, main.js, preload.js, types/ipc.d.ts, package.json, package-lock.json — verify: `npm test && npm run typecheck`
- [x] Step 8: Scaffold `mobile/` with **Capacitor 8** (appId `com.olivier.commandcenter.remote`, Node 22, JDK 21). Plain ES modules in `mobile/www`, no bundler.
  - `scripts/copy-assets.mjs` copies xterm, addon-fit, `renderer/diff-parse.mjs` and `test/fixtures/remote-proto` into `www/vendor`.
  - Enable Kotlin with `apply plugin: 'kotlin-android'` and `kotlin { jvmToolchain(21) }`. The template already pins Kotlin 2.2.20.
  - Raise minSdk to 26 (barcode scanner).
  - Manifest: `allowBackup="false"`, a network security config with cleartext off, and Capacitor `server` with no remote navigation.
  - Gitignore `mobile/node_modules`, `www/vendor` and the android build dirs.
  
  files: mobile/package.json, mobile/package-lock.json, mobile/capacitor.config.json, mobile/scripts/copy-assets.mjs, mobile/www/**, mobile/android/**, mobile/.gitignore, .gitignore — verify: `cd mobile && npm run build && npx cap sync android && android\gradlew.bat -p android assembleDebug`
  - note: Capacitor 8.5.x is current (9 is alpha). The template uses AGP 8.13, Gradle 8.14.3, Kotlin 2.2.20, SDK 36 and minSdk 24. MainActivity stays Java. The 8.0 migration needs `density` in `configChanges` (Capacitor docs; framework research).
- [x] Step 9: Add APK versioning and signing.
  - **versionCode:** `mobile/scripts/version-code.mjs` maps semver to `major*10000 + minor*100 + patch` and rejects minor/patch ≥ 100. Tests come first.
  - **Version:** `app/build.gradle` reads `ccVersionName`/`ccVersionCode` via `providers.gradleProperty` (default `0.0.0`/1).
  - **Signing:** a `release` signingConfig from env `CC_KEYSTORE_PATH`, `CC_KEYSTORE_PASSWORD`, `CC_KEY_ALIAS` and `CC_KEY_PASSWORD`. The build stays unsigned when they are absent.
  
  files: mobile/scripts/version-code.mjs, mobile/test/version-code.test.mjs, mobile/android/app/build.gradle, mobile/package.json — verify: `cd mobile && npm test && android\gradlew.bat -p android assembleRelease`
- [x] Step 10: Add a CI `mobile` job to `ci.yml`.
  - **Setup:** ubuntu-latest, which preinstalls the SDK and build-tools 34–37. Current action majors: `actions/checkout@v7`, `actions/setup-node@v7` with Node 22 and the npm cache on `mobile/package-lock.json`, `actions/setup-java@v6` with Temurin 21, and `gradle/actions/setup-gradle@v6`.
  - **Run:** `npm ci`, `npm test`, `npm run build`, `npx cap sync android` and `./gradlew testDebugUnitTest assembleDebug`, then `actions/upload-artifact@v7` uploads the debug APK with 7-day retention. No secrets.
  - **Dependabot:** add the `mobile` npm and `mobile/android` gradle ecosystems.
  
  files: .github/workflows/ci.yml, .github/dependabot.yml — verify: `actionlint .github/workflows/ci.yml`
  - note: Node 20 was removed from runners on 2026-09-23, so new jobs use the v7/v6 action majors (GitHub changelog; Actions research). actionlint needs a one-time `winget install actionlint` locally. It catches more than `@action-validator/cli`, which only checks the schema.
- [x] Step 11: Restructure `release.yml` for two artifacts.
  - **`draft` job** (`needs: tag`): runs `gh release create "$TAG" --draft --prerelease --notes "$CHANGELOG"` with `GH_REPO` set, creating the draft **once**.
  - **Windows `build` job** (`needs: [tag, draft]`): replace softprops with `gh release upload "$TAG" dist/*.exe --clobber`.
  - **New `android` job** (`needs: [tag, draft]`):
    - Fail fast if keystore secrets are missing.
    - Decode `ANDROID_KEYSTORE_BASE64` to `$RUNNER_TEMP`.
    - Compute versionCode, and **fail if it is ≤ the versionCode of the highest existing release tag**.
    - Sync the `mobile/package.json` version.
    - Run `assembleRelease -PccVersionName -PccVersionCode`.
    - Check the signature with `apksigner verify --print-certs` (build-tools resolved via `ls $ANDROID_SDK_ROOT/build-tools | sort -V | tail -1`).
    - Upload `command-center-remote-<version>.apk` with `--clobber`.
    - Delete the keystore in an `if: always()` step.
  - **`publish` job** (`needs: [tag, build, android]`, no checkout): runs `gh release edit --draft=false --prerelease` with `GH_REPO`.
  - Add `mobile/test/**` and `mobile/**/*.md` to `paths-ignore`.
  
  files: .github/workflows/release.yml — verify: `actionlint .github/workflows/release.yml`
  - note: parallel `softprops/action-gh-release` calls on one tag can create duplicate drafts (softprops issue #602). Without a checkout, `gh` needs `GH_REPO`. Immutable releases lock assets on publish, so publish must come last (Actions research).
- [x] Step 12: Add the WebView client protocol module `mobile/www/js/proto.mjs`, with tests first, driven by the vendored `frames.json`/`agents-sequence.json`. It provides:
  - message builders,
  - an agents-state reducer (dropping stale `seq`, handling the `desktopUi` flag),
  - rpc correlation (reqId, 10s timeout),
  - a per-terminal stream state (on `replay`, reset and write; drop `data` with `seq ≤ lastSeq`).
  
  No needs-input detection here; that is native. files: mobile/www/js/proto.mjs, mobile/test/proto.test.mjs — verify: `cd mobile && npm test`
- [x] Step 13: Add native cert pinning.
  - **`CertPin.kt`:** parses and normalizes the QR fingerprint and compares bytes with `MessageDigest.isEqual`.
  - **`PinTrustManager`:** hashes the leaf's DER bytes, throws on an empty chain or a mismatch, and throws in `checkClientTrusted`.
  - **`PinnedSocket.kt`:** a dedicated `OkHttpClient` with `sslSocketFactory(ctx, tm)`, a hostname verifier that returns true (safe **only** because the pin is the sole trust path), `pingInterval(25s)` and `readTimeout(0)`. The upgrade request carries the `Authorization` and `x-cc-proto` headers.
  - **JVM tests first:** a MockWebServer plus `HeldCertificate` checks that the pinned cert connects and that a different cert and a CA-trusted unpinned cert both fail. The Node-generated fixture cert (`test/fixtures/remote-proto/cert.pem` plus its fingerprint, committed by this step via a `remotecert.js` script) passes `CertPin`.
  - **Dependencies:** okhttp, okhttp-tls, mockwebserver3 and `org.json` (the JVM test stub returns defaults otherwise). Test resources point at `../../../test/fixtures/remote-proto`.
  
  files: mobile/android/app/build.gradle, mobile/android/app/src/main/java/com/olivier/commandcenter/remote/CertPin.kt, mobile/android/app/src/main/java/com/olivier/commandcenter/remote/PinnedSocket.kt, mobile/android/app/src/test/java/com/olivier/commandcenter/remote/CertPinTest.kt, mobile/android/app/src/test/java/com/olivier/commandcenter/remote/PinnedSocketTest.kt, scripts/make-fixture-cert.js, test/fixtures/remote-proto/cert.pem, test/fixtures/remote-proto/cert.json — verify: `mobile\android\gradlew.bat -p mobile/android testDebugUnitTest`
  - note: `CertificatePinner` is the wrong tool, because chain validation fails first for a self-signed leaf. Use a custom `X509TrustManager` and never a trust-all one on a shared client. The mockwebserver3 WebSocket API differs from mockwebserver (best-practices research; Android SSL docs).
- [x] Step 14: Add the connection state machine and needs-input detection as pure Kotlin, with tests first, driven by `agents-sequence.json`.
  - **`ConnState`** has the states Idle, Connecting, Connected, Offline(retryIn) and AuthFailed. It uses full-jitter backoff (base 1s, cap 30s, reset after 10s connected) with an injectable clock and random source, and a generation counter so `onFailure` and `onClosed` never both reconnect.
    - A 401 response, a 426, close code 4001 or 4002, or an `SSLPeerUnverifiedException`/`SSLHandshakeException` leads to AuthFailed with **no retry**.
    - Close code 4003 leads to a Kicked state: no auto-retry, and a manual Reconnect reuses the stored pairing.
    - Classify failures by walking the **whole cause and suppressed chain**. With a multi-address host (DDNS, `localhost`), OkHttp tries the next route after a TLS rejection and reports that route's `ConnectException`, with the `SSLException` only in `suppressed` (found in step 13). A pin mismatch must never be classified as Offline.
    - Any other IOException or close code 1001/1006/1011/1012/1013 leads to Offline.
  - **`NeedsInput`** compares the previous and next snapshots and returns `{notify:[ids], dismiss:[ids]}`. On the first snapshot after a (re)connect it notifies only ids not already notified in this service lifetime.
  
  files: mobile/android/app/src/main/java/com/olivier/commandcenter/remote/ConnState.kt, mobile/android/app/src/main/java/com/olivier/commandcenter/remote/NeedsInput.kt, mobile/android/app/src/test/java/com/olivier/commandcenter/remote/ConnStateTest.kt, mobile/android/app/src/test/java/com/olivier/commandcenter/remote/NeedsInputTest.kt — verify: `mobile\android\gradlew.bat -p mobile/android testDebugUnitTest`
- [x] Step 15: Add the native foreground service and bridge.
  - **`CredStore.kt`:** an Android Keystore AES-256-GCM key, with IV plus ciphertext in SharedPreferences. Methods: `save`, `load` and `clear`.
  - **`RemoteService.kt`:** started from the UI while the app is visible, with `startForeground(..., FOREGROUND_SERVICE_TYPE_SPECIAL_USE)`.
    - It owns `PinnedSocket`, driven by `ConnState`.
    - It reconnects right away on `ConnectivityManager.NetworkCallback.onAvailable`.
    - It runs `NeedsInput` on `agents` frames, posting or cancelling high-priority notifications on a dedicated channel. The tap intent carries the agentId.
    - AuthFailed posts a "Re-pair needed" notification and stops.
    - It forwards frames to the plugin through a process-singleton bus.
  - **`RemoteLinkPlugin.kt`:** `@CapacitorPlugin`, registered in `MainActivity` **before** `super.onCreate`.
    - Methods: `connect({url,token,certSha256})` (saves to `CredStore`), `connect()` (from the store), `disconnect`, `unpair`, `send` and `getState`.
    - Events: `message`, `state` and `notificationTap` (with `retainUntilConsumed=true`).
    - It requests `POST_NOTIFICATIONS` at runtime and the battery-optimisation exemption.
  - **Manifest:** permissions INTERNET, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE, POST_NOTIFICATIONS and REQUEST_IGNORE_BATTERY_OPTIMIZATIONS. The service declares `foregroundServiceType="specialUse"` and a `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` property.
  
  files: mobile/android/app/src/main/AndroidManifest.xml, mobile/android/app/src/main/java/com/olivier/commandcenter/remote/CredStore.kt, mobile/android/app/src/main/java/com/olivier/commandcenter/remote/RemoteService.kt, mobile/android/app/src/main/java/com/olivier/commandcenter/remote/EventBus.kt, mobile/android/app/src/main/java/com/olivier/commandcenter/remote/RemoteLinkPlugin.kt, mobile/android/app/src/main/java/com/olivier/commandcenter/remote/MainActivity.java, mobile/www/js/remote-link.mjs — verify: `mobile\android\gradlew.bat -p mobile/android testDebugUnitTest assembleDebug`
  - note: `specialUse` has no runtime cap, while `dataSync` is capped at 6h/24h on Android 15+. An FGS can't be started from the background on Android 12+. `EncryptedSharedPreferences` is deprecated, so use direct Keystore AES-GCM (Android FGS docs; framework research).
- [x] Step 16: Add pairing.
  - **Scanning:** `@capacitor/barcode-scanner` with the ZXING engine, which works without Play services.
  - **Parsing:** `pairing.mjs` parses and validates the payload against the vendored `pairing.json` (tests first) and passes it straight to `RemoteLink.connect(...)`. The token is never kept in WebView storage.
  - **Screens:** a paired-state screen with Unpair, and a "Re-pair needed" state that leads to the scanner.
  - **Manifest:** verify CAMERA in the merged manifest, and add it if missing.
  
  files: mobile/www/js/pairing.mjs, mobile/test/pairing.test.mjs, mobile/www/js/app.mjs, mobile/www/index.html, mobile/package.json, mobile/package-lock.json, mobile/android/app/src/main/AndroidManifest.xml — verify: `cd mobile && npm test && npm run build && npx cap sync android && android\gradlew.bat -p android assembleDebug`
- [x] Step 17: Add the agent list screen.
  - **List:** rows grouped by project with status dots, a dormant section with Resume, and Close with a confirm that reads "a session that was used stays resumable".
  - **New agent sheet:** projects/workspaces, then worktree, then spawn with the current phone cols/rows, then auto-attach to the returned id.
  - **Banners:** "PC offline, reconnecting" and "desktop UI unavailable".
  - **Backgrounding:** on App `pause`, detach all terminals.
  - `list-model.mjs` (grouping, sorting, banner state) gets tests first.
  
  files: mobile/www/js/list.mjs, mobile/www/js/list-model.mjs, mobile/test/list-model.test.mjs, mobile/www/js/app.mjs, mobile/www/index.html, mobile/www/style.css — verify: `cd mobile && npm test && npm run build`
- [x] Step 18: Add phone terminal settings. `term-settings.mjs` holds:
  - defaults: fontSize 11, fontFamily `monospace`, theme `system`, scrollback 5000,
  - clamping: fontSize 8–24, scrollback 500–20000,
  - load/save to localStorage with a corrupt-JSON fallback,
  - a theme resolver,
  - dark/light palettes.
  
  Tests come first. Add a Settings screen to edit them. files: mobile/www/js/term-settings.mjs, mobile/test/term-settings.test.mjs, mobile/www/js/settings-screen.mjs, mobile/www/js/app.mjs, mobile/www/index.html, mobile/www/style.css — verify: `cd mobile && npm test && npm run build`
- [x] Step 19: Add the terminal screen.
  - **xterm:** built from `term-settings`, with changes applied live.
  - **Attach:** sends `attach{id,cols,rows}`, then on `replay` runs `term.reset()` and writes, then streams. On reconnect it re-attaches automatically.
  - **Resize:** fit on orientation change and pinch (pinch adjusts and persists fontSize). Send `resize` only when cols/rows change.
  - **Exit:** an `exit` frame shows a banner with Resume.
  - **Extra keys:** Esc, Tab, Ctrl latch, arrows, Enter and Shift+Tab.
  - `keys.mjs` and `pinch.mjs` get tests first.
  
  files: mobile/www/js/terminal.mjs, mobile/www/js/keys.mjs, mobile/www/js/pinch.mjs, mobile/test/keys.test.mjs, mobile/test/pinch.test.mjs, mobile/www/js/app.mjs, mobile/www/style.css — verify: `cd mobile && npm test && npm run build`
- [x] Step 20: Add the git screen for an agent's cwd: a diff stat list, a diff view with the vendored `diff-parse.mjs`, and Fetch/Pull with result toasts. A pure `git-model.mjs` (stat summary, file grouping, result-to-toast mapping) gets tests first — files: mobile/www/js/git.mjs, mobile/www/js/git-model.mjs, mobile/test/git-model.test.mjs, mobile/www/js/app.mjs, mobile/www/style.css — verify: `cd mobile && npm test && npm run build && npx cap sync android && android\gradlew.bat -p android assembleDebug`
- [x] Step 21: Write the docs.
  - **README "Remote access":**
    - Tailscale (recommended) vs port forward, the advertised host, and the Windows Firewall prompt.
    - Pairing, Regenerate/revoke, and the security model, including the bypass warning and that a leaked QR equals full access.
  - **mobile/README:**
    - Sideloading the release APK. The CI debug APK can't install over a release one.
    - JAVA_HOME and JDK 21.
    - Keystore setup: `keytool -genkeypair`, base64 into the 4 secrets, and an offline backup.
    - An on-device acceptance checklist mirroring the success criteria.
  - **SECURITY:** the remote attack surface.
  
  files: README.md, mobile/README.md, SECURITY.md — verify: `grep -q "## Remote access" README.md && grep -q "sideload" mobile/README.md && grep -q "keytool" mobile/README.md`

## Risks
- **The port forward exposes a shell-capable server to the internet.**
  - Mitigations:
    - Off by default and TLS only.
    - Auth at upgrade, so no unauthenticated sockets exist.
    - A 256-bit token with timing-safe compare.
    - A per-IP lockout checked before the compare.
    - maxPayload, an input cap and a bufferedAmount cap.
    - An audit log, a connected-devices view and Regenerate.
  - The lockout is in-memory, so an app restart resets it. That is accepted and documented.
  - The README recommends Tailscale.
- **Phone spawns follow the desktop bypass setting (user choice).** If the token leaks while bypass is on, an attacker gets unattended code execution with no permission prompts, and needs-input alerts never fire for those agents. Mitigations: the README warns about this, and the Settings remote section shows an explicit "bypass is ON: phone spawns skip permissions" notice.
- **A leaked QR (screenshot) equals full access.** Mitigation: shown only on click, and Regenerate rotates token and cert.
- **A stale phone locks itself out.** Mitigation: a 401 or 4001 is terminal in `ConnState`, so no retry happens. Without that, its own retries would burn the 5-failure budget and block the IP for 15 min.
- Self-signed TLS is rejected by the WebView. Mitigation: the socket is native (OkHttp in the service) with an explicit pin.
- **A changed IP or advertised host breaks the QR URL.** Mitigation: the Tailscale IP is stable, the README recommends it, and re-pairing keeps the same cert.
- Phone and desktop fight over PTY size. Mitigations: last-active-client wins, a resize is sent only on an owner change or a size difference, and the desktop reclaims once (on activate or first keystroke), not on every keystroke.
- **Raw replay is drawn at the old cols.** Mitigation: resize before replay so Claude repaints on SIGWINCH. Line-oriented output may still re-wrap oddly, which is accepted. A headless emulator is out of scope.
- Scrollback replay comes from the desktop ring buffer, and the phone `scrollback` setting caps only what the phone keeps afterwards.
- **The renderer is reloading or closed.** Mitigations: `desktopUi:false` in snapshots, and `remote:command` returns an error after 5s. When the window closes, the app quits (`window-all-closed`, `main.js:898`), and the phone shows the PC as offline.
- **Doze and OEM battery killers.**
  - Mitigations: a `specialUse` FGS plus the battery-optimisation exemption.
  - In deep Doze the socket can still stall for minutes on aggressive OEMs. That is accepted for v1, since FCM is out of scope.
- **Cellular data use.** Mitigation: when backgrounded, the phone detaches terminals, so only `agents` snapshots flow.
- Concurrent typing on desktop and phone interleaves into one PTY. That is accepted and documented.
- **The selfsigned v5 API differs from older tutorials** (async, no `days` option). Mitigation: step 4 note, and the integration test exercises real generation.
- **The CI root `test` job assumed no dependencies.** Mitigation: step 4 adds `npm ci --ignore-scripts` (which skips the electron download and the node-pty build) and scopes tests to `test/`.
- **Losing the release keystore means no more in-place updates.** Mitigation: an offline backup (step 21). The keystore is never committed.
- **Keystore secrets on a public repo.** Mitigations: used only in `release.yml` (push to main and `workflow_dispatch`, never `pull_request`), decoded to `$RUNNER_TEMP`, and deleted with `always()`.
- **A failed android job blocks the desktop release** (publish waits on both). The tag and draft are left behind. Re-running the failed job finishes the release. Pushing a fix instead produces the next version, and the orphan draft must be deleted by hand. That is accepted and documented.
- versionCode caps minor/patch at 99, and a lower dispatch version fails the job. Both are by design.
- Java is not on PATH. Mitigation: the verify commands assume `JAVA_HOME=C:\Program Files\Android\Android Studio\jbr` (step 21 docs). actionlint is installed via winget.
- Research items marked "from memory" by the researchers (the OkHttp mockwebserver3 WebSocket API, WebView TLS behaviour for WebSockets, and `EncryptedSharedPreferences` deprecation status) must be spot-checked when their step starts.

- **Dev and the installed app share one userData folder** (`%APPDATA%claude-command-center`) and one single-instance lock, so a dev launch exits silently while the installed app runs, and anything written to dev userData lands in the real profile. Mitigation: smoke runs use `--user-data-dir=<scratch>`, documented in step 21.

## Log
<!-- appended by /workflow:work: one entry per completed step -->
- 2026-10-02 Step 1 — done
  red: Error: Cannot find module '../ringbuffer'
  green: test/ringbuffer.test.js ℹ pass 11 ℹ fail 0; full suite ℹ pass 93 ℹ fail 0
  verify: node --test test/ringbuffer.test.js → exit 0
  learning: Bash tool mangles backslashes in heredocs/inline scripts on this machine — write JSON with Windows paths via Write/Edit tools, not shell. Pairing encoding fixed as ccr1:+base64url(JSON). agents-sequence semantics: notified set = currently-shown notifications (cleared on leave), so re-entry notifies again and reconnect does not re-notify.
- 2026-10-02 Step 2 — done
  red: Error: Cannot find module '../remoteauth'
  green: test/remoteauth.test.js ℹ pass 26 ℹ fail 0 (incl. every pairing.json valid/invalid case)
  verify: node --test test/remoteauth.test.js → exit 0
  learning: lockout map bounded (maxEntries, prune then evict oldest) so spoofed-IP floods cannot grow memory; checkBearer refuses when no token configured.
- 2026-10-02 Step 3 — done
  red: Error: Cannot find module '../remoteproto'
  green: test/remoteproto.test.js ℹ pass 57 ℹ fail 0 (all frames.json valid/invalid + handler behaviour)
  verify: node --test test/remoteproto.test.js → exit 0
  learning: handler deps = send/close/hub(EventEmitter data|exit|agents)/hasPty/getBuffer/writeInput/resize(id,cols,rows,owner)/sizeOwner/getAgents/rpc/log — step 5 must publish data as hub.emit('data', id, buffer.append(data), data). Input only accepted for attached agents; attach to non-live agent answers exit{error}. createSizeTracker exported for main.
- 2026-10-02 Step 4 — done
  red: Error: Cannot find module '../remotecert'
  green: test/remoteserver.test.js ℹ pass 15 ℹ fail 0; npm test ℹ pass 191 ℹ fail 0
  verify: npm test → exit 0
  learning: DEVIATION (minor) — `node --test test/` fails on Node 24 (dir treated as file), so test script is `node --test "test/**/*.test.{js,mjs}"`; globs need Node >= 21, so CI test job moved Node 20 -> 22 (+ npm ci --ignore-scripts). README Testing section ("no npm install needed") is now stale — fix in step 21. createRemoteServer API: {cert,key,getToken,lockout,createHandler({send,close,ip}),log,heartbeatMs,maxBuffered,maxPayload} -> {listen,close,closeAll,clients,setSecureContext,heartbeat}. Cert files remote-cert.pem / remote-key.pem (0600). npm audit --omit=dev: 0 vulnerabilities.
- 2026-10-02 Step 5 — done
  red: n/a — main.js is electron-bound glue with no unit harness (as the plan notes); covered by the step 3/4 module tests
  green: npm test ℹ pass 191 ℹ fail 0; npm run typecheck exit 0; node --check main.js ok
  verify: npm test && npm run typecheck → exit 0
  learning: ADDITION — close code 4003 (Disconnect all, kicked) added to protocol + step 14 so a kick does not show "re-pair needed". Main owns the outgoing agents seq (monotonic across renderer reloads); renderer seq only drops out-of-order pushes. Remote spawn validated against saved project/workspace roots + registered worktrees (not knownAgentDirs). Not yet exercised live — smoke-run the app after step 7.
- 2026-10-02 Step 6 — done
  red: ERR_MODULE_NOT_FOUND renderer/remote-sync.mjs
  green: test/remote-sync.test.mjs ℹ pass 6 ℹ fail 0; npm test ℹ pass 197 ℹ fail 0; typecheck exit 0
  verify: npm test && npm run typecheck → exit 0
  learning: CORRECTION — desktop Close is removeAgent (keeps used sessions dormant), not killAndWait; phone kill now matches it and plan decision/steps updated. remote-sync.mjs kept pure (no state.js import) and wiring lives in agents.js, matching tui-signals.mjs. setStatus fires onStatusChanged only on an actual change. Background spawn relies on inactive .term being display:none so refit is skipped until the desktop activates it.
- 2026-10-02 Step 7 — done
  red: n/a — DOM/IPC UI glue with no unit harness
  green: npm test ℹ pass 197 ℹ fail 0; typecheck exit 0; npm audit --omit=dev: 0 vulnerabilities
  verify: npm test && npm run typecheck → exit 0
  smoke (live dev app, isolated --user-data-dir, remote on 127.0.0.1:47899): "remote access listening"; bad token HTTP 401 (logged with IP); no token 401; plain HTTPS GET 426; unpinned client rejected DEPTH_ZERO_SELF_SIGNED_CERT; plain ws:// rejected; tokenEnc encrypted (not plaintext hex). Not exercised live: authenticated session (token is DPAPI-encrypted), QR rendering, renderer snapshot/commands.
  learning: EXTRA FILES — renderer/dom.js (element refs convention) + CSP img-src data: (QR image). Dev and installed app share userData + single-instance lock: first smoke attempt exited silently and wrote remote.json into the real profile — removed immediately; reran with --user-data-dir. Risk added.
- 2026-10-02 Step 8 — done
  red: n/a — scaffold step
  green: npm run build "copied 4 files to www/vendor"; cap sync ok; gradlew assembleDebug "BUILD SUCCESSFUL in 2m 17s" (app-debug.apk)
  verify: cd mobile && npm run build && npx cap sync android && androidgradlew.bat -p android assembleDebug → exit 0 (JAVA_HOME=Android Studio jbr 21.0.9, ANDROID_HOME=%LOCALAPPDATA%AndroidSdk)
  learning: Capacitor 8.5.2 template did NOT pin Kotlin (research was wrong) — added kotlin-gradle-plugin 2.2.20 classpath + kotlin-android + jvmToolchain(21). MainActivity lives at com/olivier/commandcenter/remote/ (plan paths fixed, 1 refs). Fixtures are NOT vendored into www (no test data shipped in the APK); mobile tests read ../test/fixtures directly. Root .gitignore untouched — mobile/.gitignore + generated android/.gitignore cover it. Manifest: allowBackup=false + data_extraction_rules + network_security_config (cleartext off). OWASP dependency-check not configured in project — skipped.
- 2026-10-02 Step 9 — done
  red: ERR_MODULE_NOT_FOUND mobile/scripts/version-code.mjs
  green: mobile npm test ℹ pass 6 ℹ fail 0; assembleRelease BUILD SUCCESSFUL (unsigned, aapt2: versionCode=10203 versionName=1.2.3); signed with throwaway keystore -> apksigner verify OK (CN=throwaway), keystore deleted
  verify: cd mobile && npm test && androidgradlew.bat -p android assembleRelease → exit 0
  learning: Android max versionCode 2100000000 is inclusive. version-code.mjs doubles as CLI for the release workflow (exit 1 + message on invalid). Signing only applied when CC_KEYSTORE_PATH exists, so local release builds stay unsigned.
- 2026-10-02 Step 10 — done
  red: n/a — workflow config
  green: actionlint 1.7.12 on ci.yml exit 0 (baseline on all 3 workflows was clean); gh api confirms checkout v7.0.1, setup-node v7.0.0, setup-java v6.0.1, gradle/actions v6.4.0, upload-artifact v7.0.1
  verify: actionlint .github/workflows/ci.yml → exit 0 (binary from rhysd/actionlint GitHub release into scratchpad; Docker daemon not running, nothing installed system-wide)
  learning: DEVIATION — .github/dependabot.yml NOT created: repo has none; GitHub security alerts already scan mobile/package-lock.json, and a dependabot.yml would switch on scheduled version-update PRs (repo behaviour change) — left for the user to decide. gradlew chmod +x in the job since the Windows-generated file may lack the exec bit in git. Real proof is the first Actions run.
- 2026-10-02 Step 11 — done
  red: n/a — workflow config
  green: actionlint on all workflows exit 0; versionCode guard dry-run: v0.3.0 ok (300>200), v0.1.5 FAIL (105<=200), junk tags skipped, first release ok
  verify: actionlint .github/workflows/release.yml → exit 0
  learning: draft job uses gh release create --verify-tag --notes-file (changelog via env, no inline expression in run:). All run: steps take workflow values through env vars, not ${{ }} interpolation (script-injection hygiene). mobile/**/*.md already covered by existing **/*.md ignore; only mobile/test/** added. True verification = first real release run; it will fail fast until the 4 ANDROID_* secrets exist (step 21 documents setup).
- 2026-10-02 Step 12 — done
  red: ERR_MODULE_NOT_FOUND mobile/www/js/proto.mjs
  green: mobile npm test ℹ pass 27 ℹ fail 0 (21 new: builders deep-equal desktop-accepted fixture frames, all serverToClient fixtures parse, agents state, rpc, stream)
  verify: cd mobile && npm test → exit 0
  learning: agents state needs reset() on every (re)connect — main's seq restarts at 1 when the desktop app restarts, so without it the phone would drop all snapshots after a PC restart. Builders clamp/floor sizes into 2..500 so a phone fit result can never produce a frame the desktop rejects (which would close the connection).
- 2026-10-02 Step 13 — done
  red: e: Unresolved reference 'CertPin' (after fixing an OkHttp/compileSdk mismatch)
  green: gradlew testDebugUnitTest BUILD SUCCESSFUL — CertPinTest 5/5, PinnedSocketTest 4/4 (pinned self-signed opens + sends Authorization/x-cc-proto; different cert -> SSLException; CA-signed leaf with only CA pinned -> SSLException; ping 25s / readTimeout 0)
  verify: mobileandroidgradlew.bat -p mobile/android testDebugUnitTest → exit 0
  learning: OkHttp 5.5.0 okhttp-android requires compileSdk 37 but Capacitor 8/AGP 8.13 max is 36 -> pinned 5.4.0 (minCompileSdk 36), checked via AAR metadata. mockwebserver3 5.x API verified from sources jar: MockResponse.Builder().webSocketUpgrade(listener). Cross-impl contract proven: Kotlin SHA-256 of a cert from the desktop remotecert.js equals the Node pin (scripts/make-fixture-cert.js -> test/fixtures/remote-proto/cert.pem+cert.json). Multi-route hosts hide TLS failures in suppressed — added to step 14.
- 2026-10-02 Step 14 — done
  red: e: Unresolved reference 'Failure' / 'Failures'
  green: gradlew testDebugUnitTest BUILD SUCCESSFUL — ConnStateTest 11/11, NeedsInputTest 3/3 (whole agents-sequence.json fixture), CertPin 5/5, PinnedSocket 4/4
  verify: mobileandroidgradlew.bat -p mobile/android testDebugUnitTest → exit 0
  learning: NeedsInput reduces to one set rule (notify needing−shown, dismiss shown−needing); the fixture's connected flag is not needed by the detector. Failures.of walks cause+suppressed for any SSLException (multi-route case). generation++ on every handled failure makes OkHttp's onFailure+onClosed pair count once. Bash heredocs with apostrophes break in this tool — use Write for source files.
- 2026-10-02 Step 15 — done
  red: n/a — Android-bound service/plugin glue (pure logic already tested in steps 13/14)
  green: gradlew testDebugUnitTest assembleDebug BUILD SUCCESSFUL; lintDebug 0 errors (warnings: BatteryLife=Play-only/accepted, CustomX509TrustManager=intentional strict pin, ManifestOrder=template, UseKtx=style)
  verify: mobileandroidgradlew.bat -p mobile/android testDebugUnitTest assembleDebug → exit 0
  learning: EXTRA FILES — mobile/scripts/copy-assets.mjs + www/index.html now vendor @capacitor/core dist/capacitor.js: registerPlugin lives there, not in the native bridge, and there is no bundler. Added ACCESS_NETWORK_STATE (needed for registerDefaultNetworkCallback). Notification taps: Plugin.handleOnNewIntent (warm) + launch intent in load() (cold), retainUntilConsumed. All OkHttp callbacks posted to the main looper so ConnState is single-threaded. NOT run on a device/emulator yet.
- 2026-10-02 Step 16 — done
  red: ERR_MODULE_NOT_FOUND mobile/www/js/pairing.mjs
  green: mobile npm test ℹ pass 43 ℹ fail 0 (every pairing.json valid/invalid case — same fixture as desktop remoteauth); cap sync found @capacitor/barcode-scanner@3.1.2; assembleDebug BUILD SUCCESSFUL
  verify: cd mobile && npm test && npm run build && npx cap sync android && androidgradlew.bat -p android assembleDebug → exit 0
  learning: merged manifest already has android.permission.CAMERA (via the scanner's OutSystems lib) — no manifest edit needed. Scanner called via window.Capacitor.registerPlugin('CapacitorBarcodeScanner'), hint QR_CODE=0, zxing (no Play services). EXTRA FILE www/js/dom.mjs (h() helper) + style.css base. app.mjs owns ctx (agents/rpc/link) + screen router for later steps. Boot does not auto-reconnect after a kick. NOT run on a device yet.
- 2026-10-02 Step 17 — done
  red: ERR_MODULE_NOT_FOUND mobile/www/js/list-model.mjs
  green: mobile npm test ℹ pass 51 ℹ fail 0 (8 new list-model tests); npm run build ok; node --check on all www/js
  verify: cd mobile && npm test && npm run build → exit 0
  learning: EXTRA FILE www/js/core.mjs (ctx/screens/show) — screens importing app.mjs while app.mjs imports them would hit ESM TDZ at evaluation; core.mjs breaks the cycle. MOVED: detach-on-background goes to the terminal screen (step 19) where attachments live. Spawn/resume send an estimated phone size (estimateTermSize) because no terminal exists yet; the terminal screen refines it on attach. Unpair moves to the settings screen (step 18). UI not yet rendered in a browser/device.
- 2026-10-02 Step 18 — done
  red: ERR_MODULE_NOT_FOUND mobile/www/js/term-settings.mjs
  green: mobile npm test ℹ pass 59 ℹ fail 0 (8 new: defaults, clamping, theme resolve, palettes, xtermOptions, store persist/corrupt/subscribe/throwing-storage); build ok
  verify: cd mobile && npm test && npm run build → exit 0
  learning: settings modelled as createSettingsStore(storage) (get/update/subscribe) so live terminal updates are testable without globals; the singleton lives in settings-screen.mjs (termSettings). Palettes copied from the desktop (Campbell / One Half Light). Settings screen also hosts Disconnect/Reconnect, battery exemption and Unpair (moved from the old home screen).
- 2026-10-02 Step 19 — done
  red: ERR_MODULE_NOT_FOUND keys.mjs / pinch.mjs
  green: mobile npm test ℹ pass 69 ℹ fail 0 (10 new: key sequences incl. app-cursor SS3 + ESC CR newline, ctrl latch, pinch clamping); build ok
  verify: cd mobile && npm test && npm run build → exit 0
  learning: extra keys use pointerdown+preventDefault so the soft keyboard stays open. Arrows honour term.modes.applicationCursorKeysMode. Detach on visibilitychange hidden / re-attach (fresh replay) on visible — covers the step 17 background item. Resize sent only when cols/rows change. Pinch previews live and persists to termSettings on touchend. UI not yet rendered — browser smoke planned after step 20.
- 2026-10-02 Step 20 — done
  red: ERR_MODULE_NOT_FOUND mobile/www/js/git-model.mjs
  green: mobile npm test ℹ pass 73 ℹ fail 0 (4 new git-model tests over real parseDiff output); assembleDebug BUILD SUCCESSFUL
  verify: cd mobile && npm test && npm run build && npx cap sync android && androidgradlew.bat -p android assembleDebug → exit 0
  browser UI smoke (Playwright, 390x844, www served with a mocked native bridge): FOUND+FIXED a real bug — el.replaceChildren does not flatten arrays / skip null, so the list rendered "null[object HTMLElement]"; added dom.fill() and used it at the 3 affected sites. Then verified: list groups/dots/needs-input highlight/Resume; New agent sheet -> worktrees (main first) -> spawn(est. 57x56) -> attach(fit 61x57) -> replay + live data rendered; Ctrl latch+c sends  and releases; Esc/up/newline(ESC CR)/Shift-Tab sequences; exit banner blocks input + Resume re-attaches; landscape sends exactly one resize (137x22); hidden->detach, visible->attach; git stat + expandable colored diff + Pull error toast; settings clamp 30->24 persisted to localStorage; unpaired boot shows pairing screen. Smoke server stopped, screenshots removed.
- 2026-10-02 Step 21 — done
  red: n/a — docs
  green: grep checks pass; README anchors/links resolve
  verify: grep -q "## Remote access" README.md && grep -q "sideload" mobile/README.md && grep -q "keytool" mobile/README.md → exit 0
  learning: also fixed the stale README Testing section (step 4 note), documented the shared dev/installed userData + --user-data-dir smoke workflow (step 7 risk), the OkHttp 5.4.0 pin, and that release secrets must exist before the next feat:/fix: merge. SECURITY.md scope gained the remote server + phone app.
