# Task T01: Project Plan — Runner CI Fix, PyPI Package, Documentation

**Created**: 2026-04-28 12:23
**Status**: PENDING REVIEW

## Overview

This project addresses four interconnected areas:
1. **Immediate CI fix** — Fix the broken Windows desktop build
2. **CI hardening** — Add early feedback loops to prevent future breakage
3. **PyPI package** — Publish the agent-runner as a standalone `stigmer-runner` pip package
4. **Documentation rewrite** — Rewrite runner docs for platform integrators

## Key Finding: SDK Runner Clients Are Code-Generated

All four SDK runner clients (Go, TypeScript, Python, Java) are already **code-generated** by `stigmer-codegen`. No hand-written runner client work is needed:
- `sdk/typescript/src/gen/runner.ts` — generated
- `sdk/python/src/stigmer/_gen/_runner.py` — generated
- `sdk/java/src/main/java/ai/stigmer/sdk/gen/RunnerClient.java` — generated
- `sdk/go/gen/` — generated

---

## Task Breakdown

### T02: Fix Broken Windows Desktop CI (Immediate)

**Root cause**: In `.github/workflows/release.desktop.yaml` line 131, the "Sync agent-runner source for embedding" step is missing `shell: bash`. On Windows, GitHub Actions defaults to PowerShell, where `chmod +x sync.sh` and `./sync.sh` fail. The Python source never gets synced, so the verification step fails with:
```
ERROR: agent-runner source not synced -- sidecar will fail at runtime
```

**Fix**:
- Add `shell: bash` to the sync step in `release.desktop.yaml`
- Verify by checking that all other bash-dependent steps in the same workflow already have `shell: bash`

**Files**: `.github/workflows/release.desktop.yaml`

**Estimated effort**: 10 minutes

---

### T03: Harden Desktop CI Pipeline (Short-term)

Three changes to prevent future breakage:

1. **Add `push: branches: [main]` trigger** to `release.desktop.yaml`
   - Currently desktop builds only trigger on tag push and manual dispatch
   - CLI workflow triggers on both `push to main` and tags — desktop should match
   - On push to main: `should_release=false` (build-only, no GitHub release)

2. **Add `lint-and-typecheck-agent-runner` job** to the desktop workflow
   - CLI workflow gates builds behind agent-runner lint/typecheck
   - Desktop workflow skips this entirely — a broken agent-runner could ship in the sidecar
   - Add the same gating job to `release.desktop.yaml`

3. **Review and verify** all shell-dependent steps have `shell: bash`

**Files**: `.github/workflows/release.desktop.yaml`

**Estimated effort**: 1-2 hours

---

### T04: Publish Agent-Runner as PyPI Package (`stigmer-runner`)

**Goal**: Platform integrators can `pip install stigmer-runner` and run a test runner without needing the Go CLI.

**Current state of agent-runner**:
- Lives at `backend/services/agent-runner/`
- Has `pyproject.toml` with Poetry configuration
- Internal dependencies: `graphton` (monorepo lib at `backend/libs/python/graphton/`), `stigmer-protos` (generated stubs at `apis/stubs/python/stigmer/`)
- External dependencies: temporalio, langchain, langgraph, etc.

**Steps**:

1. **Assess internal dependency packaging**
   - `graphton` — needs to be either bundled or published as a separate PyPI package
   - `stigmer-protos` — generated protobuf stubs, needs to be bundled or published
   - Decision: bundle both into the `stigmer-runner` package (simplest, least surface area)

2. **Create PyPI-ready package configuration**
   - Update `pyproject.toml` with PyPI metadata (name: `stigmer-runner`, author, license, etc.)
   - Add console_scripts entry point: `stigmer-runner = "main:asyncio.run(main())"` or similar
   - Ensure all internal deps are properly included in the package
   - Add `py.typed` marker if appropriate

3. **Create CI workflow**: `.github/workflows/release.python-runner.yaml`
   - Trigger on `v*` tags (matching existing pattern)
   - Generate proto stubs
   - Bundle internal dependencies
   - Build wheel and sdist
   - Publish to PyPI using `PYPI_TOKEN` secret
   - Pattern: mirror existing `release.python-sdk.yaml`

