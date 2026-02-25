# Task T01: Replace agent_instance_id with ApiResourceReference

**Created**: 2026-02-25
**Status**: PENDING REVIEW
**Type**: Refactoring

> **This plan requires your review before execution.**

## Objective

Replace opaque `agent_instance_id` (string) with `ApiResourceReference` (org + kind + slug) in `SessionSpec` and remove `default_instance_id` from `AgentStatus` in favor of a convention-based slug pattern. Fix the existing naming confusion in `ListSessionsByAgentRequest`.

## Current State

Sessions store `agent_instance_id` as a system-generated opaque string (e.g., `ain-01kgyq948cr2xt6932o...`). This shows up in:

- CLI output (`stigmer list sessions` -- the "AGENT" column is unreadable)
- Session detail views
- Log messages throughout the execution chain

The codebase already has `ApiResourceReference` (org + kind + slug) used for `environment_refs` in `AgentInstanceSpec`, and `AgentInstanceQueryController` already exposes a `getByReference(ApiResourceReference)` RPC.

## Design Decisions

### D1: SessionSpec -- agent_instance_id to agent_instance_ref

**Change**: `string agent_instance_id` -> `ApiResourceReference agent_instance_ref`

- Aligns with existing `environment_refs` pattern in `AgentInstanceSpec`
- `getByReference()` RPC already exists for resolution
- Human-readable: "default/my-agent-default" instead of "ain-01kgyq948cr2xt..."

### D2: AgentStatus -- remove default_instance_id (convention-based)

**Change**: Remove `string default_instance_id` entirely from `AgentStatus`

The default instance slug is always `{agent-slug}-default` by convention. This is already what the code does today -- `createDefaultInstanceIfNeededStep` sets the name to `agentSlug + "-default"` and `ResolveSlugStep` generates the slug from it.

Instead of storing a field, derive the reference:
1. Load agent -> get `metadata.org` and `metadata.slug`
2. Derive instance slug: `{agent-slug}-default`
3. Look up via `getByReference(org, agent_instance, {agent-slug}-default)`
4. If not found, create it

### D3: ListSessionsByAgentRequest -- fix naming confusion

**Current bug**: The proto field is `agent_id` but the filter step uses it as `agent_instance_id`:
```go
agentInstanceID := req.GetAgentId()  // Misleading
if session.GetSpec().GetAgentInstanceId() == agentInstanceID { ... }
```

**Change**: Replace `string agent_id` with `ApiResourceReference agent_instance_ref` to be honest about what it actually filters on.

## Blast Radius (File-by-File)

### Proto Source (3 files)
| File | Change |
|------|--------|
| `apis/ai/stigmer/agentic/session/v1/spec.proto` | `agent_instance_id` -> `agent_instance_ref` (ApiResourceReference) |
| `apis/ai/stigmer/agentic/agent/v1/status.proto` | Remove `default_instance_id` field |
| `apis/ai/stigmer/agentic/session/v1/io.proto` | `ListSessionsByAgentRequest.agent_id` -> `agent_instance_ref` |

### Generated Stubs (automated via buf generate)
| Files | Action |
|-------|--------|
| `apis/stubs/go/ai/stigmer/agentic/session/v1/spec.pb.go` | Auto-regenerated |
| `apis/stubs/go/ai/stigmer/agentic/agent/v1/status.pb.go` | Auto-regenerated |
| `apis/stubs/go/ai/stigmer/agentic/session/v1/io.pb.go` | Auto-regenerated |
| `apis/stubs/python/stigmer/ai/stigmer/agentic/session/v1/*` | Auto-regenerated |
| `apis/stubs/python/stigmer/ai/stigmer/agentic/agent/v1/*` | Auto-regenerated |

