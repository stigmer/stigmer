# Approval Result Rendering Primitives

**Date**: March 4, 2026

## Summary

Added rendering primitives for the collapsed post-decision view in the inline CLI approval flow. Three public functions — `RenderApprovalResult`, `ApprovalSeparator`, and `ApprovalQuestion` — provide the building blocks that Phase 3.3 will compose into the four-state approval UX (streaming → waiting → collapse → scrollback).

## Problem Statement

The inline CLI renderer needs to collapse expanded tool content (streamed file content + approval menu) into a compact summary after the user approves, rejects, or skips a tool call. Without dedicated rendering functions, the collapse logic in Phase 3.3 would mix formatting concerns with event orchestration.

### Pain Points

- No rendering function exists for the collapsed post-decision view
- The approval flow needs action-colored bullets (green/red/dim) not present in compact renderers
- The `└` connector visual element doesn't exist in the rendering vocabulary
- No contextual approval question generator ("Do you want to create X?")
- No separator element for the expanded approval view

## Solution

New `render_approval.go` file in `pkg/toolrender/` providing pure rendering functions with no side effects. Follows the established graduated dispatch pattern from `render_compact.go` — routes by tool label to produce tool-type-specific output.

## Implementation Details

### Public API

- **`RenderApprovalResult(tc, action, opts)`** — Collapsed post-decision view. Action-colored bullet (`●` green/red/dim), tool header with `Label(arg)` format, `└` connector with summary text, and optional content preview (up to 10 lines with 4-space indent). Preview rules: shown for approved/rejected write/edit, skipped for approved shell (output streams separately), never for delete (no content body) or skip (user doesn't care).

- **`ApprovalSeparator()`** — Dim horizontal separator (`────────────────────────`, 24 chars) for the expanded approval view between content and prompt.

- **`ApprovalQuestion(tc)`** — Contextual question with verb mapping: Write/Create → "create", Edit → "edit", Shell/Execute → "execute", Delete → "delete", unknown → "run {toolName}".

### Internal Helpers (8 functions)

`approvalBullet`, `renderApprovalHeader`, `buildApprovalConnector`, `approvedSummary`, `approvalVerb`, `shouldShowApprovalPreview`, `formatApprovalPreview`, `renderApprovalUnknown`.

### Design Decisions

- **String action over `approval.Action` type**: Avoids cross-package dependency. Uses `"approve"`, `"skip"`, `"reject"` strings matching the `ApprovalResponse` protocol.
- **Separate file**: `render_compact.go` (578 lines) handles compact status display. Approval rendering is a distinct concern with its own constants and helper set. Continues the SRP-per-file pattern.
- **`shouldShowApprovalPreview` predicate**: Centralizes visibility rules so `RenderApprovalResult` stays clean and each rule is independently testable.
- **Smart cutoff (10+1)**: Shows all lines when count <= 11, truncates to 10 + footer for 12+. Same pattern as shell (3+1), think (3+1), read groups (3+1).

## Benefits

- Phase 3.3 can focus purely on event orchestration — all formatting is pre-built and tested
- 38 test functions verify every action/tool-type combination, preventing visual regressions
- Action-colored bullets provide at-a-glance approval status in terminal scrollback
- Content preview in collapsed view preserves context without consuming screen space

## Impact

- **Phase 3.3**: Will call `RenderApprovalResult` after cursor-control erase to produce the collapsed view
- **Phase 3.3**: Will use `ApprovalSeparator` and `ApprovalQuestion` in the expanded waiting-approval state
- **No existing behavior changed**: All existing compact/running renderers untouched

## Related Work

- Phase 3.0: Terminal cursor control primitives (`pkg/termctl/`)
- Phase 3.1: Custom inline prompter (`pkg/approval/inline_prompter.go`)
- Phase 3.3 (next): Rewrite `handleApproval` to orchestrate expand/prompt/collapse

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
