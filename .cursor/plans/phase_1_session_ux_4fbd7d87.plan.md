---
name: Phase 1 Session UX
overview: Make "session" the sole user-facing concept across the entire agent execution flow in the CLI. Hide execution IDs and lifecycle internals. Refactor execution creation for clean Phase 2 extensibility.
todos:
  - id: refactor-create
    content: "Refactor `createAgentExecution` in run_create.go: introduce `CreateAgentExecutionInput` struct with `SessionID` field, update function body to use `spec.SessionId` when set"
    status: completed
  - id: update-run-agent
    content: "Update `runAgent()` in run_handlers.go: session-centric messaging, remove execution-ID display, add defensive log warning if session_id is empty"
    status: completed
  - id: update-draft-skill
    content: "Update `executeDraftSkill()` in draft_skill_handler.go: same session-centric messaging pattern"
    status: completed
  - id: update-callers
    content: Update all callers of `createAgentExecution` to use the new options struct (run_handlers.go, draft_skill_handler.go)
    status: completed
  - id: verify-propagation
    content: "Verify session_id propagation end-to-end: run_create -> run_handlers -> run_stream -> TUI config -> header display. Ensure no path drops the session_id."
    status: completed
  - id: lint-and-test
    content: Run linter checks on all modified files. Verify existing tests still pass with the refactored signature.
    status: completed
isProject: false
---

# Phase 1: Session-Centric CLI UX

## Key Discovery: Backend Is Already Done

The revised plan (T01_2) listed backend changes as part of Phase 1. **These are already fully implemented:**

- `Session` proto with full CRUD RPCs: [apis/ai/stigmer/agentic/session/v1/](apis/ai/stigmer/agentic/session/v1/)
- `AgentExecutionSpec.session_id` links executions to sessions: [apis/ai/stigmer/agentic/agentexecution/v1/spec.proto](apis/ai/stigmer/agentic/agentexecution/v1/spec.proto)
- Backend auto-creates sessions when `agent_id` is provided without `session_id`
- `listBySession` RPC already exists
- `stigmer run ses-xxx` already re-attaches or replays via [run_session.go](client-apps/cli/cmd/stigmer/root/run_session.go)
- TUI header already shows "Session: ses-xxx" when session ID is available

**Phase 1 is purely CLI-side work**: making the existing code consistently session-centric and laying clean groundwork for Phase 2.

## Design Decision: Auto-Create vs. Explicit Session Creation

The revised plan said "CLI creates a session before execution." However:

