# @stigmer/ink E2E Validation and Bugfixes

**Date**: April 15, 2026

## Summary

Ran the first manual E2E test of `@stigmer/ink` against the live Stigmer API and discovered three bugs that prevented the package from working end-to-end. All three were fixed: wrong transport protocol (HTTP 415), raw mode crash in non-TTY environments, and a gitignore pattern that silently excluded the CLI entry point from version control.

## Problem Statement

The `@stigmer/ink` SDK package (T04 Phase 1) passed all 28 unit tests and had a clean build, but had never been tested against a real backend. The E2E validation surfaced three distinct issues.

### Pain Points

- Running `stigmer-ink` against the live API returned HTTP 415 (Unsupported Media Type) — the transport protocol was wrong
- Running in any non-TTY context (CI, piped output, IDE terminal tools) crashed with "Raw mode is not supported on the current process.stdin"
- The CLI entry point (`src/bin/stigmer-ink.tsx`) lived in a `bin/` directory silently excluded by the root `.gitignore`'s `bin/` pattern, meaning it was never committed in the original T04 PR

## Solution

Three targeted fixes, each addressing a distinct failure mode:

1. **Transport protocol**: Switched from `createConnectTransport` (Connect protocol) to `createGrpcWebTransport` (gRPC-web) in `@connectrpc/connect-node`, matching the server's expected content type
2. **Non-TTY resilience**: Entry point now provides a synthetic `Readable` stream as stdin when `process.stdin.isTTY` is false, preventing Ink's internal `useInput` hook from crashing. `FollowUpInput` checks `isRawModeSupported` via Ink's `useStdin` hook and gracefully disables interactive input
3. **Directory rename**: Renamed `src/bin/` to `src/cli/` to avoid collision with the root `.gitignore`'s `bin/` pattern — cleaner than adding a negation rule

## Implementation Details

### `sdk/ink/src/transport.ts`
- Replaced `createConnectTransport` with `createGrpcWebTransport` from `@connectrpc/connect-node`
- Same `httpVersion: "2"` and auth interceptor configuration — only the wire protocol changed

### `sdk/ink/src/cli/stigmer-ink.tsx` (renamed from `src/bin/`)
- Renamed directory from `bin/` to `cli/` to avoid root `.gitignore` collision
- Added `Readable` import from `node:stream`
- Detects TTY via `Boolean(process.stdin.isTTY)` and creates a synthetic stdin for non-TTY
- Passes `{ stdin, exitOnCtrlC: isTTY, debug: !isTTY }` to Ink's `render()` — debug mode outputs each frame separately instead of waiting for unmount

### `sdk/ink/src/components/FollowUpInput.tsx`
- Replaced unused `useInput` import with `useStdin` from Ink
- Checks `isRawModeSupported` and includes it in the `isDisabled` condition
- When raw mode is unavailable, renders the "Reply..." placeholder instead of crashing

### `sdk/ink/package.json`
- Updated `bin` and `publishConfig.bin` paths from `bin/` to `cli/`

## Benefits

- `@stigmer/ink` now works end-to-end against the live Stigmer API
- Full conversation thread renders in terminal: messages, tool call groups, markdown formatting, usage widget
- Package works in both TTY (interactive) and non-TTY (CI, piped) environments
- CLI entry point is properly version-controlled

## Impact

- **SDK consumers**: `@stigmer/ink` is now production-ready for terminal rendering
- **CI/CD**: Non-TTY environments no longer crash, enabling automated testing
- **Phase 2 evaluation**: Successful E2E validates the SDK approach, informing the Go CLI integration decision

## Related Work

- Builds on: `2026-04-15-155936-stigmer-ink-terminal-sdk-package.md` (T04 Phase 1)
- Project: `_projects/2026-04/20260415.01.cli-modernization`
- GitHub Issue: #122

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~30 minutes)
