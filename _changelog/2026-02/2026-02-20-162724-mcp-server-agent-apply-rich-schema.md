# MCP Server: Rich JSON Schema for Agent Apply Tool

**Date**: February 20, 2026

## Summary

Replaced the opaque single-string `resource` parameter in the `apply_agent` MCP tool with a flat, structured input following the SDK pattern. The LLM now sees a full JSON Schema with every field, its type, required status, and description — instead of guessing from a terse description string.

## Problem Statement

The `apply_agent` tool accepted a single `Resource string` parameter containing the entire Agent proto as raw JSON. The LLM had zero visibility into the 20+ fields across nested structures like `McpServerUsage`, `SubAgent`, `McpAccess`, `ToolApprovalOverride`, and `EnvironmentSpec`.

### Pain Points

- LLM had to guess the resource structure from a cramped description and a minimal example
- No field-level discoverability — the schema showed `{ "resource": "string" }`
- Proto boilerplate (`api_version`, `kind`, `metadata`/`spec` nesting) leaked into the tool interface
- Resource reference `kind` enum values (43 for skill, 44 for mcp_server) were exposed to the LLM

## Solution

Follow the same pattern as the Go SDK (`sdk/go/agent/agent.go`): flat identity fields (name, slug, org) plus spec fields (instructions, mcp_server_usages, etc.) at the same level, with a `toProto()` conversion function that handles all proto envelope assembly.

## Implementation Details

### New files

- **`domains/input.go`** — `ResourceIdentity` struct (name, slug, org, visibility, labels, tags) shared across all future domain apply tools. Embedded structs are flattened by both `encoding/json` and `jsonschema-go`.

- **`agents/input.go`** — `ApplyAgentInput` embedding `ResourceIdentity`, plus 9 nested input types: `McpServerUsageInput`, `McpServerRefInput`, `SkillRefInput`, `SubAgentInput`, `McpAccessInput`, `ToolApprovalOverrideInput`, `EnvironmentInput`, `EnvironmentValue`. All with `jsonschema` tags for rich descriptions.

- **`agents/convert.go`** — `toProto()` conversion following SDK's `ToProto()` pattern. Auto-populates `api_version`, `kind`, visibility default (PRIVATE), slug (from name), and all reference `kind` enum values.

- **`agents/convert_test.go`** — 16 test functions covering minimal input, slug generation, visibility, reference kinds, sub-agents, tool approvals, environment, labels/tags, and full round-trip.

### Modified files

- **`agents/apply.go`** — `Apply` now takes `*agentv1.Agent` directly instead of `resourceJSON string`. Eliminates the JSON unmarshal step.

- **`agents/tools.go`** — Old `ApplyAgentInput` (single `Resource string`) removed. Handler calls `input.toProto()` then `Apply()` then `domains.TextResult()`.

- **`agents/apply_tool_test.go`** — All test cases updated to use new structured input.

### Unchanged

`domains.ApplyFunc`, `domains.CallApply`, `server.go` registration, and all other domain packages remain untouched.

## Benefits

- **Full discoverability**: LLM sees every field with type, required status, and description via auto-generated JSON Schema
- **No proto leakage**: `api_version`, `kind`, `metadata`/`spec` wrapping, enum values all hidden
- **SDK consistency**: Same developer experience for LLMs as for Go SDK users
- **Shared foundation**: `ResourceIdentity` reusable for workflows, mcpservers, skills when expanded
- **Testable conversion**: `toProto()` has dedicated test coverage separate from tool handler tests

## Impact

- **MCP tool consumers (LLMs)**: Dramatically improved ability to construct valid `apply_agent` calls
- **Maintainers**: Clear separation between LLM-facing types (`input.go`), proto conversion (`convert.go`), and gRPC transport (`apply.go`)
- **Future domains**: Pattern established for workflows, mcpservers, skills to follow

## Related Work

- `2026-02-20-145752-mcp-server-shared-abstractions.md` — T02 core abstractions
- `2026-02-20-151441-mcp-server-agents-domain-refactor.md` — T03 agents refactor
- `2026-02-20-153626-mcp-server-remaining-domains-refactor.md` — T04 remaining domains

---

**Status**: ✅ Production Ready
**Timeline**: Single session
