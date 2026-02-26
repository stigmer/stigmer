---
name: Phase 3.3 Apply Migration
overview: Migrate the apply command's structured output (both project mode and file mode) from ad-hoc cliprint/fmt calls to CommandResult + Renderer, following the patterns established in Phases 3.1 and 3.2. Ephemeral progress messages stay as stderr writes (deferred like ProgressDisplay).
todos:
  - id: split-apply-go
    content: "Create apply_project.go: extract executeProjectApply + display builders + helpers from apply.go. Slim apply.go to command definition + mode routing (~100 lines)."
    status: completed
  - id: migrate-project-display
    content: "Convert project-mode display functions to CommandResult builders in apply_project.go: buildAtomicTrackResult, buildSynthesisResult, buildDryRunPreview, buildDeploymentResult, buildMissingSkillsResult."
    status: completed
  - id: migrate-file-mode
    content: Introduce fileApplyContext struct in apply_file.go. Create apply_file_handlers.go with per-resource handlers + CommandResult builders for apply result and dry-run preview.
    status: completed
  - id: remove-dead-display
    content: "Grep-verify then remove dead display functions: agent.DisplayApplyResult, agent.DisplayAgentPreview, workflow.DisplayApplyResult, workflow.DisplayWorkflowPreview, mcpserver.DisplayApplyResult, mcpserver.DisplayMcpServerPreview, apply.DisplayMissingSkillsGuidance."
    status: completed
  - id: update-bazel-verify
    content: Update BUILD.bazel with new source files. Run go build, go vet. Verify zero cliprint imports in new/migrated files (except ephemeral progress lines in executeProjectApply).
    status: completed
isProject: false
---

# Phase 3.3: Migrate Apply Commands to CommandResult

## Current State

Two files own the apply command output:

- [apply.go](client-apps/cli/cmd/stigmer/root/apply.go) (484 lines) -- project mode + display functions
- [apply_file.go](client-apps/cli/cmd/stigmer/root/apply_file.go) (282 lines) -- file mode + per-resource handlers

They delegate display to functions in internal packages:

- `agent.DisplayApplyResult()`, `agent.DisplayAgentPreview()` ([agent/display.go](client-apps/cli/internal/cli/agent/display.go))
- `workflow.DisplayApplyResult()`, `workflow.DisplayWorkflowPreview()` ([workflow/display.go](client-apps/cli/internal/cli/workflow/display.go))
- `mcpserver.DisplayApplyResult()`, `mcpserver.DisplayMcpServerPreview()` ([mcpserver/applier.go](client-apps/cli/internal/cli/mcpserver/applier.go), [mcpserver/display.go](client-apps/cli/internal/cli/mcpserver/display.go))
- `apply.DisplayMissingSkillsGuidance()` ([apply/skill_verify.go](client-apps/cli/internal/cli/apply/skill_verify.go))
- `display.ApplyResultTable.RenderDryRun()` ([pkg/display/table.go](client-apps/cli/pkg/display/table.go))

## Design Decisions

### D1: Multi-step progress pattern (agreed)

- **CommandResult** for structured results: synthesis result, deployment result, dry-run preview, missing skills warning, atomic track guidance
- **Ephemeral stderr writes** for progress: "Running SDK synthesis...", "Connecting to backend...", "Deploying resources...", organization resolution messages
- Same deferral as ProgressDisplay in Phase 3.2

### D2: Dry-run preview format (agreed)

- Replace `display.ApplyResultTable.RenderDryRun()` with CommandResult items
- Eliminates emoji violations and gains consistency with all renderers

### D3: File mode context struct

- Introduce `fileApplyContext` (following `deleteContext` pattern from Phase 3.1) to bundle `conn`, `orgID`, `dryRun`, `renderer`
- Avoids parameter explosion in per-resource handler signatures

### D4: Hardcoded `FormatHuman`

