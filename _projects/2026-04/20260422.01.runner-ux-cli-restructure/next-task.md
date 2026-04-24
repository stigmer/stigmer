# Next Task: 20260422.01.runner-ux-cli-restructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260422.01.runner-ux-cli-restructure

**Description**: Restructure Stigmer CLI with `stigmer up`/`stigmer down` commands, implement standalone runner lifecycle (`stigmer up runner`), multi-runner management, context-aware smart defaults (local vs cloud), and web UI runner integration.
**Goal**: Give users a clean, intuitive way to manage the Stigmer control plane and runners independently, with smart defaults that adapt to local vs cloud context. Replace `stigmer server` with `stigmer up`/`stigmer down`. Enable cloud users to register their local machine as a runner.
**Tech Stack**: Go (CLI/Cobra), Python (agent-runner), TypeScript/React (web UI), Protobuf
**Components**: client-apps/cli (command structure, daemon, runner lifecycle); sdk/react (runner hooks, session composer); client-apps/web (runner picker, settings page); backend/services/stigmer-server (dispatch enhancement, session auto-bind)

## Current State
- **Status**: T09 complete — all 8 tasks complete, project done
- **Last Session**: 2026-04-22 — T09 implemented (Settings > Runners admin page)
- **Active Task**: None — all tasks complete

## Session Progress (2026-04-22, Session 8)
- Implemented T09: Web UI — Settings > Runners Page
- SDK-first: `RunnerListPanel` built in `@stigmer/react`, consumed by Console
- Extracted shared phase utilities from `RunnerPicker` into `sdk/react/src/runner/phase.ts`:
  - `phaseLabel()`, `phaseDotColor()`, `isActivePhase()`, `PHASE_SORT_ORDER`
  - Refactored `RunnerPicker.tsx` to import from `phase.ts` (pure refactor, identical behavior)
- New files created:
  - `sdk/react/src/runner/phase.ts` — shared phase display utilities (pure functions, no React)
  - `sdk/react/src/runner/RunnerListPanel.tsx` — card-row admin panel with phase badges, system-managed indicators, machine info, responsive metadata columns
  - `client-apps/web/src/components/settings/RunnersSection.tsx` — Console section wrapper
  - `client-apps/web/src/app/settings/runners/page.tsx` — thin Next.js route
- Modified files:
  - `sdk/react/src/runner/RunnerPicker.tsx` — refactored to use shared phase.ts
  - `sdk/react/src/runner/index.ts` — added RunnerListPanel + phase utility exports
  - `sdk/react/src/index.ts` — added to SDK public API
  - `client-apps/web/src/components/layout/settings-nav.ts` — new "Infrastructure" nav group with Runners item
- TypeScript typecheck: 0 new errors (4 pre-existing in generated bidi stream code)
- Linter: 0 errors across all 8 modified/created files
- Design decisions:
  - Card-row list (not HTML table) — matches existing settings panel visual language (`ApiKeyListPanel` pattern)
  - New "Infrastructure" settings nav group — clean taxonomy, separate from Configuration (credentials/integration) and Organization (team/identity)
  - `includeSystemManaged: true` default for admin view — full fleet visibility
  - "System" badge on system-managed runners — distinguishes ephemeral from user-created
  - Read-only panel in v1 — no create/delete (runners created via CLI or cloud auto-provisioning)
  - Phase utilities exported as public API — platform builders can use them for custom runner UIs

## Session Progress (2026-04-22, Session 7)
- Implemented T08: Web UI — Runner Picker in Session Composer
- Created `sdk/react/src/runner/` module — first runner-aware code in the React SDK
- Three new files:
  - `useRunnerList.ts` — data hook calling `stigmer.runner.list()` with system-managed label filtering
  - `RunnerPicker.tsx` — `@base-ui/react` Select component with Auto option, phase-aware grouping (Available/Offline), phase indicator dots, hostname subtitles
  - `index.ts` — barrel exports for hook, component, and types
- Added `runnerId?: string` to `SharedSessionFields` in `useCreateSession.ts` — bridges the React hook to the TS SDK's existing `SessionInput.runnerId`
- Integrated `RunnerPicker` into `SessionComposer` Tier 1 toolbar (alongside Model Selector) via `ComposerToolbar.tsx`
  - Opt-in via `runnerId`/`onRunnerIdChange` props — platform builders who don't provide these never see the picker
