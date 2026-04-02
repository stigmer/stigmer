# Phase 4: Core Concepts Documentation

**Date**: April 2, 2026

## Summary

Implemented the full Core Concepts documentation section — 8 concept pages plus 1 workflow placeholder — with 5 new interactive demo components powered by the `@stigmer/react` SDK. This is the first comprehensive explanation of Stigmer's resource model, agent lifecycle, and platform capabilities for developers building on the platform.

## Problem Statement

The documentation site had no concept pages. The "Core Concepts" card on the docs landing page linked to nothing and was labeled "Coming soon." Developers had no way to understand Agents, Skills, Tools, Approval Flows, Sessions, Environments, or Organizations beyond the Quickstart and First Skill tutorials.

### Pain Points

- No explanation of Stigmer's resource model or how resources relate to each other
- No documentation of the Agent lifecycle (blueprint → instance → session → execution)
- No visual demonstrations of tool calls, approval flows, or conversation memory
- Developers had to read YAML seedpack files and proto definitions to understand concepts

## Solution

Created 9 MDX pages under `docs/concepts/` following the Diátaxis framework (all pages are Explanation type) and the vocabulary guide's "Concepts / how-to" register. Five pages include interactive demos using real `@stigmer/react` SDK components backed by demo fixtures — no static screenshots or mockups.

## Implementation Details

### Documentation Pages (9 files)

| Page | Visual Aid |
|------|-----------|
| `what-is-stigmer.mdx` | Mermaid platform architecture diagram, three capability layers, competitive framing tables |
| `agents.mdx` | Static `AgentDetailView` demo + Mermaid lifecycle diagram (blueprint → instance → session → execution) |
| `skills.mdx` | Static `SkillDetailView` demo + Fumadocs `Files` component + RAG comparison table |
| `tools.mdx` | Animated `ScenarioPlayer` replay — agent calls `get_order`, responds with structured data |
| `approval-flows.mdx` | Animated `ScenarioPlayer` replay — agent pauses for approval before processing a return |
| `sessions.mdx` | Animated `ScenarioPlayer` replay — agent recalls context from earlier in conversation |
| `workflows.mdx` | "Coming soon" placeholder per user instruction (workflows not production-ready) |
| `environments.mdx` | Mermaid environment layering diagram + YAML examples |
| `organizations.mdx` | Mermaid org/project hierarchy diagram + YAML examples |

### Demo Components (5 new scenarios)

All follow the established three-tier pattern (engine → views → scenarios):

- `agent-detail/` — Static `AgentDetailView` with rich fixture (MCP servers, skills, env vars)
- `skill-detail/` — Static `SkillDetailView` with realistic return-policy SKILL.md content
- `tool-calls-playback/` — Animated 4-step replay: typing → send → tool call → response
- `approval-flow-playback/` — Animated 4-step replay: typing → send → approval pause → approved
- `session-memory-playback/` — Animated 6-step replay: two-turn conversation demonstrating memory

### Infrastructure

- Created `docs/concepts/meta.json` with 9-page sidebar ordering
- Updated `docs/meta.json` with "Learn" separator section
- Updated `docs/index.mdx` to activate Core Concepts card with link
- Registered all 5 demo components in barrel export (`index.ts`) and MDX component map (`mdx.tsx`)

### Key Design Decisions

- **Two-message pattern for tool calls**: Split tool call and response into separate `AgentMessage` objects so `MessageThread` renders them in the correct visual order (tool call above response)
- **`ApiResourceKind` enum**: Used proto enum values instead of string literals for `kind` fields in `ApiResourceReference` to satisfy TypeScript strict mode
- **Page bridging**: Every page ends with a "What's next" section that motivates the next page in sidebar order, including graceful handling of the workflows placeholder

## Benefits

- Developers can now understand Stigmer's full resource model from documentation alone
- Interactive demos show real SDK components in action — no static screenshots to maintain
- Vocabulary consistency enforced across all 9 pages using the "Concepts / how-to" register
- Progressive concept introduction: what-is-stigmer → agents → skills → tools → approvals → sessions → workflows → environments → organizations

## Impact

- **Documentation site**: Activates the entire "Concepts" section (was 100% placeholder)
- **Developer onboarding**: Provides the conceptual foundation between "Getting Started" tutorials and future reference docs
- **SDK showcase**: Demonstrates `AgentDetailView`, `SkillDetailView`, `MessageThread`, `ApprovalCard`, `ToolCallGroup`, and `ScenarioPlayer` in realistic scenarios
- **Content strategy**: Completes Phase 4 of the content strategy project plan

## Related Work

- Builds on Phase 3 demo infrastructure (ScenarioPlayer, demo fixtures, three-tier architecture)
- Uses positioning and vocabulary from `_projects/2026-03/20260331.01.content-strategy/design-decisions/`
- Demo data modeled after seedpack resources (`assistant.yaml`, `agent-creator.yaml`, `mcp-server-stigmer.yaml`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
