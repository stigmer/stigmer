# Next Task: 20260423.03.stigmer-desktop-app

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Stigmer Desktop App

**Description**: Build the Stigmer Desktop application using Tauri 2.x (Rust shell + React web frontend). Full web console experience natively — sessions, agents, runner management, settings — plus native OS integration: stigmer:// URL scheme, system tray, background runner processes, native notifications, auto-updates.
**Goal**: Ship a native desktop app on macOS, Linux, and Windows that provides everything the web console offers, plus OS-level integration that browsers cannot. Distributed via website download and package managers (Homebrew, winget).
**Tech Stack**: Tauri 2.x (Rust), TypeScript/React (@stigmer/react SDK, @stigmer/typescript SDK), Go (CLI sidecar)
**Components**: client-apps/desktop (new), sdk/react (reused), sdk/typescript (reused), client-apps/cli (bundled as sidecar)

## Current State

- **Status**: T02 complete, ready for T03
- **Last Session**: 2026-04-23 — T01 approved, T02 scaffolding complete
- **Active Task**: T03 (next)

## Task Overview

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T01 | Design & task plan | **Complete** | None |
| T02 | Tauri project scaffolding | **Complete** | None |
| T03 | Core app shell (routing, layout, auth) | Pending | T02 |
| T04 | System tray integration | Pending | T03 |
| T05 | `stigmer://` URL scheme handling | Pending | T03, Phase 3 T02 |
| T06 | Sidecar — bundle CLI for runner management | Pending | T03 |
| T07 | Auto-updater & distribution pipeline | Pending | T06 |
| T08 | Desktop-specific features (file picker, notifications) | Pending | T03 |
| T09 | End-to-end testing & polish | Pending | All |

## Why no new SDK needed

The desktop app is a React frontend in a Tauri native shell:

- **UI**: `@stigmer/react` SDK — all components already exist (SessionComposer, RunnerPicker, RunnerListPanel, AgentBuilder, settings panels)
- **Data**: `@stigmer/typescript` SDK — all API clients already exist (gRPC-web, REST, streaming)
- **Native**: Tauri Rust backend — OS integration (tray, URL scheme, sidecar, notifications)
- **Runner management**: Go CLI binary bundled as Tauri sidecar

Same React components, same TypeScript SDK, different shell. Zero duplication.

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  Tauri Shell (Rust)                         │
│  ├── System Tray (runner status, actions)   │
│  ├── URL Scheme Handler (stigmer://)        │
│  ├── Sidecar Manager (Go CLI binary)        │
│  └── Auto-Updater                           │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │  Webview (React)                     │   │
│  │  @stigmer/react + @stigmer/typescript│   │
│  │  Same pages as web console           │   │
│  │  + Native file picker                │   │
│  │  + Native notifications              │   │
│  │  + Deep links from tray/notifs       │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Distribution Strategy

- **macOS**: `.dmg` from stigmer.ai/download + `brew install --cask stigmer`
- **Linux**: `.AppImage` + `.deb` from stigmer.ai/download + apt repository
- **Windows**: `.msi` from stigmer.ai/download + `winget install stigmer`
- **Auto-update**: Tauri built-in updater, manifest hosted at `stigmer.ai/desktop/update-manifest.json`
- **No app stores** — developer tools don't fit store sandboxing

## Related Projects

- **20260423.02.phase3-persistent-runners-browser-launch** — Builds server-side launch tokens and CLI foundations. This project wraps them in native desktop experience.
- **20260423.01.web-sdk-architecture-standards** — SDK architecture standards that ensure React SDK components work in any context (web, desktop, embedded).
- **20260420.01.agent-runner-as-resource** — AgentRunner resource, proxy, dispatch — all backend foundations.
- **20260422.01.runner-ux-cli-restructure** — CLI runner commands and web UI runner components.

## Session Progress (2026-04-23)

- Approved T01 design plan (Tauri 2.x, monorepo placement, distribution strategy)
- Completed T02: Tauri project scaffolding
  - Created `client-apps/desktop/` with Tauri 2.10.3 + Vite 6 + React 19
  - Integrated into npm workspaces, added Makefile targets
  - Verified: native window opens, theme tokens render, Vite HMR works
- Upgraded Rust toolchain from 1.86.0 to 1.95.0 (Tauri transitive deps require >= 1.88)
- Fixed `tauri.conf.json` schema issue (`title` is window-level only in Tauri 2.x)
- Flagged auth concern: OIDC in embedded webviews is restricted by IdPs, T03+T05 have a dependency not captured in T01

## Context for Resume

- The `@stigmer/react` SDK is the primary UI layer — all components are headless-first and theme-token based
- The `@stigmer/sdk` package handles all API communication — works in any JS runtime
- The web console at `client-apps/web/` is the reference for page structure and routing
- The Go CLI at `client-apps/cli/` is the sidecar for runner process management
- Tauri 2.x is stable and has built-in plugins for: tray-icon, deep-link, updater, dialog, notification, shell
- Desktop app lives at `client-apps/desktop/` alongside `web/` and `cli/`
- Dev workflow: `make desktop-dev` or `cd client-apps/desktop && cargo tauri dev`
- First Rust build takes ~1 min; subsequent builds are incremental (~5s)
- Pre-existing typecheck error in `sdk/typescript/src/gen/runner.ts` (RunnerStreamServerMessage) — not introduced by desktop work

## Blockers

- Phase 3 project T02 (launch token endpoints) needed for the `stigmer://` handler (T05)
- `@stigmer/react` SDK should be reasonably stable (web-sdk-architecture-standards project in progress)

## Quick Commands

- "Start T03" — Begin core app shell (routing, layout, auth)
- "Show project status" — Get overview of progress
- "Run desktop" — `make desktop-dev` to launch the desktop app

---

*This file provides direct paths to all project resources for quick context loading.*
