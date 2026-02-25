# Task T01: CLI Output System — Complete Refactor

**Created**: 2026-02-26
**Status**: PENDING REVIEW
**Type**: Refactoring (Big-Bang)
**Approach**: Build new output system, migrate all commands at once

> **This plan requires your review before execution.**

## Background

The current Stigmer CLI output system has 9 identified violations (1 Critical, 3 High, 3 Medium, 1 Low, plus 1 missed by severity — duplicate code). The user chose full scope (all violations) with a big-bang migration approach. This plan lays out the work in ordered phases that can each be a separate PR or commit boundary.

## Audit Summary (from architecture review)

| # | Issue | Severity | Current State |
|---|-------|----------|---------------|
| 1 | Delete without actual y/N confirmation | **Critical** | `DisplayDeleteConfirmation()` shows warning then proceeds to delete unconditionally |
| 2 | `PrintInfo` used for 6+ semantics | **High** | Section headers, key-value pairs, hints, guidance, status labels — all look identical |
| 3 | No `CommandResult` domain model | **High** | Each command hand-rolls output with `fmt.Println` + `cliprint` calls |
| 4 | 8 duplicate `display.go` files | **High** | Near-identical `DisplayDeleteConfirmation`, `DisplayDeleteResult`, `DisplayGetResult` per resource |
| 5 | Mixed deprecated/new API in same files | **Medium** | `cliprint.Info()` (deprecated) and `cliprint.PrintInfo()` coexist |
| 6 | 3 different icon systems | **Medium** | `✓/✗/ℹ/⚠` vs `🚀/✅/💡` vs `✓/✗/○/↻/✗✗` |
| 7 | Direct `fmt.Println` in command handlers | **Medium** | `handleBackendStatus()`, `handleServerStatus()`, `handleConfigList()` bypass cliprint |
| 8 | No stderr/stdout separation | **Medium** | Decorative output mixed with data on stdout |
| 9 | No global `--output json` flag | **Low** | Only `get` commands support yaml/json; delete, apply, config, etc. are human-only |
| 10 | Duplicate `truncateString()` | **Low** | Copy-pasted in `agent/display.go` and `skill/display.go` |

## Files in Scope

### Core output packages (create/modify)
- `client-apps/cli/pkg/clioutput/` — **NEW** package: `CommandResult`, `Renderer`, `Confirmer`
- `client-apps/cli/internal/cli/cliprint/cliprint.go` — deprecate fully, delegate to new system
- `client-apps/cli/internal/cli/clierr/clierr.go` — integrate with `CommandResult` error rendering

### Display files (consolidate into generic renderer)
- `client-apps/cli/internal/cli/agent/display.go`
- `client-apps/cli/internal/cli/skill/display.go`
- `client-apps/cli/internal/cli/mcpserver/display.go`
- `client-apps/cli/internal/cli/workflow/display.go`
- `client-apps/cli/internal/cli/project/display.go`
- `client-apps/cli/internal/cli/execution/display.go`
- `client-apps/cli/internal/cli/session/display.go`
- `client-apps/cli/internal/cli/search/display.go`

### Command handlers (migrate to CommandResult)
- `client-apps/cli/cmd/stigmer/root/delete.go`
- `client-apps/cli/cmd/stigmer/root/apply.go`
- `client-apps/cli/cmd/stigmer/root/apply_file.go`
- `client-apps/cli/cmd/stigmer/root/list.go`
- `client-apps/cli/cmd/stigmer/root/resources.go`
- `client-apps/cli/cmd/stigmer/root/backend.go`
- `client-apps/cli/cmd/stigmer/root/server.go`
- `client-apps/cli/cmd/stigmer/root/config.go`
- `client-apps/cli/cmd/stigmer/root/push.go`
- `client-apps/cli/cmd/stigmer/root/validate.go`
- `client-apps/cli/cmd/stigmer/root/run_handlers.go`
- `client-apps/cli/cmd/stigmer/root/run_display.go`
- `client-apps/cli/cmd/stigmer/root/run_display_summary.go`
- `client-apps/cli/cmd/stigmer/root/run_display_tools.go`
- `client-apps/cli/cmd/stigmer/root/run_display_approval.go`
- `client-apps/cli/cmd/stigmer/root/draft_agent_handler.go`
- `client-apps/cli/cmd/stigmer/root/draft_skill_handler.go`
- `client-apps/cli/cmd/stigmer/root/download_execution.go`
- `client-apps/cli/cmd/stigmer/root/server_logs.go`

