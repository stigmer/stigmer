# Output Format Architecture Design Decision (DD01)

**Date**: February 26, 2026

## Summary

Resolved the output format coexistence question that was blocking Phase 4 of the CLI
output system refactor. After analyzing the full codebase, determined that the two
output systems (`clioutput.CommandResult` and `--output table/yaml/json`) are separate
by design, not by accident, and should never coexist on the same command. This decision
narrows Phase 4 scope from a complex interface redesign to a focused boilerplate
extraction.

## Problem Statement

The CLI output system refactor (Phases 1-3.3) introduced `clioutput.CommandResult` with
a `Renderer` interface (human/json/quiet) for mutating commands. Meanwhile, the existing
get/list/search commands use `--output table/yaml/json` to control data serialization.
The original plan (T01) assumed these would eventually merge into a single pipeline, but
no concrete design existed for how they would coexist.

### Pain Points

- Phase 4 (display file consolidation) was blocked pending this design decision
- The original T01 plan included a `Displayable` interface and global `--output` flag
  that would route all commands through `CommandResult` — but this was speculative
- Without resolution, Phase 4 risked building the wrong abstraction

## Solution

Analyzed every relevant file in the codebase: the clioutput package (7 files), all 8
display.go files, the get/list command handlers, the search display, the cliprint
package, and the migrated delete/apply/server handlers. The analysis revealed these
are two fundamentally different systems:

| Dimension | System 1: CommandResult | System 2: --output flag |
|-----------|------------------------|------------------------|
| Commands | delete, apply, server, config set | get, list, search |
| Purpose | Operational feedback | Data inspection |
| Output schema | Fixed (status/message/sections) | Per-resource protobuf |
| JSON meaning | Operational metadata | Raw API resource |
| Piping | Not meaningful | Core use case |

Merging them would break piping, lose YAML, and mismodel tabular data.

## Implementation Details

Three deliverables, all documentation:

1. **Design Decision Document** (`DD01-output-format-architecture.md`): Formal record
   of the two-system architecture, analysis, alternatives considered, and impact on
   subsequent phases.

2. **Phase 4 Task Definition** (`T02_phase4_consolidate_display_boilerplate.md`):
   Refined execution plan for display file consolidation. Scope narrowed to extracting
   shared proto YAML/JSON boilerplate into `pkg/display/proto.go`, eliminating ~240
   lines of duplicated code across 8 files.

3. **Updated next-task.md**: Session progress, resolved design decisions, refined
   Phase 4 scope, corrected quick commands.

### Superseded Plan Elements

- T01 Phase 1.2 (`Displayable` interface): Cancelled
- T01 Phase 1.3 (global `--output` flag): Cancelled as originally scoped
- T01 Phase 4 scope: Narrowed from interface redesign to boilerplate extraction
- T01 Success Criterion #6 (display.go files under 30 lines): Revised

## Benefits

- **Unblocks Phase 4**: Clear scope and concrete execution plan
- **Prevents wrong abstraction**: Saves effort of building a `Displayable` interface
  that would have been either too generic or too complex
- **Preserves piping**: `stigmer get agent foo -o json | jq '.spec'` continues to work
- **Reduces Phase 4 complexity**: From interface design + migration to simple
  boilerplate extraction

## Impact

- CLI output system refactor project: Phase 4 is now ready to execute
- Future maintainers: Clear architectural boundary documented between action-result
  output and data-inspection output
- No code changes — purely architectural documentation

## Related Work

- [CLI Output System Foundation](2026-02-26-025243-cli-output-system-foundation.md)
- [Fix Delete Without Confirmation](2026-02-26-031441-fix-delete-without-confirmation.md)
- [Migrate Delete to CommandResult](2026-02-26-032844-migrate-delete-to-commandresult.md)
- [Migrate Server/Backend/Config to CommandResult](2026-02-26-034749-migrate-server-backend-config-to-commandresult.md)
- [Migrate Apply Commands to CommandResult](2026-02-26-041616-migrate-apply-commands-to-commandresult.md)

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes analysis + documentation)
