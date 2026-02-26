# Migrate Apply Commands to Structured CommandResult

**Date**: February 26, 2026

## Summary

Migrated the `stigmer apply` command's output — both project mode and file mode — from ad-hoc `cliprint`/`fmt.Println` calls to the structured `CommandResult` + `Renderer` system established in earlier phases. This is Phase 3.3 of the CLI output system refactor, bringing the most complex CLI command under the new output architecture.

## Problem Statement

The apply command was the most complex output challenge in the refactor: it produces multiple structured results during a single execution (synthesis summary, dry-run preview, deployment result, missing skills warning) interspersed with ephemeral progress messages. The existing implementation spread display logic across 7 functions in 5 internal packages, used emojis that violated the semantic icon vocabulary, and had a 484-line file that exceeded the 250-line limit.

### Pain Points

- `apply.go` at 484 lines, well beyond the 250-line ceiling
- 7 display functions scattered across internal packages (`agent`, `workflow`, `mcpserver`, `apply`) owned by business logic that shouldn't handle presentation
- `display.ApplyResultTable.RenderDryRun()` used `💡` and `✅` emojis, violating the established `✓`/`⚠`/`✗` semantic vocabulary
- Per-resource handlers (`applyAgent`, `applyWorkflow`, `applyMcpServer`) had 4 positional parameters — a parameter explosion pattern
- No renderer pipeline — all output went directly to stdout via `fmt.Println`

## Solution

Applied the same `CommandResult` builder + `Renderer` pattern from Phases 3.1 and 3.2, with a key design adaptation: structured `CommandResult` for results that have semantic content (synthesis summary, deployment outcome, dry-run preview) and simple `fmt.Fprintf(os.Stderr, ...)` for ephemeral progress messages (connecting, deploying, verifying). This preserves the multi-step feel of the apply command while bringing all structured output under the consistent rendering pipeline.

## Implementation Details

### File Split (484 + 282 → 4 files, 808 lines total)

- **`apply.go` (156 lines)**: Command definition, `projectApplyOptions`, `resolveApplyOrganization`, runtime utility helpers
- **`apply_project.go` (250 lines)**: `executeProjectApply` orchestration with 5 `CommandResult` builder functions
- **`apply_file.go` (181 lines)**: `fileApplyContext` struct, `executeFileApply`, file scanning, item routing
- **`apply_file_handlers.go` (221 lines)**: Per-resource handlers with 6 builder functions, `truncateForDisplay`

### Builder Functions (11 total)

Project mode (in `apply_project.go`):
- `buildAtomicTrackResult()` — Warning with guidance for missing stigmer.yaml
- `buildSynthesisResult(result)` — Success with resource counts per type
- `buildDryRunPreview(result)` — Success with resource items (replaces `ApplyResultTable.RenderDryRun()`)
- `buildDeploymentResult(result, pruneEnabled)` — Success with reconciliation details and next-step hints
- `buildMissingSkillsResult(missing)` — Warning with missing skills and fix commands

File mode (in `apply_file_handlers.go`):
- `buildAgentApplyResult`, `buildAgentDryRunResult`
- `buildWorkflowApplyResult`, `buildWorkflowDryRunResult`
- `buildMcpServerApplyResult`, `buildMcpServerDryRunResult`

### Context Struct Pattern

Introduced `fileApplyContext` (following `deleteContext` from Phase 3.1) to bundle `conn`, `orgID`, `dryRun`, and `renderer`. Handler signatures simplified from `(item, conn, orgID, dryRun)` to `(item, *fileApplyContext)`.

### Dead Code Removal

Removed 7 functions from internal packages after grep-verifying zero callers:
- `agent.DisplayApplyResult`, `agent.DisplayAgentPreview`
- `workflow.DisplayApplyResult`, `workflow.DisplayWorkflowPreview`
- `mcpserver.DisplayApplyResult`, `mcpserver.DisplayMcpServerPreview`
- `apply.DisplayMissingSkillsGuidance`

Cleaned up unused imports in `apply/skill_verify.go` (removed `fmt`, `strings`, `cliprint`).

## Benefits

- **Consistent output**: All structured apply output flows through the `CommandResult` → `Renderer` pipeline, matching delete, server, backend, and config commands
- **Emoji compliance**: Dry-run preview no longer uses `💡`/`✅` — uses the standard `✓` semantic vocabulary
- **File size compliance**: No file exceeds 250 lines (largest is `apply_project.go` at exactly 250)
- **Cleaner handler signatures**: Context struct eliminates parameter explosion
- **Dead code removed**: 850 lines of deletions across the diff (net reduction in overall codebase)
- **Zero cliprint in new files**: `apply_project.go`, `apply_file.go`, `apply_file_handlers.go` have no cliprint imports

## Impact

- CLI users see the same structured, colored output for apply commands as for all other migrated commands
- Future JSON renderer support is ready — all structured output goes through `CommandResult`
- Internal package display functions are progressively shrinking as the command layer takes ownership of presentation
- The `apply` command, being the most complex CLI flow, validates that the `CommandResult` pattern scales to multi-step orchestrations

## Related Work

- Phase 1: Core `clioutput` package foundation
- Phase 2: Delete confirmation bug fix
- Phase 3.1: Delete command migration to CommandResult
- Phase 3.2: Server/backend/config migration to CommandResult
- Phase 4 (next): Consolidate display files, design `Displayable` interface
- Phase 5 (future): Remove deprecated cliprint, wire `--output` flag end-to-end

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
