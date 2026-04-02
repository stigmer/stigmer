# React Demo Mode: Composable Fixture Infrastructure

**Date**: April 1, 2026

## Summary

Added composable fixture infrastructure to `@stigmer/react/demo` that makes it ergonomic to define any demo scenario at the point of use. The module now provides fixture entry helpers mirroring the SDK client shape, sample protobuf data factories with customizable defaults, and a `buildScenario()` function that correctly handles search RPC multiplexing. This completes Phase 2 of the React Demo Mode sub-project.

## Problem Statement

Phase 1 delivered `DemoTransport` and `createDemoClient()` — the plumbing for mocking at the transport layer. But constructing a working demo scenario required deep internal knowledge: knowing which proto service descriptor to use, whether an RPC is unary or streaming, and what the fixture key format is. This made the demo module powerful but not ergonomic.

### Pain Points

- Users needed to manually construct fixture keys like `"ai.stigmer.agentic.session.v1.SessionQueryController/get"` — error-prone and requires proto internals knowledge
- No guidance on which RPCs a given hook needs — users had to trace hook source code
- No sample data — users had to construct protobuf objects from scratch using `create()` with correct nested schemas
- `agent.list()`, `skill.list()`, and `mcpServer.list()` all route through the same `SearchService/search` RPC, causing silent key collisions in a raw `Map`

## Solution

Three composable layers that users can mix at whatever level they need:

1. **Fixture helpers** (`fixtures.*`) — mirror the SDK client shape. Each method knows the correct RPC key and unary/stream type. JSDoc documents which hooks consume it.
2. **Sample factories** (`samples.*`) — return realistic protobuf objects with flat override interfaces. Users customize the most common fields without needing proto structure knowledge.
3. **`buildScenario()`** — assembles fixture specs into a `DemoScenario`, handling search RPC multiplexing transparently.

## Implementation Details

### Fixture Entry Helpers (`fixtures.ts`)

42 helpers across 10 resource domains organized to mirror the SDK client shape:

```ts
fixtures.session.get(handler)      // → SessionQueryController/get [unary]
fixtures.session.create(handler)   // → SessionCommandController/create [unary]
fixtures.agentExecution.subscribe(handler) // → AgentExecutionQueryController/subscribe [stream]
fixtures.agent.list(handler)       // → SearchService/search [kind=agent]
```

Each helper returns a `FixtureSpec` — an opaque object that `buildScenario()` assembles into a `DemoScenario`.

### Search RPC Multiplexing

The SDK's `agent.list()`, `skill.list()`, and `mcpServer.list()` all delegate to `SearchService.search` with different `ApiResourceKind` values. At the transport layer, they share one RPC key. `buildScenario()` detects these and merges them into a single dispatch handler:

```ts
const scenario = buildScenario(
  fixtures.agent.list(() => agentSearchResponse),
  fixtures.skill.list(() => skillSearchResponse),
);
// Both work — buildScenario dispatches by ApiResourceKind from the request
```

### Sample Data Factories (`samples.ts`)

14 factories with flat override interfaces:

```ts
samples.session({ subject: "My topic" })
samples.agent({ name: "My Agent", instructions: "..." })
samples.agentExecution({ phase: ExecutionPhase.EXECUTION_IN_PROGRESS })
samples.humanMessage("Hello!")
samples.aiMessage("Here's what I found", [samples.toolCall("search", "results")])
samples.searchResponse([samples.searchResult({ kind: ApiResourceKind.agent })])
```

### Reference Scenario (`scenarios/quickstart.ts`)

One complete working scenario demonstrating the composition pattern — a 4-message session conversation with agent, instance, and environment fixtures. Exported as `quickstartScenario`.

## Benefits

- **DX improvement**: Defining a demo scenario went from ~30 lines of manual key construction to ~10 lines of composable helpers
- **Full coverage**: 42 RPCs covered (all hooks, not just 5 components) — any component can be used in demo mode
- **Type-safe**: Full TypeScript support with IntelliSense for fixture methods and sample overrides
- **Self-documenting**: JSDoc on each fixture helper documents which hooks consume that RPC
- **Search collision-proof**: `buildScenario()` handles the search multiplexing transparently

## Impact

- **Documentation authors** can embed any `@stigmer/react` component in docs with minimal fixture setup
- **Platform builders** can create custom demo scenarios for their integration documentation
- **The `quickstartScenario`** provides a copy-paste starting point for rapid prototyping
- Unblocks Phase 3 (Fumadocs integration) which will use these primitives to embed live components in documentation pages

## Related Work

- [React Demo Mode: Transport and Client Factory](2026-04-01-151243-react-demo-mode-transport-and-client-factory.md) — Phase 1: DemoTransport and createDemoClient
- Sub-project: `_projects/2026-04/20260401.01.sp.react-demo-mode/`
- Parent project: `_projects/2026-03/20260331.01.content-strategy/`

---

**Status**: ✅ Production Ready
**Timeline**: Phase 2 of 4 (Phase 1: transport layer, **Phase 2: fixture infrastructure**, Phase 3: Fumadocs integration, Phase 4: additional scenarios)