- Exported `useRunnerList`, `RunnerPicker`, and types from `sdk/react/src/index.ts`
- Wired `runnerId` state in Console's `SessionLauncher.tsx` — flows through to `createSession({ runnerId })`
- TypeScript typecheck: 0 new errors (4 pre-existing in generated bidi stream code)
- Linter: 0 errors across all modified/created files
- Design decisions:
  - Tier 1 placement (not Configure menu) — runner is a simple execution parameter like model, not a complex config flow
  - `null` = "Auto" — backend decides (session auto-bind in OSS, cloud auto-provisioning in Cloud)
  - Client-side system-managed filtering — `stigmer.ai/system-managed: "true"` labels filtered by default, `includeSystemManaged` option for T09
  - No chip in Zone 2 — runner is dropdown state (like model), not additive context (like agent/MCP)
  - No polling in v1 — fetch on mount + `refetch()` callback

## Session Progress (2026-04-22, Session 6)
- Implemented T07: Dispatch Enhancement — Fail Fast Without Runner
- Critical finding during planning: the global fallback queue (`agent_execution_runner`) is dead after T06 — no runner listens on it. Sessions without a `runner_id` were silently timing out.
- Design decision: two complementary layers instead of just a fail-fast check:
  - **Layer 1 — Session auto-bind**: new `resolveDefaultRunnerStep` in session create pipeline. When `runner_id` is empty and exactly one READY runner exists, auto-bind it. Mirrors cloud's auto-provisioning pattern. Skips silently on zero/multiple/BUSY runners.
  - **Layer 2 — Dispatch fail-fast**: `resolveByAvailableRunner` replaces dead global-queue fallback. Scans active runners, prefers READY over BUSY. Returns actionable error messages when no active runners found.
- Removed `FallbackRunnerQueue()` method (dead code after dispatch rework)
- `workflow_creator.Create()` now always uses `dispatch.TaskQueue` directly
- 19 new tests: 13 dispatch tests + 6 session auto-bind tests, all passing
- All existing tests pass, `go vet` clean, full server builds clean

## Task Overview (8 tasks)

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T02 | Daemon Refactoring — Server-Only Mode | **Complete** | None |
| T03 | `stigmer up` / `stigmer down` Commands | **Complete (reworked in T04)** | T02 |
| T04 | Runner Lifecycle — `stigmer up runner` | **Complete** | T02, T03 |
| T05 | Multi-Runner Management | **Complete** | T04 |
| T06 | Embedded Runner Identity in `stigmer up` | **Complete** | T04, T05 |
| T07 | Dispatch Enhancement — Fail Fast Without Runner | **Complete** | T06 |
| T08 | Web UI — Runner Picker in Session Composer | **Complete** | T04 |
| T09 | Web UI — Settings > Runners Page | **Complete** | T08 |

## Next Steps
1. **Project complete** — all 8 tasks (T02-T09) are done
2. Remaining work is outside this project scope:
   - Phase 0 deploy (proxy, HTTPRoute) — needed before cloud runner mode testing
   - Runner command stream integration into web UI (folder browser revival) — separate project (20260422.02)
   - Polling/real-time runner status updates — deferred, currently fetch-on-mount only

## Key Architectural Decisions

