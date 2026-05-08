# Fix Cursor Runner Crash in Cloud Sandboxes — Dangling @stigmer/protos Symlink

**Date**: May 8, 2026

## Summary

Fixed the cursor-runner crashing on startup inside Daytona cloud sandboxes due to a dangling `@stigmer/protos` symlink in the Docker image. The `ExecuteCursor` Temporal activity was timing out (`ScheduleToStart`) because no TypeScript worker was polling the `:cursor` queue — confirmed by reading `/var/log/cursor-runner.log` from a live production sandbox.

## Problem Statement

Cloud-mode Cursor harness executions were failing with `ActivityTaskTimeoutException` (`TIMEOUT_TYPE_SCHEDULE_TO_START`) on the `ExecuteCursor` activity. The 5-minute `ScheduleToStartTimeout` expired because the cursor-runner process never came online.

### Pain Points

- Cursor harness executions in cloud mode were completely broken
- The cursor-runner crash was silent — backgrounded with `nohup ... &`, errors only went to `/var/log/cursor-runner.log` inside the ephemeral Daytona sandbox
- The Dockerfile's build-time import verification only tested `config.js`, which doesn't depend on `@stigmer/protos`, so the broken symlink passed the build gate

## Solution

Copied the proto stubs from the builder stage into the final Docker image at the path the symlink expects, and strengthened the build-time verification to test the full import chain.

## Implementation Details

### Root Cause

In `package.json`, `@stigmer/protos` is declared as `"file:../../../apis/stubs/ts"`. During the Docker builder stage, this was rewritten to `"file:/build/apis/stubs/ts"` and `npm install` created a symlink at `node_modules/@stigmer/protos -> ../../../apis/stubs/ts`.

The final image copies `node_modules/` (preserving the symlink) but never copies the symlink target. The symlink resolves to `/apis/stubs/ts` in the final image, which does not exist:

```
/cursor-runner/node_modules/@stigmer/protos -> ../../../apis/stubs/ts  (→ /apis/stubs/ts)
/apis/stubs/ts  — MISSING
```

Confirmed from live sandbox `949c5359`:
```
Fatal error in cursor-runner: Error [ERR_MODULE_NOT_FOUND]:
  Cannot find package '@stigmer/protos' imported from
  /cursor-runner/dist/activity/execute-cursor.js
```

### Fix (Dockerfile.sandbox.full)

1. Added `COPY --from=cursor-runner-builder /build/apis/stubs/ts /apis/stubs/ts` to provide the symlink target in the final image
2. Replaced the shallow `config.js`-only import check with a full-chain verification that imports `@temporalio/worker`, `config.js`, and `execute-cursor.js` — this would have caught the dangling symlink at build time

## Benefits

- Cursor harness executions in cloud mode will work end-to-end
- Build-time verification now catches missing dependencies across the full import chain, preventing silent runtime crashes
- Future `file:` dependency issues will be caught at `docker build` time instead of in production

## Impact

- **Cloud Cursor harness**: Unblocked — was completely non-functional
- **Local Cursor harness**: Unaffected (CLI daemon uses source files directly)
- **Python agent-runner**: Unaffected (separate dependency chain)

## Related Work

- `_changelog/2026-05/2026-05-01-112326-fix-cursorrunner-sync-package-json-crash.md` — previous cursor-runner packaging fix
- `_projects/2026-04/20260430.01.cursor-harness/` — Cursor harness project

---

**Status**: ✅ Production Ready
**Timeline**: Investigation + fix in one session
