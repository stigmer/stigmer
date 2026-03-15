# DD-001: Adopt _libs Workspace Pattern, No New Protocols

**Date**: 2026-03-15
**Status**: PROPOSED (pending review)

## Decision

Package existing Stigmer web components into workspace packages following Planton's proven `_libs` pattern. Do NOT introduce new event protocols, streaming formats, or UI frameworks.

## Context

Prior project `20260314.04.web-ui-assistant-ui-integration` explored AG-UI protocol adoption, CopilotKit integration, and custom event models. Research revealed:

1. AG-UI is an "emerging interface" — risky as a core architectural dependency
2. CopilotKit is tightly coupled to AG-UI and has its own opinions
3. Defining a "Stigmer custom event format" would be inventing something we don't need yet
4. The existing `AgentExecution` protobuf model and React components already work

Meanwhile, Planton's `_libs` pattern has been battle-tested: 30+ workspace packages, three-layer architecture, IoC bridges, zero npm publishing overhead during development.

## Alternatives Considered

| Option | Verdict |
|--------|---------|
| AG-UI as canonical internal model | Too risky, too new, wrong abstraction for our needs now |
| Custom Stigmer event format | Over-engineering — we already have a working protobuf model |
| Publish directly to npm without workspace setup | Slower dev iteration, no first-consumer dogfooding |
| Build a new React library from scratch | Wasteful — existing components work |

## Consequences

- Platform owners get working components sooner (extract, don't rewrite)
- AG-UI can be added later as an *output adapter* (additive, not foundational)
- Stigmer's web console becomes cleaner (thin shell + library imports)
- Pattern is proven and understood (Planton reference implementation exists)
