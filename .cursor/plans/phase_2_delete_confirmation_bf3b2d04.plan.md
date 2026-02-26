---
name: Phase 2 Delete Confirmation
overview: Fix the critical bug where `stigmer delete` proceeds without user confirmation. Wire the existing `clioutput.Confirmer` into all 6 delete handlers in `delete.go` so they block on a y/N prompt before destroying resources.
todos:
  - id: delete-context-struct
    content: Add `deleteContext` struct and refactor `routeDelete` + all 5 resource handler signatures to use it
    status: completed
  - id: wire-confirmer-resource-handlers
    content: Wire `Confirmer.Confirm()` into the `!force` block of all 5 resource delete handlers (agent, workflow, mcpserver, project, skill) with abort handling
    status: completed
  - id: wire-confirmer-execution-cancel
    content: Wire `Confirmer.Confirm()` into `executeCancelExecution` with abort handling
    status: completed
  - id: update-build-bazel
    content: Add `//client-apps/cli/pkg/clioutput` to root BUILD.bazel deps
    status: completed
  - id: verify-build-lint
    content: "Verify: go build, go vet, bazel build, linter clean"
    status: completed
isProject: false
---

# Phase 2: Fix Critical Delete Confirmation Bug

## The Bug

Every delete handler in [delete.go](client-apps/cli/cmd/stigmer/root/delete.go) shows a warning display but then **unconditionally proceeds to delete**. There is no blocking prompt. The `--force` flag gates the display text, but deletion happens regardless:

```169:191:client-apps/cli/cmd/stigmer/root/delete.go
func deleteAgent(ref, orgID string, force bool, conn *grpc.ClientConn) error {
	agentRes, err := agent.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}
	if !force {
		agent.DisplayDeleteConfirmation(agentRes)
		cliprint.PrintInfo("Use --force to skip this confirmation")
		fmt.Println()
	}
	// BUG: proceeds to delete regardless of force flag
	result, err := agent.Delete(&agent.DeleteOptions{
		AgentID: agentRes.Metadata.Id,
		Conn:    conn,
	})
```

Six handlers are affected: `deleteAgent`, `deleteWorkflow`, `deleteMcpServer`, `deleteProject`, `deleteSkill`, `executeCancelExecution`.

## Scope

**IN scope** (2 files):

- `client-apps/cli/cmd/stigmer/root/delete.go` -- wire confirmer into all handlers
- `client-apps/cli/cmd/stigmer/root/BUILD.bazel` -- add `clioutput` dependency

**NOT in scope** (deferred to Phase 3):

- No changes to any `display.go` file
- No changes to the `clioutput` package
- No migration of `DisplayDeleteConfirmation` or `DisplayDeleteResult` to `CommandResult`
- No `--output` flag wiring

## Design

### 1. Introduce `deleteContext` struct

Replace the parameter list `(ref, orgID string, force bool, conn *grpc.ClientConn)` with an unexported struct in `delete.go`:

```go
type deleteContext struct {
	ref       string
	orgID     string
	force     bool
	confirmer clioutput.Confirmer
	conn      *grpc.ClientConn
}
```

