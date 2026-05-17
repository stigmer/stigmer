# Task T01: E2E Workflow Testing Infrastructure — Master Plan

**Created**: 2026-05-14
**Status**: PENDING REVIEW
**Type**: Feature Development (Multi-Phase)
**Research**: `_projects/2026-05/20260508.01.bring-workflows-to-foreground/research.workflow-e2e-testing-strategy/04.report.gpt.md`

## Objective

Build a production-grade end-to-end integration testing infrastructure for Stigmer's workflow orchestration platform. Replace the legacy 15-test E2E suite with a properly isolated, layered test pyramid that proves the full execution pipeline works: **Stigmer Cloud Java service** → Temporal → workflow-runner → agent-runner/cursor-runner → results → billing → usage tracking.

## Key Design Decisions (from review + research)

### DD-01: Test Against Stigmer Cloud Java Service, Not Go stigmer-server

The Go `stigmer-server` is the OSS local daemon. The Java `stigmer-service` in `stigmer-cloud` is the production service that handles billing, usage tracking, multi-tenancy, and all production-grade features. **All integration tests must target the Java service** because:
- It covers billing and usage tracking flows
- It's what runs in production
- Testing the Go server gives false confidence — regressions in the Java service would be missed

**Implication**: Tests need cross-repo coordination (stigmer + stigmer-cloud). The test harness must be able to build/start the Java service.

### DD-02: Delete Legacy E2E Tests

The existing 15 tests in `test/e2e/` are stale — they couple to `~/.stigmer/stigmer.db`, require a manually pre-started server, and only test deployment (Phase 1). They provide no execution confidence and create a false sense of coverage. **Delete them entirely** and replace with the new infrastructure.

### DD-03: MongoDB + Redis (Production Stack), Not SQLite

The Stigmer Cloud Java service uses **MongoDB** (primary datastore) and **Redis** (cache/sessions), not Postgres or SQLite. Use Testcontainers for both MongoDB and Redis. This matches what runs in production and catches real issues. The research report's Postgres recommendation was based on the Go server — since we're testing against the Java service (DD-01), we use its actual stack.

**Note**: The Go `stigmer-server` uses SQLite. The Java `stigmer-service` uses MongoDB + Redis + Temporal. Testing against the Java service means our test infrastructure must manage MongoDB and Redis containers.

### DD-04: Tests Must Work Locally AND in CI

A hard requirement from past experience. The previous E2E setup was local-only and had "very bad results." Every test must be runnable:
- **Locally**: `make test-integration` from a developer machine
- **In CI**: GitHub Actions with the same test commands

No test should require CI-only infrastructure. No test should require a pre-existing running server.

### DD-05: Cursor Runtime in CI — Research First, Don't Speculate

Whether the Cursor local runtime works on GitHub Actions Linux runners is an open technical question. **Do not assume**. Before building the Cursor canary, run a practical spike: set up a minimal GitHub Actions workflow that installs the Cursor SDK and attempts a local agent execution. Make the decision based on evidence, not speculation.

### DD-06: Bootstrap Token Pattern for Secrets

Do not depend on Planton for secret injection in CI. Use the **bootstrap token pattern**: store individual API keys as GitHub environment secrets (`CURSOR_API_KEY`, `ANTHROPIC_API_KEY`, etc.) directly. This is simpler, has no external dependency, and is immediately available. If Planton OIDC integration becomes available later, it can replace this without architectural changes.

### DD-07: Layered Test Pyramid

Following the research report's recommendation and industry best practices:

```
┌────────────────────────────────┐
│   Provider-Backed Canaries     │  ← 3-5 tests, nightly/protected branch
│   (Cursor cloud, real LLMs)    │
├────────────────────────────────┤
│   Cross-Service E2E Tests      │  ← 10-15 tests, every PR
│   (Real services, Postgres,    │
│    Temporal, local stubs)      │
├────────────────────────────────┤
│   Workflow Engine Integration  │  ← 20-30 tests, every PR
│   (Temporal testsuite,         │
│    task kind families)         │
├────────────────────────────────┤
│   Service Contract Tests       │  ← Many, every PR
│   (gRPC surface, SDK compat)   │
└────────────────────────────────┘
```

