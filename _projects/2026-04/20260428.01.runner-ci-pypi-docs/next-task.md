# Next Task: 20260428.01.runner-ci-pypi-docs

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Runner CI Fix, PyPI Package, and Documentation

**Description**: Fix broken desktop CI, harden release pipelines, publish agent-runner as standalone PyPI package, and rewrite runner documentation for platform integrators.

**Goal**: Ensure every tag push produces green builds across all platforms, publish the agent-runner as a pip-installable package on PyPI, and rewrite runner docs from a platform-builder perspective.

**Tech Stack**: GitHub Actions CI/CD, Python/Poetry/PyPI, Tauri/Rust, Go CLI, Markdown/MDX documentation

**Components**: CI workflows (.github/workflows/), agent-runner (backend/services/agent-runner/), desktop app (client-apps/desktop/), docs (docs/concepts/, docs/guides/)

## Task Plan

| Task | Description | Status |
|------|-------------|--------|
| T01 | Project planning | COMPLETE |
| T02 | Fix broken Windows desktop CI (`shell: bash` in sync step) | COMPLETE |
| T03 | Harden desktop CI pipeline (main push trigger, agent-runner lint gate) | COMPLETE |
| T04 | Publish agent-runner as PyPI package (`stigmer-runner`) | PENDING |
| T05 | Rewrite runner docs for platform integrators | PENDING |

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
**Current Task**: T04 (Publish agent-runner as PyPI package)
**Status**: T03 complete, ready for T04

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

## Next Steps

1. T04: Publish agent-runner as PyPI package (`stigmer-runner`)
   - Assess internal dependency packaging (graphton, stigmer-protos)
   - Create PyPI-ready package configuration
   - Create CI workflow `.github/workflows/release.python-runner.yaml`
   - Create entry point script
   - Test locally
2. T05: Rewrite runner docs for platform integrators

## Key Discovery

All four SDK runner clients (Go, TypeScript, Python, Java) are **code-generated** by `stigmer-codegen`. No hand-written runner client work needed.

---

*To resume: drag this file into chat.*