1. **Cloud-first**: `stigmer up` = start a runner (not a server). Cloud users are the primary audience.
2. `stigmer up server` = full local dev stack (Temporal + stigmer-server + embedded runner). OSS quickstart.
3. `stigmer up runner` = identical to `stigmer up` — explicit subcommand for clarity alongside `stigmer up server`
4. Credential resolution: `--token` flag > `STIGMER_API_KEY` env > config cloud token > decision tree (local probe / error with guidance)
5. Endpoint resolution: `--endpoint` flag > config endpoint > `api.stigmer.ai:443`
6. Multiple runners per machine tracked in `~/.stigmer/runners/*.json`
7. Resource commands (`stigmer list runner`, etc.) handle runner CRUD
8. OSS: runner has LLM keys directly. Cloud: runner is credential-free (proxy via `STIGMER_PROXY_ENDPOINT`).
9. Every agent-runner gets a Runner resource with identity and heartbeat
10. No auto-restart — foreground process, user sees exit. Deferred to runner-command-stream Go supervisor.
11. Workflow-runner excluded; custom images deferred
12. **Explicit naming**: no auto-suffix for multiple runners. Second `stigmer up` requires `--name` (T05 decision).
13. **Runner names are slugs**: `--name` serves as local key, server slug, and display name. Max 63 chars, lowercase alphanumeric + hyphens.
14. **Embedded runner identity**: daemon registers "embedded" Runner resource between server readiness and agent-runner start. Seedpack bootstrap moved into daemon to ensure org exists first. Registration failure is hard failure. (T06 decision)
15. **Daemon-managed state files**: daemon writes `~/.stigmer/runners/embedded.json` directly (circular dep avoidance). `ManagedByDaemon` flag prevents `stigmer down runner` from killing daemon-managed processes. (T06 decision)
16. **Session auto-bind**: when a session is created with no `runner_id` and exactly one READY runner exists, the session is automatically bound to it. This is the OSS equivalent of cloud's ephemeral runner auto-provisioning. Session creation never fails due to runner state. (T07 decision)
17. **Global fallback queue retired**: `ResolveActivityTaskQueue` no longer falls back to a global queue. All dispatch now resolves to a specific runner or fails with actionable guidance. `FallbackRunnerQueue()` removed. (T07 decision)
18. **Dispatch auto-route as safety net**: when a session has no `runner_id` at execution time (auto-bind didn't apply, or session created before runner started), dispatch scans for available runners and auto-routes. READY preferred over BUSY. (T07 decision)
19. **Runner picker Tier 1 placement**: runner selection sits alongside Model Selector in the toolbar's Tier 1, not behind the Configure menu. Both answer "how should this execute?" (which LLM + which machine). Simple single-select, not a multi-step config flow. (T08 decision)
20. **`null` = Auto**: runner picker default is "Auto" — backend decides. Platform builders who omit `onRunnerIdChange` never see the picker. Zero runner awareness needed for basic usage. (T08 decision)
21. **Client-side system-managed filtering**: `useRunnerList` filters `stigmer.ai/system-managed: "true"` labels by default. `includeSystemManaged: true` exposes them for admin views. (T08 decision)
22. **Settings "Infrastructure" nav group**: Runners live in a new "Infrastructure" group, separate from "Configuration" (credentials/integration) and "Organization" (team/identity). Forward-looking taxonomy for future infra items (storage, proxies). (T09 decision)
23. **RunnerListPanel in SDK**: Admin runner list is an SDK component (`@stigmer/react`), not Console-specific. Platform builders running their own Stigmer need runner fleet visibility. Follows `ApiKeyListPanel` / `OrgMembersPanel` pattern. (T09 decision)
24. **Shared phase utilities**: Phase display logic (labels, colors, sort order) extracted to `phase.ts` and shared between `RunnerPicker` and `RunnerListPanel`. Exported as public API for platform builders who build custom runner UIs. (T09 decision)

## Key Files

### CLI (current state after T06)
- `client-apps/cli/cmd/stigmer/root.go` — command registration (Lifecycle group)
- `client-apps/cli/cmd/stigmer/root/up.go` — `stigmer up` (runner), `stigmer up server`, `stigmer up runner`
- `client-apps/cli/cmd/stigmer/root/up_start.go` — server startup orchestration (unchanged from T03)
- `client-apps/cli/cmd/stigmer/root/up_bootstrap.go` — post-startup bootstrap (unchanged)
- `client-apps/cli/cmd/stigmer/root/down.go` — `stigmer down` (server+runners), `stigmer down server`, `stigmer down runner`
- `client-apps/cli/cmd/stigmer/root/list.go` — `stigmer list runners` (local state files)
- `client-apps/cli/internal/cli/runner/backend_info.go` — credential + endpoint resolution
- `client-apps/cli/internal/cli/runner/runner_env.go` — Python process env builder
- `client-apps/cli/internal/cli/runner/state.go` — runner state persistence, stale reaping, listing, `ManagedByDaemon` field
- `client-apps/cli/internal/cli/runner/bootstrap.go` — Python runtime bootstrap
- `client-apps/cli/internal/cli/runner/start.go` — main runner orchestration, slug validation, conflict detection
- `client-apps/cli/internal/cli/runner/stop.go` — external runner stop, daemon-managed protection
- `client-apps/cli/internal/cli/runner/copydir.go` — directory copy helper
- `client-apps/cli/internal/cli/config/config.go` — `IsCloudMode()` added
- `client-apps/cli/internal/cli/daemon/daemon.go` — daemon start logic (T02: `ServerOnly`)
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — `buildComponents()`, `registerEmbeddedRunner()`, `buildRunnerEnv()`, embedded state management
- `client-apps/cli/internal/cli/types/registry.go` — runner in `cliRelevantKinds`
- `client-apps/cli/internal/cli/types/verb_support.go` — runner verb support (apply, get, list)

### Proto (existing, no changes needed)
- `apis/ai/stigmer/agentic/runner/v1/` — Runner resource (api, spec, command, query, io, enum)

### Backend (current state after T07)
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch.go` — dispatch: explicit binding + auto-route + fail-fast
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch_test.go` — 13 dispatch tests
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflow_creator.go` — simplified: always uses dispatch.TaskQueue
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` — updated dispatch call site
- `backend/services/stigmer-server/pkg/domain/session/controller/resolve_runner.go` — session auto-bind step
- `backend/services/stigmer-server/pkg/domain/session/controller/create.go` — pipeline wired with ResolveDefaultRunner step

### Web / SDK (completed in T08 + T09)
- `sdk/react/src/runner/useRunnerList.ts` — data hook for runner list with system-managed filtering
- `sdk/react/src/runner/RunnerPicker.tsx` — styled runner picker component (Base UI Select), refactored to use shared phase.ts
- `sdk/react/src/runner/phase.ts` — shared phase utilities (phaseLabel, phaseDotColor, isActivePhase, PHASE_SORT_ORDER)
- `sdk/react/src/runner/RunnerListPanel.tsx` — admin panel component: card-row list with phase badges, system badges, machine info
- `sdk/react/src/runner/index.ts` — barrel exports (hooks, components, phase utilities)
- `sdk/react/src/session/useCreateSession.ts` — `runnerId` added to `SharedSessionFields`
- `sdk/react/src/composer/SessionComposer.tsx` — runner props + toolbar integration
- `sdk/react/src/composer/ComposerToolbar.tsx` — RunnerPicker in Tier 1
- `sdk/react/src/index.ts` — runner module exported (including RunnerListPanel + phase utils)
- `client-apps/web/src/components/session/SessionLauncher.tsx` — runnerId state wired
- `client-apps/web/src/components/settings/RunnersSection.tsx` — Console settings section
- `client-apps/web/src/app/settings/runners/page.tsx` — Next.js route
- `client-apps/web/src/components/layout/settings-nav.ts` — "Infrastructure" nav group added

## Context for Resume
- The "Runner as a Resource" project (Phase 0-2) is code complete (Sessions 1-18 of 20260420.01)
- Runner proto, backend handlers, SDK client, heartbeat, dispatch, launcher all exist
- The agent-runner Python process supports STIGMER_RUNNER_ID and heartbeat via HeartbeatEmitter
- The TypeScript SDK has RunnerClient and SessionInput.runnerId — now used by the React layer (T08)
- Phase 0 deploy (proxy, HTTPRoute) is pending — needed before cloud runner mode testing
- T02-T08 are on `feat/secrets-vault-migration` branch
- `stigmer up` is now a runner command (cloud-first), no longer starts a server
- `stigmer up server` starts the full local dev stack with embedded runner identity
- Runner command stream project (20260422.02) completed T02-T07 — bidi stream, sendCommand API all live
- The full runner selection flow is now live: user picks runner in composer → `session.create({ runnerId })` → backend binds session → executions route to runner's task queue
- `useRunnerList` hook ready for reuse in T09 with `includeSystemManaged: true`
- Folder browser revival (replacing deleted `api_fs.go`) can build on selected `runnerId` + `sendCommand(ListDirectory)` from runner-command-stream project

## Blockers
- None — project complete
- Cloud runner testing still blocked on Phase 0 deploy (proxy must be live)

## Quick Commands
- "Show project status" — Overview of progress
- "Review T01 plan" — Read T01_0_plan.md

---

*This file provides direct paths to all project resources for quick context loading.*
