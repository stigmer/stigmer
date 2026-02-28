# Shared Agent Execution Layer for CLI Run and Draft Commands

**Date**: March 1, 2026

## Summary

Extracted a shared agent execution layer that eliminates all orchestration duplication between `stigmer run agent` and `stigmer draft`. Both commands now share the same flag definitions, preparation pipeline, and agent execution flow through a three-layer architecture: shared flags, shared preparation, and shared execution. This also brings full `run` capabilities (workspace, env vars, secrets, org override, detach) to `draft` commands for the first time.

## Problem Statement

The `stigmer draft skill` and `stigmer draft agent` commands are convenience wrappers that invoke hardcoded system agents (`skill-creator`, `agent-creator`). They were built as copies of the `stigmer run agent` flow, leading to significant code duplication at three levels.

### Pain Points

- **Flag duplication**: 13 of 16 fields in `draftOptions` were identical to fields in `runOptions`, with flag registration code duplicated across both commands
- **Preparation duplication**: The validation pipeline (approve-default parsing, workspace parsing, env loading, auto-env credential resolution, backend connection, attachment processing) was duplicated line-for-line between `executeRun()` and `executeDraft()`
- **Execution duplication**: The agent execution flow (workspace session creation, execution creation, detach/stream, artifact download) was duplicated between `runAgent()` and `executeDraft()`
- **Handler duplication**: `draft_skill_handler.go` and `draft_agent_handler.go` were near-identical 130-line files differing only in three string literals
- **Missing capabilities**: Draft commands lacked workspace support, environment variables, secrets, org override, and detach mode that `run` supported
- **Missing auto-env resolution**: Draft commands skipped `resolveAndMergeAutoEnv()`, so MCP server credentials from local stores were not auto-injected

## Solution

Introduced a three-layer shared architecture where both `run` and `draft` compose the same building blocks:

1. **Layer 1 - Shared Flag Struct + Registration**: An `agentExecFlags` struct containing all 13 common flags, embedded by both `runOptions` and `draftOptions`. A single `registerAgentExecFlags()` function registers them.

2. **Layer 2 - Shared Preparation**: A `prepareAgentExec()` function that validates flags, parses workspace source, loads env vars, auto-resolves credentials, connects to the backend, and processes workspace-aware attachments. Returns a `preparedAgentExec` struct.

3. **Layer 3 - Shared Agent Execution**: An `executeResolvedAgent()` function that takes a resolved agent and runs it: creates workspace sessions, creates the execution, streams via the alt-screen TUI, and downloads artifacts.

## Implementation Details

### New File: `run_agent_exec.go`

Contains the entire shared layer:
- `agentExecFlags` struct (13 common flag fields)
- `registerAgentExecFlags()` (single source of truth for flag definitions)
- `preparedAgentExec` struct (validated/resolved state ready for execution)
- `prepareAgentExec()` (the common preparation pipeline)
- `resolvedAgentExecInput` struct (everything needed to execute a resolved agent)
- `executeResolvedAgent()` (the common agent execution flow)

### Modified: `run.go`

- `runOptions` now embeds `agentExecFlags` instead of declaring 13 fields
- `NewRunCommand()` calls `registerAgentExecFlags()` + adds only `--download`
- `executeRun()` reduced to ~15 lines: type validation, `prepareAgentExec()`, route
- `routeRun()` takes `*preparedAgentExec` instead of 12 positional parameters

### Modified: `run_handlers.go`

- `runAgent()` deleted entirely (body moved to `executeResolvedAgent()`)
- `runWorkflow()` takes `*preparedAgentExec` instead of individual parameters
- Net deletion of ~120 lines

### Modified: `draft_handler.go`

- `draftOptions` embeds `agentExecFlags` instead of declaring 13 fields
- `registerDraftFlags()` calls `registerAgentExecFlags()` + adds `--output`, `--model`, `--auto-approve`
- `executeDraft()` reduced to ~45 lines: `prepareAgentExec()`, resolve system agent, `executeResolvedAgent()`

### Deleted: `draft_skill_handler.go`, `draft_agent_handler.go`

- 260 lines of near-duplicate code eliminated (replaced by unified `draft_handler.go` in the prior step)

### Simplified: `draft_skill.go`, `draft_agent.go`

- Thin wrappers: define `draftConfig`, call `registerDraftFlags`, delegate to `executeDraft`

## Benefits

- **Single source of truth**: Flag definitions, preparation pipeline, and agent execution logic each exist in exactly one place
- **Net reduction of ~550 lines** across the CLI command layer (629 deletions, ~80 additions in new shared file)
- **Draft commands gain full `run` capabilities**: `--workspace`, `--branch`, `--commit`, `--env`, `--env-file`, `--secret`, `--secret-file`, `--org`, `--detach`
- **Auto-env resolution** now works for draft commands (MCP server credentials from gh, planton, stigmer CLI)
- **Workspace-aware attachment processing** now works for draft commands
- **`routeRun` signature** reduced from 12 positional parameters to a struct, improving readability
- **Future draft subcommands** (e.g., `draft workflow`) get all capabilities automatically by embedding `agentExecFlags`

## Impact

- **CLI users**: `stigmer draft skill` and `stigmer draft agent` now support the same options as `stigmer run agent`
- **CLI maintainers**: Adding a new flag to agent execution only requires changing `agentExecFlags` + `registerAgentExecFlags()` -- it flows to all commands automatically
- **No breaking changes**: All existing behavior preserved; new flags default to empty/false

## Related Work

- Builds on the workspace support added in the `run` command
- Builds on the auto-env credential resolution feature (`resolveAndMergeAutoEnv`)
- Foundation for any future convenience commands that wrap agent execution

---

**Status**: Production Ready
**Timeline**: Single session
