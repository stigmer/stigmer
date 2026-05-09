# MCP Server Creation Wizard

**Date**: May 9, 2026

## Summary

Built a 3-step MCP server creation wizard as an SDK-first component (`McpServerCreationWizard`), enabling users to visually configure and create MCP server blueprints from the Console. This replaces the previous draft-session-based creation flow with a structured wizard that mirrors the agent creation pattern established in T04-B.

## Problem Statement

MCP server creation was only possible through the CLI (`stigmer apply`) or the AI chat draft flow. There was no form-based visual creation experience in the Console or SDK, creating friction for users who want to manually configure MCP server integrations.

### Pain Points

- No visual creation flow for MCP servers in the Console
- Users had to write YAML manually or use the CLI to create MCP server configurations
- The "Add MCP server" button routed to the AI draft session rather than a dedicated creation page
- Platform builders embedding Stigmer had no reusable wizard component for MCP server creation

## Solution

Built a blueprint-only creation wizard (DD-T04D-001) that focuses purely on the `McpServerInput` definition. Tool discovery, default-enabled tools, and approval policies remain post-creation activities handled on the detail page via the existing Connect flow — maintaining the blueprint/runtime separation mandated by the architecture.

## Implementation Details

### New SDK Components (8 files)

- **`useCreateMcpServer`** — Mutation hook wrapping `stigmer.mcpServer.apply()` with `isCreating`, `error`, `clearError` state management
- **`McpServerCreationWizard`** — 3-step wizard composing the shared `WizardShell` infrastructure from T04-B
- **`McpServerWizardData`** — Typed form state accumulating identity, transport, env vars, and auth config
- **Step 1: IdentityTransportStep** — Name, slug (auto-derived), description, icon, visibility, transport type radio group (HTTP vs Stdio), conditional transport fields
- **Step 2: EnvironmentAuthStep** — Env var declarations (key/description/isSecret/optional), collapsible OAuth auth config (app ref, target var, scopes, discovery URL)
- **Step 3: ReviewStep** — Summary card, full YAML preview via `serializeMcpServerInputYaml()`, error display

### Shared Infrastructure Improvements

- Extracted `EnvVarEntry` and `KeyValueEntry` types to shared `resource-creation/types.ts` (both agent and MCP server wizards now import from the shared location)
- Added `serializeMcpServerInputYaml()` to `serialize-resource-yaml.ts` for YAML preview of `McpServerInput` (mirrors `serializeAgentInputYaml()`)

### Console Integration

- New route at `/library/mcp-servers/new` with thin `McpServerNewPage` domain component
- Updated `McpServerListPage` "Add MCP server" button to route to the wizard instead of the draft session URL

### Design Decision

**DD-T04D-001: Blueprint-only wizard.** Tool discovery is a runtime concern — it requires connecting to the actual server, which requires credentials resolved in the user's personal environment. The creation wizard focuses on the blueprint definition only. This mirrors the agent wizard's condensation from 7 planned steps to 3.

## Benefits

- Visual MCP server creation directly in the Console
- Consistent wizard UX across agent and MCP server creation
- SDK-first architecture: `McpServerCreationWizard` is embeddable by platform builders
- Shared wizard infrastructure reused (zero duplication with agent wizard)
- Transport-aware form validation (HTTP requires URL, Stdio requires command)

## Impact

- **Console users**: Can now create MCP servers via a guided wizard instead of writing YAML
- **Platform builders**: Can embed `McpServerCreationWizard` in their own apps
- **Architecture**: Shared `EnvVarEntry`/`KeyValueEntry` types now live in the canonical location, reducing cross-wizard coupling

## Related Work

- T04-B: Agent Creation Wizard (shared `WizardShell` infrastructure)
- T04-A: ResourceWorkbench Creation Slot (entry points)
- T04-E: YAML/JSON Import/Export (alternative creation path)
- Phase 2: Resource Detail Hubs (where tool discovery happens post-creation)

---

**Status**: Production Ready
**Timeline**: 1 session (~1 hour)
