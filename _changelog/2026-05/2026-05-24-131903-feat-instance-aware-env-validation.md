# Instance-Aware Env Var Validation in Run Dialog

**Date**: May 24, 2026

## Summary

Made the workflow run dialog aware of which environment variables are already provided by the selected instance's bound environments. The form now skips validation for those keys, shows them as "Provided by instance" with an optional override, and reorders the instance selector above env var inputs so the user sees the effect immediately.

## Problem Statement

When a user selected a workflow instance that already had `POSTGRES_CONNECTION_URL` configured via its bound environments, the run dialog still showed it as required and blocked submission. The backend already merges instance environments at execution time via `envmerge.MergeEnvironmentLayers`, so the var would be available — but the client-side form had no knowledge of this and demanded manual entry.

### Pain Points

- Users with properly configured instances were blocked from submitting workflow runs
- Required env vars that were already satisfied by instance environments appeared as validation errors
- The form ordering (env vars first, instance picker last) meant users saw validation errors before they could select their instance
- No connection between the `diffEnv` pattern used in agent/MCP flows and the workflow run form

## Solution

Added a new `useInstanceEnvKeys` hook that resolves the selected instance's `environmentRefs` into the set of env var keys those environments provide, then wired it into validation and rendering so satisfied vars are treated as optional overrides.

## Implementation Details

### New hook: `useInstanceEnvKeys`

- Accepts `WorkflowInstance | null` and `org` string
- Fetches each referenced environment via `stigmer.environment.getByReference`
- Collects all keys from `Environment.spec.data` into a `Set<string>`
- Returns `{ instanceEnvKeys, isLoading }` with proper cleanup/cancellation
- Falls back to empty set on error (safe — user can still enter manually)

### Updated `useRunWorkflowFlow`

- Derives `selectedInstance` from `instances` + `selectedInstanceId`
- Calls `useInstanceEnvKeys(selectedInstance, org)`
- Exposes `instanceEnvKeys` and `isLoadingInstanceEnvKeys` in return type
- Validation now skips keys present in `instanceEnvKeys`

### Updated `WorkflowRunForm`

- Accepts new `instanceEnvKeys` prop
- Instance selector moved **above** env var inputs (progressive disclosure)
- Instance-satisfied vars: no red asterisk, placeholder "Provided by instance", hint about override
- Override still possible — user-entered values sent as `runtimeEnv` (highest merge priority)

### Updated `WorkflowRunDialog`

- Passes `flow.instanceEnvKeys` through to the form

### Test

- Added test case verifying required env vars satisfied by instance environments don't block submission
- All 18 existing tests continue to pass

## Benefits

- Users with configured instances can submit workflow runs without re-entering env vars
- Form ordering now follows progressive disclosure (pick instance → see effect on env vars)
- Override capability preserved — users can still type values to override instance-provided vars
- Graceful degradation — on fetch failure, falls back to requiring manual entry

## Impact

- **Users**: Unblocks the primary workflow run path for users who have set up instances with environments
- **SDK surface**: 1 new hook (`useInstanceEnvKeys`) + new return fields on `useRunWorkflowFlow` + new optional prop on `WorkflowRunForm`
- **Zero breaking changes**: All new props/fields are optional with backward-compatible defaults

---

**Status**: Production Ready