4. **Create entry point script**
   - CLI wrapper: `stigmer-runner start --endpoint ... --token ...`
   - Or simpler: `python -m stigmer_runner --endpoint ... --token ...`

5. **Test locally**
   - `pip install -e .` from the agent-runner directory
   - Verify `stigmer-runner start` works end-to-end

**Files**:
- `backend/services/agent-runner/pyproject.toml`
- `.github/workflows/release.python-runner.yaml` (new)
- `backend/services/agent-runner/stigmer_runner/__init__.py` or equivalent entry point

**Estimated effort**: 1-2 days

---

### T05: Rewrite Runner Documentation for Platform Integrators

**Goal**: Rewrite runner docs from the perspective of a platform builder who needs to understand how to integrate Stigmer runners onto their platform.

**Current docs** (assessed):
- `docs/concepts/runners.mdx` — exists, user-facing
- `docs/guides/runners/` — basic guides
- `docs/guides/desktop/` — desktop-specific guides
- Missing: platform integrator perspective, SDK integration patterns, deployment patterns

**New narrative structure**:

1. **Concepts: What is a Runner** (`docs/concepts/runners.mdx` — rewrite)
   - What runners are (Temporal workers that execute agent tasks)
   - Runner lifecycle (register → connect → poll → execute → heartbeat)
   - Runner types (local native, Docker, cloud-managed)
   - Architecture diagram showing runner ↔ backend ↔ Temporal relationship

2. **Guide: Integrate Runners on Your Platform** (new)
   - **Pattern A: CLI Sidecar** — Ship the `stigmer` CLI binary, invoke `stigmer up runner --endpoint ... --token ...` as a subprocess. This is the desktop app pattern. Step-by-step instructions.
   - **Pattern B: Docker Container** — Deploy `ghcr.io/stigmer/agent-runner` image. Environment variable reference. Kubernetes deployment example.
   - **Pattern C: PyPI Package** (new, from T04) — `pip install stigmer-runner && stigmer-runner start --endpoint ... --token ...`. For Python-heavy platforms.
   - **SDK Management API** — Using the SDK (any language) to register, list, stop, delete runners programmatically. All four SDKs have generated `RunnerClient`.

3. **Guide: Runner Operations** (update existing)
   - Starting and stopping runners
   - Monitoring runner health
   - Runner logs and debugging
   - Multi-runner setups

4. **Reference: Runner Environment Variables** (new or update)
   - Complete env var reference for the agent-runner process
   - Local vs cloud mode configuration

**Files**:
- `docs/concepts/runners.mdx`
- `docs/guides/runners/` (multiple files)
- `docs/guides/integration/` (new directory for platform integrator guides)

**Estimated effort**: 1-2 days

---

## Execution Order

```
T02 (CI fix, 10 min) → T03 (CI hardening, 1-2 hrs) → T04 (PyPI, 1-2 days) → T05 (Docs, 1-2 days)
```

T02 and T03 can be done in one session. T04 and T05 are independent and could be parallelized.

## Success Criteria

- [ ] Windows desktop CI build passes on `v*` tag push
- [ ] Desktop CI runs on every push to main (build-only)
- [ ] Agent-runner lint/typecheck gates desktop builds
- [ ] `stigmer-runner` package published on PyPI
- [ ] `pip install stigmer-runner && stigmer-runner start` works
- [ ] CI pipeline for PyPI publishing exists and runs on tag push
- [ ] Runner docs rewritten with platform integrator narrative
- [ ] Sidecar, Docker, and PyPI integration patterns documented

## Risks

- **PyPI package naming**: `stigmer-runner` might be taken — need to verify availability
- **Internal dependency bundling**: graphton and stigmer-protos bundling adds complexity
- **Proto stubs generation**: PyPI package needs pre-built stubs or a build step
- **Entry point design**: Need to decide on CLI UX for the standalone package
