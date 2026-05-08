# Fix: localStorage Preference Validation Gate for Session Flow

**Date**: May 8, 2026

## Summary

Fixed a class of bugs where localStorage-persisted session preferences (harness, runner, model) could become stale and cause incorrect execution behavior. The ModelSelector harness desync bug — where selecting a Stigmer model resulted in Cursor's "Auto" being used — was the primary symptom. Added a validation gate pattern ensuring stored values are always verified against live system state before being applied.

## Problem Statement

Users reported that after selecting a Stigmer (native) model and submitting a new session, the execution would use Cursor's "Auto" model instead. Investigation revealed three related issues stemming from localStorage persistence without validation.

### Pain Points

- **Harness desync**: The `ModelSelector` component initialized its internal harness to `"native"` regardless of the parent flow's actual harness (which could be `"cursor"` from localStorage). The user sees one thing, the system does another.
- **Stale runner**: A previously-selected runner that was deleted or deregistered would still be sent in session creation, causing failures.
- **Model timing gap**: The model restore effect could run before the registry finished loading, finding no match against an empty dataset and silently failing to restore the preference.

## Solution

Established the architectural principle: **localStorage is a hint, not truth.** Every stored value passes through a validation gate before being applied to session state.

```
localStorage.getItem() → validate against live state → valid? apply : discard to default
```

## Implementation Details

### Part 1: Harness Desync (ModelSelector)

Added `initialHarness` prop to `ModelSelector` so `ComposerToolbar` can seed the correct harness from the parent flow's persisted state. Added a `useEffect` to sync when the prop changes after mount, covering dynamic harness transitions.

**Files**: `sdk/react/src/models/ModelSelector.tsx`, `sdk/react/src/composer/ComposerToolbar.tsx`

### Part 2: Runner Validation Gate

Added `useRunnerList(org)` to `useNewSessionFlow`. The stored runner ID is validated against the live runner list before being applied. Stale IDs are discarded and localStorage is cleaned up automatically.

**File**: `sdk/react/src/session/useNewSessionFlow.ts`

### Part 3: Model Timing Guard

Guarded the model restore effect with `isModelsLoading` from the model registry context. The effect now waits for the registry to load before attempting validation, eliminating the false-negative window.

**File**: `sdk/react/src/session/useNewSessionFlow.ts`

### Tests

Added 6 new test cases covering:
- Runner restore when valid, discard when stale, no-op while loading
- Model no-restore while loading, restore when valid, discard when stale

**File**: `sdk/react/src/session/__tests__/useNewSessionFlow.test.tsx`

## Benefits

- Eliminates the "wrong model on submit" bug entirely
- Prevents stale runner IDs from causing session creation failures
- Establishes a reusable validation pattern for any future localStorage-persisted preferences
- Self-cleaning: stale localStorage entries are removed automatically
- Zero UX regression: valid preferences still restore instantly

## Impact

- **Direct users**: Model selection now works correctly across sessions regardless of previous harness state
- **Platform builders**: `ModelSelector` component now accepts `initialHarness` for correct initialization in custom integrations
- **Future development**: When a UserPreferences API resource is added, the validation gate pattern stays — only the storage backend changes

## Related Work

- Follows the model registry migration from static JSON to authenticated API (commit `72ee4891d`)
- Builds on the SSR fix for undefined defaultModel in ModelSelector (commit `bdfdcc78c`)

---

**Status**: Production Ready
**Timeline**: Single session
