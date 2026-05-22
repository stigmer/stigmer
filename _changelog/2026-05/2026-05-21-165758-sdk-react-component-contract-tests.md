# SDK React Component Contract Tests

**Date**: May 21, 2026

## Summary

Added 27 contract tests across 3 new files to protect the public `@stigmer/react` SDK API surface — specifically the previously untested `useComposer` headless hook, the `MessageThread` component's approval callback flow, and `SessionComposer`'s public rendering contract.

## Problem Statement

The `@stigmer/react` SDK exports components and hooks that platform builders depend on as integration contracts. Several critical exports had zero or insufficient test coverage, creating regression risk for external consumers.

### Pain Points

- `useComposer` — a public headless hook exported in the barrel, used by platform builders for custom composer UI — had zero tests
- `MessageThread` — the primary execution viewer — had extensive `buildThreadItems` logic tests but no integration render test verifying approval callback propagation or pending message rendering
- `SessionComposer` — a 1490-line component — had only a memo-structure test; no test verified it renders a textarea, accepts input, or fires `onSubmit`

## Solution

Applied the DD-003 (headless-first) three-layer testing strategy:
1. **Layer 1**: Pure hook unit tests (`useComposer`) — no DOM, no providers
2. **Layer 2**: Component contract render tests (`MessageThread`) — DOM stubs for `useAutoScroll`, props-only
3. **Layer 3**: Styled wrapper contract tests (`SessionComposer`) — minimal `StigmerContext` mock

## Implementation Details

### `useComposer.test.ts` (11 tests)
- Validates the complete public API: `message`, `setMessage`, `canSubmit`, `submit`, `clear`, `textareaProps`
- Tests Enter-to-submit and Shift+Enter-for-newline keyboard contract
- Tests whitespace-only and disabled-state edge cases

### `MessageThread.test.tsx` (8 tests)
- Verifies approval card rendering conditioned on `onApprovalSubmit` presence
- Tests callback propagation: `onApprovalSubmit(toolCallId, action)` fires correctly through `ApprovalCardRow` → `ApprovalCard` → button click
- Verifies `pendingUserMessage` renders with opacity indicator
- Tests `ExecutionPhaseBadge` for failed executions and plan-completion card for Plan mode

### `SessionComposer-contract.test.tsx` (8 tests)
- Tests `role="form"` and `aria-label` a11y contract
- Verifies textarea renders, reflects `placeholder`, respects `disabled` and `isSubmitting` states
- Tests async submit flow (discovered `stigmer.getAuthCredential()` requirement during implementation)

## Benefits

- 27 new tests protecting the public SDK API that platform builders embed in their products
- First behavioral coverage for `useComposer` — the hook that controls Enter/Shift+Enter for every Stigmer composer surface
- Approval callback propagation now regression-tested end-to-end through the `MessageThread` render tree
- Established patterns (DOM stubs, minimal Stigmer mock) that future SDK tests can follow

## Impact

- **Platform builders**: Protected against regressions in the components they integrate (`MessageThread`, `SessionComposer`, `useComposer`)
- **SDK maintainers**: Can refactor internals with confidence that public contracts are guarded
- **Test suite**: Grew from 479 to 506 tests with zero regressions (45 test files, all green)

## Related Work

- Part of the pre-deploy integration test expansion (Workstream F: SDK Component Tests)
- Follows the SDK-first architecture standards defined in `sdk-console-architecture.mdc`

---

**Status**: Production Ready
**Timeline**: 1 session
