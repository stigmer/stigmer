# Next Task: 20260423.03.stigmer-desktop-app

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Stigmer Desktop App

**Description**: Build the Stigmer Desktop application using Tauri 2.x (Rust shell + React web frontend). Full web console experience natively — sessions, agents, runner management, settings — plus native OS integration: stigmer:// URL scheme, system tray, background runner processes, native notifications, auto-updates.
**Goal**: Ship a native desktop app on macOS, Linux, and Windows that provides everything the web console offers, plus OS-level integration that browsers cannot. Distributed via website download and package managers (Homebrew, winget).
**Tech Stack**: Tauri 2.x (Rust), TypeScript/React (@stigmer/react SDK, @stigmer/typescript SDK), Go (CLI sidecar)
**Components**: client-apps/desktop (new), sdk/react (reused), sdk/typescript (reused), client-apps/cli (bundled as sidecar)

## Current State

- **Status**: T03 complete, ready for T04
- **Last Session**: 2026-04-23 — T03 complete (SDK extraction + desktop app shell)
- **Active Task**: T04 (next)

## Task Overview

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T01 | Design & task plan | **Complete** | None |
| T02 | Tauri project scaffolding | **Complete** | None |
| T03 | Core app shell (routing, layout, auth) | **Complete** | T02 |
| T04 | System tray integration | Pending | T03 |
| T05 | `stigmer://` URL scheme handling | Pending | T03, Phase 3 T02 |
| T06 | Sidecar — bundle CLI for runner management | Pending | T03 |
| T07 | Auto-updater & distribution pipeline | Pending | T06 |
| T08 | Desktop-specific features (file picker, notifications) | Pending | T03 |
| T09 | End-to-end testing & polish | Pending | All |

## Session Progress (2026-04-23, Session 2)

### Phase A: SDK Extraction (completed)

Extracted session orchestration logic from the web app into reusable SDK hooks:

- **`useNewSessionFlow`** (`sdk/react/src/session/useNewSessionFlow.ts`) — Orchestrates "create new session" flow: model persistence, agent/resolution/MCP/skill/runner/workspace state, session + first execution creation with default agent fallback. Framework-agnostic.
- **`useSessionPageFlow`** (`sdk/react/src/session/useSessionPageFlow.ts`) — Orchestrates session page: composes `useSessionConversation` + agent resolution from session instance + workspace sync + follow-up with agent override.
- **`usePersistedModel`** (`sdk/react/src/session/usePersistedModel.ts`) — Model selection with localStorage persistence, shared between both flows.
- **`useEditSessionPrep`** (`sdk/react/src/session/useEditSessionPrep.ts`) — Edit-mode draft session preparation (fetch resource, serialize to YAML/ZIP).
- **`draft.ts`** (`sdk/react/src/session/draft.ts`) — `CREATOR_AGENTS`, `DraftResourceType`/`DraftParams`, `parseDraftParams`/`parseDraftType` moved from web app to SDK.
- **Web app refactored**: `SessionLauncher.tsx` 407→160 lines, `SessionPage.tsx` 386→210 lines, `draft-session.ts` now re-exports from SDK.

### Phase B: Desktop App Shell (completed)

Built the complete desktop application infrastructure:

- **Routing** (`src/routes.tsx`) — HashRouter with lazy-loaded routes matching web console structure.
- **App Shell** (`src/shell/AppShell.tsx`, `src/shell/Sidebar.tsx`) — Sidebar with session list via SDK hooks (`useSessionList`, `groupSessionsByTime`, `resolvedSubject`), New Session, Library, Settings navigation.
- **Auth** (`src/auth/`) — Dual-mode: DisabledAuth for local/OSS, PkceAuth for cloud (Auth0 PKCE with system browser, code exchange, token refresh). Login screen, token storage.
- **Org Context** (`src/org/OrgProvider.tsx`, `src/org/OrgGate.tsx`) — Full org gating: loading, provisioning poll (OIDC), error+retry, onboarding with SDK's `CreateOrganizationForm`.
- **Pages** — 14 page components, all thin wrappers over SDK hooks/components:
  - Session: `SessionLauncher`, `SessionPage` (using extracted SDK hooks)
  - Library: `LibraryLanding`, `AgentListPage`, `AgentDetailPage`, `SkillListPage`, `SkillDetailPage`, `McpServerListPage`, `McpServerDetailPage`
  - Settings: `SettingsRunners`, `SettingsApiKeys`, `SettingsEnvironments`, `SettingsMembers`, `SettingsOrgProfile`

### Key Decisions

- **SDK-first**: All domain logic in SDK, both web and desktop are thin shells
- **No shared app shell package**: SDK hooks are the sharing layer; sidebar duplication (~200 lines) is acceptable
- **Auth via PKCE + local callback**: Mirrors CLI pattern, independent from deep-link plugin (T05)
- **Full OrgGate**: Provisioning poll needed because desktop has no natural delay between auth and org content

### Files Changed

- 5 new SDK files (hooks + types)
- 20 new desktop files (auth, org, shell, pages, routes)
- 3 web files refactored (SessionLauncher, SessionPage, draft-session)
- SDK and web barrel exports updated
- All three packages typecheck cleanly

## Next Steps

1. **T04: System tray integration** — Native tray icon, runner status, quick actions
2. **T05: `stigmer://` URL scheme** — Deep linking (depends on Phase 3 T02 launch tokens)
3. **T06: Sidecar** — Bundle Go CLI for runner process management

## Context for Resume

- The `@stigmer/react` SDK now has session orchestration hooks (`useNewSessionFlow`, `useSessionPageFlow`, `useEditSessionPrep`) that both web and desktop consume
- Desktop app at `client-apps/desktop/` has full routing, auth, org context, and all page shells
- Auth provider auto-detects local vs cloud mode (`VITE_STIGMER_API_URL`)
- OrgGate includes provisioning poll for OIDC mode (same race condition as web)
- Desktop pages use `enableGitHub={false}` and `enableLocal` — GitHub integration isn't wired yet (no OAuth popup in Tauri)
- `SettingsMembers` and `SettingsOrgProfile` resolve org ID from slug via `useOrganization` hook
- All library list pages use `useAgentList`/`useSkillList`/`useMcpServerList` with scope toggle and pagination
- Pre-existing typecheck errors in web app (`LibraryBreadcrumbContext`) — not introduced by this work
- Pre-existing typecheck error in `sdk/typescript/src/gen/runner.ts` — not introduced by desktop work

## Blockers

- Phase 3 project T02 (launch token endpoints) needed for `stigmer://` handler (T05)

## Quick Commands

- "Start T04" — Begin system tray integration
- "Show project status" — Get overview of progress
- "Run desktop" — `make desktop-dev` to launch the desktop app

---

*This file provides direct paths to all project resources for quick context loading.*
