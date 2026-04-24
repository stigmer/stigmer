# Next Task: 20260423.03.stigmer-desktop-app

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Stigmer Desktop App

**Description**: Build the Stigmer Desktop application using Tauri 2.x (Rust shell + React web frontend). Full web console experience natively — sessions, agents, runner management, settings — plus native OS integration: stigmer:// URL scheme, system tray, background runner processes, native notifications, auto-updates.
**Goal**: Ship a native desktop app on macOS, Linux, and Windows that provides everything the web console offers, plus OS-level integration that browsers cannot. Distributed via website download and package managers (Homebrew, winget).
**Tech Stack**: Tauri 2.x (Rust), TypeScript/React (@stigmer/react SDK, @stigmer/sdk), Go (CLI sidecar)
**Components**: client-apps/desktop (new), sdk/react (reused), sdk/typescript (reused), client-apps/cli (bundled as sidecar)

## Current State

- **Status**: T05 complete, ready for T09 (end-to-end testing & polish)
- **Last Session**: 2026-04-23 — T05 complete (`stigmer://` URL scheme handling)
- **Active Task**: None (T09 is the only remaining task)

## Task Overview

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T01 | Design & task plan | **Complete** | None |
| T02 | Tauri project scaffolding | **Complete** | None |
| T03 | Core app shell (routing, layout, auth) | **Complete** | T02 |
| T04 | System tray integration | **Complete** | T03 |
| T05 | `stigmer://` URL scheme handling | **Complete** | T03, Phase 3 T02 |
| T06 | Sidecar — bundle CLI for runner management | **Complete** | T03 |
| T07 | Auto-updater & distribution pipeline | **Complete** | T06 |
| T08 | Desktop-specific features (file picker, notifications) | **Complete** | T03 |
| T09 | End-to-end testing & polish | Pending | All |

## Session Progress (2026-04-23, Session 7)

### T05: `stigmer://` URL Scheme Handling (completed)

Implemented deep link handling so the desktop app receives `stigmer://launch-runner?token=...` URLs from the browser, exchanges the launch token for runner credentials, and starts a local runner via the CLI sidecar.

#### T05.1: Tauri Plugin Setup (Rust + Config)

Added two Tauri plugins for deep linking and single-instance enforcement:

- **`Cargo.toml`** — Added `tauri-plugin-deep-link = "2"` (resolved to v2.4.7) and `tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }` (resolved to v2.4.0). The `deep-link` feature on single-instance ensures that on Windows/Linux, deep link URLs are forwarded to the running instance instead of spawning a new one.
- **`lib.rs`** — Single-instance plugin registered **first** (before all others, as required by Tauri docs). Deep-link plugin registered next. In `setup`, calls `app.deep_link().register_all()?` on Windows/Linux to register the `stigmer://` scheme for the current executable (needed for dev mode; production builds register via OS-level installers).
- **`capabilities/default.json`** — Added `core:event:default` (required for deep-link event listening) and `deep-link:default` permissions.
- **`tauri.conf.json`** — Added `plugins.deep-link.desktop.schemes: ["stigmer"]`. This tells Tauri to register `stigmer://` with the OS on install (macOS: `Info.plist CFBundleURLTypes`, Linux: `.desktop` file, Windows: registry).
- **`package.json`** — Added `@tauri-apps/plugin-deep-link`.

#### T05.2: Deep Link Handler Hook (React)