## Architecture Overview

### Service Under Test

```
┌──────────────────────────────────────────────────────────────┐
│                    Test Harness (Go)                           │
│  - Suite lifecycle (setup/teardown)                           │
│  - Ephemeral MongoDB + Redis (Testcontainers)                 │
│  - Temporal dev server bootstrap                              │
│  - Service supervisor: Bazel-build Java service + Go/Py/TS    │
│  - Fixture deployer (apply agents/workflows via gRPC)         │
│  - Assertion helpers (event stream, lifecycle, side effects)  │
│  - JUnit XML + trace bundle output                            │
│  - Cost tracking per test                                     │
└────────────┬──────────┬──────────┬──────────┬────────────────┘
             │          │          │          │
    ┌────────▼───┐ ┌────▼─────┐ ┌─▼────────┐ ┌▼────────────┐
    │ stigmer-   │ │workflow- │ │agent-    │ │cursor-      │
    │ service    │ │runner    │ │runner    │ │runner       │
    │ (Java/     │ │(Go)      │ │(Python)  │ │(TypeScript) │
    │ Spring Boot│ │          │ │          │ │             │
    │ Bazel)     │ │          │ │          │ │             │
    │            │ │          │ │          │ │             │
    │ MongoDB  ◄─┤ │Temporal ◄┤ │Ollama/  ◄┤ │Cursor SDK ◄─┤
    │ Redis    ◄─┤ │          │ │API keys  │ │API key     │
    │ Temporal ◄─┤ │          │ │          │ │             │
    └────────────┘ └──────────┘ └──────────┘ └─────────────┘
```

### Java Service Details (from exploration)

The `stigmer-service` is a **Spring Boot** app built with **Bazel** (`./bazelw`):
- **gRPC on port 8080**, HTTP on port 8081 (proxy/webhooks)
- **MongoDB** (primary datastore) + **Redis** (cache/sessions)
- **Temporal** client connecting to `localhost:7233` by default
- **Auth0 + OpenFGA** for IAM (can be stubbed/disabled for tests)
- **Stripe** for billing (can be stubbed for tests)
- **Spring profiles**: `mongo`, `temporal`, `auth0`, `openfga`, etc.
- **Config**: `application.yaml` with env-var overrides (`MONGO_DB_*`, `REDIS_*`, `TEMPORAL_*`, etc.)
- **Run**: `./bazelw run //backend/services/stigmer-service:stigmer_service_app`
- **Test**: `./bazelw test //backend/services/stigmer-service/...` (unit tests only today)

### Ephemeral Infrastructure Per Suite

Each test suite creates:
- A **MongoDB container** (via Testcontainers-Go) with a fresh database
- A **Redis container** (via Testcontainers-Go)
- A **Temporal dev server** on a free port with a unique namespace
- The Java service started as a child process with env vars pointing to Testcontainer endpoints
- Dedicated **log files** per service
- Explicit **free ports** for all services (no collisions)
- Unique **project/workflow/execution IDs** prefixed with the test name

### Auth/IAM Strategy for Tests

The Java service requires Auth0 + OpenFGA for full operation. For integration tests:
- **Option A (preferred)**: Use a test Spring profile that bypasses auth (if the service supports it)
- **Option B**: Stand up a minimal OpenFGA container via Testcontainers + use a mock Auth0 JWT issuer
- **Option C**: Use a dedicated test API key / machine account with pre-seeded permissions
- This decision will be finalized during T03 implementation based on what the service supports

### Isolation Model

- **Per-suite**: Fresh MongoDB + Redis + Temporal + services (session scope)
- **Per-test**: Unique resource names, workflow IDs, execution IDs (logical isolation within the suite)
- **No shared state**: No `~/.stigmer/` directory, no developer database, no pre-running services

