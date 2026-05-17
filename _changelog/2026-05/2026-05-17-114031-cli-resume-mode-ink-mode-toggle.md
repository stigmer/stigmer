# CLI Resume Mode Flag and Ink Mode Toggle

**Date**: May 17, 2026

## Summary

Added `--mode` flag to `stigmer resume` with auto-inference from the last execution's interaction mode, and added a Ctrl+T keyboard shortcut in the Ink terminal UI to toggle between Agent and Plan modes mid-session. Together, these close the mode continuity gap: Plan sessions now survive resume and users can switch modes without restarting.

## Problem Statement

When a user started a session in Plan mode (`stigmer run --mode plan`) and later resumed it (`stigmer resume ses-xxx`), the mode was silently dropped. Follow-up messages in the resumed session defaulted to Agent mode — violating the user's intent. Additionally, once a session was started, there was no way to switch modes without exiting and re-running the command.

### Pain Points

- Plan sessions lost their mode on resume — a silent behavior change users couldn't see
- No way to toggle mode mid-session in the terminal UI
- Users had to exit and re-run with `--mode` to switch modes

## Solution

Two complementary changes:

1. **`stigmer resume --mode`**: Auto-infers mode from the last execution's `ExecutionConfig.InteractionMode`. Explicit `--mode` flag overrides the inferred value. The effective mode flows through to both the session header display and the Ink subprocess.

2. **Ink Ctrl+T toggle**: Mode becomes React state in `SessionView`, initialized from the CLI `--mode` arg. Ctrl+T toggles between Agent and Plan. The mode indicator and shortcut hint update in real-time.

## Implementation Details

### Go CLI (`resume.go`, `resume_session.go`)

- Added `--mode` flag to `NewResumeCommand` with validation via existing `validateMode()`
- Threaded `mode string` through `executeResumeSmart` → `launchSessionPicker` → `executeRunSession` → `openSession`
- Added `resolveResumeMode(explicitMode, latestExec)` — returns explicit override if set, otherwise reads `ExecutionConfig.InteractionMode` from the last execution
- Set `headerInfo.Mode = effectiveMode`, which flows to the header panel and to Ink via `streamAgentInk`

### Ink SDK (`SessionView.tsx`, `FollowUpInput.tsx`, `index.ts`)

- Converted static `mode` prop to `useState<InteractionMode>` in `SessionView`
- Added `useEffect` to sync when prop changes externally
- Added Ctrl+T handler alongside existing Ctrl+O (tool expansion toggle)
- Mode indicator always visible when follow-up input is active (yellow for Plan, cyan for Agent)
- `FollowUpInput` hint line shows what Ctrl+T will switch to: `Ctrl+T agent mode` or `Ctrl+T plan mode`
- Exported `InteractionMode` type from barrel export

### Tests

- 5 table-driven unit tests for `resolveResumeMode` covering explicit overrides, auto-inference from Plan execution, Agent/unspecified passthrough, and nil config handling

## Benefits

- Plan sessions automatically resume in Plan mode — no flags needed
- Users can switch modes mid-session without restarting
- Consistent keyboard shortcut pattern: Ctrl+O (tools) + Ctrl+T (mode)
- The hint line tells users what Ctrl+T will do, reducing discovery friction

## Impact

- **CLI users**: `stigmer resume` now respects mode continuity
- **Ink SDK consumers**: `SessionView` gains stateful mode + keyboard toggle out of the box
- **Platform builders**: `InteractionMode` type exported for use in custom Ink integrations

## Related Work

- Session 8: CLI `--mode=plan` flag for `run`/`draft` (predecessor — this extends it to `resume`)
- Session 6-7: Phase 4 Plan/Agent mode (proto, SDK, harness enforcement)

---

**Status**: ✅ Production Ready