- **`useDeepLinkHandler.ts`** (new, ~160 lines) — Hook that handles the full `stigmer://` deep link lifecycle:
  - **Cold start**: Calls `getCurrent()` from `@tauri-apps/plugin-deep-link` on mount to check if the app was launched via a URL (CLI arg).
  - **Warm dispatch**: Registers `onOpenUrl()` listener for URLs arriving while the app is already running (forwarded by single-instance plugin).
  - **URL parsing**: Validates `stigmer://launch-runner?token=...` format. Rejects unrecognized hosts or missing token.
  - **Token exchange**: Calls `client.runner.exchangeLaunchToken()` via the Stigmer SDK. Uses `create(ExchangeLaunchTokenRequestSchema, { token })` for proto message construction.
  - **Runner start**: Calls `invokeStartRunner({ token: accessToken, endpoint: BASE_URL })` — same sidecar path as manual runner start.
  - **Toast UX**: Non-blocking `sonner` toasts for the full lifecycle: loading → success (with "View Runners" action) → or error (with specific guidance per error type).
  - **Auth coordination**: If a deep link arrives before the user is authenticated, the URL is queued in a ref and processed once `isAuthenticated` flips to true.
  - **Concurrency guard**: `busyRef` prevents parallel processing of multiple deep links.
- **`App.tsx`** — Mounted `useDeepLinkHandler(client, BASE_URL, isAuthenticated)` in `AuthenticatedApp`, alongside `useAppUpdater()` and `useRunnerNotifications()`.

#### T05.3: Phase 3 Project Scope Update

Updated `20260423.02.phase3-persistent-runners-browser-launch/next-task.md`:
- T03 (CLI URL registration) and T04 (CLI URL handler) marked as **"Deferred — CLI-only fallback"**. The desktop app is the primary `stigmer://` handler.
- Critical path updated: `T02 → Desktop T05 → T07 → T08 → T09`.
- Flow diagram updated to show Desktop App as the primary receiver.
- Quick commands updated to prioritize T07 (SDK hooks — triggering side).

### Key Decisions

- **DD-T05-01: Toast-based UX for deep link handling** — Non-blocking `sonner` toasts instead of modal/navigation. Matches `useAppUpdater` pattern and Slack/Figma/Zoom deep link behavior. Success toast has a "View Runners" action button for optional navigation.
- **DD-T05-02: Desktop app must be authenticated to process deep links** — URLs arriving before auth completes are queued and processed after login. Technically `exchangeLaunchToken` is public, but starting runners from an unauthenticated app is confusing UX.
- **DD-T05-03: No `endpoint` param in URL for v1** — The desktop app uses its own `BASE_URL` for the exchange. Browser and desktop should point at the same server. Multi-environment support (endpoint in URL) is a future enhancement.
- **DD-T05-04: Single-instance is mandatory** — Without it, Windows/Linux spawn a new app instance per deep link click. The single-instance plugin with `deep-link` feature ensures URL forwarding to the existing instance.

### Surprises Discovered

1. `tauri-plugin-single-instance` must be the **first** plugin registered in the builder chain — Tauri docs are explicit about this ordering requirement.
2. `onOpenUrl` only works on macOS natively. On Windows/Linux, it requires the single-instance plugin with the `deep-link` feature enabled — without it, deep link events are silently dropped and a new instance spawns instead.
3. `getCurrent()` from the deep-link plugin reads CLI arguments to detect cold-start URLs on Windows/Linux. On macOS, it reads from the app delegate. The abstraction is seamless from the JS side.
4. Proto message types from `@bufbuild/protobuf` require `create(Schema, { ... })` — plain objects are rejected by TypeScript. The desktop app uses `ExchangeLaunchTokenRequestSchema` from `@stigmer/protos`.
5. `URL` constructor parses `stigmer://launch-runner?token=...` with `launch-runner` as `hostname` (not `pathname`), so the handler checks both `hostname` and `pathname` for robustness.

### Files Changed

- 1 new hook (`useDeepLinkHandler.ts` ~160 lines)
- 2 Tauri plugins added (`deep-link` v2.4.7, `single-instance` v2.4.0)
- 5 desktop files modified (`lib.rs`, `Cargo.toml`, `capabilities/default.json`, `tauri.conf.json`, `package.json`)
- 1 React file modified (`App.tsx` — mount the hook)
- 2 project docs updated (Phase 3 `next-task.md`, Desktop `next-task.md`)
- Auto-updated: `Cargo.lock`, `package-lock.json`
- Rust: zero `cargo clippy` warnings
- TypeScript: zero `tsc` errors