- The backend **already auto-creates sessions** when `agent_id` is provided without `session_id`
- Explicit creation requires the CLI to resolve `agent_instance_id` (a concept the CLI doesn't work with today)
- The only Phase 1 benefit of explicit creation would be setting `session.spec.subject` (conversation title for `stigmer list sessions`)
- Phase 2 **will** need explicit session control (for follow-up executions in the same session)

**Approach**: Keep auto-create for Phase 1. The refactored options struct adds `SessionID` support so Phase 2 can pass it for follow-ups. Explicit session creation (with subject, instance resolution) is deferred to Phase 2 where it's actually needed.

## Changes

### 1. Refactor `createAgentExecution` to options struct

**File**: [run_create.go](client-apps/cli/cmd/stigmer/root/run_create.go)

The current function has 8 positional parameters:

```18:18:client-apps/cli/cmd/stigmer/root/run_create.go
func createAgentExecution(agentID string, orgID string, message string, runtimeEnv envfile.EnvMap, attachments []*agentexecutionv1.Attachment, model string, autoApproveAll bool, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
```

Refactor to an options struct:

```go
type CreateAgentExecutionInput struct {
    AgentID        string
    SessionID      string // Phase 2: for follow-up executions within a session
    OrgID          string
    Message        string
    RuntimeEnv     envfile.EnvMap
    Attachments    []*agentexecutionv1.Attachment
    Model          string
    AutoApproveAll bool
    Conn           *grpc.ClientConn
}

func createAgentExecution(input CreateAgentExecutionInput) (*agentexecutionv1.AgentExecution, error)
```

When `SessionID` is set, populate `spec.SessionId` instead of `spec.AgentId` (the backend infers the agent from the session). This enables Phase 2 follow-ups without further refactoring.

### 2. Session-centric messaging in `runAgent()`

**File**: [run_handlers.go](client-apps/cli/cmd/stigmer/root/run_handlers.go)

Current behavior shows execution IDs as fallback:

```40:61:client-apps/cli/cmd/stigmer/root/run_handlers.go
	if len(attachments) > 0 {
		cliprint.PrintInfo("Creating agent execution with %d attachment(s)...", len(attachments))
	} else {
		cliprint.PrintInfo("Creating agent execution...")
	}
	// ...
	if sessionID != "" {
		cliprint.PrintSuccess("Session started: %s", sessionID)
	} else {
		cliprint.PrintSuccess("Agent execution started: %s", agent.Metadata.Name)
		cliprint.PrintInfo("  Execution ID: %s", exec.Metadata.Id)
	}
```

Changes:

- "Creating agent execution..." becomes "Starting session..."
- Always show "Session: ses-xxx" (the backend always creates a session)
- Remove the execution-ID fallback entirely from user-facing output
- Add a defensive `log.Warn()` if session_id is unexpectedly empty (indicates a backend issue, not a user concern)

### 3. Session-centric messaging in `executeDraftSkill()`

**File**: [draft_skill_handler.go](client-apps/cli/cmd/stigmer/root/draft_skill_handler.go)

Same pattern as `runAgent()`:

```72:84:client-apps/cli/cmd/stigmer/root/draft_skill_handler.go
	cliprint.PrintInfo("Invoking skill-creator-agent...")
	// ...
	sessionID := exec.GetSpec().GetSessionId()
	if sessionID != "" {
		cliprint.PrintInfo("Session: %s", sessionID)
	} else {
		cliprint.PrintInfo("Execution ID: %s", exec.Metadata.Id)
	}
```

Replace with session-only display, remove execution ID from output.

### 4. Clean up exit/detach displays

**File**: [run_display_summary.go](client-apps/cli/cmd/stigmer/root/run_display_summary.go)

The branching in `streamAgentExecution` already prefers session display:

```108:120:client-apps/cli/cmd/stigmer/root/run_stream.go
	if sessionID != "" {
		if result.Done() {
			displaySessionExitLine(sessionID, finalExec)
		} else {
			displaySessionDetachLine(sessionID)
		}
	} else {
		if result.Done() {
			displayAgentExecutionComplete(finalExec)
		} else {
			displayAgentExecutionDetached(finalExec)
		}
	}
```

Since session_id is always present now, the `else` branch becomes a defensive fallback. Keep it (defensive coding) but it should never trigger. Session exit stays minimal per UX decision: "Session ses-xxx completed (12s)".

### 5. Verify TUI header always shows session

**File**: [view.go](client-apps/cli/pkg/executiontui/view.go)

```69:79:client-apps/cli/pkg/executiontui/view.go
	var title string
	if m.cfg.SessionID != "" {
		title = fmt.Sprintf("  Session: %s  %s", m.cfg.SessionID, phaseIndicator)
	} else {
		title = fmt.Sprintf("  Execution: %s  %s", m.cfg.ExecutionID, phaseIndicator)
	}
```

No code change needed -- just verify that `SessionID` is always populated in `Config` when constructing the TUI model. The propagation happens in `streamAgentExecution` which already passes `sessionID` to the config.

## Scope Boundary

**In scope:**

- Options struct refactor for `createAgentExecution`
- All user-facing messages: session-centric, no execution IDs
- All callers updated to use new signature
- Defensive handling when session_id is unexpectedly empty

**Not in scope:**

- No proto changes
- No backend changes
- No new CLI commands
- No TUI architecture changes (textarea, input states -- Phase 2)
- No explicit session creation / subject setting (Phase 2)
- No "ask user" protocol (Phase 3)

