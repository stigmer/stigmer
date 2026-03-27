# MCP Server Discovery & Approval Policy Generation — Web Console + Backend

**Date**: March 27, 2026

## Summary

Added server-side MCP server discovery and AI-driven approval policy generation to the Stigmer platform. The web console's MCP server detail page now lets users discover tools, manage credentials, and auto-generate approval policies using the `mcp-server-creator` agent — capabilities previously available only through CLI scripts.

## Problem Statement

The MCP server detail page was read-only for discovered capabilities. Discovery (connecting to an MCP server, listing its tools) and approval policy generation (AI-classifying tool risk, producing `default_tool_approvals`) required manual CLI commands. The web console offered no way to trigger either operation, making it an incomplete management surface.

### Pain Points

- Users had to use CLI scripts to discover MCP server tools, then manually copy YAML
- Approval policy generation required running shell scripts outside the platform
- No unified experience — CLI users had discovery, web users did not
- Credential management for discovery was ad-hoc (shell environment only)
- Java backend (cloud) and Go backend (OSS) had no discovery RPC, only the CLI could push discovered capabilities

## Solution

A full-stack implementation spanning proto APIs, Python Temporal workflow, Go/Java backend handlers, TypeScript SDK, and React hooks/components:

1. **Server-side discovery via Temporal** — Both Go and Java backends delegate MCP discovery to the Python agent-runner through a Temporal workflow, avoiding the need for MCP runtimes (Node.js, Go, Docker) in the backend containers
2. **`discoverCapabilities` RPC** — New synchronous RPC that blocks until discovery completes (~30s timeout)
3. **Auto-discovery on apply** — Best-effort fire-and-forget discovery after every `apply` operation
4. **React SDK hooks** — `useDiscoverCapabilities`, `useMcpServerCredentials`, `useTriggerApprovalPolicySession`
5. **Enhanced detail view** — Discovery button, credential prompt, approval policies section, and inline AI execution panel

## Implementation Details

### Proto (Phase 1)

- Added `DiscoverCapabilitiesInput` message to `io.proto` with required `mcp_server_id` field
- Added `discoverCapabilities` RPC to `command.proto` with `can_edit` IAM authorization
- Added `api = 4` to `DiscoverySource` enum in `status.proto` for API-triggered discovery
- Regenerated all language stubs (Go, Java, Python, TypeScript, Dart)

### Python Temporal Activity (Phase 2)

- New `backend/services/agent-runner/worker/activities/discover_mcp_server.py` — `DiscoverMcpServerWorkflow` + `discover_mcp_server` activity
- Reuses existing `config_transformer.py` and `MultiServerMCPClient` from the agent-runner
- Connects to stdio/HTTP MCP servers, lists tools and resource templates, returns structured output
- Registered in `worker.py` alongside existing agent execution activities

### Go Backend (Phase 3)

- New `discover_capabilities.go` handler in mcpserver controller — resolves credentials from personal environment, starts Temporal workflow, blocks for result, stores capabilities
- Extended `mcpserver_controller.go` with `SetDiscoveryDependencies` for Temporal client, runner queue, and environment client injection
- Modified `apply.go` to fire `StartBestEffortDiscovery` goroutine after successful create/update
- Wired dependencies in `server.go`

### Java Backend (Phase 3)

- New `McpServerDiscoverCapabilitiesHandler.java` in stigmer-cloud with 5-step pipeline: LoadFromRepo → Authorize → ResolveCredentials → ExecuteDiscoveryWorkflow → StoreDiscoveredCapabilities
- Starts the same Python Temporal workflow, blocking for 45s
- Resolves credentials from personal environment via `EnvironmentQueryControllerBlockingStub`

### TypeScript SDK (Phase 4)

- Verified auto-generated `discoverCapabilities` method on `McpServerClient`

### React SDK (Phase 5)

- **`useDiscoverCapabilities`** — Action hook wrapping the discovery RPC with loading/error state
- **`useMcpServerCredentials`** — Checks personal environment against `env_spec`, computes missing variables, provides `saveCredentials()`
- **`useTriggerApprovalPolicySession`** — Orchestrates agent session creation with pre-filled prompt and YAML attachment
- **`ApprovalPolicyGeneratorPanel`** — Inline execution streaming panel using `MessageThread` and `ExecutionProgress`
- **Enhanced `McpServerDetailView`** — Discovery button (with credential prompt fallback), approval policies section, generate policies button with inline agent panel

### Agent Enhancement

- Added `apply_mcp_server` to `mcp-server-creator` agent's `enabled_tools` in seedpack

## Benefits

- **Complete web console experience** — Discovery and policy generation no longer require CLI access
- **Consistent dual-backend support** — Both Go (OSS) and Java (Cloud) backends use the same Python Temporal workflow
- **SDK-first architecture** — All new hooks and components are in `@stigmer/react`, embeddable by platform builders
- **Credential persistence** — Discovery credentials are always saved to the personal environment for reuse
- **Auto-discovery** — New/updated MCP servers get tools discovered automatically on apply

## Impact

- **Web console users** — Can now discover, inspect, and configure MCP server tools entirely from the UI
- **Platform builders** — Get 4 new hooks (`useDiscoverCapabilities`, `useMcpServerCredentials`, `useTriggerApprovalPolicySession`) and 1 new component (`ApprovalPolicyGeneratorPanel`) for embedding in their apps
- **Agent-runner** — Gains a new Temporal activity for MCP discovery, reusable beyond the web console flow
- **Both backends** — Gain the `discoverCapabilities` RPC and auto-discovery on apply

## Files Changed

### New files (8)
- `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` — `DiscoverCapabilitiesInput` message
- `backend/services/agent-runner/worker/activities/discover_mcp_server.py` — Temporal workflow + activity
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/discover_capabilities.go` — Go handler
- `stigmer-cloud/.../McpServerDiscoverCapabilitiesHandler.java` — Java handler
- `sdk/react/src/mcp-server/useDiscoverCapabilities.ts`
- `sdk/react/src/mcp-server/useMcpServerCredentials.ts`
- `sdk/react/src/mcp-server/useTriggerApprovalPolicySession.ts`
- `sdk/react/src/mcp-server/ApprovalPolicyGeneratorPanel.tsx`

### Modified files (10+)
- Proto files (command.proto, status.proto) + all regenerated stubs (Go, Java, Python, TS, Dart)
- `backend/services/agent-runner/worker/worker.py` — Activity/workflow registration
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/apply.go` — Auto-discovery
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/mcpserver_controller.go` — Dependencies
- `backend/services/stigmer-server/pkg/server/server.go` — Dependency wiring
- `sdk/react/src/mcp-server/McpServerDetailView.tsx` — Enhanced with discovery + policies
- `sdk/react/src/mcp-server/index.ts` + `sdk/react/src/index.ts` — New exports
- `seedpack/agents/mcp-server-creator.yaml` — `apply_mcp_server` tool

## Related Work

- Extends the MCP tool discovery project (`20260225.02.mcp-tool-discovery`) which built CLI-side discovery
- Builds on the HITL approval flow hardening which added `ApprovalLifecycleState`
- Uses the personal environment pattern established in the session composer

---

**Status**: ✅ Production Ready (pending end-to-end testing)
**Timeline**: Multi-session implementation across backend, SDK, and frontend layers
