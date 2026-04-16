# Task T10: Validation and Testing Updates

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Testing
**Depends on**: T01-T09

## Goal

Update `validate-demos.ts` and Playwright specs to cover all new interaction types and viewport sizes introduced in T01-T09.

## Implementation

### 1. Update validate-demos.ts

- Extend the auto-derived visibility contract extraction to recognize new action types: `click`, `type`, `hover`, `drag`, `viewport-transition`
- For `click` actions: extract target as a visibility requirement (element must be visible and clickable)
- For `type` actions: extract `data-type-target` elements as visibility requirements
- For `hover` actions: extract target as a visibility requirement
- For `drag` actions: extract both `data-drag-source` and `data-drag-target` as visibility requirements
- For `viewport-transition`: extract `data-viewport-target` as a visibility requirement

### 2. Update Playwright specs

- `demo.spec.ts`: Add assertions for new interaction types (verify click targets are interactive, type targets are focusable, etc.)
- `demo-visibility.spec.ts`: Add contract fields for new interaction types (`clickMustWork`, `typeMustFocus`, `hoverMustReveal`, `dragMustComplete`)
- Both specs: Run against all 5 viewport projects from T03

### 3. Screenshot baselines

- Regenerate baselines at all viewport sizes after T01 fix
- Add baselines for steps that use new interaction types
- Verify `maxDiffPixelRatio` tolerance is appropriate across all viewports

### 4. CI integration

- Update CI workflow to run the expanded Playwright test matrix
- Ensure test results are reported per viewport project
- Set up baseline management for multi-viewport screenshots

## Success Criteria

- `validate-demos.ts` extracts visibility requirements for all 8 interaction types
- Playwright tests cover all interaction types with appropriate assertions
- All tests pass at all 5 viewport sizes
- CI runs the full test matrix
- Screenshot baselines exist for all contracted steps at all viewports
