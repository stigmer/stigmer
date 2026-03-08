# Unify `--model` and `--auto-approve` Flags Across `run` and `draft`

**Date**: March 8, 2026

## Summary

Promoted `--model` and `--auto-approve` from draft-only flags into the shared `agentExecFlags` layer so that both `stigmer run` and `stigmer draft` expose identical execution options. This eliminates a flag registration gap that caused `stigmer run agent ... --model` to fail with `Error: unknown flag: --model`.

## Problem Statement

The `stigmer draft` command supported `--model` and `--auto-approve` flags, but the `stigmer run` command did not — despite both commands converging on the same `executeResolvedAgent()` execution path. The shared `resolvedAgentExecInput` struct already carried `Model` and `AutoApproveAll` fields, and the backend API already accepted both. The gap was purely at the CLI flag registration level.

### Pain Points

- `scan-infra-requirements.sh` (and any script passing `--model` to `stigmer run`) failed with `Error: unknown flag: --model`
- Users could override the LLM model when drafting but not when running an agent directly, which is inconsistent since `draft` is just `run` with a pre-selected system agent
- The `--auto-approve` flag had the same asymmetry — available on `draft` but not on `run`

## Solution

Moved `Model` and `AutoApproveAll` into the shared `agentExecFlags` struct and its registration function `registerAgentExecFlags()`. Since `draft` calls `registerAgentExecFlags` internally, both commands now automatically inherit these flags with zero duplication.

## Implementation Details

### Shared layer (`run_agent_exec.go`)

- Added `Model string` and `AutoApproveAll bool` to the `agentExecFlags` struct
- Registered `--model` and `--auto-approve` flags in `registerAgentExecFlags()`
- Added both fields to `preparedAgentExec` so they flow through the shared preparation path
- Populated both fields in `prepareAgentExec()` from the flags

### Draft handler (`draft_handler.go`)

- Removed `Model` and `AutoApprove` from `draftOptions` (now inherited via embedded `agentExecFlags`)
- Removed duplicate `--model` and `--auto-approve` registrations from `registerDraftFlags()`
- Updated `executeDraft()` to read from `prep.Model` / `prep.AutoApproveAll` instead of the removed fields

### Run paths (`run.go`, `run_picker.go`)

- Wired `Model` and `AutoApproveAll` from `preparedAgentExec` into `resolvedAgentExecInput` across all 4 code paths: `routeRun`, `executeRunByAgentID`, `executeRunWithFallback`, `launchAgentPickerAndRun`
- Added `EXECUTION OPTIONS` section to the run command's long help text
- Added usage examples for `--model` and `--auto-approve`

## Benefits

- **Flag consistency**: `run` and `draft` now expose the exact same execution options
- **Zero duplication**: Flag definitions exist in exactly one place (`registerAgentExecFlags`)
- **Script compatibility**: `scan-infra-requirements.sh` and similar scripts can pass `--model` to `stigmer run` without error
- **Future-proof**: Any new agent-execution command that embeds `agentExecFlags` automatically gets these flags

## Impact

- CLI users can now pass `--model` and `--auto-approve` to `stigmer run` in addition to `stigmer draft`
- No behavior changes for existing `draft` usage — the flags work identically
- Scripts and automation that invoke `stigmer run agent ... --model` now work correctly

---

**Status**: Production Ready