### Backend Go (4 files)
| File | Change |
|------|--------|
| `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` | `createDefaultInstanceIfNeededStep`: derive ref by convention, look up via `getByReference()`. `createSessionIfNeededStep`: set `AgentInstanceRef` instead of `AgentInstanceId`. |
| `backend/services/stigmer-server/pkg/domain/session/controller/steps/filter_by_agent_instance.go` | Compare by reference (org + slug) instead of ID string |
| `backend/services/stigmer-server/pkg/domain/session/controller/session_controller_test.go` | Update test fixtures |
| `backend/services/stigmer-server/pkg/domain/session/controller/list_by_agent.go` | Comment updates |

### Python Agent-Runner (1 file)
| File | Change |
|------|--------|
| `backend/services/agent-runner/worker/activities/execute_graphton.py` | Use `session.spec.agent_instance_ref` and call `get_by_reference()` instead of `get()` |

### CLI (1 file)
| File | Change |
|------|--------|
| `client-apps/cli/internal/cli/session/display.go` | Display `org/slug` format instead of opaque ID |

### Not Touched
- `AgentInstanceId` message in `agentinstance/v1/io.proto` (used by `get()` RPC, unrelated)
- Agent instance creation/update pipelines
- Workflow runner (uses agent execution, not session spec directly)
- Store/persistence layer (proto serialization handles it transparently)

## Implementation Phases

### Phase 1: Proto Changes
1. Edit `session/v1/spec.proto` -- change field type and add import
2. Edit `agent/v1/status.proto` -- remove `default_instance_id`
3. Edit `session/v1/io.proto` -- change `ListSessionsByAgentRequest`
4. Run `buf generate` to regenerate all stubs

### Phase 2: Agent Execution Flow (Go)
5. Update `createDefaultInstanceIfNeededStep` -- derive ref by convention, use `getByReference()`
6. Update `createSessionIfNeededStep` -- set `AgentInstanceRef` on session spec
7. Update pipeline context keys and types

### Phase 3: Session Controller (Go)
8. Update `filter_by_agent_instance.go` -- compare references instead of IDs
9. Update `list_by_agent.go` -- comments
10. Update `session_controller_test.go` -- all test fixtures

### Phase 4: Python Agent-Runner
11. Update `execute_graphton.py` -- use `get_by_reference()` for agent instance lookup

### Phase 5: CLI
12. Update `session/display.go` -- display `org/slug` format

### Phase 6: Verification
13. Run Go tests
14. Run buf lint
15. Manual CLI verification (`stigmer list sessions`)

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Existing sessions in DB become invalid | Expected and accepted (no backward compat needed) |
| Python stubs may have different method naming for `getByReference` | Verify generated Python stub method names after buf generate |
| `createDefaultInstanceIfNeededStep` needs agent instance client for `getByReference()` | It already has `agentInstanceClient` -- just need to call the right method |
| Convention slug collision (user manually creates `{slug}-default`) | Low risk in OSS; can add validation later if needed |

## Success Criteria

- [ ] `SessionSpec` uses `ApiResourceReference` instead of string ID
- [ ] `AgentStatus.default_instance_id` removed
- [ ] `ListSessionsByAgentRequest` uses `ApiResourceReference`
- [ ] CLI `stigmer list sessions` shows `org/slug` format
- [ ] Agent execution auto-session-creation works with references
- [ ] Python agent-runner resolves instances via `getByReference()`
- [ ] All Go tests pass
- [ ] buf lint passes

## Notes

- This is a breaking change for stored data. All existing sessions will need to be recreated.
- The `getByReference()` RPC already exists and is tested.
- The `ApiResourceReference` type is well-established in the codebase (`environment_refs` uses it).

---

## Review Process

1. **Review this plan** -- Does the approach make sense?
2. **Provide feedback** -- Any concerns about the design decisions (D1, D2, D3)?
3. **I'll revise** -- Create `T01_2_revised_plan.md` if needed
4. **Approve** -- Give explicit go-ahead
5. **Execute** -- Implementation tracked phase by phase
