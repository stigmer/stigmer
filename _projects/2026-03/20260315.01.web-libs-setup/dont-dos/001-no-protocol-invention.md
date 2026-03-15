# Don't Do: No Protocol Invention Before Packaging

**Date**: 2026-03-15
**Source**: Prior project scope creep (20260314.04)

## What Happened

The prior project started as "build embeddable UI components" but spiraled into:
1. Evaluating AG-UI protocol for canonical event model
2. Designing a custom "Stigmer event format"
3. Planning AG-UI ↔ Protobuf translation layers
4. Evaluating CopilotKit, assistant-ui, and adapter patterns

None of this was necessary. The existing protobuf model and React components already work.

## The Rule

1. Do NOT define new event formats or protocols
2. Do NOT adopt AG-UI, CopilotKit, or assistant-ui in this project
3. Do NOT change the Agent Runner (Python) or Stigmer Server (Go)
4. Do NOT add SSE endpoints or new streaming transports
5. Package what exists. Make it importable. Ship it.

Protocol work (AG-UI adapter, new streaming formats) is a valid *future* project, AFTER the packaging foundation is solid.
