# Web/SDK Architecture Standards — Workstream A: Design Decisions

**Date**: April 23, 2026

## Summary

Codified the existing SDK-first architectural principles — previously embedded only in role files and conversation preambles — into 8 numbered design decisions, 5 dont-do anti-patterns, and 1 auto-loading cursor rule. This is the documentation foundation for the broader web-sdk-architecture-standards project.

## Problem Statement

Stigmer's SDK-first architecture (`@stigmer/protos` → `@stigmer/sdk` → `@stigmer/theme` → `@stigmer/react` → Console) was well-established in practice but not formally documented as standalone, referenceable decisions. The architectural principles lived in three role files (`001_architect.md`, `004_web_ux_ui.md`, `006_ux_designer.md`) and in a text block that was manually pasted into every AI conversation.

### Pain Points

- Architectural principles were discoverable only by reading lengthy role files end-to-end
- No numbered, traceable identifiers for referencing specific decisions in code reviews or discussions
- Anti-patterns were described in prose but not cataloged with detection methods
- AI agents working on web/SDK files had no auto-loaded architecture context unless the developer manually pasted a preamble

## Solution

Extracted existing decisions into the ADR (Architecture Decision Record) pattern — each decision gets its own file with context, rationale, consequences, source traceability, and enforcement mechanisms. Created a complementary set of dont-do files cataloging anti-patterns with detection commands. Consolidated the operational guidance into a cursor rule that auto-loads when editing web or SDK React files.

## Implementation Details

### Design Decisions (8 files)

| DD | Title | Core Principle |
|----|-------|---------------|
| DD-001 | SDK-first development | Build in `@stigmer/react` first, Console second |
| DD-002 | Console is a thin shell | `app/` is routes + layout only, zero domain logic |
| DD-003 | Headless-first architecture | Data hooks → behavior hooks → styled components |
| DD-004 | Zero framework deps in SDK | No `next/*`, no Console routing in SDK |
| DD-005 | Theme token compliance | All visuals via `--stgm-*` tokens, scoped isolation |
| DD-006 | Error messages as UX | What happened, why, what to do |
| DD-007 | Generated types are source of truth | Protos → SDK → React, never hand-rolled |
| DD-008 | Single provider model | `StigmerProvider` + `useStigmer()` only |

### Dont-Dos (5 files)

Each includes detection commands (grep patterns) and "what to do instead" guidance:

1. No Console imports in SDK
2. No framework dependencies in SDK
3. No hardcoded colors or sizes
4. No opacity modifiers on tokens
5. No technical-function grouping in Console

### Cursor Rule

`.cursor/rules/client-apps/web/sdk-console-architecture.mdc` — 87 lines, scoped to `client-apps/web/src/**/*.{tsx,ts}` and `sdk/react/src/**/*.{tsx,ts}`. Incorporates the architecture preamble that was previously pasted manually, references all DDs and dont-dos by number, and includes a 5-point checklist for evaluating any new component.

## Benefits

- **Traceability**: Every architectural principle has a DD number that can be cited in PRs, discussions, and code comments
- **Discoverability**: New contributors and AI agents find the rules without reading 180+ lines of role files
- **Auto-enforcement**: The cursor rule loads automatically when working on relevant files — no manual preamble pasting
- **Detection**: Each dont-do includes concrete grep/lint commands for catching violations
- **Foundation**: Workstreams C (metrics) and B (restructuring) can reference these decisions as their governing constraints

## Impact

- **AI agents**: Auto-loaded architecture context when editing web/SDK files via the new cursor rule
- **Contributors**: Numbered decision catalog for onboarding and code review reference
- **Project continuity**: Workstreams C and B have a documented set of invariants to verify against

## Related Work

- Part of project `20260423.01.web-sdk-architecture-standards`
- Workstream C (Architectural Metrics) and Workstream B (Console Domain Organization) to follow
- Extends existing `.cursor/rules/client-apps/web/theme-token-guidelines.mdc`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
