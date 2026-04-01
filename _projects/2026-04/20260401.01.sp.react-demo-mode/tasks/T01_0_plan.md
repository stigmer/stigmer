# Task T01: React Demo Mode for Documentation

**Created**: 2026-04-01
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260331.01.content-strategy (Phase 3 prerequisite)

**This plan requires your review before execution.**

## Objective

Build a demo mode for `@stigmer/react` that enables ALL components to render with realistic sample data -- without a live backend. This is achieved by mocking at the single integration point (the transport layer), not by wrapping individual components.

## Architecture

### How components get data today

```
StigmerProvider({ client: Stigmer })
  → StigmerContext stores the Stigmer instance
    → useStigmer() returns it
      → hooks call client.session.get(), client.agent.list(), etc.
        → generated clients delegate to Transport (gRPC-Web)
          → Transport sends request to the Stigmer API backend
```

Every component in `@stigmer/react` goes through this single chain. The `Transport` (from `@connectrpc/connect`) is the only place where real network calls happen.

### How demo mode works

Replace one layer. Everything else stays the same.

```
StigmerProvider({ client: demoClient })
  → StigmerContext stores the demo client (same type as Stigmer)
    → useStigmer() returns it (no change)
      → hooks call client.session.get(), etc. (no change)
        → generated clients delegate to DemoTransport
          → DemoTransport returns fixture data (no network calls)
```

**One mock transport → all generated clients work → all hooks work → all components work.** No per-component wrappers. No rewriting. When new components are added to `@stigmer/react`, they work in demo mode automatically because they use the same transport chain.

### The mock point

The `Stigmer` class constructor takes a `StigmerConfig` and creates a `Transport` via `createStigmerTransport()` (`sdk/typescript/src/transport.ts`). The transport is passed to `GeneratedClient` which creates all 17 resource clients.

For demo mode, we create:
1. A `DemoTransport` implementing the `@connectrpc/connect` `Transport` interface
2. A factory: `createDemoClient()` that wires `DemoTransport` → `GeneratedClient` → returns a `Stigmer`-compatible object

Usage in docs:

```tsx
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient, skillCreationScenario } from "@stigmer/react/demo";

const client = createDemoClient(skillCreationScenario);

<StigmerProvider client={client}>
  {/* ANY component works */}
  <SessionComposer />
  <MessageThread executions={...} />
  <ResourceListView />
  <SkillDetailView />
  <ArtifactsWidget />
</StigmerProvider>
```

## Implementation Phases

### Phase 1: DemoTransport and client factory

**Goal**: A `createDemoClient()` function that returns a working `Stigmer`-compatible client backed by fixture data.

**Steps**:

1. **Study the `Transport` interface** from `@connectrpc/connect`. Understand the unary and server-streaming call signatures.

2. **Build `DemoTransport`** that:
   - Receives a fixture registry (service name + method name → response data)
   - For unary RPCs: looks up the fixture and returns it as a resolved promise
   - For server-streaming RPCs: returns an async iterable of fixture snapshots (for `useExecutionStream`)
   - For unregistered methods: returns a clear error: "No demo fixture registered for [service].[method]"

3. **Build `createDemoClient()`** factory:
   - Takes a fixture scenario (a pre-built fixture registry)
   - Creates `DemoTransport` with that scenario
   - Creates `GeneratedClient(demoTransport)` for the 17 resource clients
   - Creates `SearchClient(demoTransport)` and `GitHubClient(demoTransport)`
   - Returns an object that satisfies the `Stigmer` type

4. **Verify the type compatibility**: The returned object must be accepted by `StigmerProvider` without type errors.

### Phase 2: Fixture data for the Cloud quickstart scenario

**Goal**: A `skillCreationScenario` fixture set that powers the Cloud quickstart demo.

**Steps**:

1. **Identify which RPCs the target components call**. Trace the hooks used by:
   - `MessageThread` (presentational -- needs `AgentExecution[]` as props, but the hooks that feed it call `agentExecution` RPCs)
   - `SessionComposer` (uses `useComposer` which calls session/execution RPCs)
   - `ArtifactsWidget` (uses `useExecutionArtifacts` / `useArtifactContent`)
   - `ResourceListView` (uses `useResourceList` / `useResourceSearch`)
   - `SkillDetailView` (uses `useSkill*` hooks)

