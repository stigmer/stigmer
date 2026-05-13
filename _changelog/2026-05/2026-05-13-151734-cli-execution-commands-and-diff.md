# CLI Execution Commands and Diff — Unified Lifecycle Management for All Execution Types

**Date**: May 13, 2026

## Summary

Added a unified `stigmer execution` command group with 7 subcommands (cancel, terminate, pause, resume, logs, trace, approve) that work for both agent and workflow executions via ID prefix auto-detection, plus a generic `stigmer diff -f` command for comparing local YAML with remote server state before applying. This completes T12 (CLI Parity) in the Bring Workflows to the Foreground project.

## Problem Statement

The CLI had full CRUD for workflows (`list/get/delete/apply/run`) but lacked operational commands for managing executions after creation. Operators needed to cancel stuck executions, view event logs, inspect execution traces, submit approvals, and compare local changes with deployed state — all from the terminal.

### Pain Points

- No way to cancel, pause, or resume executions from the CLI after `stigmer run` exits
- No CLI access to workflow execution event logs or execution structure traces
- No way to submit approvals for human_input tasks outside the streaming `run` session
- `stigmer get execution` and `stigmer list executions` only supported agent executions, not workflow executions
- No `stigmer diff` to preview changes before `stigmer apply`

## Solution

Introduced two new command surfaces:

1. **`stigmer execution` noun-group** — 7 subcommands for lifecycle and observability, auto-detecting execution type (agent vs workflow) from the ID prefix (`aex_` vs `wex_`)
2. **`stigmer diff -f`** — generic resource diff that auto-detects kind from YAML and shows colored unified diff against remote state

## Implementation Details

**Architecture**: Follows the established CLI pattern — thin command handlers in `cmd/stigmer/root/`, domain logic in `internal/cli/execution/`. The execution type is resolved at the domain layer via `ResolveType(id)`, which dispatches to the correct Go SDK client.

**New commands**:
- `stigmer execution cancel/terminate/pause/resume` — lifecycle management
- `stigmer execution logs [--follow] [--task]` — event log viewer (workflow: subscribeEvents/getEventLog; agent: subscribe stream)
- `stigmer execution trace [-o yaml|json]` — task tree renderer
- `stigmer execution approve --task/--tool-call` — approval submission
- `stigmer diff -f <file>` — colored unified diff using go-difflib

**Enhanced existing commands**:
- `stigmer get execution` now accepts both `aex_` and `wex_` IDs
- `stigmer list executions` gained `--type agent|workflow` filter

**Files**: 20 new, 3 modified in `client-apps/cli/`

## Benefits

- Operators can manage execution lifecycle entirely from the terminal
- Workflow and agent executions share a single command surface with consistent UX
- Pre-apply diff reduces deployment surprises
- Event logs and traces provide observability without switching to the web UI

## Impact

- CLI users: full operational control over both execution types
- CI/CD pipelines: scriptable execution management (`cancel`, `approve`)
- Workflow developers: `diff` integrates into edit-validate-diff-apply workflow

## Related Work

- T09 (Execution Viewer UI) — the web counterpart to `logs` and `trace`
- T11 (Run Workflow from UI) — the web counterpart to `stigmer run workflow`
- T13/T13b (Backend task types) — the RPCs these commands call

---

**Status**: ✅ Production Ready
**Timeline**: Single session
