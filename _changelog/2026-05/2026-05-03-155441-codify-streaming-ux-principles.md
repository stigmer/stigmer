# Codify Streaming UX Principles into Roles and Rules

**Date**: May 3, 2026

## Summary

Extracted the architectural patterns, performance principles, anti-patterns, and dependency policies established during the React SDK Streaming UX project (20260503.01) into the three files that guide all future web/frontend work: the `sdk-console-architecture.mdc` rule, the `004_web_ux_ui.md` role, and the `006_ux_designer.md` role. This ensures future sessions inherit these standards automatically without needing to re-read the completed project's session notes.

## Problem Statement

The React SDK Streaming UX project completed 11 phases across 11 sessions, producing ~18 significant design decisions and anti-patterns. All of this knowledge was captured only in `next-task.md` session progress notes — the roles and rules that are routinely pulled into web development conversations had zero coverage of streaming data architecture, React performance patterns for real-time views, SDK backward-compatibility policies, dependency licensing, animation accessibility, or data fetching patterns.

### Pain Points

- Future web/frontend sessions would not inherit the established streaming architecture without manually pulling the completed project's `next-task.md`
- Key anti-patterns (e.g., `useState(snapshot)` for streaming data, full-object callback dependencies, `@starting-style` in virtualized contexts) had no enforcement mechanism
- SDK dependency license policy and opt-in behavior change policy were undocumented in any rule file
- The UX Designer role had no guidance on treating real-time data flow architecture as a UX concern

## Solution

Updated three files with targeted additions that codify the project's learnings as enforceable standards:

1. **`sdk-console-architecture.mdc`** — 7 new Design Decisions (DD-009 through DD-015) and 3 new Dont-Dos
2. **`004_web_ux_ui.md`** — New "Streaming & Real-Time View Standards" sub-section
3. **`006_ux_designer.md`** — New mandate item and journey mapping guidance

## Implementation Details

### sdk-console-architecture.mdc (DD-009 through DD-015)

- **DD-009**: Streaming data pipeline — StreamController FSM, rAF coalescing, structural sharing, startTransition, useSyncExternalStore, React.memo
- **DD-010**: Reference stability — useMemo on hook returns, narrow callback deps
- **DD-011**: Opt-in SDK behavior changes — backward-compatible defaults, no mid-session switching
- **DD-012**: SDK dependency license policy — MIT/Apache-2.0 only, commercial deps isolated to Console
- **DD-013**: React.lazy for optional heavy dependencies — tree-shaking, optional peer deps
- **DD-014**: FetchCache for cross-mount persistence — cacheKey + key-remount coexistence
- **DD-015**: Animation accessibility — prefers-reduced-motion, 0.01ms not 0ms, class-based over @starting-style

New Dont-Dos: No `useState(snapshot)` for streaming (#6), no full-object callback deps (#7), no `@starting-style` in virtualized contexts (#8).

### 004_web_ux_ui.md

Added "Streaming & Real-Time View Standards" under Quality Standard point 1, covering: the structural-sharing pipeline, row-level re-render isolation, referential stability requirements, content-agnostic IO/RO auto-scroll, and opt-in behavior defaults.

### 006_ux_designer.md

Added mandate item 8 ("Real-Time Data Flow Is a UX Concern") establishing that streaming data architecture is a UX decision. Added streaming data flow mapping guidance to the Journey Mapping process step.

## Benefits

- Future web/frontend conversations automatically inherit streaming architecture standards via the `.mdc` rule (applied to all `sdk/react/src/**` and `client-apps/web/src/**` files)
- Anti-patterns are explicitly listed as Dont-Dos — agents will avoid them without needing project-specific context
- The UX Designer role now treats streaming data flow as a first-class UX concern, not just an implementation detail
- Dependency licensing and backward-compatibility policies are formalized for the first time

## Impact

- **All future SDK/Console development** — The `sdk-console-architecture.mdc` rule applies to every TypeScript file in `sdk/react/src/` and `client-apps/web/src/`
- **All web UX design sessions** — The `004_web_ux_ui.md` and `006_ux_designer.md` roles are pulled into conversation for any web/frontend work
- **Platform builders** — The codified patterns ensure consistent streaming quality in embeddable components

## Related Work

- `2026-05-03-102015-react-sdk-streaming-render-instrumentation.md` — T02 instrumentation
- `2026-05-03-153020-react-sdk-animation-polish.md` — T12 final phase
- Project: `_projects/2026-05/20260503.01.react-sdk-streaming-ux/`

---

**Status**: Production Ready
**Timeline**: Single session
