---
name: Phase 3.2 Migration
overview: Migrate server/backend/config command output from ad-hoc cliprint/fmt calls to structured CommandResult + Renderer, while splitting the 896-line server.go into maintainable files.
todos:
  - id: step1-backend
    content: "Migrate backend.go: handleBackendStatus() and handleBackendSet() to CommandResult + Renderer"
    status: completed
  - id: step2-config
    content: "Migrate config.go: handleConfigSet() and handleConfigList() to CommandResult; keep handleConfigGet/Path as raw output"
    status: completed
  - id: step3-split
    content: Split server.go (896 lines) into server.go + server_status.go + server_llm.go (pure structural, no logic change)
    status: completed
  - id: step4-llm
    content: "Migrate server_llm.go: refactor showLLMStatus into section-builder, migrate handleLLMList to CommandResult"
    status: completed
  - id: step5-status
    content: "Migrate server_status.go: refactor helpers into section-builders, migrate handleServerStatus + handleServerStop to CommandResult"
    status: completed
  - id: step6-verify
    content: "Cleanup and verification: go build, go vet, go test, cliprint audit, BUILD.bazel update"
    status: completed
isProject: false
---

# Phase 3.2: Migrate server/backend/config to CommandResult

## Scope

Migrate output in three command files from ad-hoc `cliprint`/`fmt.Println` to structured `clioutput.CommandResult` + `Renderer`. Also split `server.go` (896 lines -- 3.5x over the 250-line limit) into three files.

**In scope:** `backend.go` (134 lines, 23 output calls), `config.go` (328 lines, 27 output calls), `server.go` (896 lines, 151 output calls -- partial migration)

**Explicitly excluded** (with rationale below):

- `handleServerStart()` / `handleLLMPull()` -- use `cliprint.ProgressDisplay` (BubbleTea interactive spinner), a fundamentally different paradigm from CommandResult
- `server_logs.go` -- log streaming is an ongoing data pipe, not a command result
- `handleConfigGet()` / `handleConfigPath()` -- raw value output for scripting/piping (wrapping in CommandResult would break `stigmer config get llm.provider | xargs ...`)

---

## Flagged Surprises (Require Design Decisions)

### Surprise 1: server.go is 896 lines

3.5x over the 250-line coding guideline. Must be split as part of this phase. Proposed split:

- **server.go** (~170 lines): `NewServerCommand`, sub-command constructors, `handleServerStart`, `runBootstrapDiscovery`, `handleServerStop`
- **server_status.go** (~280 lines): `handleServerStatus` + all status display helpers (`showComponentStatus`, `showAgentRunnerStatusEnhanced`, `createBasicHealthStatus`, `showBootstrapStatus`, `getStateDisplay`, `getHealthSymbol`, `formatDuration`, `isProcessAlive`, `isDockerContainerRunning`)
- **server_llm.go** (~170 lines): LLM sub-command constructors + `showLLMStatus`, `handleLLMList`, `handleLLMPull`

`server_status.go` at ~280 lines is slightly over 250, justified by cohesion: it's all status display code with a single reason to change.

### Surprise 2: Per-field color differentiation will be lost

Current `handleServerStatus()` uses `cliprint.Warning` (yellow) for unhealthy fields and `cliprint.Info` (cyan) for healthy ones. In the CommandResult model, all fields within a section are rendered uniformly (dim key, normal value). Health semantics must be conveyed through **symbols embedded in values** (e.g., `"Running ✓"`, `"Unhealthy ✗"`, `"3 (crash loop) ⚠"`).

This is consistent with the semantic vocabulary established in Phase 1, but it IS a visual change from the current per-line coloring.

### Surprise 3: Output destination changes from stdout to stderr

Current `handleServerStatus()` writes to stdout via `fmt.Println`. The `HumanRenderer` writes chrome/status output to stderr (data to stdout). After migration, server status output moves from stdout to stderr. This is the correct CLI convention (informational output to stderr), but it's a behavioral change that could affect scripts parsing `stigmer server status` output.

