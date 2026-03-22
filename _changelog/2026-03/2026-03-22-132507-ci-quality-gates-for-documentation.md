# CI Quality Gates for Documentation

**Date**: March 22, 2026

## Summary

Added the first PR-triggered CI workflow to the Stigmer repository. Every pull
request that touches documentation, the site, or linting configuration now runs
three parallel quality gates: prose linting (Vale + Prettier), site build
verification (Fumadocs/Next.js), and link checking (Lychee). Also fixed two
latent gaps in the website deploy workflow and restored docs linting in the local
`make check` target.

## Problem Statement

Phases 1 and 2 of the documentation infrastructure project established a full
local toolchain: Vale prose linting, Prettier formatting, pre-commit hooks, a
Fumadocs-powered docs site with search, and a content architecture with 35 clean
MDX files. But none of this was enforced in CI.

### Pain Points

- Zero PR-triggered workflows in the entire repository. All seven existing
  workflows were release/deploy pipelines triggered by tags or pushes to `main`.
  Any PR could merge without automated checks.
- `release.website.yaml` only watched `site/**`, not `docs/**`. Docs-only merges
  to `main` did not trigger a site rebuild, so updated content would not appear
  on the live site until the next unrelated `site/` change.
- `release.website.yaml` used Node 20 despite the project requiring Node 22
  (documented as critical in the `.nvmrc` and session checkpoints).
- `make check` excluded `lint-docs` with a "temporarily removed" comment from
  before Phase 1 archived the stale AI-generated docs. Phase 1 completed, all
  docs pass Vale, but the target was never restored.

## Solution

Created `.github/workflows/ci.docs.yaml` with three parallel jobs that run on
every `pull_request` and `push` to `main` touching docs, site, or linting
configuration. Fixed the deploy workflow and Makefile gaps as companion changes.

## Implementation Details

### New workflow: `ci.docs.yaml`

Three parallel jobs:

1. **lint** — Installs Vale 3.9.5 (manual binary download for exact local
   parity) and Node 22. Runs `make lint-docs` (Vale strict, fails on warnings)
   and `make format-docs-check` (Prettier).
2. **build** — Installs Node 22 with corepack/yarn. Runs `yarn build` in
   `site/` to catch broken MDX, missing frontmatter, and Fumadocs configuration
   errors.
3. **links** — Uses `lycheeverse/lychee-action@v2` with
   `continue-on-error: true`. Non-blocking initially because external links are
   inherently flaky in CI (rate limiting, transient failures) and Lychee does not
   understand Fumadocs slug-style relative links.

Design decisions:

- Single workflow with parallel jobs instead of two separate files (original plan
  called for `docs-lint.yml` + `docs-build.yml`). Same performance, less
  duplication, easier maintenance.
- `ci.` naming prefix to distinguish from existing `release.` deploy workflows.
  Establishes a convention for future PR check workflows.
- Concurrency group (`docs-${{ github.head_ref || github.ref }}`) cancels stale
  runs on the same PR branch.
- Vale installed via direct binary download rather than `errata-ai/vale-action`
  to ensure `make lint-docs` runs identically to local development.

### Companion fix: `release.website.yaml`

- Added `docs/**` and `vale/**` to the `paths` trigger.
- Updated `node-version` from 20 to 22.

### Companion fix: Makefile

- Restored `lint-docs` and `format-docs-check` in the `check` target.
- Added `docs-build` target that delegates to `make -C site build`.

## Benefits

- Documentation quality is now enforced on every PR, not just locally via
  pre-commit hooks.
- Docs-only changes merged to `main` now trigger a site rebuild and deploy.
- Node version consistency between CI and local development eliminates a class of
  subtle build divergence bugs.
- `make check` now includes docs quality, making the local full-CI-gate match
  what runs in GitHub Actions.

## Impact

- **Contributors**: PRs touching docs get immediate feedback on Vale violations,
  formatting issues, and build breakage.
- **Maintainers**: Merge confidence increases. No more "it worked locally"
  surprises for docs changes.
- **Users**: Site content stays in sync with merged docs changes.

## Related Work

- Session 1: Vale prose linting setup (`2026-03-22-104645`)
- Session 2: Archive + content architecture (`2026-03-22-112920`)
- Session 3: Fumadocs integration (`2026-03-22-123515`)
- Session 4: Pre-commit hooks + style guide (`2026-03-22-125421`)

---

**Status**: Production Ready
**Timeline**: Session 5 of the documentation infrastructure project
