# Task T01: Stigmer Desktop App — Design & Task Plan

**Created**: 2026-04-23
**Status**: PENDING REVIEW
**Type**: Feature Development

## Objective

Build a Stigmer Desktop application using Tauri 2.x that provides the **full web console experience** natively on macOS, Linux, and Windows — plus native OS integration that a browser cannot offer: `stigmer://` URL scheme handling, system tray with runner status, background runner process management, and auto-updates.

## Why Tauri (not Electron)

| | Tauri 2.x | Electron |
|---|---|---|
| Binary size | ~10–15 MB | ~150+ MB |
| Memory usage | Low (native webview) | High (ships Chromium) |
| URL scheme handling | Built-in `bundle.protocols` | Manual, platform-specific |
| System tray | Built-in plugin | Third-party library |
| Auto-updater | Built-in plugin | electron-updater |
| Sidecar bundling | Built-in `bundle.externalBin` | Manual packaging |
| Security model | Rust process isolation | Less isolated |

Tauri is the right fit: small, native, and has built-in support for every OS integration we need.

## Why no new SDK is needed

The desktop app is a **React web frontend running in a Tauri native shell**:

- **UI layer**: `@stigmer/react` SDK — all components already exist (SessionComposer, RunnerPicker, RunnerListPanel, AgentBuilder, Settings panels, etc.)
- **Data layer**: `@stigmer/typescript` SDK — all API clients already exist (gRPC-web, REST, streaming)
- **Native layer**: Tauri Rust backend — handles OS integration (tray, URL scheme, sidecar, notifications)
- **Runner management**: Go CLI binary bundled as Tauri sidecar — manages agent-runner Python processes

The React SDK was designed for embedding (headless-first, theme-token-based styling). The desktop app is just another consumer, like the web console.

## What already exists (reusable)

- `sdk/react/` — Full component library: sessions, agents, runners, settings, composer, models, etc.
- `sdk/typescript/` — Full API client: all resource CRUD, streaming, auth
- `client-apps/web/` — Reference implementation for page routing, layout, settings structure
- `client-apps/cli/` — Runner lifecycle management (start, stop, state, Docker), Go binary
- `apis/` — All proto definitions and generated stubs

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Tauri Shell (Rust)                             │
│  ┌───────────────┬──────────────────────────┐   │
│  │ System Tray   │ URL Scheme Handler       │   │
│  │ Runner status │ stigmer:// → webview     │   │
│  │ Quick actions │                          │   │
│  ├───────────────┴──────────────────────────┤   │
│  │ Sidecar Manager                          │   │
│  │ Bundles stigmer CLI binary               │   │
│  │ Spawns/stops runner processes            │   │
│  ├──────────────────────────────────────────┤   │
│  │ Auto-Updater                             │   │
│  │ Checks for updates, self-updates         │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │ Webview (React)                          │   │
│  │                                          │   │
│  │  @stigmer/react SDK components           │   │
│  │  @stigmer/typescript SDK clients         │   │
│  │                                          │   │
│  │  Same pages as web console:              │   │
│  │  - Sessions (create, view, history)      │   │
│  │  - Agents (browse, configure)            │   │
│  │  - Settings (runners, API keys, org)     │   │
│  │  - Runner management (launch, stop)      │   │
│  │                                          │   │
│  │  + Desktop-specific features:            │   │
│  │  - Native file picker for workspace      │   │
│  │  - Drag-and-drop file attachments        │   │
│  │  - Deep links from notifications         │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Task Breakdown

### T02: Tauri Project Scaffolding

**Goal**: Initialize the Tauri 2.x project with proper monorepo integration.

**Scope:**
- Create `client-apps/desktop/` with Tauri 2.x scaffold (`cargo create-tauri-app`)
- Configure `tauri.conf.json`: window title, size, `bundle.identifier` (`ai.stigmer.desktop`)
- Set up React frontend: `src-frontend/` using Vite + React + TypeScript
- Add `@stigmer/react` and `@stigmer/typescript` as workspace dependencies
- Configure Tauri's CSP (Content Security Policy) to allow API calls to `api.stigmer.ai`
- Set up development workflow: `cargo tauri dev` hot-reloads both Rust and React
- Basic window with Stigmer logo and "Hello from Desktop" — proof of life

**Affected code:**
- New: `client-apps/desktop/` (entire Tauri project)
- Modified: root `package.json` or workspace config (add desktop to monorepo)

**Effort**: ~1–2 days

---

### T03: Core App Shell — Routing & Layout

**Goal**: Port the web console's page structure into the desktop app using SDK components.

