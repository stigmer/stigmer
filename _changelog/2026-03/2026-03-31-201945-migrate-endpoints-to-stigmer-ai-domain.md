# Migrate Production Endpoints to stigmer.ai Domain

**Date**: March 31, 2026

## Summary

Migrated all production endpoints from the `*.stigmer.planton.live` domain to the new `*.stigmer.ai` domain. The web app moves from `stigmer.planton.live` to `app.stigmer.ai`, and the API moves from `api.stigmer.planton.live` to `api.stigmer.ai`. This establishes Stigmer's own domain identity instead of living under the Planton infrastructure namespace.

## Problem Statement

The production endpoints were still using `*.stigmer.planton.live`, a subdomain under Planton's infrastructure domain. As Stigmer establishes its own brand and product identity, the endpoints need to reflect the `stigmer.ai` domain.

### Pain Points

- `stigmer.planton.live` doesn't convey Stigmer as an independent product
- `api.stigmer.planton.live` is unnecessarily long for developer-facing API endpoints
- MCP server configs, CLI defaults, and documentation all referenced the old domain
- CORS origin allowlists, ingress hostnames, and gateway configs needed updating

## Solution

Global find-and-replace across configuration, source code, tests, and documentation in the OSS repo:

| Old Endpoint | New Endpoint |
|---|---|
| `stigmer.planton.live` | `app.stigmer.ai` |
| `api.stigmer.planton.live` | `api.stigmer.ai` |

## Implementation Details

### Infrastructure & Config
- `client-apps/web/_kustomize/overlays/prod/service.yaml` — ingress hostname

### Source Code & Tests
- `backend/services/workflow-runner/pkg/config/stigmer_config.go` — example comment
- `mcp-server/internal/grpc/client_test.go` — gRPC connection test expectations
- `mcp-server/internal/config/config_test.go` — config test fixture

### Documentation (workflow-runner)
- `docs/README.md`, `docs/architecture/callbacks.md`, `docs/architecture/grpc.md`
- `docs/architecture/overview.md`, `docs/getting-started/quick-reference.md`
- `docs/guides/phase-1.5.md`, `docs/implementation/phase-1.5-summary.md`
- `docs/implementation/phase-1.5-completion.md`, `docs/implementation/agent-runner-pattern-migration.md`

### Other Documentation & Changelogs
- `backend/services/agent-runner/_rules/.../learning-log.md`
- 5 changelog entries in `_changelog/2026-03/`

**Total**: 19 files, 40 line replacements

## Benefits

- Clean, branded domain (`stigmer.ai`) for all public-facing endpoints
- Shorter, more memorable API URL for developers (`api.stigmer.ai`)
- Consistent domain across web app, API, CLI, and MCP server documentation

## Impact

- All developer-facing documentation now references `api.stigmer.ai`
- Test fixtures updated to match production endpoint naming
- No functional changes — this is a pure domain rename at the config/docs level

## Related Work

- Companion change in `stigmer-cloud` repo (CORS, gateway, service configs, mobile app)
- Previous domain migration: `stigmer-prod-api.planton.live` → `api.stigmer.planton.live` (2026-03-31)

---

**Status**: ✅ Production Ready
