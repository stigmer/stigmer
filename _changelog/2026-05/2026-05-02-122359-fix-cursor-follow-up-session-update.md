# Fix Cursor Harness Follow-Up: Preserve Harness on Session Update

**Date**: May 2, 2026

## Summary

Fixed the immediate cause of follow-up messages failing on Cursor harness sessions. The `buildUpdateInput` helper in `useSessionConversation.ts` did not preserve `harness` and `runnerId` fields when rebuilding the session for update, causing the cloud backend's harness immutability validator to reject every follow-up attempt.

## Problem Statement

When a user sent a follow-up message on a Cursor harness session, the message would briefly appear (optimistic UI) then vanish within milliseconds. No error was shown. No second execution was ever created in the database.

### Pain Points

- Follow-up messages on Cursor harness sessions silently failed every time
- The error was completely invisible to users (no toast, no error state rendered)
- 19 Cursor harness sessions in production all had exactly 1 execution -- follow-ups never worked

## Solution

Added `harness` and `runnerId` to the `buildUpdateInput` function's return object, preserving the existing session values during the pre-execution session update. Also added development-mode error logging to the catch block for future debuggability.

## Implementation Details

The `sendFollowUp` function calls `updateSession()` before creating the execution when workspace entries are present (which is always true for Cursor sessions -- they have a local path entry). The `buildUpdateInput` helper was missing two critical fields:

```typescript
runnerId: spec?.runnerId || undefined,
harness: spec?.harness,
```

Without these, the session update sent `HARNESS_UNSPECIFIED` on the wire, which the backend's `ValidateHarnessImmutabilityStep` treated as `HARNESS_NATIVE` and rejected because it differs from the stored `HARNESS_CURSOR`.

The catch block was also updated to log errors in development mode instead of silently discarding them.

## Benefits

- Cursor harness follow-up messages now pass the session update validation
- Combined with the earlier `Agent.resume()` model fix, follow-ups can complete end-to-end
- Development builds now log follow-up errors to console for faster debugging

## Impact

- **Users**: Follow-up conversations in Cursor harness sessions will now work
- **Developers**: Silent failures in `sendFollowUp` are now visible in dev console

## Related Work

- [Fix cursor harness follow-up and subject](2026-05-02-120016-fix-cursor-harness-follow-up-and-subject.md) -- the `Agent.resume()` model fix (cursor-runner layer)
- [Session model harness locking](2026-05-02-102735-session-model-harness-locking.md) -- the harness locking feature that exposed this gap

---

**Status**: Production Ready
