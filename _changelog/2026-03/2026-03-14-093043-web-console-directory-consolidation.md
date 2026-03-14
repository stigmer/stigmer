# Consolidate Web Console into Single `client-apps/web` Directory

**Date**: March 14, 2026

## Summary

Eliminated the dual-directory situation where `client-apps/web` (an obsolete restaurant prototype) and `client-apps/web-console` (the actual Stigmer web console) coexisted in the stigmer-cloud monorepo. Moved the Kubernetes deployment config (`_kustomize/`) from the old directory, deleted the prototype, and renamed `web-console` to `web` — aligning the codebase with the existing Planton service definition, Makefile targets, and container image path.

## Problem Statement

The stigmer-cloud repository had two web application directories:

- `client-apps/web` — A "Bella Vista" restaurant management prototype (MUI v7, category/dish/reservation/table modules) with zero Stigmer functionality
- `client-apps/web-console` — The actual Stigmer Web Console MVP (17 routes, Tailwind + shadcn/ui, agent execution, catalog, draft flows)

### Pain Points

- Confusing to have two web apps in the same monorepo with overlapping names
- Infrastructure (`stigmer-web.yaml`, Makefile, kustomize manifests) pointed to `client-apps/web` but the real app was in `client-apps/web-console`
- The `_kustomize/` deployment config (base + local/prod overlays with Auth0 secrets, ingress, resource limits) was trapped in the wrong directory
- Root `package.json` listed both as workspaces, creating unnecessary dependency resolution overhead

## Solution

Consolidate into a single `client-apps/web/` by:
1. Moving `_kustomize/` from old `web` to `web-console`
2. Deleting old `web/` entirely
3. Renaming `web-console/` to `web/`
4. Updating internal path references (Dockerfile, README, package.json)

The key insight: renaming `web-console` TO `web` means all infrastructure references (`stigmer-web.yaml` trigger paths, Dockerfile path, image repo `ghcr.io/stigmer/stigmer-cloud/client-apps/web`, kustomize base directory, Makefile targets) become correct with zero edits.

## Implementation Details

**Moved (1 directory):**
- `client-apps/web/_kustomize/` → `client-apps/web-console/_kustomize/` (base/service.yaml, overlays/local, overlays/prod)

**Deleted (69 files):**
- Restaurant prototype: MUI components (Header, SidebarNavigation, StatusBadge, ThemeRegistry), domain modules (category, dish, reservation, table), pages (dashboard, reservations, tables, menu, settings), MUI theme, cookie utilities, default Next.js public assets

**Renamed:**
- `client-apps/web-console/` → `client-apps/web/` via `git mv`

**Updated path references:**
- `client-apps/web/Dockerfile` — 12 `web-console` → `web` substitutions (COPY, RUN cd, standalone paths, WORKDIR)
- `client-apps/web/package.json` — name field `web-console` → `web`
- `client-apps/web/README.md` — 5 path references updated
- Root `package.json` — removed `client-apps/web-console` from workspaces

**Required zero changes:**
- `_ops/planton/service-hub/services/stigmer-web.yaml`
- `Makefile` (lint, clean, update targets)
- `_kustomize/base/service.yaml` (image repo path)

## Benefits

- Single canonical web app directory — no confusion about which is "the real one"
- Infrastructure alignment — service definition, CI/CD paths, image repo, kustomize directory all naturally point to `client-apps/web`
- 7,329 lines of dead code removed (restaurant prototype)
- Clean workspace config — one web entry in root `package.json`
- Deployment-ready — `_kustomize/` overlays with Auth0 config, secrets, and ingress are now where they belong

## Impact

- **Repository structure**: `client-apps/web-console/` no longer exists; `client-apps/web/` is the sole web application
- **CI/CD**: No changes needed — `stigmer-web.yaml` already pointed to `client-apps/web`
- **Docker builds**: `docker build -f client-apps/web/Dockerfile .` (path unchanged from infra perspective)
- **Historical docs**: Project session notes under `_projects/` still reference `web-console` — left as-is since they're accurate historical records

## Related Work

- [Web Console MVP Complete](2026-03-14-092101-web-console-mvp-complete.md) — The MVP that built the web console in `client-apps/web-console/`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
