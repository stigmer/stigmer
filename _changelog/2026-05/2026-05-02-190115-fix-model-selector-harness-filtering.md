# Fix Model Selector: Follow-Up Auto-Selection and Harness Filtering

**Date**: May 2, 2026

## Summary

Fixed two model selector bugs in the session follow-up composer: (1) the dropdown not pre-selecting the model from the previous execution ("Auto" on Cursor harness), and (2) non-Cursor models sporadically appearing in Cursor sessions. Both issues manifested in the Tauri desktop app.

## Problem Statement

When a user creates a Cursor-harness session, selects "Auto" model, and completes an execution, the follow-up composer's model dropdown should show "Auto" pre-selected. It did not. Additionally, the dropdown sometimes displayed native/Stigmer models inside a Cursor session instead of filtering to cursor-only models.

### Pain Points

- Follow-up messages defaulted to wrong model, forcing manual re-selection every turn
- Non-Cursor models appearing in Cursor sessions violated the harness filtering contract
- Both issues eroded trust in the execution configuration flow

## Solution

Four targeted fixes across the React SDK's model selection chain, addressing compound key corruption in localStorage, stale state initialization, missing prop synchronization, and an overly permissive harness-locking condition.

## Implementation Details

### Fix 1: `ComposerToolbar` harness locking

Changed `harnessLocked` from `harness !== undefined && !showHarnessSelector` to `harness !== undefined`. When a harness is explicitly set (by the launcher's selector or the session page), the model dropdown now always filters to that harness's models. Unified mode only activates when no harness preference exists.

### Fix 2: `usePersistedModel` compound key handling + key-change re-sync

- Added `extractPlainModelId()` using `parseModelKey()` to handle legacy compound keys (`"cursor/default"` → `"default"`) read from localStorage
- Added a `useEffect` that re-reads from localStorage when the storage key changes (harness transition from "native" during loading to "cursor" after session loads)

### Fix 3: `useNewSessionFlow` compound key stripping

All three localStorage interaction paths (persist effect, harness-switch restore, mount restore) now strip compound keys via `parseModelKey()` before storing or validating, preventing future corruption.

### Fix 4: `SessionComposer` prop sync

Replaced raw `useState(defaultModelId)` with a controlled sync pattern: a `userOverrodeModel` ref tracks whether the user has manually selected a model. External `defaultModelId` changes (e.g., `lastExecModelId` resolving after executions load) now propagate to the internal state unless the user has overridden.

## Benefits

- Model selector always reflects the previous execution's model choice for follow-up messages
- Harness filtering is a strict invariant: Cursor sessions only show Cursor models
- localStorage compound key corruption is self-healing (legacy values parsed gracefully)
- No SDK public API changes — all fixes are internal behavioral corrections

## Impact

- **SDK React**: `ComposerToolbar`, `SessionComposer`, `usePersistedModel`, `useNewSessionFlow`
- **Web Console + Desktop App (Tauri)**: Both benefit from the same fixes
- **Platform Builders**: Embeddable `SessionComposer` component behavior is now correct without workarounds
- **Tests**: 13 new tests added (11 for `usePersistedModel`, 2 for `useNewSessionFlow`), full suite 243/243 passing

## Related Work

- Session harness model introduced in cursor-harness event visibility work
- Model registry unification from earlier in this sprint

---

**Status**: ✅ Production Ready