### Surprise 4: `showLLMStatus()` is dual-purpose

Called standalone from `stigmer server llm status` AND embedded inside `handleServerStatus()`. Must be refactored into a **section-builder pattern**: a function that adds sections to an existing `*CommandResult` rather than printing directly. Standalone command creates its own result and delegates to the builder.

Same pattern needed for `showBootstrapStatus()`.

---

## Implementation Steps

### Step 1: backend.go -- Full migration (smallest, establishes pattern)

**Target:** [backend.go](client-apps/cli/cmd/stigmer/root/backend.go) (134 lines)

Migrate `handleBackendStatus()` and `handleBackendSet()`:

- `handleBackendStatus()` → `clioutput.Success("Backend configuration")` with sections for type, endpoint, auth status
- `handleBackendSet("local")` → `clioutput.Success("Backend set to local")` with hints for next steps
- `handleBackendSet("cloud")` → `clioutput.Success("Backend set to cloud")` with hints
- `handleBackendSet(invalid)` → `clioutput.Error(...)` with valid options hint
- Replace `cliprint` import with `clioutput`
- Create renderer inline: `clioutput.NewRenderer(clioutput.FormatHuman, os.Stdout, os.Stderr)`
- Error paths that use `clierr.Handle(err)` stay as-is (those are fatal exits, not output)

**Expected result:** ~134 lines, zero `cliprint` import, zero `fmt.Println` for output.

### Step 2: config.go -- Partial migration

**Target:** [config.go](client-apps/cli/cmd/stigmer/root/config.go) (328 lines)

Migrate `handleConfigSet()` and `handleConfigList()`:

- `handleConfigSet()` → `clioutput.Success("Configuration updated: %s = %s", key, value)` with hint for config path
- `handleConfigList()` → `clioutput.Success("Configuration")` with sections per config group (backend, llm, temporal, execution), field per key=value pair, hint for edit path

**Keep as-is (raw value output):**

- `handleConfigGet()` -- `fmt.Println(value)` is correct for piping
- `handleConfigPath()` -- `fmt.Println(configPath)` is correct for piping

**Keep as-is (pure logic, no output):**

- `getConfigValue()`, `setConfigValue()` -- no output calls, pure business logic

Error paths within `handleConfigGet/Set` that use `cliprint.PrintError` followed by return: migrate these to `clioutput.Error(...)` + render + return.

**Expected result:** ~328 lines (similar size, logic unchanged), mixed `fmt`/`clioutput` imports (fmt still needed for get/path raw output).

### Step 3: Split server.go (pure structural refactor, no behavior change)

**Target:** [server.go](client-apps/cli/cmd/stigmer/root/server.go) (896 lines)

Split into three files with NO logic changes -- pure file reorganization:

- **server.go** (~170 lines): `NewServerCommand`, `newServerStopCommand`, `newServerStatusCommand`, `handleServerStart`, `runBootstrapDiscovery`, `handleServerStop`
- **server_status.go** (~280 lines): `handleServerStatus`, `createBasicHealthStatus`, `showComponentStatus`, `showAgentRunnerStatus`, `showAgentRunnerStatusEnhanced`, `getStateDisplay`, `getHealthSymbol`, `formatDuration`, `isProcessAlive`, `isDockerContainerRunning`, `showBootstrapStatus`
- **server_llm.go** (~170 lines): `newServerLLMCommand`, `newServerLLMListCommand`, `newServerLLMPullCommand`, `newServerLLMStatusCommand`, `showLLMStatus`, `handleLLMList`, `handleLLMPull`

Update BUILD.bazel to add `server_status.go` and `server_llm.go` to srcs.

**Verification:** `go build`, `go vet` must pass with zero behavior change.

### Step 4: server_llm.go -- Migrate status and list handlers

