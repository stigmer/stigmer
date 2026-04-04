# React SDK Full Component Preview Coverage

**Date**: April 4, 2026

## Summary

Expanded the live component preview system from 5 to 54 of 59 exported React SDK components, fixed the missing Workspace toolbar button in SessionComposer, and enriched the AgentDetailView preview with full spec data (MCP servers, skills, sub-agents, environment variables, audit timestamps). Every visual SDK component on every generated reference page now has an interactive click-to-reveal preview.

## Problem Statement

The component preview system established in the previous session covered only 5 of 59 exported React SDK components. Documentation readers could only see live previews for SessionComposer, ModelSelector, AgentDetailView, ErrorMessage, and ApiKeyListPanel. The remaining 54 components had no visual representation — readers had to mentally assemble the UI from prop tables.

### Pain Points

- 54 components lacked any visual context on their reference pages
- SessionComposer preview was missing the Workspace toolbar button (the `workspace` prop was not passed)
- AgentDetailView preview showed only a header and generic instructions — 4 of 6 renderable sections (MCP Servers, Skills, Sub-Agents, Environment Variables) were empty
- No preview for high-value components like MessageThread, ToolCallDetail, ApprovalCard, SkillDetailView, or McpServerDetailView

## Solution

A systematic expansion of the data-driven preview registry (`preview-configs.ts`) with 49 new component entries and enriched data for 2 existing entries. Each preview uses realistic mock data from the "support-agent at Acme Corp" narrative — consistent tool calls, orders, skills, and MCP servers that tell a coherent story across all previews.

Five components were deliberately excluded with documented rationale: StigmerProvider (no visual output), FolderBrowser (requires live filesystem API), GitHubRepoPicker (requires OAuth), ApprovalPolicyGeneratorPanel (requires streaming execution), and ArtifactPreviewModal (modal with live RPC dependencies).

## Implementation Details

### SessionComposer Workspace Fix

Root cause: `SessionComposer` checks `workspace != null` to show the Workspace toolbar button. The preview config was not passing a `workspace` prop.

Fix: Added a `MOCK_WORKSPACE` object implementing `UseWorkspaceEntriesReturn` with empty entries and no-op handlers, matching the existing pattern in `site/src/components/docs/demos/engine/shared.ts`.

### AgentDetailView Enrichment

Built a `buildRichAgent()` helper that constructs a fully populated agent:
- Custom instructions tailored to the support-agent story
- 2 MCP server usages (order-management-api, notification-service) with enabled tools
- 3 skill references (company-knowledge-base, return-policy, product-catalog)
- 1 sub-agent (order-lookup) with MCP access to order-management-api
- 3 environment variables (ORDER_API_URL, ORDER_API_KEY as secret, NOTIFICATION_WEBHOOK)
- Public visibility and audit timestamps (created 3 days ago, updated now)

### Shared Mock Data Architecture

Rather than per-component ad-hoc data, the file defines reusable data builders:
- `MOCK_WORKSPACE` / `MOCK_SESSION_VARIABLES` — hook return value mocks
- `buildRichAgent()` — fully populated agent with all 6 renderable sections
- `buildSampleExecution()` — execution with messages, tool calls, LLM metrics, todos, write-backs, artifacts
- `buildSampleToolCall()` / `buildMcpToolCall()` — standard and MCP-shaped tool calls
- `buildRichSkill()` / `buildRichMcpServer()` — detail views with enriched specs
- `buildSampleDiscoveredTools()` / `buildSampleSearchResults()` — list data for pickers and resource views

### Component Grouping

Components organized by domain and fixture complexity:

| Group | Components | Strategy |
|-------|-----------|----------|
| Detail views | SkillDetailView, McpServerDetailView, EnvironmentListPanel | Fixture-backed (getByReference/list RPCs) |
| Pickers | AgentPicker, McpServerPicker, SkillPicker | Search-fixture-backed |
| Messages/Execution | MessageThread, MessageEntry, ExecutionProgress, ApprovalCard, TodoList, etc. | Props-only with protobuf data |
| Tool/Artifact | ToolCallDetail, ToolCallGroup, ArtifactContentRenderer, ArtifactCard, etc. | Props-only |
| Forms | CreateApiKeyForm, CreateEnvironmentForm, EnvVarForm, McpServerConfigPanel, etc. | Render idle, submit needs user action |
| Small widgets | ResourceListView, ScopeToggle, VisibilityToggle, WriteBackCard, UsageWidget, etc. | Static props |

### Files Changed

- **`site/src/components/docs/previews/preview-configs.ts`** — Expanded from 98 to 1,115 lines: 49 new preview configs, enriched AgentDetailView and SessionComposer, shared data builders
- **`site/scripts/generate-react-sdk-docs/renderer.ts`** — `PREVIEW_COMPONENTS` set expanded from 5 to 54 entries with domain-organized comments
- **`docs/sdk/react/*.mdx`** (12 files) — Auto-regenerated with 49 new `<ComponentPreview>` tags

### Key Design Decisions

- **Coherent narrative over random data**: All mock data follows the "Acme Corp support-agent" story — orders, returns, knowledge base, notification service. This makes the docs feel like a real product walkthrough, not a test harness.
- **Shared builders over inline data**: Reusable `build*()` functions at the top of the file prevent data duplication and ensure consistency when the same execution/agent/tool call appears across multiple previews (e.g., UsageWidget, WriteBacksWidget, and ArtifactsWidget all use `buildSampleExecution()`).
- **Skip list with rationale**: 5 components explicitly excluded rather than shoehorned with broken or misleading static mocks. Each skip documented with the specific technical reason.

## Benefits

- **Full visual coverage**: 54 of 59 SDK components (92%) now have interactive previews on their reference pages
- **Workspace visibility**: SessionComposer preview now shows the full two-tier toolbar (Attach, Workspace, Configure menu)
- **Rich AgentDetailView**: All 6 sections visible — Header with public badge and timestamps, Instructions, MCP Servers with tool lists, Skills, Sub-Agents with nested details, Environment Variables
- **Consistent data story**: Readers see a coherent product narrative across all previews
- **Maintainable**: Adding a new preview remains one config entry + one set addition

## Impact

- 14 React SDK reference pages now have component previews (up from 5 pages)
- 54 total `<ComponentPreview>` tags in generated MDX (up from 5)
- Zero new files — all changes within the existing preview system architecture
- Zero linter/typecheck errors introduced

## Related Work

- [React SDK Component Preview System](2026-04-04-172209-react-sdk-component-preview-system.md) — The initial 5-component preview system this builds on
- [React SDK MDX Generator](2026-04-04-162212-react-sdk-mdx-generator.md) — The auto-generation pipeline that emits preview tags

---

**Status**: ✅ Production Ready
**Timeline**: Single session
