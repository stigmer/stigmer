# Design Decision 002: Session Header Stays as Committed Content

**Date**: 2026-03-05
**Status**: Accepted
**Context**: Phase 3 planning -- header/subject migration

## Decision

The session header panel remains as committed content rendered directly to stderr before the Bubbletea program starts. It is NOT moved into Bubbletea's `View()`. The in-place subject update mechanism is removed entirely.

## Original T01 Plan Assumption (Superseded)

Phase 3 described: "Move session header into View() and replace manual cursor save/restore with Bubbletea re-rendering."

## What We Discovered

Bubbletea inline mode has a fixed layout contract:
- `View()` renders at the **bottom** of the terminal, always.
- `tea.Println()` commits content **above** the View region.

Putting the header in `View()` would mean all subsequent output (tool calls, AI messages via `Println`) appears ABOVE the header -- an inverted display order. The header is top-of-session context; it belongs at the top, not the bottom.

## Alternatives Considered

| Approach | Outcome |
|----------|---------|
| Header in View() | All Println content appears above header -- inverted display |
| Header as sticky bottom status bar | Permanently consumes 7-10 lines; fundamentally different UX |
| All output in View() (no Println) | View grows unboundedly; 80ms re-render of entire session history |
| Hybrid: header at top + 1-line status bar at bottom | Adds complexity for marginal gain |
| Wait for subject before rendering header | 2-10s delay before any output; violates "never leave user waiting" |

## What We Did Instead

- Render header via direct stderr write before Bubbletea starts (unchanged from current behavior)
- Omit the Subject field from new session headers (no placeholder dash)
- Subject appears naturally on session resume (already resolved from backend)
- Delete all ANSI cursor math: `lineCountingWriter`, `subjectUpdater`, `pollSessionSubject`

## Future Option

The `lineCountingWriter` approach can be reintroduced later as a small, contained hack if in-place subject update is desired. The wrapping bug it carries only manifests when the header panel itself soft-wraps (rare at typical terminal widths of 80+ columns).

---

## Update (v2 Migration, 2026-03-05)

The v2 migration (project 20260305.03) resolved the subject update limitation without reverting this decision. The `\033[3J` scrollback clear + full history replay mechanism (see `20260305.03/design-decisions/001-scrollback-clear-3J.md`) allows the header to be re-rendered with the resolved subject via re-commit. The header stays as committed content (this decision holds), and subject update works via clear+replay (no in-place cursor math needed).
