# Unified Model Registry Distribution Strategy

**Date**: May 2, 2026

## Summary

Replaced fragile, ad-hoc distribution of `model-registry.json` with a unified "Sync Once, Load Natively" architecture. All three consumers (Python graphton, TypeScript cursor-runner, React SDK) now follow the same pattern: a local `data/` directory synced by one Makefile target and verified by one CI check. This fixes the Anthropic API 404 error caused by the Python model registry failing to load when pip-installed into a venv.

## Problem Statement

`backend/libs/model-registry.json` is the single source of truth for all model metadata (IDs, pricing, capabilities, context windows) across the platform. It was consumed by four different technology stacks across six deployment contexts, each with its own ad-hoc distribution mechanism.

### Pain Points

- **Python graphton** used `Path(__file__).resolve().parents[5] / "model-registry.json"` — a fragile 5-level parent directory traversal that assumed a specific directory nesting depth. When graphton was pip-installed into a venv (as happens during agent runner bootstrap), `parents[5]` resolved to `venv/` instead of `backend/libs/`, silently producing an empty registry.
- **TypeScript cursor-runner** imported from `../../../../libs/model-registry.json` — a 4-level relative path that required a `sed` rewrite during CLI embedding.
- **React SDK** had a manually maintained copy in `sdk/react/data/` with zero automation — a drift risk.
- **Agent-runner Dockerfile** didn't copy the JSON at all — broken in container deployments.
- **Dev mode** (`buildPreInstallFn`) didn't copy model-registry.json — broken for `make local`.

The cascading failure: empty registry → `resolve_or_passthrough` passes platform ID `claude-sonnet-4.5` directly to Anthropic API → Anthropic returns 404 (expects `claude-sonnet-4-5-20250929`).

## Solution

"Sync Once, Load Natively" — each consumer loads the JSON using its technology stack's native, robust mechanism, and a single Makefile target distributes the canonical file to all consumer-local locations.

## Implementation Details

### Python graphton — `importlib.resources`

Replaced `Path(__file__).parents[5]` with Python's standard `importlib.resources` API:

- Created `graphton/data/` package with `__init__.py` and `model-registry.json`
- Updated `pyproject.toml` to include the JSON as package data
- `_ensure_loaded()` now uses `importlib.resources.files("graphton.data").joinpath("model-registry.json")`
- Works identically whether run from source tree, pip-installed into a venv, installed as a wheel in Docker, or vendored inside the embedded CLI build

### TypeScript cursor-runner — Local `data/` directory

Replaced the 4-level relative import with the same pattern the React SDK already uses:

- Created `cursor-runner/data/model-registry.json`
- Changed import from `../../../../libs/model-registry.json` to `../../data/model-registry.json`
- Eliminates the `sed` rewrite in `cursorrunner/sync.sh`

### Makefile targets

- `make sync-model-registry` — copies canonical JSON to all three consumer locations
- `make check-model-registry` — diffs all copies against canonical, fails on drift
- `sync-model-registry` added as dependency of `codegen`
- `check-model-registry` added to the `check` CI gate

### Simplified sync.sh scripts

- `agentrunner/sync.sh` — removed model-registry.json copy block (now inside graphton package data)
- `cursorrunner/sync.sh` — removed model-registry.json copy + `sed` rewrite block (now inside `data/` directory, copied with source)

### Updated `@update-model-registry` cursor rule

Added Step 5b documenting `make sync-model-registry` after editing the canonical JSON.

## Benefits

- **Zero fragile path arithmetic** — no `parents[5]`, no `../../../../libs/`, no `sed` rewrites
- **One sync command** — `make sync-model-registry` distributes to all consumers
- **CI drift detection** — `make check-model-registry` catches stale copies before production
- **Self-contained packages** — graphton carries its own registry data, fixing venv, Docker, and dev mode gaps simultaneously
- **Consistent pattern** — all three consumers follow identical architecture (local `data/`, native loading, Makefile sync)

## Impact

- **Agent runner**: Fixes the Anthropic 404 error that prevented session subject generation
- **Dev mode**: `make local` now correctly loads model metadata without manual intervention
- **Docker**: Agent-runner container image inherits the fix via graphton's package data
- **CI**: Drift between canonical and consumer copies is now caught automatically
- **Embedding**: Both `sync.sh` scripts are simplified — fewer moving parts, fewer failure modes

## Related Work

- Follows from the unified model registry introduction (model-registry.json as single source of truth)
- Addresses the same class of issue documented in `_changelog/2026-05/2026-05-01-185359-fix-embedded-sync-model-registry-path-resolution.md`

---

**Status**: Production Ready
**Files Changed**: 14 files across 5 directories
