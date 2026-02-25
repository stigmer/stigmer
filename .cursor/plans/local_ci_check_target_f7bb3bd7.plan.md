---
name: Local CI Check Target
overview: Add a `make check` target to the root Makefile that mirrors exactly what CI runs (lint + typecheck + build + test), so broken code is caught locally before pushing. Also add a PR-level CI workflow to prevent broken code from landing on main.
todos:
  - id: add-typecheck-target
    content: Add `typecheck` target to root Makefile (mypy on agent-runner + graphton)
    status: completed
  - id: add-check-target
    content: Add `check` composite target to root Makefile (lint + typecheck + build + test)
    status: completed
  - id: cleanup-build-backend
    content: Remove mypy from `build-backend` target (now lives in `typecheck`)
    status: completed
  - id: add-ci-workflow
    content: Create `.github/workflows/ci.yaml` for PR-level checks (lint, typecheck, build, test)
    status: completed
  - id: fix-lint-errors
    content: Fix the ~10 existing Ruff/mypy errors in agent-runner Python code
    status: completed
isProject: false
---

# Local CI Validation via `make check`

## Problem

The CI pipeline (`release.cli.yaml`) runs `lint-and-typecheck-agent-runner` on every push to `main`, but there's no single local command to replicate what CI does. This means lint/typecheck failures are only discovered after pushing. Additionally, there is no PR-level CI workflow -- checks only run *after* code lands on `main`, which is too late.

## Current State Analysis

**Root `make lint` is incomplete** -- it runs `go vet` + `gofmt` + `ruff check` but does NOT run `mypy` type checking. This is the exact gap that let the current failure through.

**CI `lint-and-typecheck-agent-runner` runs:**

- `poetry run mypy grpc_client/ worker/ --show-error-codes`
- `poetry run ruff check grpc_client/ worker/`

**Root `make lint` runs:**

- `go vet` on all 7 Go modules
- `gofmt -s -w .`
- `make -C apis lint` (proto linting)
- `poetry run ruff check .` on graphton and agent-runner (but no mypy)

**Root `make build-backend` runs:**

- `poetry run mypy grpc_client/ worker/ ../../libs/python/graphton/src/ --show-error-codes` (mypy is here, buried in "build")

Mypy is currently split across two targets (`build-backend` has it, `lint` doesn't), which is confusing and explains why it gets missed locally.

## Design

Keep `make build` fast (compile-only, ~3s). Introduce `make check` as the comprehensive pre-push gate:

```
make check = lint + typecheck + build (compile) + test
```

### Target Hierarchy


| Target           | Purpose                               | Speed    | When to use                  |
| ---------------- | ------------------------------------- | -------- | ---------------------------- |
| `make build`     | Compile binaries                      | ~3s      | During development iteration |
| `make lint`      | Static analysis (go vet, ruff, proto) | ~10s     | Quick quality check          |
| `make typecheck` | Type checking (mypy)                  | ~15s     | After Python changes         |
| `make test`      | Unit tests                            | ~30s     | Before committing            |
| `**make check**` | **All of the above combined**         | **~60s** | **Before pushing / PR**      |


## Changes

### 1. Add `typecheck` target to root [Makefile](Makefile)

New target that runs mypy on all Python projects, matching what CI does:

```makefile
typecheck: ## Run type checkers (mypy for Python)
	@echo "============================================"
	@echo "Running Type Checks"
	@echo "============================================"
	@echo ""
	@echo "1/1 Type checking agent-runner + graphton (MyPy)..."
	@cd backend/services/agent-runner && \
		poetry install --no-interaction --quiet && \
		poetry run mypy grpc_client/ worker/ ../../libs/python/graphton/src/ --show-error-codes
	@echo "✓ Type checking passed"
	@echo ""
```

### 2. Add `check` target to root [Makefile](Makefile)

Composes all validation steps in the same order CI would run them:

```makefile
check: lint typecheck build test ## Run all checks locally (mirrors CI)
```

Lint errors are cheapest to fix, so they run first. Build validates compilation. Tests run last (slowest).

### 3. Clean up `build-backend` target in root [Makefile](Makefile)

Remove the mypy invocation from `build-backend` since it now lives in `typecheck`. `build-backend` should only compile, not lint. This eliminates the confusing duplication.

### 4. Add PR CI workflow: `.github/workflows/ci.yaml`

A lightweight CI workflow that triggers on pull requests and pushes to `main`. This runs the same checks that `make check` runs, gating PRs before merge:

```yaml
name: ci
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint-and-typecheck-python:
    # mypy + ruff on agent-runner and graphton

  lint-go:
    # go vet on all Go workspace modules

  build:
    # compile CLI + workflow-runner-grpc

  test:
    # all unit tests (Go + Python)
```

This ensures broken code can never land on `main`, which is the real fix for the problem. `make check` is the local convenience wrapper around the same checks.

### 5. Fix the current lint errors

The 10 Ruff errors and mypy errors shown in the CI screenshot need to be fixed. This is a separate task from the Makefile changes but should be done in the same PR since they're blocking CI.

## File Changes Summary

- **[Makefile](Makefile)**: Add `typecheck` and `check` targets; clean up `build-backend`
- **[.github/workflows/ci.yaml](.github/workflows/ci.yaml)** (new): PR-level CI workflow
- **Python source files**: Fix the ~10 existing Ruff/mypy errors (in `backend/services/agent-runner/`)