### Table/display utilities (refactor)
- `client-apps/cli/pkg/display/table.go`
- `client-apps/cli/pkg/display/colors.go`
- `client-apps/cli/pkg/display/terminal.go`
- `client-apps/cli/pkg/display/truncate.go`

---

## Phase 1: Domain Model & Core Infrastructure

**Goal**: Build the new output system foundation. No commands migrated yet — just the new package.

### 1.1 Create `pkg/clioutput/` package

#### 1.1.1 `result.go` — CommandResult value object

```go
type ResultStatus int

const (
    StatusSuccess ResultStatus = iota
    StatusWarning
    StatusError
)

type CommandResult struct {
    Status   ResultStatus
    Message  string        // headline: "Agent deleted successfully"
    Sections []Section     // structured output sections
    Hints    []string      // next-step suggestions (dimmed)
}

type Section struct {
    Title  string          // "Resource Details", "Reconciliation Summary"
    Fields []KeyValue      // structured key-value pairs
    Items  []string        // bullet items (for lists without keys)
}

type KeyValue struct {
    Key   string           // "ID", "Name", "Slug"
    Value string           // the actual value
}

// Builder pattern for ergonomic construction
func Success(message string, args ...any) *CommandResult { ... }
func Warning(message string, args ...any) *CommandResult { ... }
func Error(message string, args ...any) *CommandResult   { ... }

func (r *CommandResult) AddSection(title string) *Section { ... }
func (s *Section) Field(key, value string) *Section       { ... }
func (s *Section) Fieldf(key, format string, args ...any) *Section { ... }
func (s *Section) Item(text string) *Section               { ... }
func (r *CommandResult) Hint(text string) *CommandResult   { ... }
func (r *CommandResult) Hintf(format string, args ...any) *CommandResult { ... }
```

#### 1.1.2 `renderer.go` — Renderer interface

```go
type OutputFormat string

const (
    FormatHuman OutputFormat = "human"
    FormatJSON  OutputFormat = "json"
    FormatQuiet OutputFormat = "quiet"
)

type Renderer interface {
    Render(result *CommandResult)
}

func NewRenderer(format OutputFormat, w io.Writer) Renderer { ... }
```

#### 1.1.3 `human_renderer.go` — Human-readable renderer

Strict semantic vocabulary:

| Semantic | Rendering |
|----------|-----------|
| Success status | `✓ Message` (green bold) |
| Warning status | `⚠ Message` (yellow bold) |
| Error status | `✗ Message` (red bold) |
| Section title | `Title:` (bold, no icon, no color) |
| Key-value pair | `  Key    Value` (dim key, normal value, no icon) |
| Bullet item | `  - Item text` (normal, no icon) |
| Hint | `  Hint text` (dim, no icon) |

Key-value alignment: keys are right-padded to the max key width within their section plus 4 spaces.

**No emoji anywhere.** `✓`, `✗`, `⚠` only. No `🚀`, `✅`, `💡`, `ℹ`, `○`, `↻`.

#### 1.1.4 `json_renderer.go` — Machine-readable renderer

Outputs `CommandResult` as JSON to stdout. Status messages go to stderr even in JSON mode.

#### 1.1.5 `quiet_renderer.go` — Minimal renderer

Only prints the status line (success/error). Suppresses sections, hints, and fields.

#### 1.1.6 `confirm.go` — Interactive confirmation

```go
type Confirmer interface {
    Confirm(prompt string) (bool, error)
}

type InteractiveConfirmer struct{}  // reads y/N from stdin
type AlwaysYesConfirmer struct{}    // for --force flag
```

#### 1.1.7 `context.go` — Output context (global state for a command)

```go
type OutputContext struct {
    Format    OutputFormat
    Renderer  Renderer
    Confirmer Confirmer
    Stdout    io.Writer    // data output
    Stderr    io.Writer    // status/decorative output
}

func NewOutputContext(format OutputFormat, force bool) *OutputContext { ... }
```

### 1.2 Create `Displayable` interface for resources

```go
type Displayable interface {
    DisplayType() string       // "Agent", "Skill", "MCP Server"
    DisplayFields() []KeyValue // ID, Name, Slug, Org, etc.
}
```

Each resource wrapper implements this. One generic `DisplayResource(d Displayable)` function replaces 8 display files.

### 1.3 Add global `--output` flag to root command

