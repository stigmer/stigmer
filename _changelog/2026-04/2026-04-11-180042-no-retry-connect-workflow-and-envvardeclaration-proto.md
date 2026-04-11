# No-Retry Connect Workflow and EnvVarDeclaration Proto

**Date**: April 11, 2026

## Summary

Eliminated Temporal activity retries in the MCP server connect workflow to prevent the 401 retry loop, and introduced `EnvVarDeclaration` — a new proto message that separates environment variable declaration semantics from storage semantics across all blueprint resources.

## Problem Statement

Two related issues in the MCP server connect flow:

### Pain Points

- **401 retry loop**: When `SLACK_ACCESS_TOKEN` was missing (OAuth not completed), the connect workflow retried indefinitely with exponential backoff. The `PlaceholderResolver` in lenient mode sent a literal `Bearer ${SLACK_ACCESS_TOKEN}` as the Authorization header, causing a deterministic 401 that could never succeed on retry.
- **No required/optional distinction**: `EnvironmentValue` was shared between storage (actual encrypted values) and declaration (what a blueprint needs). There was no way to express "this env var is optional" vs "this env var is required" — the `tolerateMissing` flag in the Java handler was a runtime workaround for a missing domain concept.

## Solution

**Phase 1 — No-retry policy**: Added `RetryPolicy(maximum_attempts=1)` to all three `workflow.execute_activity` calls in the connect workflow. Connect is user-triggered and synchronous — errors should surface immediately.

**Phase 2 — EnvVarDeclaration proto**: Created a dedicated declaration message in the `environment` package that describes what a blueprint *needs* (schema), separate from `EnvironmentValue` which stores what a blueprint *has* (data). Added a flat `map<string, EnvVarDeclaration> env` field on McpServerSpec, AgentSpec, and WorkflowSpec, deprecating the nested `env_spec.data` pattern.

## Implementation Details

### Retry policy (1 file)

Added `RetryPolicy(maximum_attempts=1)` to `discover_mcp_server.py`:
- `discover_mcp_server` activity in `ConnectMcpServerWorkflow` 
- `classify_tool_approvals` activity in `ConnectMcpServerWorkflow`
- `discover_mcp_server` activity in legacy `DiscoverMcpServerWorkflow`

### Proto changes (4 files)

**New message** in `environment/v1/spec.proto`:
```protobuf
message EnvVarDeclaration {
  bool is_secret = 1;
  string description = 2;
  bool optional = 3;
}
```

**New fields** on blueprint specs (deprecating `env_spec`):
- `McpServerSpec.env` — field 15
- `AgentSpec.env` — field 8
- `WorkflowSpec.env` — field 5

### Stub regeneration (67+ files across stigmer, 44+ files across stigmer-cloud)

Ran `make codegen` (stigmer) and `make protos` (stigmer-cloud) to regenerate Go, Java, Python, TypeScript, and Dart stubs plus SDK docs.

## Benefits

- **Immediate error feedback**: 401 and other deterministic connect errors surface to the user in seconds instead of retrying for minutes.
- **Clean DDD separation**: Blueprint declarations (schema) are distinct from environment storage (data). The `optional` concept lives only on declarations where it semantically belongs.
- **Flatter YAML**: `spec.env.KEY` replaces `spec.env_spec.data.KEY` — one nesting level removed for MCP server authors.
- **Foundation for T04-T06**: Consumer code, seedpack migration, and required/optional enforcement can now build on these proto definitions.

## Impact

- **Agent runner**: Connect workflow fails fast on errors (no more silent retry loops).
- **Proto API surface**: New `EnvVarDeclaration` type available across all blueprint resources. Old `env_spec` deprecated but still works.
- **SDK stubs**: All languages (Go, Java, Python, TypeScript, Dart) regenerated with new types.
- **No consumer changes yet**: The new `env` field is defined but not yet consumed. Existing `env_spec` continues to work unchanged — fully backward compatible.

## Related Work

- Follows the MCP OAuth managed credentials work from the same day
- T04-T06 (seedpack migration, consumer fallback, required/optional enforcement) are the next steps in this project

---

**Status**: ✅ Production Ready (proto + retry fix; consumer migration pending in T04-T06)
**Timeline**: ~1 hour