**Scope:**
- Set up React Router (or Tauri's recommended router) with routes matching the web console:
  - `/` — Sessions list / home
  - `/sessions/:id` — Session view
  - `/agents` — Agent library
  - `/agents/:id` — Agent detail
  - `/settings` — Settings root
  - `/settings/runners` — Runners management
  - `/settings/api-keys` — API keys
  - `/settings/organization` — Org settings
- Create a desktop-appropriate layout (sidebar nav, no top browser bar)
- Wire `StigmerProvider` from `@stigmer/react` at the root (auth, API client, theme)
- Authentication flow: on first launch, show login screen; store token in Tauri's secure store (keychain on macOS, keyring on Linux, credential manager on Windows)

**Key decision**: The web console uses Next.js App Router. The desktop app uses plain React Router (no SSR, no server components). The SDK components are framework-agnostic — they work in both.

**Affected code:**
- New: `client-apps/desktop/src-frontend/` (React app)
- Reuses: All `sdk/react` components

**Effort**: ~2–3 days

---

### T04: System Tray Integration

**Goal**: Show Stigmer in the system tray with runner status and quick actions.

**Scope:**
- Tauri's `tray-icon` plugin — native system tray on all platforms
- Tray icon states:
  - Idle (no runners): default Stigmer icon
  - Active (runners running): green dot overlay
  - Error (runner failed): red dot overlay
- Tray menu items:
  - Runner status section (each runner: name, phase, machine info)
  - "Launch Runner" → triggers runner start via sidecar
  - "Stop All Runners" → sends shutdown to all active runners
  - Separator
  - "Open Stigmer" → focus/show main window
  - "Settings" → open main window on settings page
  - "Quit Stigmer" → graceful shutdown of all runners, then exit
- Tray updates in real-time based on runner heartbeat data
- App runs in background when window is closed (tray stays alive)

**Affected code:**
- New: `client-apps/desktop/src-tauri/src/tray.rs`
- Modified: `client-apps/desktop/src-tauri/src/main.rs` (register tray)
- Modified: `tauri.conf.json` (tray plugin config)

**Effort**: ~1–2 days

---

### T05: `stigmer://` URL Scheme Handling

**Goal**: Desktop app handles `stigmer://` URLs for browser-initiated runner launches.

**Scope:**
- Configure `tauri.conf.json` `bundle.protocols` — registers `stigmer://` with the OS on install
- Tauri's deep-link plugin receives the URL and routes it to the React frontend
- React handler parses `stigmer://launch-runner?token=...&runtime=...`, calls launch-token exchange, starts runner
- If app is not running when URL is clicked, OS launches the app with the URL as argument — Tauri handles this natively
- This **supersedes** the CLI URL handler from the Phase 3 project when the desktop app is installed (both register the same scheme; last-installed wins, which is the right behavior)

**Affected code:**
- Modified: `tauri.conf.json` (bundle.protocols, deep-link plugin)
- New: `client-apps/desktop/src-frontend/hooks/useDeepLink.ts`
- New: `client-apps/desktop/src-tauri/src/deep_link.rs`

**Dependencies**: Phase 3 project T02 (launch token endpoints must exist)

**Effort**: ~1 day

---

### T06: Sidecar — Bundle CLI for Runner Management

**Goal**: Bundle the Go CLI binary as a Tauri sidecar so the desktop app can manage runner processes.

**Scope:**
- Configure `tauri.conf.json` `bundle.externalBin` to include the `stigmer` CLI binary
- Tauri's sidecar API spawns/manages the CLI process from Rust
- Rust-side commands exposed to frontend via Tauri's `invoke`:
  - `start_runner(name, runtime, token)` → runs `stigmer up runner --name <name> --runtime <runtime>`
  - `stop_runner(name)` → runs `stigmer down runner <name>`
  - `list_runners()` → runs `stigmer list runners` (or reads `~/.stigmer/runners/*.json` directly)
  - `get_runner_logs(name)` → reads runner log file
- Build pipeline: compile Go CLI for each target platform, bundle into Tauri app

**Affected code:**
- New: `client-apps/desktop/src-tauri/src/sidecar.rs` (Rust sidecar commands)
- Modified: `tauri.conf.json` (externalBin config)
- New: React hooks wrapping Tauri invoke calls

**Effort**: ~2 days

---

### T07: Auto-Updater & Distribution

**Goal**: Ship the app with auto-update and provide installers for all platforms.

**Scope:**
- **Auto-updater**: Tauri's built-in updater plugin. Checks a JSON manifest hosted on `stigmer.ai/desktop/update-manifest.json`. Downloads and applies updates in the background. User sees "Update available — restart to apply" notification.
- **macOS**: `.dmg` installer (Tauri generates this). Code-sign with Apple Developer cert. Notarize with `notarytool`. Distribute via `stigmer.ai/download` and `brew install --cask stigmer`.
- **Linux**: `.AppImage` (universal), `.deb` (Debian/Ubuntu). Distribute via `stigmer.ai/download` and apt repository.
- **Windows**: `.msi` installer (Tauri generates this). Code-sign. Distribute via `stigmer.ai/download` and `winget install stigmer`.
- **CI pipeline**: GitHub Actions workflow builds all platforms in parallel, uploads artifacts, publishes update manifest.
- **Update manifest hosting**: Static JSON on S3/R2 behind `stigmer.ai/desktop/` — contains latest version, download URLs, checksums.

**Affected code:**
- New: `.github/workflows/release.desktop.yaml`
- Modified: `tauri.conf.json` (updater endpoint)
- New: `client-apps/desktop/scripts/` (signing, notarization helpers)

**Effort**: ~2–3 days

---

### T08: Desktop-Specific Features

**Goal**: Features that are only possible or significantly better in a desktop app.

**Scope:**
- **Native file picker**: When creating a session or selecting a workspace, use Tauri's native file dialog instead of browser file input. Gives access to full filesystem, not just uploads.
- **Native notifications**: "Runner started", "Execution complete", "Runner disconnected" — via OS notification center. Clicking a notification deep-links into the relevant session/runner.
- **Background operation**: App continues running in tray when window is closed. Runners stay alive. Reopening the window reconnects to existing state.
- **Keyboard shortcuts**: Global shortcuts (e.g., Cmd+Shift+S to open Stigmer from anywhere on macOS).
- **Window state persistence**: Remember window size, position, and last-viewed page across restarts.

**Affected code:**
- Modified: `client-apps/desktop/src-tauri/src/` (Rust-side native integrations)
- New: `client-apps/desktop/src-frontend/hooks/useNativeFilePicker.ts`
- New: `client-apps/desktop/src-frontend/hooks/useNativeNotifications.ts`

**Effort**: ~2 days

---

### T09: End-to-End Testing & Polish

**Goal**: Validate the complete desktop experience across platforms.

**Test scenarios:**
1. Install on macOS via `.dmg` → app launches, login works, sessions visible
2. Install on Linux via `.AppImage` → same
3. `stigmer://` link from browser → desktop app receives and starts runner
4. System tray shows correct runner status, quick actions work
5. Runner launched from desktop → heartbeat active → visible in both desktop and web console
6. Auto-updater detects new version and applies update
7. Close window → tray stays → reopen → state preserved
8. Native file picker works for workspace selection
9. Full session lifecycle: create session → select runner → execute → view output

**Effort**: ~2 days

## Dependency Graph

```
T02 (scaffold) ──► T03 (app shell) ──┬──► T05 (URL scheme)
                                       ├──► T04 (system tray)
                                       └──► T06 (sidecar)
                                                    │
T07 (auto-update & distribution) ◄──────────────────┤
T08 (desktop features) ◄───────────────────────────┘
                                                    │
T09 (E2E testing) ◄────────────────────────────────┘
```

**Critical path**: T02 → T03 → T06 → T09

## Estimated Effort

| Task | Effort | Dependencies |
|------|--------|--------------|
| T02: Tauri scaffolding | 1–2 days | None |
| T03: App shell (routing, layout, auth) | 2–3 days | T02 |
| T04: System tray | 1–2 days | T03 |
| T05: URL scheme handling | 1 day | T03, Phase 3 T02 |
| T06: Sidecar (bundle CLI) | 2 days | T03 |
| T07: Auto-updater & distribution | 2–3 days | T06 |
| T08: Desktop-specific features | 2 days | T03 |
| T09: E2E testing & polish | 2 days | All |
| **Total** | **~14–18 days (~3–4 weeks)** | |

## Relationship to Phase 3 Project

The Phase 3 project (`20260423.02.phase3-persistent-runners-browser-launch`) builds:
- Launch token server endpoints (this project's T05 depends on them)
- CLI `stigmer://` handler (the desktop app's handler supersedes it)
- Docker placement (the desktop app's sidecar uses the same CLI commands)
- SDK runner action hooks (the desktop app uses them directly)
- Stop command via stream (the desktop app uses it via the SDK)

These two projects can proceed **in parallel**. Phase 3 builds the server-side and CLI foundations; the Desktop project wraps everything in a native experience.

## Success Criteria for T01 (this plan)

- [ ] Task breakdown reviewed and approved
- [ ] Tauri 2.x confirmed as the right choice
- [ ] Monorepo placement decided (`client-apps/desktop/`)
- [ ] Distribution strategy confirmed (website + package managers, no app stores)
- [ ] Ready to begin T02

## Next Steps

1. **You approve this plan** — or request adjustments
2. We begin T02 (Tauri scaffold) immediately
3. T03 follows (this is the largest task — porting the full app shell)
4. T04, T05, T06 can run in parallel after T03
5. T07, T08 follow, then T09 wraps up