Add `--output` (`-o`) flag to the root cobra command. Valid values: `human` (default), `json`, `quiet`. Stored in cobra context and accessible by all subcommands.

---

## Phase 2: Fix Critical Bug — Delete Confirmation

**Goal**: Make `stigmer delete` actually prompt for confirmation before destroying resources.

### 2.1 Replace fake confirmation with real interactive prompt

In `delete.go`, replace:
```go
if !force {
    agent.DisplayDeleteConfirmation(agentRes)
    cliprint.PrintInfo("Use --force to skip this confirmation")
    fmt.Println()
}
// proceeds to delete regardless
```

With:
```go
if !force {
    result := clioutput.Warning("You are about to delete the following agent:")
    result.AddSection("").
        Field("ID", agentRes.Metadata.Id).
        Field("Name", agentRes.Metadata.Name).
        Field("Slug", agentRes.Metadata.Slug).
        Field("Org", agentRes.Metadata.Org)
    result.Hint("This action cannot be undone.")
    ctx.Renderer.Render(result)

    confirmed, err := ctx.Confirmer.Confirm("Delete this agent? [y/N]")
    if err != nil || !confirmed {
        fmt.Fprintln(ctx.Stderr, "Aborted.")
        return nil
    }
}
```

### 2.2 Apply to all delete handlers

Same pattern for: `deleteWorkflow`, `deleteMcpServer`, `deleteProject`, `deleteSkill`, `executeCancelExecution`.

---

## Phase 3: Migrate All Commands

**Goal**: Every command returns `CommandResult` and uses the renderer. No direct `fmt.Print` or `cliprint` calls.

### 3.1 Migrate resource CRUD commands

For each resource type (agent, skill, mcpserver, workflow, project, execution, session):
- `DisplayApplyResult` → build `CommandResult` with Success status + resource section + hints
- `DisplayDeleteResult` → build `CommandResult` with Success status + deleted resource section
- `DisplayGetResult` → build `CommandResult` with sections for Metadata, Spec, Status
- `DisplayListResult` → keep table rendering (tables are a separate concern) but wrap in `CommandResult`
- `DisplayDeleteConfirmation` → handled in Phase 2

### 3.2 Migrate server/backend/config commands

- `handleBackendStatus()` — currently uses raw `fmt.Println` for headers
- `handleServerStatus()` — most complex; has component status, health monitoring, LLM status
- `handleConfigList()` — uses raw `fmt.Printf` for key-value pairs
- `handleConfigSet()` / `handleConfigGet()` — straightforward

### 3.3 Migrate apply commands

- `executeProjectApply()` — has mid-stream progress updates that need special handling
- `displaySynthesisResult()` / `displayApplyResult()` / `displayDryRunPreview()`

### 3.4 Handle progress/streaming output

Progress displays (`cliprint.NewProgressDisplay()`, BubbleTea) are a separate concern. They use stderr by nature (interactive TUI). These don't need to return `CommandResult` but should write to stderr consistently.

---

## Phase 4: Consolidate Display Files

**Goal**: Eliminate the 8 duplicate `display.go` files.

### 4.1 Implement `Displayable` for each resource type

Create thin adapter functions in each resource package:
```go
func (a *AgentDisplayable) DisplayType() string       { return "Agent" }
func (a *AgentDisplayable) DisplayFields() []KeyValue  { ... }
```

### 4.2 Create generic display functions

In `pkg/clioutput/resource.go`:
```go
func ResourceResult(status ResultStatus, message string, d Displayable) *CommandResult { ... }
func DeleteConfirmResult(d Displayable) *CommandResult { ... }
func DeleteSuccessResult(d Displayable) *CommandResult { ... }
```

### 4.3 Remove duplicate display.go code

After migration, each `display.go` shrinks to:
- `Displayable` implementation (5-15 lines)
- Format-specific overrides only where needed (e.g., agent `displayAgentSummary`)
- Remove `truncateString` duplicates (move to `pkg/display/truncate.go`, already exists)

---

## Phase 5: Cleanup & Polish

**Goal**: Remove all deprecated code, enforce consistency, add global output flag.

### 5.1 Remove deprecated `cliprint` functions

Delete `Success()`, `Info()`, `Warning()`, `Error()` (the ones without `Print` prefix). Audit all callers.

### 5.2 Deprecate and redirect `cliprint.PrintXxx` functions

These should become thin wrappers that create a `CommandResult` and render it. Or, if we want to be strict, remove them and compiler-check that all callers have migrated.

