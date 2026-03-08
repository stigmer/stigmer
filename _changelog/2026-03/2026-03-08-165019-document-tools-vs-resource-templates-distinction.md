# Document Tools vs Resource Templates Distinction in MCP Capabilities

**Date**: March 8, 2026

## Summary

Added clear documentation across proto schemas, API docs, and product docs to distinguish MCP **tools** (callable actions) from **resource templates** (read-only data endpoints) within `discovered_capabilities`. This prevents a fatal runtime error where resource template names are mistakenly placed in `enabled_tools`.

## Problem Statement

An agent execution (`infra-chart-composer`) failed at startup with a `RuntimeError: Tool 'cloud_resource_schema' not found in cache`. The agent's `enabled_tools` list included `cloud_resource_schema` and `connection_schema`, which are MCP **resource templates** — not tools. The agent-runner tried to create approval-aware wrappers for them, couldn't find them in the tool registry, and crashed before the agent could even start.

### Pain Points

- The `DiscoveredCapabilities` proto message contains both `tools` and `resource_templates` as separate fields, but no documentation warned against mixing them
- The `enabled_tools` field comments didn't mention that only tool names are valid
- The agent-creator skill (which generates Agent YAMLs) had no signal in its source material to distinguish tools from resource templates
- The error was fatal and non-obvious — the agent-runner crashed instead of gracefully skipping unknown tools

## Solution

Added the tools vs resource templates distinction to every documentation layer that the skill-generation pipeline reads as context — proto field comments, API reference docs, validation checklists, and product docs. This ensures that when the `agent-creator` skill is regenerated, the skill generator will naturally infer this distinction from the source material and encode it in the generated skill.

## Implementation Details

### Proto Changes (3 files)

- **`mcpserver/v1/status.proto`** — Added a prominent "IMPORTANT — Tools vs Resource Templates" block to the `DiscoveredCapabilities` message comment. Updated field comments on `tools` and `resource_templates` to clarify which is callable and which is not.
- **`mcpserver/v1/spec.proto`** — Added a warning to `default_enabled_tools` field comment against including resource template names.
- **`agent/v1/spec.proto`** — Added warnings to `enabled_tools` field comments on both `McpServerUsage` and `McpAccess` messages.

### API Documentation Changes (4 files)

- **`mcpserver/docs/capability-discovery.md`** — Added critical callout block after the structure section and a warning in the "Using Discovered Tool Names" section.
- **`mcpserver/docs/mcpserver-resource-guide.md`** — Updated the `default_enabled_tools` field description in the schema table.
- **`mcpserver/docs/validation-checklist.md`** — Added a new checklist item under "Tool Names".
- **`agent/docs/validation-checklist.md`** — Added a new checklist item under "MCP Server Usages" and a new "Common Pitfall" section with wrong/correct code examples.
- **`agent/docs/mcp-server-integration.md`** — Updated the `enabled_tools` field description in the McpServerUsage table.

### Product Documentation Changes (2 files)

- **`docs/product/what-is-mcp-server.md`** — Added a callout in the Capability Discovery section.
- **`docs/product/what-is-agent.md`** — Added a callout after the `enabled_tools` explanation.

## Benefits

- The `agent-creator` skill regeneration will naturally pick up the tools vs resource templates distinction from proto comments and docs — no explicit prompt override needed
- Every documentation layer reinforces the same message, creating defense-in-depth against this class of error
- Future agents generated via `stigmer draft agent` will not accidentally include resource template names in `enabled_tools`

## Impact

- **Agent authoring pipeline**: The agent-creator skill (regenerated from protos + docs) will produce correct `enabled_tools` lists
- **Developer experience**: Anyone reading the proto comments or API docs will immediately see the distinction
- **Existing agents**: The `infra-chart-composer` agent needs to be regenerated after the skill is regenerated

## Related Work

- Precedes: Regeneration of the `agent-creator` skill via `02_draft-agent-creator-skill.sh`
- Precedes: Regeneration of the `infra-chart-composer` agent via `04_draft-infra-chart-composer-agent.sh`

---

**Status**: ✅ Production Ready
