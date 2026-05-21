---
name: Unified Runner Deployment
overview: "Integration-test and deploy the unified TypeScript runner (`@stigmer/runner`) for both local (CLI/desktop) and cloud (Daytona sandbox) execution of all three activity types: ExecuteCursor, ExecuteDeepAgent, and ExecuteServerlessWorkflow."
todos:
  - id: integration-tests-unified-runner
    content: "Add integration tests for ExecuteDeepAgent + ExecuteServerlessWorkflow through the unified runner (extend session-routing suite)"
    status: pending
  - id: flip-routing-default
    content: "Change STIGMER_ACTIVITY_ROUTING default from 'global' to 'session' in Java (application-temporal.yaml) and Go (config.go)"
    status: pending
  - id: repoint-cli-bootstrap
    content: "Repoint CLI bootstrap from cursor-runner to backend/services/runner (cursorrunner_dev.go, sync.sh, Makefile DEV_LDFLAGS)"
    status: pending
  - id: dockerfile-unified-runner
    content: "Create Dockerfile for unified runner (multi-stage Node 22 build + slim runtime)"
    status: pending
  - id: sandbox-image-update
    content: "Update cloud sandbox image to use unified runner instead of 3 legacy runners"
    status: pending
  - id: wire-daytona-kustomize
    content: "Wire Daytona env vars into prod kustomize (STIGMER_SANDBOX_TYPE=daytona, API key, image, temporal address)"
    status: pending
  - id: deploy-smoke-test
    content: "Deploy stigmer-service + push sandbox image + end-to-end smoke test"
    status: pending
isProject: false
---

# Unified Runner Deployment Plan

## Current State

The unified runner at `backend/services/runner/` is **code-complete** (1493 runner tests + 1057 deep-agent tests + 41 workflow-engine integration tests), but:

- **Integration test gap:** Only ExecuteCursor is tested through the unified runner (session-routing suite). ExecuteDeepAgent and ExecuteServerlessWorkflow have ZERO integration coverage through it.
- **Routing default is wrong:** `STIGMER_ACTIVITY_ROUTING` defaults to `global` — session routing should be the inherent behavior, not an opt-in flag.
- CLI daemon bootstraps from `backend/services/cursor-runner` (NOT the unified runner)
- No Dockerfile for unified runner
- Cloud sandbox image (`agent-sandbox-full`) still bakes 3 legacy runners
- Daytona config not wired into prod kustomize (`STIGMER_SANDBOX_TYPE=noop` in prod)

## Key Architectural Decision: Routing Default

**Decision:** Change `STIGMER_ACTIVITY_ROUTING` default from `global` to `session`.

**Rationale:** Session routing is the architecture — not a feature flag. Both LOCAL and CLOUD execution targets use `session:{id}` queues (they only differ in who provides the runner). There is no valid case where an agent execution with a session should go to the global queue. The env var remains in code purely as an emergency kill switch.

- Session-less operations (MCP connect) already pass empty session ID → global queue fallback
- Workflow execution dispatch uses its own `WorkflowExecutionDispatchService` with separate queues — unaffected
- `STIGMER_DEFAULT_EXECUTION_TARGET` is NOT needed in kustomize — Java already defaults to `cloud` for managed edition

**No kustomize changes needed for routing.** Just flip the default in code.

## Task Sequence (ordered by dependency + impact)

### Task 1: Integration Tests for Unified Runner (All 3 Execution Types)

**Why first:** You cannot deploy with confidence if 2 out of 3 execution paths are untested through the actual runner being deployed. The harness infrastructure already exists — extend it.

**Current coverage:**
- ExecuteCursor: covered (session-routing Tier 2 offline + Tier 3 provider E2E)
- ExecuteDeepAgent: NOT covered (main suite uses legacy Python agent-runner on global queue)
- ExecuteServerlessWorkflow: NOT covered (main suite uses Go workflow-runner)

**Approach — extend `test/integration-session-routing/`:**

The session-routing suite already starts the unified runner in manager mode via `unified_runner.go`. Add tests for the other two execution types:

**1a. ExecuteDeepAgent (native harness) tests:**
- Tier 2 (offline): Create `HARNESS_NATIVE` session, add to unified runner manager, create execution. Without `ANTHROPIC_API_KEY`, proves dispatch reaches unified runner and fails gracefully (same pattern as Cursor offline tests).
- Tier 3 (provider): With `ANTHROPIC_API_KEY` or proxy, full E2E through DeepAgent pipeline to `COMPLETED`.
- Depends on: #6 (ExecuteGraphton→ExecuteDeepAgent name mismatch) being resolved in another conversation

**1b. ExecuteServerlessWorkflow tests:**
- Tier 2 (offline): Submit a simple golden YAML workflow (e.g., `01-operation-basic.yaml`), verify the unified runner's workflow engine picks it up and executes.
- Tier 3 (provider): Submit a workflow that calls an LLM (e.g., `04-operation-call-llm.yaml`), verify full completion with real API key.
- Note: Workflow executions route via `WorkflowExecutionDispatchService` — need to verify how it interacts with the unified runner (separate queue pattern: `workflow_execution_runner`)

**1c. Cloud target + static runner tests:**
- Extend `cloud_control_plane_test.go` with native + workflow cases (not just Cursor)

