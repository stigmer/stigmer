# Fix Web Frontend Bypassing LLM Session Subject Generation

**Date**: March 24, 2026

## Summary

The web Console was setting session subjects to a raw 8-word truncation of the user's message, which prevented the backend's LLM-powered title generation from ever running. This fix aligns the web with the CLI and backend auto-create paths by using the sentinel value, and adds a shared `resolvedSubject` utility to the SDK so all display surfaces filter it consistently.

## Problem Statement

When creating a session from the Stigmer Console (web), the `SessionLauncher` component set the session subject to `firstNWords(message, 8)` — a raw slice of the user's first message. The `GenerateSessionSubject` Temporal activity checks whether the subject equals `"Auto-created session"` (the sentinel) before invoking an LLM to generate a concise title. Since the web-created subject never matched the sentinel, every web session permanently kept its truncated, low-quality subject.

### Pain Points

- Web sessions displayed raw message fragments as titles (e.g., "Look for the latest change log file that") instead of concise, meaningful LLM-generated titles
- Inconsistent behavior between CLI (which got LLM titles) and web (which did not)
- The `GenerateSessionSubject` activity logged "not auto-created, skipping generation" for every web-originated session, wasting investigation time

## Solution

Aligned all session-creation paths to use the same sentinel subject, and added a shared SDK utility so display layers consistently filter it.

## Implementation Details

### Layer 1: `@stigmer/sdk` — constant and utility

New hand-written file `sdk/typescript/src/session.ts`:

- `PENDING_SUBJECT` — the sentinel constant (`"Auto-created session"`), matching the Go CLI's `PendingSubject` and the Python activity's `_AUTO_CREATED_SUBJECT`
- `resolvedSubject(subject)` — returns `null` when the subject is the sentinel, the string otherwise. Mirrors the Go CLI's `ResolvedSubject` function

Exported from `sdk/typescript/src/index.ts` as part of the public `@stigmer/sdk` API.

### Layer 2: `@stigmer/react` — default and re-export

- `useCreateSession` now defaults `subject` to `PENDING_SUBJECT` when the caller omits it (`input.subject ?? PENDING_SUBJECT`). Any SDK consumer automatically gets correct behavior without needing to know about the sentinel.
- `PENDING_SUBJECT` and `resolvedSubject` re-exported from the session barrel and `@stigmer/react` top-level index.

### Layer 3: `client-apps/web` — consume

- `SessionLauncher.tsx`: removed `subject: firstNWords(message, 8)` and the `firstNWords` helper. Sessions now get the sentinel by default.
- `Sidebar.tsx`: uses `resolvedSubject()` to filter the sentinel, falling back to `"Untitled session"`. The existing 5-second delayed refetch picks up the LLM-generated title.

## Files Changed

| File | Change |
|------|--------|
| `sdk/typescript/src/session.ts` | New — `PENDING_SUBJECT` constant and `resolvedSubject` utility |
| `sdk/typescript/src/index.ts` | Export new session utilities |
| `sdk/react/src/session/index.ts` | Re-export from `@stigmer/sdk` |
| `sdk/react/src/index.ts` | Surface re-exports at package level |
| `sdk/react/src/session/useCreateSession.ts` | Default subject to `PENDING_SUBJECT` |
| `client-apps/web/src/components/session/SessionLauncher.tsx` | Remove `firstNWords` and explicit subject |
| `client-apps/web/src/components/layout/Sidebar.tsx` | Use `resolvedSubject()` for display filtering |

## Benefits

- Web sessions now get the same concise, LLM-generated titles as CLI sessions
- Consistent behavior across all session-creation surfaces (CLI, web, backend auto-create)
- SDK consumers get correct defaults automatically — no sentinel knowledge required
- Display surfaces have a shared utility to filter the sentinel, preventing it from leaking into UI

## Impact

- **SDK consumers**: `useCreateSession` now defaults correctly; no breaking change (subject is still optional)
- **Console users**: Session titles in the sidebar will show "Untitled session" briefly, then update to the LLM-generated title within ~5 seconds
- **Platform builders**: `resolvedSubject` is available as a public API for any embedding that displays session subjects

## Related Work

- Original session subject generation: `_changelog/2026-02/2026-02-25-000324-auto-generate-session-subjects.md`
- CLI subject enrichment: `_changelog/2026-03/2026-03-04-111351-cli-session-header-subject-model-enrichment.md`

---

**Status**: Production Ready
