# React Demo Mode: Transport and Client Factory

**Date**: April 1, 2026

## Summary

Added a demo mode to `@stigmer/react` that allows all components to render with in-memory fixture data instead of a live Stigmer backend. This is the transport layer foundation — a `DemoTransport` that intercepts RPCs and a `createDemoClient()` factory that returns a `Stigmer`-compatible client accepted by `StigmerProvider`. Exported as the `@stigmer/react/demo` subpath.

## Problem Statement

Stigmer's React SDK components require a live backend to render. This makes it impossible to embed real product components in documentation pages, Storybook stories, or static demo contexts. Building mock providers for individual components would be fragile and require updates every time a new component is added.

### Pain Points

- Documentation cannot show real Stigmer components — only screenshots or mock-ups
- No way to demonstrate the SDK's component library to platform builders without a running server
- Per-component mocking would be brittle and scale poorly with the growing component surface (180+ files)

## Solution

Mock at the transport layer — the single integration point where all RPCs flow through. One mock transport makes every generated client work, which makes every hook work, which makes every component work. New components added to `@stigmer/react` work in demo mode automatically because they use the same transport chain.

## Implementation Details

### DemoTransport (`sdk/react/src/demo/transport.ts`)

A class that satisfies the `@connectrpc/connect` `Transport` interface's runtime shape. When a generated client issues an RPC, the transport looks up a fixture handler by `"<service typeName>/<method name>"` and returns its result. Missing fixtures throw a descriptive error identifying the exact RPC key to register.

- `unary()`: Fixture lookup → returns response-shaped object
- `stream()`: Fixture lookup → wraps array into `AsyncIterable`
- Errors: `"No demo fixture for SessionQueryController/get. Add a fixture with key '...' to your DemoScenario."`

### createDemoClient (`sdk/react/src/demo/client.ts`)

Factory that constructs all 19 resource clients (17 generated + `SearchClient` + `GitHubClient`) with a `DemoTransport` and returns a `Stigmer`-compatible object via TypeScript structural typing. No changes to `@stigmer/sdk` public API were required.

### Type System (`sdk/react/src/demo/types.ts`)

- `FixtureRegistry`: `ReadonlyMap<string, FixtureEntry>` mapping RPC keys to handlers
- `DemoScenario`: Container passed to `createDemoClient()`
- `rpcKey()`: Helper to construct fixture keys from proto service descriptors

### Subpath Export

`@stigmer/react/demo` is a tree-shakeable subpath — production apps that don't import it get zero bundle impact.

## Benefits

- **One mock point → all components work**: No per-component wrappers needed
- **Future-proof**: New components work in demo mode automatically
- **Zero new dependencies**: Only type imports from `@connectrpc/connect` (erased at compile time)
- **Actionable errors**: Missing fixtures tell developers exactly which RPC key to register
- **Clean separation**: Demo module is isolated in a subpath export, not mixed with production code

## Impact

- **SDK consumers**: Platform builders can now preview Stigmer components in their own Storybook or testing environments
- **Documentation**: Foundation for embedding real product components in MDX pages (Phase 3)
- **Testing**: DemoTransport can be used as a lightweight test double for SDK integration tests

## Related Work

- Parent project: `20260331.01.content-strategy` — Phase 3 (Getting Started documentation) depends on demo mode for live component embeds
- Next phases: Phase 2 (fixture data), Phase 3 (Fumadocs integration), Phase 4 (additional scenarios)

---

**Status**: ✅ Production Ready (Phase 1 — transport and factory)
**Timeline**: Single session
