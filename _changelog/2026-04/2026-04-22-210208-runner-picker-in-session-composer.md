# Runner Picker in Session Composer (T08)

**Date**: April 22, 2026

## Summary

Added runner awareness to the React SDK and wired it into the Console's session creation flow. Users can now see available runners in the session composer, select one, and have the selection bind the session to that runner's task queue. This completes the user-facing loop for the runner resource model: CLI starts a runner, web UI picks it, backend routes work to it.

## Problem Statement

The Runner resource model was complete at the backend (proto, handlers, heartbeat, dispatch, session auto-bind) and the CLI (`stigmer up runner`, multi-runner management), but the web UI had no way to:
- Show which runners are available in the user's organization
- Let users choose which runner should handle their session
- Forward the selection through `session.create()` to bind the session

### Pain Points

- Users starting sessions on the web console had no control over which runner would execute their agents
- The `SessionInput.runnerId` field existed in the TypeScript SDK but was unreachable from the React layer
- No React hook existed for fetching runner resources — the `runner` module was absent from `@stigmer/react`
- OSS users with multiple runners had no way to target a specific one from the web UI

## Solution

Built the runner module in `@stigmer/react` following the SDK-first, headless-first architecture. Created a data hook (`useRunnerList`) and styled component (`RunnerPicker`), integrated them into the existing `SessionComposer` toolbar, and wired the Console's `SessionLauncher` to manage runner state.

## Implementation Details

### New Module: `sdk/react/src/runner/`

**`useRunnerList(org, options?)`** — Data hook that calls `stigmer.runner.list()` and returns typed `Runner[]` with loading/error/refetch state. Filters out system-managed (ephemeral cloud) runners by default via the `stigmer.ai/system-managed` label. The `includeSystemManaged: true` option enables full visibility for admin views (T09).

**`RunnerPicker`** — Styled dropdown built on `@base-ui/react/select`, matching the existing `ModelSelector` pattern:
- "Auto" option (default) — lets the backend decide via session auto-bind or cloud auto-provisioning
- Runners grouped by phase: Available (READY/BUSY) and Offline (STOPPED/PENDING/FAILED)
- Phase indicator dots (green/yellow/gray), runner name, and hostname subtitle
- Inactive runners visible but disabled — users see their full fleet, not just online runners
- All visual properties via `--stgm-*` tokens — no hardcoded colors

### SessionComposer Integration

- `runnerId` / `onRunnerIdChange` props added (opt-in pattern matching agent/MCP/skills)
- RunnerPicker renders in Tier 1 of the toolbar, between Configure menu and Model Selector
- Toolbar layout: `[Attach] [Workspace] | [Configure] | [Runner ▾] [Model ▾] [Send]`

### Session Creation Passthrough

- `runnerId?: string` added to `SharedSessionFields` in `useCreateSession`
- Forwarded to `stigmer.session.create({ runnerId })` — bridges to the already-wired TS SDK field

### Console Wiring

- `SessionLauncher.tsx` manages `runnerId` state via `useState<string | null>(null)`
- Passed to `SessionComposer` and included in `sessionFields` for `createSession`

## Benefits

- **User control**: Users choose which machine runs their agents — critical for multi-runner setups
- **SDK-first**: `useRunnerList` and `RunnerPicker` are fully embeddable — platform builders can use them in their own products
- **Zero breaking changes**: Runner picker is opt-in. Consumers who don't pass `onRunnerIdChange` see no difference
- **Admin reuse**: `useRunnerList({ includeSystemManaged: true })` ready for T09's Settings > Runners page

## Impact

- **Direct users**: Can now see and select runners when creating sessions in the web console
- **Platform builders**: Can embed runner selection into their own UIs via `<RunnerPicker />` or build custom UIs with `useRunnerList()`
- **OSS users**: Multi-runner setups are now fully supported in the web UI (previously CLI-only targeting)
- **Architecture**: Establishes the `runner` module in `@stigmer/react` — first of two runner UI features (T08 picker, T09 admin page)

## Related Work

- Runner command stream project (20260422.02) — provides `sendCommand(ListDirectory)` for future folder browsing through a selected runner
- T09 (Settings > Runners page) — next task, reuses `useRunnerList` for admin view
- T07 (Dispatch fail-fast + session auto-bind) — backend that honors the `runnerId` selection

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
