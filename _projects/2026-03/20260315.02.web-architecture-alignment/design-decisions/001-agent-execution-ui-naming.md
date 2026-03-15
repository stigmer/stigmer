# Design Decision: Package Name `@stigmer/agent-execution-ui`

**Date**: 2026-03-15
**Status**: Accepted
**Task**: T03 (Phase 2)

## Context

The `@stigmer/react-ui` package needed a domain-aligned name. The original Phase 1
plan proposed `@stigmer/execution-ui`, but this was challenged during planning.

## Decision

Renamed to `@stigmer/agent-execution-ui`.

## Rationale

1. **Ubiquitous language**: "AgentExecution" is the exact domain term from the
   `agentic/agentexecution/v1/` bounded context. The package contains exclusively
   AgentExecution-scoped components (streaming, tool calls, HITL approvals,
   sub-agent delegation).

2. **Disambiguation**: Stigmer has two fundamentally different execution types:
   - **AgentExecution** — chat-style message stream, tool calls, HITL approvals
   - **WorkflowExecution** — DAG visualization, task status, branching, signals

   These require completely different UI paradigms. A generic `execution-ui` would
   either become a kitchen-sink package or force a confusing rename later.

3. **Namespace clarity**: The naming convention leaves clean room for future packages:
   - `@stigmer/workflow-execution-ui` — DAG visualization (future)
   - `@stigmer/session-ui` — session management (Phase 7)
   - `@stigmer/catalog-ui` — resource browsing (Phase 7)
   - `@stigmer/agent-ui` — agent blueprint CRUD (future)

4. **Planton precedent**: Planton's domain packages use domain-capability names
   without unnecessary generality (`@planton/agent-fleet`, `@planton/service-hub`).

## Alternatives Considered

| Name | Rejected Because |
|------|-----------------|
| `@stigmer/execution-ui` | Ambiguous — does not distinguish between AgentExecution and WorkflowExecution |
| `@stigmer/agentic-ui` | Too broad — the agentic bounded context covers agents, sessions, workflows, skills, MCP servers |
| `@stigmer/agent-ui` | Too broad — the package is about execution streaming, not agent CRUD |

## Consequences

- All imports use `@stigmer/agent-execution-ui/execution`
- When workflow execution UI is built, it gets its own package
- The subpath exports (`.`, `./execution`, `./styles.css`) are unchanged
