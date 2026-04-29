# Runner Documentation Restructure for Platform Builders

**Date**: April 29, 2026

## Summary

Restructured the entire runner documentation section to target platform builders who want to integrate Stigmer into their desktop applications. Replaced the mixed-audience content with a clear journey: set up a sidecar, choose an execution mode (local, sandbox, or cloud), and manage runner lifecycle. Removed desktop app documentation and orphaned demo scenarios.

## Problem Statement

The runner documentation mixed two audiences — individual developers running `stigmer up` on their laptops and platform builders embedding Stigmer into their own apps. Neither audience was well served. Desktop app install/setup docs duplicated content already available on the website and console. Internal-facing pages (Docker deployment, PyPI package, raw environment variables) exposed implementation details that platform builders interact with through the CLI, not directly.

### Pain Points

- Runner docs had no clear audience or journey
- Desktop app docs duplicated download/install info from the website
- Docker deployment and environment variable reference pages targeted operators, not platform builders
- Demo scenarios for deleted pages were orphaned but still registered in the build

## Solution

Rewrote the runner guide section with a platform-builder-first journey organized around three execution modes (local, sandbox, cloud/auto) and the sidecar integration pattern. Removed all content that does not serve the platform-builder audience.

## Implementation Details

### New documentation structure (6 pages)

- **Overview** — three-mode table (local/sandbox/cloud), sidecar pattern diagram, audience statement
- **Sidecar setup** — architecture, building the CLI binary, bundling, spawning processes, deep links, SDK API
- **Local mode** — `stigmer up` with native runtime, naming, backend config, multiple runners
- **Sandbox mode** — runner-level vs command-level isolation, Docker flags, custom sandbox images
- **Cloud mode (auto)** — JIT provisioning, no-setup fallback, session binding
- **Stop and clean up** — CLI stop commands, SIGTERM behavior, SDK stop, state file cleanup

### Removed content

- `docs/guides/desktop/` (overview, install, manage-runners) — 3 pages
- `docs/guides/runners/docker-deployment.mdx` — standalone Docker/K8s deployment guide
- `docs/guides/runners/environment-variables.mdx` — raw env var reference
- `docs/guides/runners/pypi-package.mdx` — PyPI package install guide
- `docs/guides/runners/local-runner.mdx` — replaced by local-mode.mdx
- `docs/guides/runners/platform-integration.mdx` — replaced by sidecar-setup.mdx
- 4 demo scenario directories (desktop-first-launch, desktop-runner-management, local-runner-tour, stop-runner-tour)

### Updated files

- `docs/concepts/runners.mdx` — reframed around three modes, removed desktop references
- `docs/vocabulary.md` — updated Runner entry
- `docs/guides/meta.json` — removed desktop section
- `site/src/components/docs/index.ts` — removed 4 orphaned demo exports
- `site/src/components/mdx.tsx` — removed 4 orphaned demo imports/registrations
- `site/src/components/pages/DownloadPage.tsx` — updated links to new page slugs

## Benefits

- Clear, single-audience documentation for platform builders
- Logical journey from sidecar setup through execution modes
- No orphaned demos or dead cross-references
- Reduced doc surface area from 10+ mixed-audience pages to 6 focused pages

## Impact

- **Platform builders** get a clear path from "I want to integrate Stigmer" to "it's running"
- **Site/docs build** is cleaner — no dead demo imports
- **Maintenance** is simpler — fewer pages, no audience-mixing

## Related Work

- Runner concept page updated to align with three-mode framing
- DownloadPage.tsx updated to link to new guide structure

---

**Status**: ✅ Production Ready