**Why a struct and not more parameters:** The handlers currently take 4 params. Adding `confirmer` makes 5 (replacing `force` isn't possible -- see below). In Phase 3, `renderer` adds a 6th. A struct avoids parameter explosion and is easy to extend. It's unexported and local to `delete.go`.

**Why keep `force` alongside `confirmer`:** The `force` flag gates whether to *show the confirmation display at all*. The confirmer handles the *blocking prompt*. `AlwaysYesConfirmer` doesn't know about the display -- it only auto-confirms. We need `force` to skip the entire confirmation UI (display + prompt) when `--force` is set.

### 2. Create confirmer in `executeDelete`, pass through `deleteContext`

```go
func executeDelete(opts deleteOptions) error {
	if isDeleteExecutionType(opts.TypeArg) {
		return executeCancelExecution(opts) // separate flow, own confirmer
	}
	// ... existing setup (config, org, daemon, connection) ...
	
	dctx := &deleteContext{
		ref:       opts.Reference,
		orgID:     orgID,
		force:     opts.Force,
		confirmer: clioutput.NewConfirmer(opts.Force, os.Stderr),
		conn:      conn,
	}
	return routeDelete(info, dctx)
}
```

`routeDelete` simplifies to `func routeDelete(info *types.TypeInfo, dctx *deleteContext) error`.

### 3. Handler pattern (same for all 5 resource handlers)

```go
func deleteAgent(dctx *deleteContext) error {
	agentRes, err := agent.GetFromBackend(dctx.conn, dctx.orgID, dctx.ref)
	if err != nil {
		return err
	}

	if !dctx.force {
		agent.DisplayDeleteConfirmation(agentRes)
		confirmed, err := dctx.confirmer.Confirm("Proceed with deletion? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := agent.Delete(&agent.DeleteOptions{
		AgentID: agentRes.Metadata.Id,
		Conn:    dctx.conn,
	})
	if err != nil {
		return err
	}
	agent.DisplayDeleteResult(result)
	return nil
}
```

Key behavior changes:

- **Removed**: `cliprint.PrintInfo("Use --force to skip this confirmation")` + `fmt.Println()`. The `--force` hint is already in command help; real-world CLIs (terraform, gh) don't mention skip flags in prompts
- **Added**: `confirmer.Confirm()` blocks for user input
- **Added**: abort returns `nil` (not an error -- user's choice was honored) with "Aborted." to stderr
- Error from `Confirm()` is wrapped per coding guidelines

### 4. Execution cancel (separate flow)

`executeCancelExecution` creates its own backend connection, so it can't share the `deleteContext` created after the early return. It creates its own confirmer inline:

```go
func executeCancelExecution(opts deleteOptions) error {
	// ... validate, setup connection ...

	if !opts.Force {
		fmt.Println()
		cliprint.PrintWarning("You are about to cancel execution: %s", opts.Reference)
		cliprint.PrintInfo("This will gracefully stop the running agent.")
		fmt.Println()

		confirmer := clioutput.NewInteractiveConfirmer(os.Stderr)
		confirmed, err := confirmer.Confirm("Proceed with cancellation? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := execution.CancelWithResult(conn, opts.Reference)
	// ...
}
```

### 5. BUILD.bazel change

Add `//client-apps/cli/pkg/clioutput` to the `deps` list of the `root` library target.

## Pre-Existing Concern: File Length

`delete.go` is currently 349 lines -- already above the 250-line guideline. Phase 2 adds roughly 40-50 lines of confirmation logic, pushing it to ~400. This is pre-existing debt. I recommend noting this for Phase 3: when we migrate displays to `CommandResult`, consider splitting into `delete.go` (command definition + orchestration) and `delete_handlers.go` (per-resource handlers). Not in Phase 2 scope.

## Behavioral Summary


| Scenario                                    | Before                                 | After                                                                                   |
| ------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| `stigmer delete agent foo`                  | Shows warning, deletes unconditionally | Shows warning, prompts `[y/N]`, deletes only on "y"                                     |
| `stigmer delete agent foo --force`          | Deletes silently                       | Deletes silently (no change)                                                            |
| `stigmer delete agent foo` + user types "N" | N/A (no prompt)                        | Prints "Aborted.", exits cleanly                                                        |
| `stigmer delete agent foo` piped (non-TTY)  | Shows warning, deletes unconditionally | Shows warning, `InteractiveConfirmer` returns false (non-TTY safety), prints "Aborted." |
| `stigmer delete exec aex_123`               | Shows warning, cancels unconditionally | Shows warning, prompts `[y/N]`, cancels only on "y"                                     |


## Verification

After implementation:

- `go build ./client-apps/cli/...` -- compiles
- `go vet ./client-apps/cli/...` -- no issues
- Bazel build target for root package
- Manual: `stigmer delete agent <slug>` prompts and waits
- Manual: `stigmer delete agent <slug> --force` skips prompt
- Manual: type "N" at prompt to verify abort