**Key files to modify/create:**
- New: `test/integration-session-routing/deep_agent_test.go` (~4-6 tests)
- New: `test/integration-session-routing/workflow_execution_test.go` (~4-6 tests)
- Modify: `test/integration-session-routing/suite_test.go` (add native harness config, workflow fixtures)
- Modify: `test/integration/harness/unified_runner.go` (if any env gaps for DeepAgent/workflow)
- Modify: `test/integration-session-routing/Makefile` (new test targets)

**Estimate:** ~2-3 hours

---

### Task 2: Flip Routing Default to `session`

**Why here:** Once integration tests pass with `ActivityRouting=session` (which the test suite already sets explicitly), we have confidence to make it the production default.

**Changes (two one-line edits):**
- Java: `application-temporal.yaml` → `activity-routing: ${STIGMER_ACTIVITY_ROUTING:session}` (was `:global`)
- Go: `config.go` → change fallback from `RoutingGlobal` to `RoutingSession`

The env var stays in code as a kill switch. No kustomize changes needed — prod just picks up the new default.

**Estimate:** ~5 min (plus running existing tests to confirm no regression)

---

### Task 3: Repoint CLI Bootstrap to Unified Runner

**Why next:** The unified runner is proven (integration tests), routing is correct (default flipped). Wire the CLI to use it locally.

**Changes (stigmer repo):**
- `client-apps/cli/internal/cli/cursorrunner/cursorrunner_dev.go` — change walk target from `backend/services/cursor-runner` to `backend/services/runner`
- `client-apps/cli/internal/cli/cursorrunner/sync.sh` (embed) — copy from `backend/services/runner` instead of `cursor-runner`
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — update `RunnerPIDFileName` and log constants
- Root `Makefile` — update `DEV_LDFLAGS` to point at `backend/services/runner`, add `build-runner` / `test-runner` / `typecheck-runner` targets
- Verify: `stigmer up` starts the unified runner, all 3 execution types dispatch correctly

**Estimate:** ~1 hour

---

### Task 4: Dockerfile for Unified Runner

**Changes (stigmer repo):**
- Create `backend/services/runner/Dockerfile` — multi-stage Node 22 build:
  - Stage 1: `npm ci --omit=dev` + `npx tsc` (or `esbuild` bundle)
  - Stage 2: slim runtime with `node dist/main.js`
- Create `.dockerignore` (exclude tests, node_modules, .git)
- Add `make docker-build-runner` to root Makefile
- Verify: `docker build` produces working image, `docker run` starts Temporal worker

**Estimate:** ~30 min

---

### Task 5: Update Cloud Sandbox Image

**Changes (stigmer repo):**
- Option A (recommended): Create new `backend/services/runner/Dockerfile.sandbox` — unified runner + workspace tooling (git, python, etc.)
- Option B: Update `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full` to replace 3 runners with 1
- Update `release.sandbox-cloud.yaml` GitHub Action — build from new path, push to GHCR
- Entry command: `node /runner/dist/main.js` (static mode, queue from env)

**Estimate:** ~1 hour

---

### Task 6: Wire Daytona into Prod Kustomize

**Why needed:** Daytona config is NOT in prod kustomize today. Spring `application-sandbox.yaml` declares the env vars but prod sets none of them — so `STIGMER_SANDBOX_TYPE=noop` (disabled).

**What's already in Planton:**
- `$secrets-group/daytona/prod.api-key` — exists, just not referenced
- `$variables-group/sandbox-ci/prod.sandbox-image` — exists (CI-managed), not referenced

**Changes (stigmer-cloud repo) — `_kustomize/overlays/prod/service.yaml`:**
- Add variables:
  - `STIGMER_SANDBOX_TYPE: daytona`
  - `STIGMER_SANDBOX_IMAGE: $variables-group/sandbox-ci/prod.sandbox-image`
  - `STIGMER_SANDBOX_TEMPORAL_ADDRESS: <external Temporal endpoint>`
- Add secrets:
  - `DAYTONA_API_KEY: $secrets-group/daytona/prod.api-key`
- Verify whether `DAYTONA_API_URL` and `DAYTONA_TARGET` are needed by the Java SDK (may be auto-discovered)
- Optionally add `DAYTONA_API_URL` / `DAYTONA_TARGET` to a new Planton variables-group if SDK requires them

**NOT needed in kustomize (handled by code defaults):**
- `STIGMER_ACTIVITY_ROUTING` — defaults to `session` after Task 2
- `STIGMER_DEFAULT_EXECUTION_TARGET` — Java already defaults to `cloud`

**Estimate:** ~30 min

---

### Task 7: Deploy + Smoke Test

- Deploy stigmer-service via Planton (`tools/ci/deploy_prod_planton.sh --service stigmer-service`)
- Push sandbox image to GHCR (manually or via release workflow trigger)
- Smoke test: create session → execution routes to `session:{id}` queue → Daytona sandbox boots → unified runner picks up activity → execution reaches COMPLETED

---

## Recommendation: Pick Task 1 Now

Integration tests are the gate. Start with **ExecuteServerlessWorkflow** tests (no dependency on #6 name mismatch fix), then add **ExecuteDeepAgent** tests once the other conversation lands the fix.

## What Can Be Deferred Past Demo

- Worker count scaling (#4) — monitor after deploy
- Sandbox orphan cleanup (#5) — operational hardening, weeks out
- Token renewal (#7) — only if 4h TTL is hit during demo
- Go workflow-runner K8s retirement — keep alongside until parity proven
- Main integration suite full migration (replace legacy runners) — larger effort, post-demo
- npm publish workflow for `@stigmer/runner` — not needed for internal deploy