## Session Progress (2026-04-23, Session 6)

### T07: Auto-Updater & Distribution Pipeline (completed)

Implemented Tauri's built-in updater plugin with React-side update UX, a cross-platform GitHub Actions CI workflow, and Makefile release automation.

#### T07.1: Updater Plugin Integration (Rust + Tauri Config)

Added two Tauri plugins (`updater`, `process`) and configured the updater with a real signing keypair.

- **`Cargo.toml`** — Added `tauri-plugin-updater = "2"` (resolved to v2.10.1) and `tauri-plugin-process = "2"` (resolved to v2.3.1).
- **`lib.rs`** — Registered `tauri_plugin_process::init()` in the builder chain. Registered `tauri_plugin_updater::Builder::new().build()` inside the `setup` closure (updater requires the app handle for initialization, per official Tauri docs).
- **`capabilities/default.json`** — Added `updater:default` and `process:default` permissions.
- **`tauri.conf.json`** — Added `bundle.createUpdaterArtifacts: true` (tells Tauri to generate signed `.sig` files and update bundles during builds). Added `plugins.updater` section with the public key and endpoint (`https://github.com/stigmer/stigmer/releases/latest/download/latest.json`).
- **`package.json`** — Added `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process`.
- **Signing keypair** — Generated via `tauri signer generate -w ~/.tauri/stigmer.key`. Public key committed to `tauri.conf.json`. Private key at `~/.tauri/stigmer.key` — must be backed up and added to GitHub Actions as `TAURI_SIGNING_PRIVATE_KEY`.

#### T07.2: Update Check UX (React)

- **`useAppUpdater.ts`** (new, 86 lines) — Hook that checks for updates 5 seconds after mount (avoids slowing startup), then every 4 hours. Uses a `busyRef` guard to prevent concurrent checks. When an update is found, shows a persistent `sonner` toast with the new version and a "Restart to Update" action button. Clicking the button calls `update.downloadAndInstall()` then `relaunch()` from `@tauri-apps/plugin-process`. State machine: `idle → checking → available` (success path) or `→ error` (failure path). Download path: `available → downloading → ready → relaunch`. Returns `{ status, checkForUpdate }` for future settings page integration.
- **`App.tsx`** — Mounted `useAppUpdater()` in `AuthenticatedApp`, alongside `useRunnerNotifications()`.

#### T07.3: CI Workflow — Cross-Platform Build & Release

- **`.github/workflows/release.desktop.yaml`** (new) — Full cross-platform release pipeline.
  - **Trigger**: Push `desktop-v*` tags (release) or `workflow_dispatch` (build-only).
  - **Jobs**: `determine-version` → `generate-protos` → `build` (4-platform matrix).
  - **Build matrix**: macOS arm64, macOS x86_64, Linux x86_64, Windows x86_64.
  - Each matrix job: download proto stubs → build Go CLI sidecar (no embed tags, lightweight) → install Node deps + build SDK libs → run `tauri-action` for platform build.
  - **Release**: On tag push, `tauri-action` creates a draft GitHub Release with all platform installers (`.dmg`, `.AppImage`, `.deb`, `.msi`/`.exe`) and `latest.json` for the auto-updater.
  - **Code signing env vars** included (macOS: APPLE_CERTIFICATE, etc.) — no-ops until secrets are configured.
  - **Sidecar naming**: Per Tauri convention, `stigmer-<target-triple>` (e.g., `stigmer-aarch64-apple-darwin`, `stigmer-x86_64-pc-windows-msvc.exe`).

#### T07.4: Code Signing (Infrastructure Ready)