## Phased Implementation

### Phase 1: Foundation (Weeks 1-3)

> Build the test harness and prove it can start/stop the full service stack in isolation.

**T02: Delete Legacy E2E Tests**
- Remove `test/e2e/` entirely (all 76 files)
- Remove references to the old E2E suite from Makefile and CI
- Keep the `test/` directory for the new infrastructure

**T03: Test Harness Core**
- Create `test/integration/` directory structure
- Build `TestHarness` in Go with:
  - Testcontainers-Go for ephemeral **MongoDB** and **Redis**
  - Temporal dev server bootstrap (programmatic start/stop)
  - Service supervisor:
    - Build Java `stigmer-service` via `bazelw` (from stigmer-cloud repo)
    - Start it as a child process with env vars pointing to Testcontainer endpoints (`MONGO_DB_HOST`, `REDIS_HOST`, `TEMPORAL_SERVICE_ADDRESS`, etc.)
    - Start Go `workflow-runner` as child process
    - Optionally start Python `agent-runner` and TypeScript `cursor-runner`
  - Health check polling (gRPC reflection or health endpoint on all services)
  - Clean shutdown with log collection
  - Free port allocation for all services
  - Temporary working directories
  - Auth bypass or test profile configuration for the Java service
- Build `FixtureDeployer`: apply agents/workflows via gRPC client (port 8080)
- Build `AssertionHelpers`: lifecycle phase assertions, event stream subscription, execution polling with timeout

**T04: JUnit XML + Trace Bundle Output**
- Wire `gotestsum` for JUnit XML generation
- Build trace bundle collector:
  - Service logs
  - Temporal event histories
  - Execution event streams
  - Cost records
  - `manifest.json` with SHA, timestamp, runner info
- Wire `upload-artifact` in CI

**T05: First Smoke Test**
- One test: start the full stack, apply a simple workflow (`set` task only), run it, assert `COMPLETED`
- This proves the harness works end-to-end with no external dependencies
- Add `make test-integration` target to Makefile

**T06: CI Workflow — Offline Integration**
- Create `.github/workflows/ci.integration-offline.yaml`
- Runs on every PR push
- Linux runner, Testcontainers for MongoDB + Redis, Temporal dev server
- Bazel build of Java service (cache Bazel outputs across runs)
- No external API keys required
- Blocks merge

### Phase 2: Cross-Service Execution Canaries (Weeks 4-7)

> First real proof that the execution pipeline works.

**T07: Workflow Lifecycle Tests**
- Happy path: apply workflow → run → assert `PENDING → RUNNING → COMPLETED`
- Cancellation: start workflow → cancel mid-execution → assert terminal state
- Retry/error: workflow with failing task + retry policy → assert retry count + failure state
- Event stream: subscribe to execution events → assert ordered milestones

**T08: Agent Call Through LangGraph**
- Workflow with `agent_call` task routed to `agent-runner`
- Use Ollama (local LLM) — no external API keys
- Assert: execution phases, structured output, usage record exists
- Deterministic prompt: "Set the variable `result` to the value `hello-from-langgraph`"

**T09: Cursor Runtime CI Spike**
- **Before building the Cursor canary**: run a practical spike
- Create a minimal GitHub Actions workflow that:
  1. Installs Node.js and the Cursor SDK
  2. Attempts to create a local Cursor agent
  3. Runs a trivial prompt ("Create a file named test.txt with content 'hello'")
  4. Reports whether it works or fails
- Based on results, decide: Cursor canary in blocking PR lane (local runtime) vs. protected/nightly lane only (cloud runtime)
- Document findings in `design-decisions/`

**T10: Agent Call Through Cursor SDK**
- Workflow with `agent_call` task routed to `cursor-runner`
- File-write canary: "Create exactly one file named canary.json with exact JSON contents"
- Assert: file exists, content matches, Stigmer records usage, execution reaches terminal state
- Placed in blocking or nightly lane based on T09 findings

