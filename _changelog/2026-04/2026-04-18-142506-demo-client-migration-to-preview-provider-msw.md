# Retire @stigmer/react/demo -- Migrate to PreviewProvider + MSW

**Date**: April 18, 2026

## Summary

Replaced the entire Stigmer-specific demo mock infrastructure (`DemoTransport`, `createDemoClient`, `fixtures`, `buildScenario`) with `@scenar/preview`'s generic `PreviewProvider` backed by MSW (Mock Service Worker). This eliminates 1,111 lines of product-specific mock transport code and replaces it with protocol-standard HTTP interception that uses the real Stigmer SDK client.

## Problem Statement

Stigmer's `@stigmer/react/demo` module provided a custom in-process mock layer: a fake Connect-RPC transport (`DemoTransport`), a fake client factory (`createDemoClient`), a fixture registry mirroring every SDK method, and a scenario builder with search multiplexing. This infrastructure worked but had significant drawbacks:

### Pain Points

- **Parallel maintenance**: Every new RPC added to the Stigmer SDK required a corresponding fixture entry, fixture type, and DemoTransport routing rule.
- **Fake client code path**: The demo client was a hand-built object mimicking the real `Stigmer` class. Any SDK client refactor (new methods, renamed clients) required updating the fake in lockstep.
- **No real transport testing**: `DemoTransport` intercepted at the Connect-RPC method level, bypassing HTTP entirely. Bugs in serialization, headers, or transport configuration were invisible in demos.
- **Product-specific infrastructure**: The fixture registry, scenario builder, and search multiplexing were Stigmer-only. No reuse possible across projects.

## Solution

Replace the entire stack with three layers:

1. **MSW service worker** intercepts HTTP requests at the browser level -- the same network calls the production SDK makes.
2. **`PreviewProvider`** (from `@scenar/preview/runtime`) manages MSW lifecycle, gates rendering until the service worker is ready, and wraps children with the app's provider chain.
3. **`connectFixture`** (from `@scenar/preview/connect`) builds MSW handlers from protobuf service descriptors using the Connect-RPC URL convention -- generic, not product-specific.

The real `Stigmer` client runs with a real Connect transport (`useBinaryFormat: false` for MSW JSON compatibility). MSW intercepts every `fetch()` before it leaves the browser.

## Implementation Details

### Scenar changes (`@scenar/preview` v0.1.3 and v0.1.4)

- **`@scenar/preview/connect`** -- New subpath export with `connectHandler` (async, lazy MSW import) and `connectFixture` (sync, static MSW import). Both derive URL patterns from service `typeName` and method descriptors.
- **`scenar preview init`** -- Now auto-generates `mockServiceWorker.js` in the project's public directory. Framework-aware (Next.js, Vite, CRA, Remix all resolve to `public/`).
- **`@bufbuild/protobuf >=2.0.0`** added as optional peer dependency for the connect subpath.
- 23 new tests across connect handlers and MSW init.

### Stigmer changes

- **`site/.scenar/providers.tsx`** -- Wired `PreviewProviders` with a real `Stigmer` client using `createConnectTransport({ baseUrl: "/", useBinaryFormat: false })`.
- **19 scenario migrations** -- All `index.tsx` files converted from `StigmerProvider` + `createDemoClient` to `PreviewProvider` + `connectFixture`.
- **`samples` extracted** -- Moved from `@stigmer/react/demo` to `@stigmer/react/test` (new subpath export). All 23 import sites updated.
- **`@stigmer/react/demo` deleted** -- `client.ts` (78 LOC), `transport.ts` (116 LOC), `fixtures.ts` (409 LOC), `types.ts` (69 LOC), `index.ts`, and their tests removed.
- **`preview-helpers.ts` eliminated** -- Initially created as a local sync wrapper, then replaced by `connectFixture` from `@scenar/preview/connect` in v0.1.4.
- **`next.config.ts`** -- Added `webpack` alias to exclude `msw/node` from client bundle (standard MSW + Next.js compatibility).

### File impact

- 52 files changed in the main migration commit
- Net: 1,493 insertions, 1,811 deletions (net -318 lines)
- `@stigmer/react/demo` directory fully removed

## Benefits

- **Zero product-specific mock infrastructure** -- The only Stigmer-specific code remaining is `samples.ts` (domain data builders) and `providers.tsx` (provider chain wiring). Both are inherently product-specific.
- **Real transport code path** -- Demos now exercise the actual `Stigmer` client, `createConnectTransport`, and `fetch()`. Transport bugs are visible.
- **No maintenance tax for new RPCs** -- Adding a new RPC requires zero fixture infrastructure. Just call `connectFixture(NewController, "method", () => data)` in the scenario.
- **Reusable across Scenar ecosystem** -- `connectFixture` and `PreviewProvider` work for any project using Connect-RPC + MSW, not just Stigmer.

## Impact

- **Site demos**: All 19 scenarios that used `@stigmer/react/demo` now use `@scenar/preview`. The 9 Scenar-only scenarios (no Stigmer client) were unaffected.
- **SDK consumers**: `@stigmer/react/demo` subpath no longer exists. Any external consumers must switch to `@stigmer/react/test` for `samples` and `@scenar/preview/runtime` for preview infrastructure.
- **Scenar users**: Any project using Connect-RPC can now use `connectFixture` from `@scenar/preview/connect` for typed MSW handlers.

## Related Work

- Design decision: `_projects/2026-04/20260417.02.scenar-product/design-decisions/010-stigmer-demo-client-migration.md`
- Scenar changelog: `scenar-ai/scenar/_changelog/2026-04/2026-04-18-134500-preview-connect-rpc-and-msw-init.md`
- Previous demo infrastructure: `2026-04-01-151243-react-demo-mode-transport-and-client-factory.md`
- Previous fixture system: `2026-04-01-154201-react-demo-mode-composable-fixture-infrastructure.md`

---

**Status**: Production Ready
**Timeline**: Single session
