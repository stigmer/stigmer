# Design Decision 003: Nil-Channel Pattern for Conditional Select Cases

**Status**: Accepted
**Date**: 2026-03-05 (Session 5)
**Context**: Bubbletea v2 migration, Phase 4 (Ctrl+O during follow-up)

## Problem

`renderInline`'s main event loop uses a `select` statement with multiple channel cases: `cfg.events`, `cfg.subjectUpdate`, `cfg.toggleExpandCh`, `cfg.cancelCh`, and (after Phase 4) `r.followUpInputCh`. During the follow-up phase, `cfg.events` and `cfg.subjectUpdate` should no longer be active (the execution is done), while `followUpInputCh` should become active. How to conditionally enable/disable select cases without complex boolean guards?

## Decision

Use Go's nil-channel semantics: a receive on a nil channel blocks forever, effectively disabling that select case. When the renderer enters follow-up mode, `cfg.events` and `cfg.subjectUpdate` are set to nil (disabling them) and `r.followUpInputCh` is set to a live channel (enabling it).

```go
// After DoneEvent, transition to follow-up:
cfg.events = nil         // disable: no more execution events
cfg.subjectUpdate = nil  // disable: subject already resolved or irrelevant
r.followUpInputCh = ch   // enable: now listening for user input
```

## Rationale

1. **Language-level guarantee**: nil channels in select are a well-defined Go idiom, not a workaround. The behavior is specified and reliable.
2. **No boolean guards**: Alternative approaches (wrapping each case in `if enabled`) make the select harder to read and error-prone. The nil-channel approach keeps the select clean.
3. **Single select statement**: The event loop stays as one `select` block rather than branching into multiple loop variants for different lifecycle phases.

## Trade-off

Config channel fields are mutated (set to nil), which modifies the caller's struct. This is documented in the code and is acceptable because `inlineRenderConfig` is consumed once per `renderInline` call and not reused.

## References

- Go specification: "A receive from a nil channel blocks forever"
- Checkpoint: `checkpoints/2026-03-05-session-5.md`
- Implementation: `run_stream_inline.go` (follow-up activation block)