The workflow includes all macOS signing/notarization environment variables (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_PASSWORD`). They are no-ops until the corresponding GitHub secrets are configured. When an Apple Developer ID Application certificate is available, adding the secrets is all that's needed — no workflow changes required.

#### T07.5: Makefile Integration

- **`desktop-build`** — Updated with a warning when `TAURI_SIGNING_PRIVATE_KEY` is not set.
- **`desktop-release`** (new) — Bumps `tauri.conf.json` version, commits the change, creates a `desktop-v*` tag, and pushes. Usage: `make desktop-release bump=patch|minor|major`.
- **`release`** — Updated help text to mention `make desktop-release` as a separate command.

### Key Decisions

- **DD-T07-01: Update manifest via GitHub Releases** — `tauri-action` generates `latest.json` automatically with `includeUpdaterJson: true`. Update endpoint points to `https://github.com/stigmer/stigmer/releases/latest/download/latest.json`. Zero infrastructure. Trade-off: coupled to GitHub repo URL; mitigated by future `stigmer.ai` proxy if needed.
- **DD-T07-02: Independent desktop versioning with `desktop-v*` tags** — Desktop has its own release cadence. Tag format `desktop-v0.1.0` avoids conflicts with CLI's `v*` tags. Version source of truth: `tauri.conf.json`.
- **DD-T07-03: Updater signing keypair generated** — Public key committed to config; private key at `~/.tauri/stigmer.key`. This key is a permanent commitment: changing it breaks updates for all installed copies. Must be backed up securely and added to GitHub Actions secrets before first release.
- **DD-T07-04: React-side update check** — Update UX driven from React (`@tauri-apps/plugin-updater` JS API), not Tauri's built-in dialog. Gives full control over the toast-based, non-blocking UX via `sonner`. The hook is desktop-specific (`client-apps/desktop/src/hooks/`), not SDK material.
- **DD-T07-05: Sidecar built without embed tags** — The Go CLI sidecar is built with `go build -ldflags="-s -w"` (no `-tags embed_agentrunner embed_webconsole`). Produces a smaller binary since the desktop app doesn't need the embedded web console or agent-runner source — it has its own UI and manages runners via CLI commands.
- **DD-T07-06: Draft releases** — `releaseDraft: true` in `tauri-action`. Releases are created as drafts, reviewed, then published manually. Auto-updater only works with published releases — intentional: prevents broken builds from reaching users.
- **DD-T07-07: Package manager distribution deferred** — Homebrew cask, winget, apt repo deferred. Premature for v0.1.0. Auto-update means users download once and get updates automatically. Package managers add discoverability but not necessity.

### Surprises Discovered

1. `tauri-plugin-updater` must be registered inside the `setup` closure (not the builder chain) because it needs the app handle: `app.handle().plugin(tauri_plugin_updater::Builder::new().build())`.
2. `relaunch()` comes from `tauri-plugin-process`, not from the updater plugin — separate dependency required.
3. `tauri signer generate` requires an interactive TTY for the password prompt. Used `expect` to automate in the terminal. Empty password is valid (key is still encrypted with a derived key, just no user password).
4. `tauri-plugin-updater` pulled in `reqwest` and `rustls` as transitive dependencies (for HTTPS update checks), adding to compile time but no runtime overhead.
5. The `createUpdaterArtifacts` config key must be `true` (not `"v1Compatible"`) for new Tauri v2 apps — `"v1Compatible"` is only for apps migrating from Tauri v1.

### Files Changed

- 1 new hook (`useAppUpdater.ts` 86 lines)
- 1 new CI workflow (`release.desktop.yaml` ~170 lines)
- 2 Tauri plugins added (`updater` v2.10.1, `process` v2.3.1)
- 5 desktop files modified (`lib.rs`, `Cargo.toml`, `capabilities/default.json`, `tauri.conf.json`, `package.json`, `App.tsx`)
- 1 repo file modified (`Makefile` — new `desktop-release` target, updated `desktop-build`, updated `release` help)
- Signing keypair generated (`~/.tauri/stigmer.key`, `~/.tauri/stigmer.key.pub`)
- Auto-updated: `Cargo.lock`, `package-lock.json`, `gen/schemas/*.json`
- Rust: zero `cargo clippy` warnings
- TypeScript: zero `tsc` errors

## Next Steps

1. **T09: End-to-end testing & polish** — The only remaining task. All feature tasks (T02–T08) are complete.
2. **Operational: Add GitHub secrets** — `TAURI_SIGNING_PRIVATE_KEY` (content of `~/.tauri/stigmer.key`), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty string). Required before first `desktop-v*` tag push.
3. **Operational: macOS code signing** — Obtain Apple Developer ID Application certificate, add `APPLE_*` secrets to GitHub. Enables signed/notarized `.dmg` builds.
4. **Polish: Tray icon state variants** — Designer-created icons for idle/active/error states
5. **Polish: Notification click-to-focus** — Bring Stigmer window to focus on notification click
6. **Polish: Settings > About section** — Show current version, update status, manual check button