**T11: HITL Approval Test**
- Workflow with `human_input` task
- Assert workflow reaches waiting state
- Submit synthetic approval via workflow-execution API
- Assert correct resumption and completion
- Second test: send rejection, assert cancellation

### Phase 3: Task Family Expansion + Provider Lane (Weeks 8-11)

> Deepen task-kind coverage by family, add provider-backed canaries.

**T12: Task Family Matrix**

| Family | Task Kinds | Assertion Style |
|---|---|---|
| Pure state & schema | `set`, `transform`, `extract`, `validate` | Golden output, context schema validation |
| Control flow | `switch_case`, `for_each`, `fork` | Branch choice, fan-out/join semantics |
| Recovery | `try_catch`, `raise_error`, retry, timeout | Retry count, failure classification, compensation path |
| External I/O | `http_call` with local stub, `emit_event`/`listen` | Request shape, response mapping, event round-trip |
| Policy | `budget_guard`, `notification` with local sink | Budget block/allow, notification payload delivery |

**T13: Provider-Backed CI Lane**
- Create `.github/workflows/ci.integration-providers.yaml`
- Protected GitHub Actions environment: `provider-integration`
- Bootstrap token pattern: `CURSOR_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` as GitHub environment secrets
- Concurrency group: one run per branch
- Triggers: merge queue, `main` push, nightly schedule, manual dispatch

**T14: Provider Canaries**
- Cursor cloud artifact canary (nightly): create workspace file, verify artifact listing
- Anthropic/OpenAI canary (nightly): one `llm_call` task through real provider, assert structured output validates
- Per-test cost reporting: provider, model, tokens, estimated USD in JUnit custom properties

### Phase 4: Hardening (Weeks 12-14)

> Replay gates, flake management, observability, SDK smoke tests.

**T15: Temporal Workflow Replay CI Gate**
- On workflow-runner changes, download representative event histories
- Replay them in CI
- Fail on replay errors (catches non-deterministic workflow definition changes)

**T16: Flake Management**
- Quarantine lane: separate CI workflow for known flaky tests, non-blocking
- Nightly stress lane: repeat critical tests multiple times
- Dashboard metrics in GitHub job summaries: first-pass rate, p95 duration, cost per run

**T17: OpenTelemetry Instrumentation**
- Span tree: `test.run` → `stigmer.apply`/`stigmer.run` → gRPC spans → `temporal.workflow` → `stigmer.task` → `agent.session`
- Use OTel gRPC semantic conventions
- Export to trace bundle for failed tests

**T18: SDK Acceptance Smoke Tests**
- One Go SDK call through the full API surface
- One TypeScript SDK call
- One Python SDK call
- Assert: correct response, no schema drift

## Test Directory Structure

```
test/
├── integration/
│   ├── README.md
│   ├── go.mod
│   ├── go.sum
│   ├── harness/
│   │   ├── harness.go              # TestHarness: lifecycle, ports, services
│   │   ├── postgres.go             # Testcontainers Postgres setup
│   │   ├── temporal.go             # Temporal dev server bootstrap
│   │   ├── service_supervisor.go   # Start/stop Java + Go + Python + TS services
│   │   ├── fixture_deployer.go     # Apply agents/workflows via gRPC
│   │   ├── assertion_helpers.go    # Lifecycle, event stream, side effect assertions
│   │   ├── trace_bundle.go         # Collect logs, histories, events on failure
│   │   └── cost_tracker.go         # Per-test cost recording
│   │
│   ├── suite_test.go               # Test entry point, suite setup/teardown
│   │
│   ├── workflow_lifecycle_test.go   # T07: happy path, cancel, retry, events
│   ├── agent_langgraph_test.go     # T08: agent_call through agent-runner
│   ├── agent_cursor_test.go        # T10: agent_call through cursor-runner
│   ├── hitl_approval_test.go       # T11: human_input pause/resume/reject
│   │
│   ├── taskfamily_state_test.go    # T12: set, transform, extract, validate
│   ├── taskfamily_flow_test.go     # T12: switch_case, for_each, fork
│   ├── taskfamily_recovery_test.go # T12: try_catch, raise_error, retry
│   ├── taskfamily_io_test.go       # T12: http_call, emit_event, listen
│   ├── taskfamily_policy_test.go   # T12: budget_guard, notification
│   │
│   ├── canary_cursor_cloud_test.go # T14: Cursor cloud artifact canary
│   ├── canary_providers_test.go    # T14: Anthropic/OpenAI canary
│   │
│   ├── replay_test.go              # T15: Temporal workflow replay
│   ├── sdk_smoke_test.go           # T18: SDK acceptance smoke
│   │
│   └── testdata/
│       ├── workflows/              # Test workflow YAML definitions
│       ├── agents/                 # Test agent definitions
│       ├── golden/                 # Expected outputs for deterministic tests
│       └── histories/              # Captured Temporal event histories for replay
```

