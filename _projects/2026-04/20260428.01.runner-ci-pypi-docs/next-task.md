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
| T03 | Harden desktop CI pipeline (main push trigger, agent-runner lint gate) | PENDING |
| T04 | Publish agent-runner as PyPI package (`stigmer-runner`) | PENDING |
| T05 | Rewrite runner docs for platform integrators | PENDING |

## Essential Files

### Project Documentation
- **Plan**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.01.runner-ci-pypi-docs/tasks/T01_0_plan.md`
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.01.runner-ci-pypi-docs/README.md`

### Key Files to Modify
- **Desktop CI (T02/T03)**: `.github/workflows/release.desktop.yaml`
- **Agent-runner (T04)**: `backend/services/agent-runner/pyproject.toml`
- **Runner docs (T05)**: `docs/concepts/runners.mdx`, `docs/guides/runners/`

### Knowledge Folders
- Design Decisions: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.01.runner-ci-pypi-docs/design-decisions/`
- Checkpoints: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260428.01.runner-ci-pypi-docs/checkpoints/`

## Current Status

**Created**: 2026-04-28 12:23
**Current Task**: T03 (Harden desktop CI pipeline)
**Status**: T02 complete, ready for T03

## Session Progress (2026-04-28)

- T01 plan created and approved
- T02 completed: added `defaults.run.shell: bash` to desktop release workflow `build` job
- Root cause confirmed: sync step missing `shell: bash`, PowerShell can't run `chmod` or bash scripts
- Chose job-level default over spot fix to prevent recurrence
- Audited all 9 `run:` steps in the build job — all bash-compatible, no regressions

## Next Steps

1. T03: Harden desktop CI pipeline
   - Add `push: branches: [main]` trigger to `release.desktop.yaml`
   - Add `lint-and-typecheck-agent-runner` gate job (mirror CLI workflow pattern)
   - Review all shell-dependent steps have `shell: bash`
2. T04: Publish agent-runner as PyPI package (`stigmer-runner`)
3. T05: Rewrite runner docs for platform integrators

## Key Discovery

All four SDK runner clients (Go, TypeScript, Python, Java) are **code-generated** by `stigmer-codegen`. No hand-written runner client work needed.

---

*To resume: drag this file into chat.*