### 5.3 Enforce stderr/stdout separation

- All `Renderer.Render()` writes decorative output to stderr
- Only data output (JSON mode, YAML get output, table data) goes to stdout
- `clierr.Handle()` already writes to stderr — keep this

### 5.4 Wire up `--output` flag end-to-end

Root command flag → context propagation → renderer selection in every command handler.

### 5.5 Final icon/vocabulary audit

Search entire CLI codebase for emoji and Unicode symbols. Remove all occurrences of: `🚀`, `✅`, `💡`, `ℹ`, `○`, `↻`, `✗✗`, `⚠️` (emoji variant). Keep only: `✓` (success), `✗` (error), `⚠` (warning).

---

## Phase 6: Verification

### 6.1 Manual smoke test

Run every command variant and verify output consistency:
- `stigmer apply -f agent.yaml`
- `stigmer apply` (project mode)
- `stigmer delete agent my-agent` (confirm prompt appears, y/N works)
- `stigmer delete agent my-agent --force` (skips prompt)
- `stigmer get agent my-agent` / `--output json` / `--output quiet`
- `stigmer list agents`
- `stigmer server` / `stigmer server status` / `stigmer server stop`
- `stigmer backend status` / `stigmer backend set local`
- `stigmer config list` / `stigmer config set llm.model foo`

### 6.2 Pipe test

Verify `stigmer get agent my-agent --output json 2>/dev/null | jq .` works cleanly.

### 6.3 Grep audit

```bash
# No direct fmt.Print in command handlers
rg 'fmt\.(Print|Printf|Println)' client-apps/cli/cmd/ --glob '*.go'

# No cliprint.Info/Success/Error/Warning (deprecated non-Print variants)
rg 'cliprint\.(Info|Success|Error|Warning)\(' client-apps/cli/ --glob '*.go'

# No stray emoji
rg '[🚀✅💡ℹ○↻]' client-apps/cli/ --glob '*.go'
```

---

## Success Criteria (measurable)

1. `rg 'fmt\.(Print|Printf|Println)' client-apps/cli/cmd/ --glob '*.go'` returns zero matches (excluding test files)
2. `rg 'cliprint\.(Info|Success|Error|Warning)\(' client-apps/cli/ --glob '*.go'` returns zero matches
3. `stigmer delete agent foo` (without `--force`) prompts `Delete this agent? [y/N]` and waits
4. `stigmer get agent foo --output json` outputs valid JSON to stdout with no decorative text
5. `stigmer apply 2>/dev/null` produces no visible output (all status goes to stderr)
6. All 8 `display.go` files are under 30 lines each (adapter + Displayable impl only)
7. Single icon vocabulary: only `✓`, `✗`, `⚠` in the entire CLI codebase

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Big-bang touches 30+ files → merge conflicts | Work on a dedicated branch; merge main into it daily |
| Delete confirmation breaks CI/scripts | Document the behavioral change; `--force` preserves old behavior |
| stderr/stdout change breaks piping | Only affects commands that didn't have `--output json` before — low risk |
| BubbleTea progress display conflicts with Renderer | Progress is a separate concern; keep it on stderr, don't route through CommandResult |

## Estimated Effort

| Phase | Files | Effort |
|-------|-------|--------|
| Phase 1: Core infrastructure | ~8 new files | Medium |
| Phase 2: Delete confirmation fix | 1 file (delete.go) | Small |
| Phase 3: Migrate all commands | ~20 files | Large |
| Phase 4: Consolidate display files | 8 files + 1 new | Medium |
| Phase 5: Cleanup & polish | ~10 files | Small |
| Phase 6: Verification | 0 files (testing) | Small |

---

## Review Process

**What happens next**:
1. **You review this plan** — consider the approach, phasing, and scope
2. **Provide feedback** — any concerns, scope changes, or disagreements
3. **I'll revise** — create `T01_2_revised_plan.md` incorporating your feedback
4. **You approve** — explicit go-ahead
5. **Execution begins** — tracked in `T01_3_execution.md`

**Questions to consider**:
- Is the big-bang approach acceptable for ~30 files, or should we split into multiple PRs per phase?
- Should Phase 2 (delete confirmation fix) be a separate urgent PR before the rest?
- Is the icon vocabulary (`✓`, `✗`, `⚠` only — no emoji) the right call?
- Should `--output` flag be on root command (global) or per-subcommand?
- Any commands I missed in the scope?
