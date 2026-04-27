# Desktop Auto-Updater & Distribution Pipeline

**Date**: April 23, 2026

## Summary

Added auto-update capability and a cross-platform CI/CD release pipeline to the Stigmer Desktop app. Users receive non-blocking update notifications via in-app toast, and clicking "Restart to Update" downloads, installs, and relaunches seamlessly. A GitHub Actions workflow builds signed installers for macOS (arm64 + x86_64), Linux, and Windows, producing a `latest.json` manifest that the updater consumes from GitHub Releases.

## Problem Statement

The Stigmer Desktop app (Tauri 2.x) had no mechanism for delivering updates to users after the initial install. Without an auto-updater, every bug fix or feature release requires users to manually download and reinstall — a friction point that kills adoption for a desktop app.

### Pain Points

- No way to push updates to installed desktop apps
- No CI/CD pipeline to build cross-platform installers
- No signed update artifacts (Tauri's updater mandates cryptographic signatures)
- No release automation — manual builds per platform are error-prone and unsustainable

## Solution

Integrated Tauri's built-in updater plugin with a React-driven update UX and a GitHub Actions workflow that builds, signs, and releases the app for all target platforms. The update manifest is hosted as a static `latest.json` on GitHub Releases — zero infrastructure required.

## Implementation Details

### Updater Plugin Integration (Rust)

Added `tauri-plugin-updater` and `tauri-plugin-process` to the Tauri backend. The updater plugin is registered in the `setup` closure (it needs the app handle for initialization), while the process plugin (required for `relaunch()`) is registered in the builder chain. Capabilities updated with `updater:default` and `process:default`.

Generated a permanent Tauri updater signing keypair via `tauri signer generate`. The public key is committed to `tauri.conf.json`; the private key must be stored as a GitHub Actions secret (`TAURI_SIGNING_PRIVATE_KEY`). This keypair is a one-time, irreversible commitment — losing the private key means installed copies can never receive updates.

### Update UX (React)

Created `useAppUpdater` hook that checks for updates 5 seconds after app startup (avoiding startup slowdown) and every 4 hours thereafter. Uses a `busyRef` guard against concurrent checks. When an update is found, displays a persistent `sonner` toast with the new version and a "Restart to Update" action button. The download/install/relaunch flow is triggered only on explicit user action — never silently.

### CI/CD Pipeline

New `.github/workflows/release.desktop.yaml` workflow triggered by `desktop-v*` tags:

1. **Proto generation** — Builds proto stubs once and shares via artifact (same pattern as `release.cli.yaml`)
2. **4-platform build matrix** — macOS arm64, macOS x86_64, Linux x86_64, Windows x86_64
3. **Each job**: Compiles Go CLI sidecar (lightweight, no embeds) → installs Node deps → builds SDK libs → runs `tauri-action` to produce signed installers
4. **Release**: Creates a draft GitHub Release with all platform artifacts and `latest.json` for the auto-updater

The Go CLI sidecar is built with `-tags embed_agentrunner` (corrected from the original design which omitted it). The `embed_webconsole` tag is not used — the desktop app has its own UI and does not serve the web console. The agent-runner embed is required because `stigmer up runner` bootstraps a Python venv from the embedded source.

### Release Automation

Added `make desktop-release bump=patch|minor|major` — bumps `tauri.conf.json` version, commits the change, creates a `desktop-v*` tag, and pushes. CI handles the rest.

## Benefits

- **Zero-friction updates**: Users see a toast, click once, app restarts with the new version
- **Cross-platform coverage**: One workflow produces `.dmg` (macOS), `.AppImage`/`.deb` (Linux), `.msi`/`.exe` (Windows)
- **Cryptographic verification**: Every update is signed and verified before installation
- **No infrastructure cost**: Update manifest hosted on GitHub Releases, no S3/CDN needed
- **Independent release cadence**: Desktop versions (`desktop-v*`) are decoupled from CLI (`v*`) and npm releases
- **Code signing ready**: macOS signing env vars wired in CI — just add Apple Developer secrets when available

## Impact

- **Desktop app**: Now has a complete distribution story — build, sign, release, auto-update
- **CI/CD**: New workflow added to the release matrix; existing workflows unaffected
- **Makefile**: Three desktop targets (`desktop-dev`, `desktop-build`, `desktop-release`)
- **Security**: Updater signing keypair generated — private key backup is critical

## Related Work

- T02–T06, T08 (prior desktop tasks): Built the app that this pipeline now distributes
- `release.cli.yaml`: Provided the proto generation and Go build patterns reused here
- Phase 3 project: T05 (URL scheme) remains blocked on launch token endpoints

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
