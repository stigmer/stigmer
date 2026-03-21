# Top 5 Concept Docs from Proto Ground Truth

**Date**: March 21, 2026

## Summary

Created the first five concept documentation pages for the Stigmer docs site, each authored directly from protobuf definitions and their companion `docs/` directories. The new `docs/concepts/` section covers What is Stigmer?, Agents, Agent Executions, Sessions, and Workflows — giving platform builders a complete mental model of the Stigmer resource hierarchy before they write code.

## Problem Statement

The documentation site had a home page and visual foundation (from Phases 0–2) but zero content pages. Platform builders landing on the site had no way to understand what Stigmer's resources are, how they relate, or what each one controls.

### Pain Points

- No explanation of the 4-layer resource model (Agent → AgentInstance → Session → AgentExecution)
- No documentation of key proto concepts like ExecutionPhase, WorkflowTaskKind, or workspace persistence
- The "Concepts" card on the home page linked nowhere and said "Coming soon"
- Proto definitions and their companion docs directories contained rich, accurate material that wasn't surfaced to users

## Solution

Created a `docs/concepts/` section with a landing page and five concept docs, each following the project's concept template (`docs/standards/templates/concept.mdx`) and anchored to proto source files as the canonical reference.

## Implementation Details

### Files Created (7)

| File | Purpose |
|------|---------|
| `docs/concepts/meta.json` | Sidebar ordering for the Concepts section |
| `docs/concepts/index.mdx` | Section landing page with Cards linking to all 5 docs |
| `docs/concepts/what-is-stigmer.mdx` | Platform overview: 4-layer hierarchy, dual execution model, container analogies |
| `docs/concepts/agent.mdx` | Agent resource: AgentSpec fields, MCP server integration, sub-agents, YAML examples |
| `docs/concepts/agent-execution.mdx` | AgentExecution resource: 8-phase state machine, HITL approvals, cost tracking |
| `docs/concepts/session.mdx` | Session resource: thread continuity, workspace persistence (git + local), tool augmentation |
| `docs/concepts/workflow.mdx` | Workflow resource: 13 task types, Temporal durability, Agent vs Workflow comparison |

### Files Modified (2)

| File | Change |
|------|--------|
| `docs/meta.json` | Added `"concepts"` to pages array |
| `docs/index.mdx` | Updated Concepts card with `href="/docs/concepts"`, removed "Coming soon" |

### Proto Sources Referenced

- `apis/ai/stigmer/agentic/agent/v1/spec.proto` + `agent/docs/README.md` + `agent/docs/examples.md`
- `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto` + `enum.proto` + `agentexecution/docs/README.md`
- `apis/ai/stigmer/agentic/session/v1/spec.proto` + `workspace.proto` + `session/docs/README.md`
- `apis/ai/stigmer/agentic/workflow/v1/spec.proto` + `enum.proto` + `tasks/agent_call.proto` + `workflow/docs/README.md` + `workflow/docs/examples.md`

### Key Patterns

- **Container analogy**: Agent = Docker image, AgentInstance = container config, Session = terminal session, AgentExecution = `docker run` — used consistently across all docs
- **Mermaid diagrams**: Every doc includes at least one diagram (flowcharts for hierarchies, stateDiagram-v2 for ExecutionPhase lifecycle)
- **CLI examples for runtime resources**: AgentExecution and Session docs use `stigmer run` / `stigmer session` CLI commands rather than YAML since these resources are created at runtime
- **YAML examples for authored resources**: Agent and Workflow docs include full YAML manifests from the proto `docs/examples.md` files

## Benefits

- Platform builders can now read a complete conceptual model before touching the SDK or CLI
- Every claim in the docs traces back to a proto field or enum — no outdated or speculative content
- Mermaid diagrams give immediate visual comprehension of the resource hierarchy and lifecycle state machines
- The section landing page provides at-a-glance navigation to all concepts

## Impact

- **Platform builders**: Can now understand all 5 core resources before writing integration code
- **Docs site**: First real content section — moves from placeholder to useful
- **Home page**: "Concepts" card now navigates to a live section instead of showing "Coming soon"
- **Build**: 13 static pages generated, up from 8 — all routes verified

## Related Work

- Phase 0: Audience & Purpose (established platform builder focus)
- Phase 1: Clean Slate + Visual Foundation (Mermaid rendering, typography)
- Phase 2: Docs Home Page (SDK icons, section cards)
- Phase 4 (next): Validated CLI Quickstart

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
