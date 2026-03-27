# Next Task: 20260225.02.mcp-tool-discovery

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260225.02.mcp-tool-discovery

**Description**: Add MCP server tool/resource discovery to Stigmer. CLI uses the Go MCP SDK to connect locally and discover tools/resources, then pushes results to stigmer-server via a new updateDiscoveredCapabilities RPC. Web console triggers server-side discovery via Temporal workflow. AI-driven approval policy generation via mcp-server-creator agent.
**Goal**: Enable Stigmer to store and expose the list of tools/resources available on each configured MCP server, and automatically generate approval policies for those tools.
**Tech Stack**: Protobuf, Go (CLI, stigmer-server), Java (stigmer-cloud), Python (agent-runner Temporal activity), TypeScript (SDK + React), buf generate
**Components**: APIs (proto definitions), stigmer-server (RPC handler), stigmer-cloud (RPC handler with FGA), CLI (discover command, bootstrap discovery), agent-runner (Temporal activity), SDK (TypeScript client, React hooks + components), shared library (mcpdiscovery)

## Current State

- **Status**: In Progress — Implementation complete, ready for end-to-end testing
- **Last Session**: 2026-03-27 — Completed server-side discovery + React SDK + approval policy generation
- **Active Task**: End-to-end testing of discovery and approval policy flows

## Session Progress (2026-03-27) — Session 4

### Server-side Discovery (New)

- **Proto**: Added `DiscoverCapabilitiesInput` message, `discoverCapabilities` RPC with `can_edit` authorization, `api = 4` in `DiscoverySource` enum
- **Agent-runner**: New `discover_mcp_server.py` with `DiscoverMcpServerWorkflow` + `discover_mcp_server` activity using `MultiServerMCPClient`
- **Go backend**: New `discover_capabilities.go` handler (resolve credentials → start Temporal workflow → block → store). Auto-discovery on apply via `StartBestEffortDiscovery` goroutine
- **Java backend**: New `McpServerDiscoverCapabilitiesHandler.java` with 5-step pipeline (LoadFromRepo → Authorize → ResolveCredentials → ExecuteDiscoveryWorkflow → StoreDiscoveredCapabilities)
- **Stubs**: All regenerated (Go, Java, Python, TypeScript, Dart)

### React SDK (New)

- **`useDiscoverCapabilities`** — Wraps `discoverCapabilities` RPC
- **`useMcpServerCredentials`** — Checks personal env against `env_spec`, computes missing vars, saves credentials
- **`useTriggerApprovalPolicySession`** — Creates agent session with pre-filled prompt + YAML attachment
- **`ApprovalPolicyGeneratorPanel`** — Inline execution streaming using `MessageThread` + `ExecutionProgress`
- **Enhanced `McpServerDetailView`** — Discovery button, credential form, approval policies section, generate policies button + inline panel

### Agent Enhancement

- Added `apply_mcp_server` to `mcp-server-creator` agent's `enabled_tools` in seedpack

## Phases Complete

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Proto changes + codegen | COMPLETE |
| 2 | Agent-runner Temporal activity | COMPLETE |
| 3 | Go + Java backend handlers | COMPLETE |
| 4 | TypeScript SDK method | COMPLETE |
| 5 | React SDK hooks + components | COMPLETE |
| 6 | Enhanced McpServerDetailView | COMPLETE |
| 7 | Auto-discovery on apply (Go) | COMPLETE |
| E2E | End-to-end testing | PENDING |

## Next Steps

### End-to-End Testing (Priority)

1. Test discovery from web console: click "Discover Tools" → credential prompt → discovery runs → tools appear
2. Test approval policy generation: click "Generate Policies" → agent session starts → inline panel streams progress → policies applied
3. Test auto-discovery on apply: `apply` MCP server YAML → tools auto-discovered in background
4. Test credential flow: missing env vars → prompt → save → auto-trigger discovery
5. Verify Java handler in stigmer-cloud compiles and integrates

### Follow-up Work

- Add auto-discovery to Java `apply` handler (currently only Go has it)
- Test agent-runner Temporal activity with various MCP server types (stdio, HTTP)
- Consider adding a progress indicator during the ~30s discovery blocking period
- Evaluate whether `ApprovalPolicyGeneratorPanel` needs approval handling (user approve/reject on tool calls)

## Context for Resume

- All implementation is complete across both repos (stigmer + stigmer-cloud)
- stigmer-cloud has uncommitted changes: regenerated stubs + new Java handler
- The `mcp-server/proto/` BUILD.bazel files in stigmer are unrelated (from mcp-server codegen module)
- Pre-existing approval-related stub changes in stigmer-cloud are from HITL flow hardening, not this project
- Key architectural decision: both backends delegate to the same Python Temporal workflow on the agent-runner's task queue

## Essential Files

### New in this session
- `backend/services/agent-runner/worker/activities/discover_mcp_server.py` — Temporal workflow + activity
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/discover_capabilities.go` — Go handler
- `stigmer-cloud/.../McpServerDiscoverCapabilitiesHandler.java` — Java handler
- `sdk/react/src/mcp-server/useDiscoverCapabilities.ts`
- `sdk/react/src/mcp-server/useMcpServerCredentials.ts`
- `sdk/react/src/mcp-server/useTriggerApprovalPolicySession.ts`
- `sdk/react/src/mcp-server/ApprovalPolicyGeneratorPanel.tsx`

### Modified in this session
- `apis/ai/stigmer/agentic/mcpserver/v1/{command,io,status}.proto` + all stubs
- `backend/services/agent-runner/worker/worker.py`
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/{apply,mcpserver_controller}.go`
- `backend/services/stigmer-server/pkg/server/server.go`
- `sdk/react/src/mcp-server/McpServerDetailView.tsx`
- `sdk/react/src/mcp-server/index.ts` + `sdk/react/src/index.ts`
- `sdk/typescript/src/gen/mcpserver.ts`
- `seedpack/agents/mcp-server-creator.yaml`

### From earlier sessions (unchanged)
- `backend/libs/go/mcpdiscovery/` — Shared Go discovery library
- `client-apps/cli/internal/cli/mcpserver/` — CLI discovery command + env resolver
- `client-apps/cli/cmd/stigmer/root/server.go` — Bootstrap wiring

### Plan
- `_plans/mcp_discovery_and_approval_dc8a630d.plan.md` — Full implementation plan

## Quick Commands

After loading context:
- "Run end-to-end test" — Test the full discovery + policy generation flow
- "Add auto-discovery to Java apply" — Extend stigmer-cloud apply handler
- "Show project status" — Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
