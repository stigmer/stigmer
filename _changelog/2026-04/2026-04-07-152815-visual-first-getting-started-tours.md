# Visual-First Overview Tours for Getting Started Pages

**Date**: April 7, 2026

## Summary

Added multi-surface overview tours to all four Getting Started pages (Quickstart, Your First Skill, Connect Your Tools, Create Your Agent), placing a concise visual walkthrough at the top of each page inside "What you'll build." Each tour uses the ScenarioPlayer to step through 4–6 surfaces — management console, code editor, terminal, session composer — giving readers a 15–20 second preview of the entire journey before they start coding. Custom mock components were replaced with real SDK components, redundant bottom sections were removed, and shared view components were made configurable.

## Problem Statement

The Getting Started pages lacked a cohesive visual narrative. Quickstart had a weak "See it in action" section at the bottom that replayed what the reader had already done. Connect Your Tools had inline conversation playbacks (`DemoToolCallsPlayback`, `DemoApprovalFlowPlayback`) that showed flat web-app conversations without the code+terminal context that makes the story meaningful. No page showed the full arc up front.

### Pain Points

- Readers who scanned instead of reading missed the visual payoff entirely because it was at the bottom
- Fragmented demos didn't convey the end-to-end flow (API key → code → terminal → domain failure)
- Custom mock components (`ApiKeyCreatedPage`, `McpServerPanel`, `AgentConfigPanel`) diverged visually from the real production UI
- `CodeEditorView` showed "stigmer-federation" for all scenarios regardless of context
- `TerminalView` hardcoded the working directory prompt

## Solution

Applied the visual-first pattern (already proven on the federation documentation) to all four Getting Started pages: a multi-surface overview tour at the top of "What you'll build," followed by step-by-step instructions with inline demos for specific UI interactions.

## Implementation Details

### Four new tour scenarios

| Scenario | Steps | Surfaces |
|---|---|---|
| `quickstart-tour` | 5 | ManagementShell → CodeEditor → Terminal → CodeEditor → Terminal |
| `first-skill-tour` | 4 | ComposerView → ComposerView → CodeEditor → Terminal |
| `connect-tools-tour` | 6 | McpServerDetailView → McpServerDetailView → CodeEditor → Terminal → ComposerView → ComposerView |
| `create-agent-tour` | 5 | ComposerView → ComposerView → AgentDetailView → CodeEditor → Terminal |

### Real SDK components replace custom mocks

- **quickstart-tour**: `ApiKeyCreatedAlert` + `ApiKeyListPanel` from `@stigmer/react` backed by `fixtures.apiKey.findAll()` — replaces hand-drawn `ApiKeyCreatedPage`
- **connect-tools-tour**: `McpServerDetailView` from `@stigmer/react` backed by `fixtures.mcpServer.getByReference()` with two server states (tools-only, with-policies) — replaces hand-drawn `McpServerPanel` + `ToolRow`
- **create-agent-tour**: `AgentDetailView` from `@stigmer/react` backed by `fixtures.agent.getByReference()` — replaces hand-drawn `AgentConfigPanel`

### Shared view improvements

- `CodeEditorView`: Added `workspaceName` prop (defaults to `"stigmer-federation"` for backward compatibility). Getting-started tours pass `"stigmer-quickstart"`.
- `TerminalView`: Added `cwd` prop (defaults to `"~/stigmer-federation"`). Getting-started tours pass `"~/stigmer-quickstart"`.

### Mid-step interactions

- `connect-tools-tour` steps 0 and 1: `scroll-to` at 25% narration progress to reveal tools/policies sections at the bottom of `McpServerDetailView`
- `quickstart-tour` step 0: `set-cursor` on the copy-key button; `clear-cursor` on transition to code editor

### Content cleanup

- **Removed** from `quickstart.mdx`: "Now try a domain question" section, "See it in action" section with `DemoQuickstartPlayback`
- **Removed** from `connect-tools.mdx`: `DemoToolCallsPlayback` and `DemoApprovalFlowPlayback` inline demos and their introductory paragraphs
- **Kept**: All step-level inline demos that teach WHERE TO CLICK (`DemoApiKeySetup`, `DemoSkillCreationTour`, `DemoMcpServerCreationTour`, `DemoDiscoverCapabilities`, `DemoGeneratePolicies`, `DemoAgentCreationTour`, `DemoAgentDetail`)

### Narration and registration

- Narration text written for all narrated steps across all 4 tours
- Audio generated via Edge TTS (`make generate-narration`)
- All 4 scenarios registered in `SCENARIO_REGISTRY`, exported from `docs/index.ts`, wired into `mdx.tsx`

## Benefits

- Every Getting Started page now opens with a visual promise that orients the reader before they start
- Real SDK components ensure visual fidelity — demos match production exactly
- Configurable workspace names prevent cross-scenario context leaks
- Reduced page length by removing redundant bottom sections
- Consistent pattern across all Getting Started and federation documentation

## Impact

- **Readers**: See the full journey before committing to the tutorial. Higher engagement, lower bounce.
- **Maintainers**: One pattern for all overview tours. Real SDK components mean zero drift from production UI.
- **Documentation quality**: Follows the aha-moment design principle — the visual payoff is the first thing readers encounter.

## Related Work

- [Federation Visual Scenarios and Interaction Framework](2026-04-07-141850-federation-visual-scenarios-and-interaction-framework.md) — established the pattern
- [Multi-Tenant Visual Demo Scenario](2026-04-07-145526-multi-tenant-visual-demo-scenario.md) — applied the pattern to multi-tenancy
- [Demo Components Three-Tier Architecture](2026-04-02-164409-demo-components-three-tier-architecture.md) — foundational architecture

---

**Status**: ✅ Production Ready
**Timeline**: 2 sessions (~3 hours)
