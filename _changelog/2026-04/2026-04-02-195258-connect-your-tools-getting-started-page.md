# Connect Your Tools — Getting Started Page

**Date**: April 2, 2026

## Summary

Added the third and final Getting Started page — "Connect your tools" — completing the documentation narrative arc of "teach your domain, bring your tools, and set your rules." This page walks users through connecting an MCP server, discovering its capabilities, generating approval policies, and wiring tools and approvals into SDK code. Four new interactive demo scenarios and one new view component were built, and the SDK's `McpServerDetailView` gained a `defaultCapabilityTab` prop for deep-linking.

## Problem Statement

After the Quickstart and "Your First Skill" pages, users knew how to create a session and teach domain knowledge. But two pillars of Stigmer's tagline — "bring your tools" and "set your rules" — were undocumented. Without guidance on MCP server connection and approval flows, users couldn't progress from knowledge-only agents to agents that take real actions with human oversight.

### Pain Points

- No Getting Started content for tool connectivity (MCP servers)
- No documentation for the approval policy generation flow
- No interactive demos showing the MCP server lifecycle (create → discover → policies)
- The `ComposerView` artifact panel was hardcoded for Skills, preventing reuse for MCP server artifacts

## Solution

Created `docs/getting-started/connect-tools.mdx` with five progressive steps, each backed by interactive demos using real SDK components. Parameterized the artifact panel to support multiple artifact types. Replaced a custom demo view with the actual SDK `McpServerDetailView` to ensure visual fidelity with the production Console.

## Implementation Details

### New Demo Scenarios (4)

- **`mcp-server-creation-tour`**: 12-step guided tour — navigate to Library, click "Add MCP Server", describe the server to the agent, preview the YAML artifact, push to organization. Uses `ComposerView` with the new `ArtifactMeta` descriptor for MCP server artifacts.
- **`discover-capabilities-playback`**: 3-step playback using the real SDK `McpServerDetailView`. Each step carries a full `McpServer` protobuf fixture; a pre-built client map swaps the `StigmerProvider` client per step, triggering natural hook re-fetches.
- **`generate-policies-playback`**: 3-step playback using `McpServerDetailView` with `defaultCapabilityTab="policies"`. Transitions from tools-only to tools-with-policies.
- **`mcp-server-detail`**: Static detail view showing a fully configured server with discovered tools and approval policies.

### New View Component (1)

- **`McpServersListView`**: Mirrors `SkillsListView` for the MCP servers library page in demos. Supports `highlightCreate` and `showNewServer` props for tour steps.

### SDK Enhancement

- Added `defaultCapabilityTab` prop to `McpServerDetailView` — a non-breaking enhancement allowing consumers to open the view on the Tools, Policies, or Resources tab. Used by the generate-policies scenario and useful for deep-linking in the Console.

### ComposerView Parameterization

- Extracted `ArtifactMeta` interface with fields for icon, name, label, title, description, fileName, contentType, and pushLabel
- `ArtifactPanel` now reads all labels from `meta` instead of hardcoded Skill values
- Default meta (`SKILL_ARTIFACT_META`) preserves backward compatibility with the skill creation tour

### Bug Fixes

- Fixed pre-existing SSR build failure in `api-key-setup` scenario — moved module-scope `samples.apiKey` calls into a lazy function to prevent proto resolution failures during static generation
- Removed custom `McpServerDetailDemo` view in favor of the real SDK component

### Documentation

- `connect-tools.mdx`: 5-step tutorial with embedded `DemoMcpServerCreationTour`, `DemoDiscoverCapabilities`, `DemoGeneratePolicies`, `DemoToolCallsPlayback`, and `DemoApprovalFlowPlayback`
- Multi-language SDK code samples (TypeScript, Go, Python, Java) for tool connection and approval handling
- Bridge section added to `first-skill.mdx` linking to the new page

## Benefits

- **Complete Getting Started narrative**: All three tagline pillars now have dedicated Getting Started content
- **Visual fidelity**: Discover and generate demos use the real SDK component, matching exactly what users see in the Console
- **Reusable artifact panel**: `ArtifactMeta` makes it trivial to add new artifact types (workflows, etc.) in future tours
- **SDK improvement**: `defaultCapabilityTab` is useful for any platform builder embedding `McpServerDetailView`

## Impact

- **Documentation**: Getting Started section complete with 3 pages covering the full agent setup journey
- **SDK**: Non-breaking prop addition to `McpServerDetailView`
- **Site demos**: 4 new scenario modules, 1 new view component, 1 parameterized view
- **Build**: All 23 static pages generate successfully (Node 22)

## Related Work

- [Phase 4 Core Concepts Documentation](2026-04-02-174522-phase-4-core-concepts-documentation.md)
- [Demo Components Three-Tier Architecture](2026-04-02-164409-demo-components-three-tier-architecture.md)
- [Centralize Demo Styling Tokens](2026-04-02-181623-centralize-demo-styling-tokens.md)
- [MCP Server Detail View UX Overhaul](2026-04-02-192704-mcp-server-detail-view-ux-overhaul.md)

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (including SDK enhancement, 4 scenarios, bug fixes, MDX content)
