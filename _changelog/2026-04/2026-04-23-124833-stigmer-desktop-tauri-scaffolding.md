# Stigmer Desktop App — Tauri 2.x Project Scaffolding

**Date**: April 23, 2026

## Summary

Scaffolded the Stigmer Desktop application at `client-apps/desktop/` using Tauri 2.x (Rust) + Vite 6 + React 19, fully integrated into the npm workspace monorepo. The desktop app consumes the same `@stigmer/react`, `@stigmer/sdk`, and `@stigmer/theme` packages as the web console — proving the SDK's headless-first, framework-agnostic architecture works exactly as designed. A native macOS window opens with theme tokens rendering correctly.

## Problem Statement

Stigmer's web console provides a browser-based experience for sessions, agents, and runner management. However, browsers cannot offer:
- `stigmer://` URL scheme handling for browser-initiated runner launches
- System tray with runner status and quick actions
- Background runner process management (app runs when window is closed)
- Native notifications for execution events
- Secure token storage in OS keychain/keyring
- Auto-updates without browser involvement

### Pain Points

- Browser limitations block deep OS integration that developer tools need
- No native presence on the desktop (tray, dock, global shortcuts)
- Runner management requires keeping a browser tab open
- Auth tokens stored in browser sessionStorage are ephemeral

## Solution

A Tauri 2.x application that wraps the existing React SDK in a native shell. Tauri was chosen over Electron for its small binary size (~10-15 MB vs ~150+ MB), native webview (no bundled Chromium), and built-in support for every OS integration needed (tray, deep links, sidecar, auto-updater).

The key architectural insight: **no new SDK is needed**. The desktop app is just another consumer of `@stigmer/react` and `@stigmer/sdk`, exactly like the web console — different shell, same components. This validates the SDK-first architecture.

## Implementation Details

### Project Structure

```
client-apps/desktop/
├── package.json              # npm workspace member
├── vite.config.ts            # Tauri-optimized Vite config
├── tsconfig.json             # ES2022, strict, bundler resolution
├── index.html                # Vite entry
├── src/
│   ├── main.tsx              # ReactDOM.createRoot
│   ├── App.tsx               # StigmerProvider + proof of life
│   └── globals.css           # Full @stigmer/theme token integration
└── src-tauri/
    ├── Cargo.toml            # Tauri 2.10.3
    ├── tauri.conf.json       # Window config, CSP, bundle settings
    ├── src/lib.rs            # tauri::Builder setup
    ├── src/main.rs           # Desktop entry point
    └── capabilities/         # Security permissions
```

### Key Configuration Decisions

- **Vite + React** (not Next.js) — no SSR needed in a desktop app
- **`@tailwindcss/vite`** plugin — same Tailwind 4 as web console, Vite-native integration
- **Standard Tauri directory convention** — `src/` for frontend, `src-tauri/` for Rust
- **No path aliases** — imports use `@stigmer/*` package names directly
- **CSP configured** for API connections to `*.stigmer.ai` and localhost

### Monorepo Integration

- Added `client-apps/desktop` to root `package.json` workspaces
- Added Makefile targets: `desktop-dev`, `desktop-build`, `verify-desktop`
- All existing root gitignore rules (`target/`, `dist/`, `node_modules/`) cover the new directory

## Benefits

- Validates SDK-first architecture — `@stigmer/react` works identically in Tauri webview as in Next.js
- Foundation for all T03-T09 desktop features (auth, routing, tray, URL scheme, sidecar, auto-update)
- Dev workflow mirrors web console: `make desktop-dev` for hot-reload development
- ~10 MB binary target (vs ~150 MB for Electron equivalent)
- First Rust build: ~1 min; incremental: ~5s

## Impact

- **Platform builders**: Confirms SDK embeddability in non-Next.js environments
- **Desktop users**: Foundation for native Stigmer experience with OS integration
- **Maintainers**: Clean separation — desktop app is a thin shell consuming SDK packages

## Related Work

- [SDK-first architecture standards (Workstream A)](2026-04-23-113717-web-sdk-architecture-standards-workstream-a.md)
- Desktop project plan: `_projects/2026-04/20260423.03.stigmer-desktop-app/tasks/T01_0_plan.md`

---

**Status**: T02 complete, foundation ready for T03 (core app shell)
**Timeline**: Single session (~2 hours including first Rust compilation)
