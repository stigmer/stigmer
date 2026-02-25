# TUI Header: Show Session Subject Instead of Raw ID

**Date**: February 25, 2026

## Summary

The alt-screen TUI header now displays the session's human-readable subject line (e.g., "Refactor authentication module") instead of the opaque session ID (e.g., `ses-01kjatmvul214h8mav91xx8c9`). This gives users immediate context about what a session is doing without memorising IDs.

## Problem Statement

When running or re-attaching to a session, the TUI header bar showed:

```
Session: ses-01kjatmvul214h8mav91xx8c9  ⏳ pending
```

### Pain Points

- The raw session ID conveys no meaning — users cannot tell which session they are looking at without external context.
- The backend already generates a descriptive subject for every session, but the TUI was not using it.
- In multi-session workflows (re-attach, resume), the problem is amplified because users must cross-reference IDs manually.

## Solution

Add a `SessionSubject` field to the TUI `Config` and prefer it over the raw `SessionID` in the header renderer. Callers that already fetch the session object (`openSession`, `resumeSession`) pass the subject through; callers that create brand-new sessions (where the subject may not yet exist) pass an empty string, falling back gracefully to the session ID.

## Implementation Details

- **`executiontui/model.go`** — Added `SessionSubject string` to `Config`.
- **`executiontui/view.go`** — `renderHeader()` computes a `sessionLabel` that prefers `SessionSubject` over `SessionID`, then uses it in both the conversational-mode and streaming-mode header formats.
- **`run_stream.go`** — `streamAgentExecution` gains a `sessionSubject` parameter and forwards it into the TUI config.
- **`run_session.go`** — `openSession` and `resumeSession` thread the subject (already available from `ses.GetSpec().GetSubject()`) to the TUI.
- **`run_handlers.go`**, **`draft_agent_handler.go`**, **`draft_skill_handler.go`** — Pass `""` for newly created sessions where the subject is not yet fetched.

## Benefits

- Users see a meaningful session title at a glance — no mental mapping from IDs.
- Zero-cost change for new sessions: graceful fallback to the session ID when subject is unavailable.
- No additional API calls; uses data already fetched by the existing session lookup path.

## Impact

- **CLI users**: Improved experience when re-attaching to or resuming sessions.
- **New sessions**: No change in appearance until the subject is populated (future improvement opportunity).

## Related Work

- Session subject generation on the backend (already in place).
- Future: populate subject for newly created sessions by fetching the session object after execution creation.

---

**Status**: ✅ Production Ready
