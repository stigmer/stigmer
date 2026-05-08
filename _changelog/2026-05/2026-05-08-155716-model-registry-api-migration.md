# Model Registry: Migrate All Consumers from Static JSON to Authenticated API

**Date**: May 8, 2026

## Summary

Replaced the static `model-registry.json` file (copied to 4 locations across the OSS repo, plus 1 in the cloud repo) with an authenticated API endpoint that all platform consumers fetch from at runtime with local TTL caching. This fixes Issue #143 (Vite build failures from missing JSON) and eliminates the fragile multi-copy sync machinery.

## Problem Statement

The `@stigmer/react` npm package bundled a static `model-registry.json` that broke Vite/Rollup production builds in Tauri desktop apps (Issue #143). The compiled JS in `dist/models/registry.js` referenced `../../data/model-registry.json` which Vite strictly resolves before checking package boundaries, while Webpack (Next.js) happened to resolve it differently.

### Pain Points

- 5 copies of the same JSON file maintained across 2 repos, synced via `make sync-model-registry`
- A Cursor rule (`@update-model-registry`) required periodic manual web-scraping of provider pricing pages
- Published npm packages shipped stale pricing data that could already be outdated at publish time
- Bundler incompatibility between Vite (strict path resolution) and Webpack (lazy resolution)
- Adding or updating a model required touching 2 repos and running sync/check targets

## Solution

Added an authenticated REST endpoint (`GET /v1/proxy/model-registry`) to the cloud backend that serves the raw `model-registry.json` from the classpath. All consumers (React SDK, cursor-runner, graphton) now fetch from this endpoint with local TTL caching instead of importing a static file.

The endpoint is placed under `/v1/proxy/` so it:
- Requires Bearer token authentication (existing Spring Security rule)
- Routes to port 8081 via the existing Kubernetes HTTPRoute
- Gets wildcard CORS from the Istio EnvoyFilter (works from any customer domain)
- Requires no infrastructure or security config changes

## Implementation Details

### New Endpoint (stigmer-cloud)

- `GET /v1/proxy/model-registry` on `PublicBillingController.java`
- Reads raw JSON from classpath at `@PostConstruct`, serves it with `Cache-Control: public, max-age=3600`
- Authenticated via `/v1/proxy/**` pattern — no security config changes needed
- Separate from the existing unauthenticated `/api/v1/public/model-pricing` (marketing site, markup-applied)

### React SDK (`@stigmer/react`)

- `registry.ts`: Removed static JSON import and `MODEL_REGISTRY` constant. Added `fetchModelRegistry(apiUrl, token)` and `parseRegistryJson()`. Changed `resolveDefaultModelId()` to accept a `models` parameter.
- `ModelRegistryContext.ts`: New React context holding fetched registry state (`models`, `isLoading`, `error`).
- `provider.tsx`: `StigmerProvider` now fetches the model registry on mount using `client.getAuthCredential()` and `client.baseUrl`. Removed `cloudApiUrl` prop.
- `useModelRegistry.ts`: Reads from context instead of static constant. Added `isLoading` and `error` to return type.
- `package.json`: Removed `"data"` from `files` array.
- Test rewritten to use inline test data and `ModelRegistryContext.Provider` wrapper.

### Cursor-Runner (TypeScript)

- `model-pricing-data.ts`: Replaced static JSON import with async `getPricingTable()` using API fetch, 1-hour TTL cache, and `STIGMER_AUTH_TOKEN` env var for Bearer auth. Falls back to conservative default pricing on failure.
- `model-pricing.ts`: Changed from synchronous `PRICING_TABLE` to async `ensureLoaded()` + lazy map initialization.

### Graphton (Python)

- `model_registry.py`: Replaced `_load_registry_text()` filesystem-walk loader with HTTP fetch from the API using `STIGMER_AUTH_TOKEN` env var for Bearer auth, 1-hour TTL cache via `time.monotonic()`. Stale cache served on fetch failure. `STIGMER_MODEL_REGISTRY_PATH` env var kept as offline override.

### OSS Cleanup

- Deleted 4 JSON copies: `backend/libs/model-registry.json`, `sdk/react/data/model-registry.json`, `backend/libs/python/graphton/src/graphton/data/model-registry.json`, `backend/services/cursor-runner/data/model-registry.json`
- Removed `sync-model-registry` and `check-model-registry` Makefile targets
- Removed from `codegen` and `check` target dependencies
- Deleted `.cursor/rules/backend/update-model-registry.mdc` (moved to stigmer-cloud)

### Rule Migration

- New `.cursor/rules/update-model-registry.mdc` created in stigmer-cloud
- Targets the single classpath JSON at `backend/services/stigmer-service/src/main/resources/model-registry.json`
- No sync step — after deployment, consumers auto-refresh within cache TTL

## Benefits

- Issue #143 permanently fixed — no JSON in the npm package, no bundler path issues
- Single source of truth — one JSON file in the cloud service classpath
- Always fresh — consumers get current models/pricing without npm releases
- No sync machinery — eliminated `make sync-model-registry`, `check-model-registry`, 4 JSON copies
- Authenticated — raw provider pricing (business data) requires Bearer token, CORS works from any origin via Istio gateway
- Adding a model = updating one JSON + deploying — auto-propagates to all consumers

## Impact

- **React SDK**: `MODEL_REGISTRY` export removed (breaking). `useModelRegistry` now returns `isLoading`/`error`. Models empty during initial fetch.
- **Cursor-runner**: `PRICING_TABLE` sync export replaced by async `getPricingTable()`. Requires `STIGMER_AUTH_TOKEN` env var.
- **Graphton**: `_load_registry_text()` now fetches from API. Requires `STIGMER_AUTH_TOKEN` env var.
- **Issue #143**: Fixed — Vite/Rollup builds succeed since no JSON file is bundled.
- **Makefile**: `codegen` and `check` targets simplified (no registry sync/check).

## Related Work

- Public model pricing API (stigmer-cloud, same session) — the existing `/api/v1/public/model-pricing` endpoint stays for the marketing site
- Pricing page rewrite and cost calculator (earlier session today)
- Billing system Phases 1-5

---

**Status**: Production Ready
**Timeline**: Single session
