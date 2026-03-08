# Auto-Merge MCP Server env_spec into Agent at Create/Update Time

**Date**: March 8, 2026

## Summary

Added a new deterministic pipeline step — `MergeMcpServerEnvSpecs` — to both the OSS (Go) and Cloud (Java) agent create and update pipelines. This step automatically merges environment variable declarations from referenced MCP servers into the agent's `env_spec`, eliminating a class of runtime failures where agents crash because their MCP server subprocesses are missing required environment variables.

## Problem Statement

When an agent references MCP servers via `mcp_server_usages`, those MCP servers may require specific environment variables (e.g., `PLANTON_API_KEY` for `mcp-server-planton`). The agent's `env_spec` must declare these variables so that:
- The UI/CLI can display what environment variables the agent needs
- `AgentInstance` configuration knows which variables to supply
- Execution-time validation has the complete schema to check against

### Pain Points

- **Manual and error-prone**: Agent authors (including the `agent-creator` LLM) had to manually copy env var declarations from each MCP server's `env_spec` into the agent. Forgetting any variable caused runtime crashes.
- **Runtime failures with poor diagnostics**: The `infra-chart-composer` agent crashed with `MCP persistent connection failed: PLANTON_API_KEY is required when transport is "stdio"` because it didn't declare the variable in its `env_spec`.
- **No platform-level guarantee**: The completeness of an agent's `env_spec` depended entirely on the diligence of its creator, with no deterministic enforcement.

## Solution

A new pipeline step inserted into both agent create and update pipelines that resolves each referenced MCP server, reads its `env_spec.data`, and union-merges those entries into the agent's `env_spec.data` before persistence.

Key design decisions:
- **Agent-declared entries always win**: If the agent already declares a variable, its definition takes precedence over the MCP server's. User intent is never overwritten.
- **Schema only, no values**: Only `description` and `is_secret` are merged. The `value` field is intentionally left empty because actual values come from `AgentInstance.environment_refs` at runtime.
- **Lenient on missing MCP servers**: If an MCP server cannot be found (not yet created, different org), the step logs a warning and continues. The execution-time `McpEnvironmentValidator` remains the authoritative fail-fast check.
- **Idempotent**: Re-applying an agent produces the same result.

## Implementation Details

### stigmer (OSS / Go)

- **New file**: `backend/services/stigmer-server/pkg/domain/agent/controller/merge_mcp_env_specs.go`
  - `mergeMcpServerEnvSpecsStep` struct implementing the pipeline step interface
  - Uses `steps.FindResourceBySlug` to resolve MCP servers by org+slug
  - Takes `store.Store` as its only dependency
- **Modified**: `create.go` — wired step between `NormalizeReferencesStep` and `PersistStep`
- **Modified**: `update.go` — same wiring
- **Modified**: `agent_controller_test.go` — 6 new integration test cases using real SQLite store:
  - Basic merge from a single MCP server
  - Agent-declared env vars take precedence
  - No-op when no MCP usages
  - Graceful skip when MCP server not found
  - Multiple MCP servers with overlapping env vars
  - Update pipeline also merges

### stigmer-cloud (Cloud / Java)

- **New file**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agent/request/step/MergeMcpServerEnvSpecsStep.java`
  - Spring `@Component` implementing `RequestPipelineStepV2<ContextBase<Agent, Agent>>`
  - Works with both `CreateContextV2` and `UpdateContextV2` via the `? super T` bound on `addStep`
  - Injects `McpServerRepo`, uses `findByOrgAndSlug` to resolve each MCP server
- **Modified**: `AgentCreateHandler.java` — injected step, wired between `normalizeReferences` and `persist`
- **Modified**: `AgentUpdateHandler.java` — same injection and wiring
- **New file**: `MergeMcpServerEnvSpecsStepTest.java` — 10 unit test cases with Mockito/AssertJ covering merge behavior, precedence, lenient error handling, and idempotency

## Benefits

- **Zero-configuration correctness**: Agents automatically declare all environment variables their MCP servers need. No manual copying, no forgotten variables.
- **Fail-fast at creation, not runtime**: Missing env vars are now visible at agent apply time (in the stored `env_spec`), not at execution time when the MCP server subprocess crashes.
- **Backward compatible**: Existing agents with manually declared `env_spec` entries are unaffected — their entries take precedence.
- **No proto changes**: Both `AgentSpec.env_spec` and `McpServerSpec.env_spec` already share the same `EnvironmentSpec` protobuf type.

## Impact

- **Agent authors**: No longer need to manually cross-reference MCP server env_spec when creating agents
- **agent-creator LLM**: The platform now guarantees completeness deterministically, removing the need for LLM instructions about env_spec propagation
- **End users**: Fewer runtime failures when running agents that use MCP servers
- **Platform operators**: The `McpEnvironmentValidator` at execution time is now a safety net rather than the primary enforcement mechanism

## Related Work

- `McpEnvironmentValidator` (execution-time validation) — unchanged, remains as safety net
- `NormalizeApiResourceReferencesStep` — the step this new step depends on (resolves org fields)
- `agent-creator` skill — no longer needs env_spec propagation instructions

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation across both repositories
