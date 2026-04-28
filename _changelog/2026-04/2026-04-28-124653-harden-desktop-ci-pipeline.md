# Harden Desktop CI Pipeline

**Date**: April 28, 2026

## Summary

Hardened the desktop release CI pipeline by adding a push-to-main continuous build trigger, gating platform builds behind agent-runner Python lint/typecheck, and fixing a latent bug where push-to-main events would leave version variables unset. These changes bring the desktop workflow to parity with the CLI workflow's quality gates.

## Problem Statement

The desktop CI pipeline (`release.desktop.yaml`) had two gaps compared to the CLI pipeline:

### Pain Points

- Desktop builds only triggered on tag push and manual dispatch — breakage landed silently on main and only surfaced at release time (this is how the Windows `shell: bash` bug shipped)
- No agent-runner quality gate — a broken Python agent-runner could ship inside the Tauri sidecar binary without any lint or type-check catching it
- The `determine-version` step had no `else` branch — a push-to-main event would leave `VERSION` and `SHOULD_RELEASE` unset, breaking the entire pipeline

## Solution

Modeled the desktop workflow after the CLI workflow's proven patterns:

1. Added `push: branches: [main]` trigger for continuous validation builds
2. Added `lint-and-typecheck-agent-runner` job (MyPy + Ruff) as a gate before platform builds
3. Fixed the `determine-version` step to handle push-to-main events

## Implementation Details

Single file change: `.github/workflows/release.desktop.yaml`

**Push-to-main trigger**: Added `branches: [main]` under `on.push`. On push to main, `should_release` is set to `false` so the workflow performs a build-only run (no GitHub release created). This matches the CLI workflow's approach.

**Agent-runner lint gate**: Added the `lint-and-typecheck-agent-runner` job, identical to the CLI workflow's version. It runs on `ubuntu-latest`, installs Poetry, downloads proto stubs, and runs MyPy type checking and Ruff linting against `grpc_client/` and `worker/`. The `build` matrix job now depends on this job via `needs`.

**Version fix**: Added the `else` branch in the `determine-version` step so push-to-main events get `VERSION="test-<short-hash>"` and `SHOULD_RELEASE="false"` instead of unset variables.

**Design decision — no path filters**: The desktop build depends on files across 7+ directories (`client-apps/desktop/`, `client-apps/cli/`, `backend/services/agent-runner/`, `backend/libs/python/graphton/`, `apis/`, `sdk/typescript/`, `package.json`). Path filters would be fragile and risk recreating silent breakage. Accepted full build cost on every push to main, matching the CLI workflow pattern.

## Benefits

- Every merge to main validates the full desktop build across all three platforms (macOS, Ubuntu, Windows)
- Broken agent-runner Python code is caught before it can ship in the desktop sidecar
- The `determine-version` pipeline bug is fixed before it could cause a CI failure
- Desktop and CLI workflows now share the same quality gate patterns, reducing cognitive overhead for maintainers

## Impact

- **CI/CD**: Desktop pipeline now runs on every push to main (increased CI cost, accepted for reliability)
- **Developers**: Faster feedback on breakage — no more discovering issues only at release time
- **Release confidence**: Agent-runner quality is verified before any platform build starts

## Related Work

- T02 in the same project: Fixed the Windows `shell: bash` bug that originally motivated this hardening
- CLI workflow (`release.cli.yaml`): The reference pattern for all changes in this task

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~15 minutes)
