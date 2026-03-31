# Update Endpoint References to New Domain Convention

**Date**: March 31, 2026

## Summary

Updated all references to the old Stigmer API and Web endpoint hostnames across documentation, tests, operational configs, and source code comments to reflect the new domain naming convention.

## Problem Statement

The production endpoints were migrated from environment-prefixed naming (`stigmer-prod-api.planton.live`, `stigmer-prod-web.planton.live`) to a cleaner subdomain convention (`api.stigmer.planton.live`, `stigmer.planton.live`). Stale references throughout the codebase would cause confusion and could lead to misconfigurations.

### Pain Points

- Tests referenced the old `stigmer-prod-api.planton.live` hostname
- Documentation and architecture guides contained outdated endpoint URLs
- Changelog entries described the old endpoints, creating inconsistency with the live environment

## Solution

Global find-and-replace across the `stigmer` repository:

| Old Endpoint | New Endpoint |
|---|---|
| `stigmer-prod-api.planton.live` | `api.stigmer.planton.live` |
| `stigmer-prod-web.planton.live` | `stigmer.planton.live` |

## Implementation Details

### Files Updated (18 files, 37 line changes)

**Tests** (3 files):
- `mcp-server/internal/config/config_test.go` — updated test fixture address
- `mcp-server/internal/grpc/client_test.go` — updated connection target and assertion expectations

**Source Code** (1 file):
- `backend/services/workflow-runner/pkg/config/stigmer_config.go` — updated example in code comment

**Operational Config** (1 file):
- `client-apps/web/_kustomize/overlays/prod/service.yaml` — previously staged change

**Documentation** (9 files):
- Workflow runner docs (`README.md`, architecture, guides, implementation)
- Agent runner learning log

**Changelogs** (4 files):
- Historical changelog entries updated for consistency

## Benefits

- All codebase references now match the live production endpoints
- Tests validate against the correct hostnames
- Reduced risk of copy-paste misconfigurations from stale docs

## Impact

No runtime impact — the actual deployed services were already migrated. This commit brings documentation, tests, and config references into alignment.

---

**Status**: ✅ Production Ready
