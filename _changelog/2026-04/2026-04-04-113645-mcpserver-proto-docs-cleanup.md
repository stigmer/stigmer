# MCP Server Proto Documentation Cleanup

**Date**: April 4, 2026

## Summary

Cleaned up MCP Server proto comments to properly separate SDK-facing content from internal implementation details, created a dedicated `overview.md` for the SDK reference page, and removed decorative dividers — aligning the MCP Server resource with the Agent gold standard established in earlier sessions.

## Problem Statement

The MCP Server protos were heavily documented, but all documentation was written before the `@internal` boundary convention was established. This caused the auto-generated SDK reference page to leak authorization models, implementation flows, Temporal workflow details, and internal field format notes into the public-facing documentation.

### Pain Points

- RPC detail sections showed authorization matrices and "Input:", "Returns:" blocks that belong to internal developers, not SDK consumers
- The SDK page intro was derived from the `McpServerSpec` message comment ("This is a reusable definition...") instead of a proper `overview.md` file
- Decorative dividers (`// ─────`) in `spec.proto` and `status.proto` violated Document Writer conventions
- YAML examples were embedded in proto comments instead of living in `overview.md`
- 8 of 9 RPCs lacked `@internal` boundaries, causing full comment text to render in the SDK docs

## Solution

Applied the same `@internal` boundary pattern used in the Agent resource across all 6 MCP Server proto files, created a dedicated `overview.md`, and regenerated all SDK docs and intermediate schemas.

## Implementation Details

### New file: `overview.md`

Created `apis/ai/stigmer/agentic/mcpserver/docs/overview.md` with a 3-sentence SDK-facing description and a representative YAML example. This file is read directly by the SDK docs generator and replaces the derived spec description.

### Proto comment restructuring (6 files)

- **`api.proto`**: Moved lifecycle, YAML example, and visibility semantics behind `@internal` on the `McpServer` message and `metadata` field
- **`command.proto`**: Added `@internal` to all 7 RPCs and the service comment. SDK-facing text now shows only the method summary and behavioral notes
- **`query.proto`**: Added `@internal` to both RPCs and the service comment
- **`spec.proto`**: Removed 2 decorative divider blocks, added `@internal` to `McpServerSpec`, `StdioServerConfig`, `HttpServerConfig`, `ToolApprovalPolicy` messages, and to `default_enabled_tools` and `env_spec` fields
- **`status.proto`**: Removed decorative divider block, added `@internal` to `McpServerStatus`, `DiscoveredCapabilities`, `DiscoveredTool`, `DiscoveredResourceTemplate`, and simplified field comments
- **`io.proto`**: Added `@internal` to `UpdateDiscoveredCapabilitiesInput` and `DiscoverCapabilitiesInput` messages

### Codegen regeneration

Ran `proto2schema` and `gen-sdk-docs` to regenerate intermediate JSON schemas and all SDK reference pages. The regeneration also picked up pre-existing proto changes from earlier sessions on this branch.

## Benefits

- SDK consumers see clean, focused documentation without authorization matrices or backend implementation details
- The MCP Server SDK reference page now matches the Agent page in structure and tone
- Proto readers still have full context via `@internal` sections
- All decorative dividers removed per Document Writer conventions
- Consistent `@internal` boundary pattern across all API resources

## Impact

- **SDK users**: Cleaner, more focused reference documentation for the MCP Server resource
- **Proto readers**: Internal details preserved behind `@internal` — no information lost
- **Codegen pipeline**: Schemas and SDK docs fully regenerated and in sync

## Related Work

- [Environment, AgentInstance, AgentExecution proto docs cleanup](2026-04-04-111706-environment-agentinstance-agentexecution-proto-docs-cleanup.md)
- [ExecutionContext proto docs cleanup](2026-04-04-112614-executioncontext-proto-docs-cleanup.md)
- [Audience-aware proto comments for SDK docs](2026-04-03-201354-audience-aware-proto-comments-sdk-docs.md)

---

**Status**: ✅ Production Ready