- Apply has no `--output` flag. Same as delete (decision #14 from Phase 3.1).

### D5: Applier cliprint calls -- out of scope

- `agent/applier.go`, `mcpserver/applier.go`, `project/applier.go` have cliprint calls in business logic ("Creating agent: X", dry-run messages)
- These are NOT in the command layer -- leave for Phase 5 cleanup
- The `Quiet` flag already controls them

## File Split Strategy

### Current (2 files, 766 total lines)

- `apply.go` (484 lines) -- too large
- `apply_file.go` (282 lines) -- near limit

### After (4 files, ~same total but properly split)

- `apply.go` (~100 lines) -- Command definition, options, mode routing only
- `apply_project.go` (~240 lines) -- `executeProjectApply`, project display builders, `resolveApplyOrganization`, project helpers
- `apply_file.go` (~170 lines) -- `fileApplyContext`, `executeFileApply`, file scanning/detection, `applyResourceItem` routing
- `apply_file_handlers.go` (~200 lines) -- `applyAgent`, `applyWorkflow`, `applyMcpServer` with CommandResult builders, `truncateForDisplay` utility

## Detailed Changes

### 1. apply.go -- Slim to command definition

Keep only:

- `NewApplyCommand()` (command/flag definitions)
- `projectApplyOptions` / `fileApplyOptions` structs
- Mode routing in `Run` func

Move out: `executeProjectApply`, all `display`* functions, `resolveApplyOrganization`, helpers (`getEntryPoint`, `runtimeToStringForApply`, `getDefaultEntryPointForApply`)

### 2. apply_project.go -- Project mode flow + display builders

`**executeProjectApply`** rewritten with:

- Renderer created once at top: `renderer := clioutput.NewRenderer(clioutput.FormatHuman, os.Stdout, os.Stderr)`
- Atomic track: `renderer.Render(buildAtomicTrackResult())`
- Project found: stays as `fmt.Fprintf(os.Stderr, ...)` (ephemeral progress)
- Synthesis: `fmt.Fprintf(os.Stderr, "Running SDK synthesis...\n")` then `renderer.Render(buildSynthesisResult(...))`
- Dry-run: `renderer.Render(buildDryRunPreview(...))`
- Connection: `fmt.Fprintf(os.Stderr, "Connecting to backend...\n")` (ephemeral)
- Skill verification: ephemeral progress, but on failure: `renderer.Render(buildMissingSkillsResult(...))` + return error
- Deploy: `fmt.Fprintf(os.Stderr, "Deploying resources...\n")` then `renderer.Render(buildDeploymentResult(...))`

**Display builder functions** (all return `*clioutput.CommandResult`):

- `buildAtomicTrackResult()` -- Warning with guidance items and hints
- `buildSynthesisResult(result *synthesis.Result)` -- Success with resource counts
- `buildDryRunPreview(proj, result)` -- Success with resource items (replaces ApplyResultTable)
- `buildDeploymentResult(result *project.ApplyResult, pruneEnabled bool)` -- Success with project info, reconciliation items, next-step hints
- `buildMissingSkillsResult(missing []apply.ExternalSkillRef)` -- Warning with missing skill items and fix-command hints

**Kept as-is**: `resolveApplyOrganization`, `getEntryPoint`, `runtimeToStringForApply`, `getDefaultEntryPointForApply`

### 3. apply_file.go -- File mode orchestration

**New struct**:

```go
type fileApplyContext struct {
    conn     grpc.ClientConnInterface
    orgID    string
    dryRun   bool
    renderer clioutput.Renderer
}
```

`**executeFileApply**` rewritten:

- Creates renderer at top
- Creates `fileApplyContext` after connection setup
- Connection progress stays as `fmt.Fprintf(os.Stderr, ...)`
- Passes `fctx` to `applyResourceItem`

**Kept**: `resolveApplyFiles`, `detectApplyItems`, `applyItem` struct

### 4. apply_file_handlers.go -- Per-resource handlers with CommandResult

**Handler signatures** change from `(item, conn, orgID, dryRun)` to `(item applyItem, fctx *fileApplyContext)`:

- `applyAgent` -- builds CommandResult for success/dry-run
- `applyWorkflow` -- builds CommandResult for success/dry-run
- `applyMcpServer` -- builds CommandResult for success/dry-run

**Builder functions** (all return `*clioutput.CommandResult`):

- `buildAgentApplyResult(result)` -- "Agent created/updated successfully" + ID/Name/Slug + next-step hints
- `buildAgentDryRunResult(agent)` -- "Dry run: X is valid" + preview section
- `buildWorkflowApplyResult(result)` -- same pattern
- `buildWorkflowDryRunResult(workflow)` -- same pattern
- `buildMcpServerApplyResult(result)` -- same pattern
- `buildMcpServerDryRunResult(mcpserver)` -- same pattern

**Utility**: `truncateForDisplay(s string, maxLen int) string` -- local helper (Phase 4 will consolidate the 4+ duplicate `truncateString` functions)

### 5. Dead code removal in internal packages

After migration, these functions are no longer called from the command layer. Verify with grep before removing.


| Package   | Function                       | File            | Reason                                   |
| --------- | ------------------------------ | --------------- | ---------------------------------------- |
| agent     | `DisplayApplyResult`           | display.go      | Replaced by `buildAgentApplyResult`      |
| agent     | `DisplayAgentPreview`          | display.go      | Replaced by `buildAgentDryRunResult`     |
| workflow  | `DisplayApplyResult`           | display.go      | Replaced by `buildWorkflowApplyResult`   |
| workflow  | `DisplayWorkflowPreview`       | display.go      | Replaced by `buildWorkflowDryRunResult`  |
| mcpserver | `DisplayApplyResult`           | applier.go      | Replaced by `buildMcpServerApplyResult`  |
| mcpserver | `DisplayMcpServerPreview`      | display.go      | Replaced by `buildMcpServerDryRunResult` |
| apply     | `DisplayMissingSkillsGuidance` | skill_verify.go | Replaced by `buildMissingSkillsResult`   |


**NOT removed** (still used by applier.go internal paths):

- `agent.displayAgentSummary`, `agent.truncateString`
- `workflow.displayWorkflowSummary`, `workflow.truncateString`
- `mcpserver.displayMcpServerSummary`

### 6. BUILD.bazel

Add `apply_project.go` and `apply_file_handlers.go` to srcs.

## What is NOT in scope

- Applier cliprint calls (`agent/applier.go`, `mcpserver/applier.go`, `project/applier.go`) -- business logic, deferred to Phase 5
- `resolveOrganization` in `verb_helpers.go` -- shared across all commands, separate migration
- `display.ApplyResultTable` struct/methods -- not removed, may be used elsewhere. Phase 4 concern
- Progress message migration to a formal `ProgressWriter` -- future phase
- `truncateString` consolidation -- Phase 4

## Risks and Watch Points

- **Verify dead code**: Grep each function before removal to confirm no other callers
- **Applier progress overlap**: When `Quiet: false`, the applier prints "Creating agent: X" before the RPC. This still appears in output alongside our CommandResult. This is expected and fine -- it's a progress message from the business layer
- `**resolveApplyOrganization` cliprint calls**: Remain as-is (cliprint.PrintInfo). These are informational progress messages shared with the overall pattern. Migrating them would require passing a renderer, which adds complexity for no immediate benefit