## Makefile Targets

```makefile
# New targets
test-integration:           ## Run offline integration tests (no API keys needed)
test-integration-providers: ## Run provider-backed integration tests (needs API keys)
test-integration-replay:    ## Run Temporal replay checks
test-integration-stress:    ## Run stress/flakiness detection suite
```

## CI Workflow Summary

| Workflow | Trigger | Requires API Keys | Blocks Merge |
|---|---|---|---|
| `ci.integration-offline.yaml` | Every PR push | No | Yes |
| `ci.integration-providers.yaml` | `main`, nightly, manual | Yes (GitHub env secrets) | No (advisory) |
| `ci.integration-replay.yaml` | workflow-runner changes | No | Yes |
| `ci.integration-stress.yaml` | Nightly schedule | Yes | No |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Java service requires MongoDB + Redis + Temporal + auth | High | Testcontainers for MongoDB/Redis, Temporal dev server, test Spring profile or auth bypass for Auth0/OpenFGA. Worth the upfront investment for realistic testing. |
| Cross-repo dependency (stigmer ↔ stigmer-cloud) | High | Pin to specific versions/branches. Test harness clones or references stigmer-cloud at a known commit. Alternatively, use pre-built Docker image of stigmer-service. |
| Bazel build of Java service adds CI build time | High | Cache Bazel outputs aggressively. Alternatively, pull a pre-built container image instead of building from source in CI. |
| Auth0/OpenFGA integration complicates test setup | Medium | Explore: (1) test Spring profile bypassing auth, (2) OpenFGA Testcontainer + mock JWT, (3) pre-seeded test API key. Decide in T03. |
| Cursor local runtime may not work on CI Linux runners | Medium | T09 spike resolves this empirically before building the canary. Fallback: cloud-only in nightly lane. |
| LLM-dependent tests are non-deterministic and expensive | Medium | Assert structure/side-effects/lifecycle, not prose. Keep provider canaries to 3-5 tests. Cost caps per lane. |
| Temporal dev server bootstrap adds test startup latency | Low | Session-scoped (one startup per suite, not per test). Typically 2-5 seconds. |
| Testcontainers MongoDB/Redis adds CI complexity | Low | Well-established pattern (n8n, Airflow). Testcontainers handles Docker lifecycle automatically. |

## Suggested Starting Point

Begin with **T02 (Delete Legacy E2E Tests)** and **T03 (Test Harness Core)** in the same batch. T02 is a clean slate operation. T03 is the foundation everything else builds on.

## Implementation Order

```
Phase 1 (Weeks 1-3):  T02 → T03 → T04 → T05 → T06
Phase 2 (Weeks 4-7):  T07 → T08 → T09 → T10 → T11
Phase 3 (Weeks 8-11): T12 → T13 → T14
Phase 4 (Weeks 12-14): T15 → T16 → T17 → T18
```

Each phase is independently valuable. Phase 1 alone replaces the broken legacy suite with a working harness. Phase 2 provides the highest confidence gain per engineer-week.

---

**Please review this plan and provide your feedback. I will not proceed to execution until you explicitly approve.**