2. **Build fixture data** for each RPC using `@bufbuild/protobuf` `create()`:
   - A session with a skill-creation conversation
   - Agent executions with human/AI messages showing the skill creation flow
   - Artifacts (the generated SKILL.md content)
   - A resource list with sample agents, skills, MCP servers
   - A skill detail with metadata and content

3. **Package as `skillCreationScenario`** -- a fixture registry ready to pass to `createDemoClient()`.

### Phase 3: Integration with Fumadocs

**Goal**: Demo components render correctly in MDX pages within the docs site.

**Steps**:

1. **Add `@stigmer/react` and `@stigmer/theme` to the docs site dependencies** (site/package.json). These are monorepo workspace packages.

2. **Import styles**: Add `@stigmer/react/styles.css` and `@stigmer/theme/tokens.css` to the docs layout. Verify `.stgm` scoping prevents style conflicts with Fumadocs.

3. **Create MDX-friendly demo wrapper components**:
   - These are thin wrappers that set up the provider + fixture scenario so MDX authors write `<DemoSkillCreation />` not 15 lines of boilerplate.
   - Place in `site/src/components/docs/demos/`.

4. **Build a test docs page** (`docs/getting-started/quickstart.mdx` or a scratch page) that embeds the demo components. Verify `yarn build` passes.

### Phase 4: Additional scenarios (as needed)

The fixture system is designed to be extensible. Future scenarios can be added without changing the transport or client code:

- `agentRunScenario` -- showing an agent execution with tool calls
- `approvalFlowScenario` -- showing an approval card in action
- `workflowScenario` -- showing a workflow execution

These are not needed for Phase 3 of the parent project but demonstrate the pattern scales.

## Code placement

| Artifact | Location | Rationale |
|----------|----------|-----------|
| `DemoTransport` | `sdk/react/src/demo/transport.ts` | Part of the React SDK, close to the components it serves |
| `createDemoClient()` | `sdk/react/src/demo/client.ts` | Factory function, exported from the demo entry |
| Fixture scenarios | `sdk/react/src/demo/scenarios/` | One file per scenario, each exports a fixture registry |
| Demo entry | `sdk/react/src/demo/index.ts` | Barrel export: `import { createDemoClient, skillCreationScenario } from "@stigmer/react/demo"` |
| MDX wrapper components | `site/src/components/docs/demos/` | Docs-site-specific, not part of the SDK export |

The demo module lives in `@stigmer/react` (not a separate package) because:
- It imports protobuf types and `@connectrpc/connect` types that are already peer dependencies
- It's tightly coupled to the React SDK's component contracts
- Platform builders may want demo mode for their own Storybook/testing
- Exported as a subpath (`@stigmer/react/demo`) so it's tree-shakeable -- production apps that don't import it get zero bundle impact

## Risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `Transport` interface may have methods beyond unary/streaming that we miss | Medium | Study `@connectrpc/connect` types first; the mock only needs to handle what components actually use |
| Protobuf object construction may reject partial data | Medium | Use `create()` from `@bufbuild/protobuf` (same pattern used in production code); fill all required fields |
| CSS conflicts between `@stigmer/theme` and Fumadocs | Low | `.stgm` scoping + `@layer stgm` already isolates styles; test early in Phase 3 |
| Server-streaming mock may not match hook expectations | Medium | Trace `useExecutionStream` to understand exact stream protocol; mock accordingly |

## Success criteria

1. `createDemoClient(scenario)` returns a `Stigmer`-compatible client -- TypeScript compiles without type errors
2. `StigmerProvider` accepts the demo client and descendant components render
3. The skill-creation scenario renders: a conversation thread, artifacts, library view, and skill detail
4. No live backend connection is required
5. `yarn build` and `tsc --noEmit` pass for both `sdk/react` and `site/`
6. Demo mode is exported as `@stigmer/react/demo` and importable from MDX

## Execution approach

- Work phase by phase, verifying each before moving to the next
- Phase 1 is the foundation -- if the mock transport doesn't work cleanly, we stop and reassess before investing in fixture data
- Pause before any decision that affects the `@stigmer/sdk` or `@stigmer/react` public API surface

## Review process

1. **You review this plan**
2. **Provide feedback** -- especially on code placement and export strategy
3. **I revise** -- Create T01_1_review.md + T01_2_revised_plan.md
4. **You approve** -- Execution begins
5. **I implement** -- Phase 1 first, verify, then Phase 2, then Phase 3