## Context for Resume

- T05 added two Tauri plugins: `deep-link` (v2.4.7), `single-instance` (v2.4.0 with `deep-link` feature)
- Single-instance plugin registered FIRST in the builder chain (Tauri requirement), deep-link plugin registered second
- `stigmer://` scheme configured in `tauri.conf.json` `plugins.deep-link.desktop.schemes`
- On Windows/Linux, `register_all()` called in `setup` to register schemes for the current executable (dev mode)
- `useDeepLinkHandler` hook: `getCurrent()` for cold start, `onOpenUrl()` for warm dispatch, `busyRef` concurrency guard, `pendingUrlRef` for pre-auth queueing
- Deep link flow: parse `stigmer://launch-runner?token=...` → `exchangeLaunchToken()` → `invokeStartRunner({ token, endpoint })` → toast
- T07 added two Tauri plugins: `updater` (v2.10.1), `process` (v2.3.1)
- Updater plugin registered in `setup` closure, not builder chain: `app.handle().plugin(tauri_plugin_updater::Builder::new().build())`
- Process plugin registered in builder chain: `.plugin(tauri_plugin_process::init())`
- Updater signing public key in `tauri.conf.json` `plugins.updater.pubkey`; private key at `~/.tauri/stigmer.key`
- Update endpoint: `https://github.com/stigmer/stigmer/releases/latest/download/latest.json`
- `useAppUpdater` hook: 5s initial delay, 4h interval, `sonner` toast, `busyRef` guard against concurrent checks
- CI workflow: `desktop-v*` tag → `generate-protos` → 4-platform matrix (macOS arm64/x86_64, Linux x86_64, Windows x86_64) → `tauri-action` with `includeUpdaterJson: true`
- Go sidecar built without embed tags (no `embed_agentrunner embed_webconsole`) — lightweight CLI binary
- `make desktop-release bump=patch` bumps `tauri.conf.json` version, commits, tags `desktop-v*`, pushes
- Draft releases: must be published manually after verification for auto-updater to work
- Windows: builds but `sidecar.rs` process management (SIGTERM/SIGKILL) is Unix-only — known limitation
- Dev workflow unchanged: `./scripts/setup-sidecar-dev.sh` then `cargo tauri dev` (or `make desktop-dev`)
- Pre-existing typecheck errors in web app and `sdk/typescript/src/gen/runner.ts` — not introduced by this work

## Blockers

- GitHub secrets (`TAURI_SIGNING_PRIVATE_KEY`) needed before first CI release build

## Quick Commands

- "Start T09" — Begin end-to-end testing & polish
- "Show project status" — Get overview of progress
- "Run desktop" — `make desktop-dev` to launch the desktop app (run `./scripts/setup-sidecar-dev.sh` first for sidecar)
- "Release desktop" — `make desktop-release bump=patch` (requires `TAURI_SIGNING_PRIVATE_KEY` in GitHub secrets)

---

*This file provides direct paths to all project resources for quick context loading.*
