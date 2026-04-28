# Next Task: 20260428.01.runner-ci-pypi-docs

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Runner CI Fix, PyPI Package, and Documentation

**Description**: Fix broken desktop CI, harden release pipelines, publish agent-runner as standalone PyPI package, and rewrite runner documentation for platform integrators.

**Goal**: Ensure every tag push produces green builds across all platforms, publish the agent-runner as a pip-installable package on PyPI, and rewrite runner docs from a platform-builder perspective.

**Tech Stack**: GitHub Actions CI/CD, Python/Hatchling/PyPI, Tauri/Rust, Go CLI, Markdown/MDX documentation

**Components**: CI workflows (.github/workflows/), agent-runner (backend/services/agent-runner/), desktop app (client-apps/desktop/), docs (docs/concepts/, docs/guides/)

## Task Plan

| Task | Description | Status |
|------|-------------|--------|
| T01 | Project planning | COMPLETE |
| T02 | Fix broken Windows desktop CI (`shell: bash` in sync step) | COMPLETE |
| T03 | Harden desktop CI pipeline (main push trigger, agent-runner lint gate) | COMPLETE |
| T04 | Publish agent-runner as PyPI package (`stigmer-runner`) | COMPLETE |
| T05 | Rewrite runner docs for platform integrators | COMPLETE |

## Essential Files

### Project Documentation
- **Plan**: `_projects/2026-04/20260428.01.runner-ci-pypi-docs/tasks/T01_0_plan.md`
- **README**: `_projects/2026-04/20260428.01.runner-ci-pypi-docs/README.md`

### Key Files to Modify
- **Desktop CI (T02/T03)**: `.github/workflows/release.desktop.yaml` (done)
- **Agent-runner (T04)**: `backend/services/agent-runner/pyproject.toml`
- **Runner docs (T05)**: `docs/concepts/runners.mdx`, `docs/guides/runners/`

### Knowledge Folders
- Design Decisions: `_projects/2026-04/20260428.01.runner-ci-pypi-docs/design-decisions/`
- Checkpoints: `_projects/2026-04/20260428.01.runner-ci-pypi-docs/checkpoints/`

## Current Status

**Created**: 2026-04-28 12:23
**Current Task**: —
**Status**: All tasks complete

## Session Progress (2026-04-28)

### Session 1 (T01 + T02)
- T01 plan created and approved
- T02 completed: added `defaults.run.shell: bash` to desktop release workflow `build` job
- Root cause confirmed: sync step missing `shell: bash`, PowerShell can't run `chmod` or bash scripts
- Chose job-level default over spot fix to prevent recurrence
- Audited all 9 `run:` steps in the build job — all bash-compatible, no regressions

### Session 2 (T03)
- Added `push: branches: [main]` trigger to desktop workflow
- Fixed latent bug: `determine-version` had no `else` branch — push-to-main events would leave VERSION and SHOULD_RELEASE unset
- Added `lint-and-typecheck-agent-runner` job gating builds behind MyPy + Ruff (mirrors CLI workflow)
- Shell audit confirmed clean: job-level `defaults.run.shell: bash` covers all Windows steps, other jobs run on ubuntu-latest
- Design decision: no path filters — accepted full build cost on push-to-main for reliability
- Committed: `6af3a043 ci(desktop): add push-to-main trigger and agent-runner lint gate`

### Session 3 (T04)
- Verified graphton builds as a standalone PyPI package (name available on PyPI)
- Restructured agent-runner: moved `worker/` and `grpc_client/` under `src/stigmer_runner/`
- Rewrote all imports across ~130 files (`from worker.` → `from stigmer_runner.worker.`)
- Switched build system from Poetry (`package-mode=false`) to hatchling (PEP 621)
- Created `src/stigmer_runner/__init__.py` and `__main__.py` (console script entry point)
- Updated Dockerfile to use pip + `requirements.txt` instead of Poetry (simpler, no Poetry install in Docker)
- Updated sandbox Dockerfile.sandbox.full (same Poetry → pip migration)
- Updated `sync.sh` for CLI embedding (copies from `src/stigmer_runner/` now)
- Updated `BUILD.bazel` (glob paths, imports directive)
- Updated `run.sh` to use venv directly instead of `poetry run`
- Updated CI workflows: `release.desktop.yaml`, `release.cli.yaml`, `release.sandbox-cloud.yaml`
  - Lint jobs: Poetry → pip install from requirements.txt + mypy/ruff directly
  - Path filters updated to `src/stigmer_runner/` layout
- Created `.github/workflows/release.python-runner.yaml` (determine-version → publish-graphton → publish-runner)
- Updated agent-runner rule file `_rules/implement-agent-runner-features.mdc` paths
- Both packages build successfully: `graphton-0.1.0-py3-none-any.whl`, `stigmer_runner-0.0.0.dev0-py3-none-any.whl`
- PyPI names confirmed available: `graphton`, `stigmer-runner`
- **Manual steps required**: Set up PyPI trusted publishing (see plan Phase 5)

### Session 4 (T05)
- Pushed back on T01 plan: concept page does NOT need a rewrite (it's strong), no separate `integration/` dir, no combined Pattern A/B/C page
- Retitled `docs/guides/runners/` section from "Runners (CLI)" to "Runners"
- Initially created Docker, PyPI, and env vars guides — then discovered critical architectural gap:
  - The Python agent-runner is NOT a self-sufficient runner process
  - Registration (`Runner.Apply`), heartbeats, and the bidi command stream live in the Go CLI
  - Standalone `docker run` or `pip install stigmer-runner` produces a Temporal worker that can't register, heartbeat, or be managed from the web console
- Removed Docker, PyPI, and env vars guides from navigation (files kept on disk for future reference)
- Reverted concept page to original text (removed PyPI mention)
- Created `docs/guides/runners/platform-integration.mdx` — the correct guide for platform builders:
  - CLI sidecar pattern (bundle Go binary, spawn `stigmer up runner`)
  - Architecture diagram showing CLI ↔ backend ↔ Python ↔ Temporal layers
  - Build targets, startup grace period, process monitoring, state files
  - Deep link launch token flow (`createLaunchToken` → URL scheme → `exchangeLaunchToken`)
  - SDK `RunnerClient` API for programmatic management
  - Desktop app as reference implementation
- Updated `overview.mdx` — 3 cards (local runner, stop/cleanup, platform integration)
- Updated `concepts/runners.mdx` — added platform integration link in "What's next"

## Next Steps

All tasks complete. Manual steps remaining from T04:
- Set up PyPI trusted publishing for `stigmer-runner` and `graphton` packages
- Create CI workflow to push `ghcr.io/stigmer/agent-runner` Docker image on tag pushes

## Key Discovery

All four SDK runner clients (Go, TypeScript, Python, Java) are **code-generated** by `stigmer-codegen`. No hand-written runner client work needed.

---

*To resume: drag this file into chat.*