**Target:** `server_llm.go` (created in Step 3)

- Refactor `showLLMStatus()` into a **section-builder**: `addLLMSections(result *clioutput.CommandResult, cfg *config.Config)` that adds LLM sections to any result
- Standalone `stigmer server llm status` creates its own `clioutput.Success("LLM configuration")`, calls `addLLMSections`, renders
- `handleLLMList()` → `clioutput.Success("Available models")` with items section, hints for next steps
- `handleLLMPull()` -- **excluded** (uses `cliprint.ProgressDisplay`)

### Step 5: server_status.go -- Migrate status dashboard

**Target:** `server_status.go` (created in Step 3)

This is the most complex step. Refactor display helpers into **section-builder functions**:

- `showComponentStatus()` → `addComponentSection(result *clioutput.CommandResult, name string, health daemon.ComponentHealth, pid int)`
- `showAgentRunnerStatusEnhanced()` → `addAgentRunnerSection(result *clioutput.CommandResult, health daemon.ComponentHealth, agentStatus *daemon.AgentRunnerStatus)`
- `showBootstrapStatus()` → `addBootstrapSection(result *clioutput.CommandResult)`

Then `handleServerStatus()` orchestrates:

```go
func handleServerStatus() {
    // ... load dataDir, check running status ...
    if running {
        result := clioutput.Success("Stigmer server is running")
        addComponentSection(result, "Stigmer Server", health, pid)
        addComponentSection(result, "Workflow Runner", wfHealth, wfPID)
        addAgentRunnerSection(result, arHealth, agentStatus)
        result.AddSection("Server Details").
            Fieldf("Port", "%d", daemon.DaemonPort).
            Field("Data", dataDir)
        addBootstrapSection(result)
        addLLMSections(result, cfg)  // from server_llm.go
        result.AddSection("Web UI").Field("Temporal", "http://localhost:8233")
        renderer.Render(result)
    } else {
        result := clioutput.Warning("Stigmer server is not running")
        result.Hint("To start: stigmer server")
        renderer.Render(result)
    }
}
```

Also migrate `handleServerStop()` in server.go -- trivial, ~5 lines of output.

Utility functions (`isProcessAlive`, `isDockerContainerRunning`, `formatDuration`, `getStateDisplay`, `getHealthSymbol`) remain as-is -- they're pure logic, not output.

### Step 6: Cleanup and verification

- Verify `cliprint` is removed from `backend.go`, `server_status.go`
- Verify `server.go` and `server_llm.go` still import `cliprint` (expected -- `handleServerStart` and `handleLLMPull` use `ProgressDisplay`)
- `config.go` may retain `cliprint` for error paths in `handleConfigGet`/`handleConfigPath` (or migrate those too)
- `go build ./client-apps/cli/cmd/stigmer/...` -- clean
- `go vet` on all modified packages -- clean
- `go test ./client-apps/cli/cmd/stigmer/root/...` -- all passing
- Update BUILD.bazel with new source files

---

## Execution Order Rationale

Steps 1-2 (backend, config) are independent and simple -- they establish the migration pattern for this phase. Step 3 (split) is a prerequisite for Steps 4-5. Step 4 (LLM) must come before Step 5 (status) because `handleServerStatus()` calls `addLLMSections()` from `server_llm.go`.

---

## Files Modified/Created Summary

```
Modified:
  client-apps/cli/cmd/stigmer/root/backend.go         (migrate to clioutput)
  client-apps/cli/cmd/stigmer/root/config.go           (partial migrate)
  client-apps/cli/cmd/stigmer/root/server.go           (split: 896→~170 lines)
  client-apps/cli/cmd/stigmer/root/BUILD.bazel         (+2 srcs)

Created:
  client-apps/cli/cmd/stigmer/root/server_status.go    (~280 lines, new)
  client-apps/cli/cmd/stigmer/root/server_llm.go       (~170 lines, new)
```

