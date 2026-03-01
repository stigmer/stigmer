---
name: Unify draft command options
overview: Eliminate duplication between draft skill/agent handlers, and bring all agent-execution options (workspace, env vars, secrets, org, detach) from `run` into `draft` via a single parameterized handler that reuses the same building blocks.
todos:
  - id: create-draft-handler
    content: Create `draft_handler.go` with `draftConfig`, `draftOptions`, `registerDraftFlags()`, `executeDraft()`, and `displayDraftAgentNotFoundError()` — composing the same building blocks as run
    status: completed
  - id: simplify-draft-skill
    content: "Simplify `draft_skill.go` to a thin wrapper: define skillCreator draftConfig, call registerDraftFlags, delegate to executeDraft"
    status: completed
  - id: simplify-draft-agent
    content: "Simplify `draft_agent.go` to a thin wrapper: define agentCreator draftConfig, call registerDraftFlags, delegate to executeDraft"
    status: completed
  - id: delete-old-handlers
    content: Delete `draft_skill_handler.go` and `draft_agent_handler.go`
    status: completed
  - id: verify-compile-lint
    content: Verify the code compiles and passes linting
    status: completed
isProject: false
---

# Unify Draft Command Options with Run

## Problem

`stigmer draft skill` and `stigmer draft agent` are convenience wrappers that run hardcoded system agents (`skill-creator`, `agent-creator`). They share the same execution infrastructure as `stigmer run agent`, but:

- They are missing several flags that `run` supports: `--workspace`, `--branch`, `--commit`, `--env`, `--env-file`, `--secret`, `--secret-file`, `--org`, `--detach`
- They skip auto-env resolution (`resolveAndMergeAutoEnv`), so MCP server credentials aren't auto-injected
- They skip workspace-aware attachment processing (always pass `""` for workspace root)
- The two handlers (`draft_skill_handler.go`, `draft_agent_handler.go`) are near-identical 130-line files differing only in three string literals
- The two options structs and flag registrations are also duplicated

## Design

`draft` is semantically "run a specific system agent with auto-download." The fix is to:

1. **Introduce a parameterized handler** that eliminates the duplication
2. **Add missing flags** so draft has the same agent-execution capabilities as run
3. **Add missing execution steps** (workspace parsing, env loading, auto-env resolution, workspace-aware attachments, explicit session creation for workspace)

### Key Types

In a new file `draft_handler.go`:

```go
// draftConfig identifies which system agent to invoke.
type draftConfig struct {
    AgentName    string // e.g., "skill-creator"
    ResourceType string // e.g., "Skill" — for user-facing messages
}

// draftOptions contains all CLI flags for any draft subcommand.
type draftOptions struct {
    // Core
    Message     string
    AttachFlags []string
    OutputDir   string
    Model       string

    // Execution control
    ApproveDefault  string
    AutoApprove     bool
    Verbose         bool
    Detach          bool
    OrgOverride     string

    // Workspace
    WorkspaceFlag string
    BranchFlag    string
    CommitFlag    string

    // Environment
    EnvFlags        []string
    EnvFileFlags    []string
    SecretFlags     []string
    SecretFileFlags []string
}
```

### Execution Flow

The unified `executeDraft(cfg draftConfig, opts draftOptions) error` follows this sequence (mirroring `executeRun` + `runAgent` but for draft's semantics):

```
1. Parse --approve-default
2. Parse workspace source       (parseWorkspaceSource — reused from run)
3. Load & merge env vars        (envfile.LoadAndMergeWithSecrets — reused from run)
4. Auto-resolve credentials     (resolveAndMergeAutoEnv — reused from run)
5. Connect to backend           (connectToBackend — already reused)
6. Resolve system agent         (resolveAgent — already reused)
7. Process workspace-aware attachments (NewAttachmentProcessor — already reused, now workspace-aware)
8. If workspace: create session (createSessionForAgent — reused from run)
9. Create agent execution       (createAgentExecution — already reused)
10. If detach: log message and return
11. Stream execution            (streamAgentExecution — already reused)
12. Download artifacts          (downloadArtifacts — already reused)
```

### Shared Flag Registration

A helper `registerDraftFlags(cmd *cobra.Command, opts *draftOptions)` registers all flags once. Both `NewDraftSkillCommand()` and `NewDraftAgentCommand()` call this instead of duplicating flag definitions.

## Files Changed

- **NEW**: `[client-apps/cli/cmd/stigmer/root/draft_handler.go](client-apps/cli/cmd/stigmer/root/draft_handler.go)` — Unified `draftConfig`, `draftOptions`, `executeDraft()`, `registerDraftFlags()`, and `displayDraftAgentNotFoundError()`
- **MODIFY**: `[client-apps/cli/cmd/stigmer/root/draft_skill.go](client-apps/cli/cmd/stigmer/root/draft_skill.go)` — Simplify to thin wrapper: define `draftConfig`, call `registerDraftFlags`, delegate to `executeDraft`
- **MODIFY**: `[client-apps/cli/cmd/stigmer/root/draft_agent.go](client-apps/cli/cmd/stigmer/root/draft_agent.go)` — Same simplification
- **DELETE**: `[client-apps/cli/cmd/stigmer/root/draft_skill_handler.go](client-apps/cli/cmd/stigmer/root/draft_skill_handler.go)` — Replaced by unified handler
- **DELETE**: `[client-apps/cli/cmd/stigmer/root/draft_agent_handler.go](client-apps/cli/cmd/stigmer/root/draft_agent_handler.go)` — Replaced by unified handler

## Behavioral Notes

- `**--output` stays** as draft's flag (not replaced by `--download`). It's more semantic: "where to save what I'm creating."
- `**--detach` on draft** will log: "Detach mode: artifacts will not be auto-downloaded. Reconnect with: stigmer run ses-xxx" to make the trade-off explicit.
- `**--model`** stays on draft (run doesn't have it — that's a separate gap).
- `**--auto-approve`** stays on draft (run doesn't have it explicitly — also a separate gap).
- **All existing behavior is preserved**. New flags default to empty/false, so no breaking changes.
- **No new dependencies** are introduced — all building blocks already exist.

