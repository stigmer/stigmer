# SDK/React Session Harness Selector

**Date**: April 30, 2026

## Summary

Added harness selection to the React SDK — a `HarnessSelector` segmented control component, harness-aware model filtering, per-harness model persistence, and full threading from the composer UI through session creation to the server. This is the final task (T08) of the Cursor Harness project, completing the end-to-end integration of Cursor as a premium execution engine alongside Stigmer's native harness.

## Problem Statement

The Cursor Harness project (T01–T09) added a second execution engine to Stigmer — sessions can now run on either the native LangGraph-based engine or the Cursor SDK. The backend, workflow dispatch, Temporal workers, billing, and packaging were all in place, but the React SDK had no way for users to select which harness to use when creating a session, and no way to filter models or persist preferences per harness.

### Pain Points

- Users had no UI control to choose between native and Cursor execution engines
- The model selector showed all models regardless of harness — Cursor-only models were hidden by `DISABLED_PROVIDERS` and native models would be invalid for Cursor sessions
- Model preferences were stored in a single localStorage key, meaning switching harnesses would overwrite the user's preferred model for the other engine
- The session page flow had no awareness of the session's harness, so follow-up messages couldn't filter models correctly

## Solution

Added a `HarnessSelector` component (segmented control) to the composer toolbar, with harness-aware model filtering throughout the SDK's hook and component layers. The harness value threads from the UI through `useNewSessionFlow` → `useCreateSession` → `stigmer.session.create()` to the server. For existing sessions, the harness is derived read-only from `session.spec.harness` and used to filter models for follow-up messages.

## Implementation Details

**New files (2):**
- `sdk/react/src/models/harness.ts` — `HarnessOption` type alias (`"native" | "cursor"`), `HARNESS_LABELS` display map, `toProtoHarness()`/`fromProtoHarness()` converters, `DEFAULT_HARNESS`
- `sdk/react/src/models/HarnessSelector.tsx` — Segmented control with `role="radiogroup"`, arrow-key navigation, ARIA compliance, and a premium tier indicator on the Cursor segment

**Modified files (12):**
- `useModelRegistry.ts` — `UseModelRegistryOptions` with optional `harness` param. When `"cursor"`, bypasses `DISABLED_PROVIDERS` and shows only cursor-provider models
- `ModelSelector.tsx` — Optional `harness` prop threaded to `useModelRegistry`
- `ComposerToolbar.tsx` — `showHarnessSelector`, `harness`, `onHarnessChange` props; renders `HarnessSelector` before `ModelSelector`
- `SessionComposer.tsx` — Harness props with auto-reset logic (resets model to harness default when current model is invalid for the new harness)
- `useCreateSession.ts` — `harness` in `SharedSessionFields`, proto conversion via `toProtoHarness()`
- `useNewSessionFlow.ts` — Harness state with localStorage persistence, per-harness model storage keys (`stigmer:session:model` for native, `stigmer:session:model:cursor` for cursor)
- `usePersistedModel.ts` — Optional `harness` param, harness-qualified storage key, harness-filtered registry validation
- `useSessionPageFlow.ts` — Derives `harness` from `session.spec.harness`, passes to `usePersistedModel`, exposes for badge rendering
- `registry.ts`, `models/index.ts`, `session/index.ts`, `index.ts` — Barrel exports updated

**Key design decisions:**
- String literals (`"native" | "cursor"`) on component props, proto enums inside hooks — platform builders never import proto types
- Per-harness model persistence preserves user preference per engine; legacy key doubles as native key for backward compatibility
- Harness selector hidden on session page (immutable after first execution) — harness exposed as read-only for badge display

## Benefits

- Users can now choose between Stigmer (native) and Cursor (premium) engines when creating a session
- Model selector automatically adapts to show only valid models for the selected harness
- Model preferences persist independently per harness — switching engines doesn't lose the user's preferred model
- Follow-up messages on existing sessions automatically filter models by the session's harness
- All new code lives in `@stigmer/react` — zero Console-specific dependencies, fully reusable by platform builders

## Impact

- **End users**: Can select their execution engine and see relevant models immediately
- **Platform builders**: `HarnessSelector`, `HarnessOption`, `HARNESS_LABELS`, and harness-aware hooks are all public API
- **Cursor Harness project**: T08 completes the final task — all 9 tasks (T01–T09) are now done

## Related Work

- T01: Proto foundation (`Harness` enum, `SessionSpec.harness`)
- T03: Cursor Runner TypeScript service
- T04: Workflow harness dispatch
- T06: Cost model and billing integration (Cursor model entries in `MODEL_REGISTRY`)
- T07: Session lifecycle (session delete restrictions, resume hardening)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~45 minutes)
