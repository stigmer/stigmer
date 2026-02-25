# Makefile Architect Rewrite: 587 Lines to 163

**Date**: February 26, 2026

## Summary

Rewrote the monorepo Makefile from scratch, cutting 27 targets and 587 lines down to 14 targets and 163 lines. Eliminated all duplication, removed dead targets, merged overlapping concerns, and made `release-local` smart enough to conditionally rebuild the agent-runner Docker image only when source files change.

## Problem Statement

The Makefile had grown organically into a wall of targets that was hard to navigate and harder to maintain.

### Pain Points

- **27 targets** — too many for any developer to hold in their head
- **Massive duplication** — the 40-line version bump logic was copy-pasted across `release` and `protos-release`; 7 Go modules listed individually 7+ times
- **Dead targets** — `build-backend` printed "these are CLI subcommands now" and built one binary; `setup-hooks` was a subset of `setup`; `test-all-go` was `test` minus Python
- **Operational runbooks as targets** — `test-local-mode`, `test-sandbox-mode`, `dev-full` mostly printed instructions rather than building artifacts
- **Noise over signal** — every target had 15-20 decorative echo lines for 2-3 lines of actual work
- **Split identity** — `typecheck` and `lint` were separate targets for the same concern (static analysis)
- **Two release-local variants** — `release-local` and `release-local-full` forced developers to decide which one to run

## Solution

Applied DRY principles and a "one clear purpose per target" philosophy. Every target either builds something, checks something, or cleans something. No target exists solely to print instructions.

## Implementation Details

- **`GO_MODULES` variable** — the 7 Go module paths are defined once and iterated via `for` loops in `setup`, `test`, and `lint`
- **Version bump deduplicated** — the logic lives only in `release`; `protos-release` delegates with `$(MAKE) release bump=$(bump)`
- **`lint` absorbs `typecheck`** — go vet, gofmt, buf lint, ruff, and mypy all run under one target
- **Smart `release-local`** — uses a sentinel file (`.agent-runner-image-built`) and `find -newer` to detect agent-runner source changes; skips the Docker build when the image is already current
- **Parameterized `sandbox`** — one target replaces `sandbox-build-basic` and `sandbox-build-full` via `make sandbox sandbox=basic|full`
- **Minimal output** — lowercase, terse status messages; let the tools speak for themselves

### Targets removed (13)

| Target | Reason |
|---|---|
| `setup-hooks` | Already inside `setup` |
| `build-backend` | Dead — services are CLI subcommands |
| `test-all-go` | Redundant subset of `test` |
| `test-sdk` | Trivial one-liner |
| `test-workflow-runner` | Trivial one-liner |
| `test-agent-runner` | Trivial one-liner |
| `test-all` | Confusing alias |
| `coverage` | Rarely used; duplicated all test paths |
| `install` | `release-local` replaces this |
| `build-agent-runner-image` | Folded into `release-local` |
| `dev` / `dev-full` | `go run .` and alias of `release-local` + `sandbox` |
| `sandbox-build-basic` / `sandbox-build-full` | Consolidated into `sandbox` |
| `sandbox-test` / `test-local-mode` / `test-sandbox-mode` | Operational runbooks, not build targets |

## Benefits

- **72% fewer lines** (587 → 163)
- **48% fewer targets** (27 → 14)
- **Zero duplication** — Go module list and version bump logic each defined once
- **Faster inner loop** — `release-local` skips the Docker build when agent-runner hasn't changed
- **Easier onboarding** — `make help` fits on one screen

## Impact

Every developer using `make` in the stigmer monorepo. The target names and behavior are the same for the primary workflows (`build`, `test`, `lint`, `release-local`, `release`), so no retraining needed.

---

**Status**: ✅ Production Ready
