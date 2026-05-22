# Integration Tests

This directory contains the Go integration test suites for the Stigmer platform.
Each suite is a separate Go module with its own `TestMain` that configures the
Java service (`stigmer-service`) differently.

## Suites

| Suite | Directory | What it tests |
|-------|-----------|---------------|
| **Core integration** | `integration/` | Agents, workflows, sessions, auth, FGA, SDK, MCP, billing, seedpack |
| **Security** | `integration-security/` | Production JWT auth chain, federated IdP, PlatformClient tokens |
| **Session routing** | `integration-session-routing/` | Per-session Temporal task queue routing (`ActivityRouting: session`) |
| **WfExec routing** | `integration-wfexec-routing/` | Per-execution workflow activity routing (`WorkflowActivityRouting: execution`) |
| **E2E (Playwright)** | `e2e/` | Browser UI tests — smoke, functional, and interactive tiers |

The suites must remain separate Go modules because each configures the Java
service with different routing modes and security settings that cannot coexist
in a single process.

## Quick Start

### Run all offline suites

```bash
make test-integration-all
```

### Run all suites including provider-backed tests

```bash
make test-integration-all PROVIDERS=true
```

Provider-backed tests require API keys (`ANTHROPIC_API_KEY`, `CURSOR_API_KEY`).
When keys are not set, individual tests skip gracefully via `t.Skip()`.

### Run a single suite

```bash
make test-integration                          # Core (offline)
make test-integration-providers                # Core (provider-backed)
make test-integration-security                 # Security
make test-integration-session-routing          # Session routing (offline)
make test-integration-session-routing-providers # Session routing (Cursor E2E)
make test-integration-wfexec-routing           # WfExec routing (offline)
```

### Run a specific test

```bash
make -C test/integration test-subset TEST_RUN='TestWorkflowData'
```

## Prerequisites

| Dependency | Purpose | Install |
|------------|---------|---------|
| Go 1.22+ | Test runner | `brew install go` |
| Java 21 | `stigmer-service` fat JAR | `brew install openjdk@21` |
| Docker | Testcontainers (Mongo, Redis, OpenFGA, MinIO, Jaeger) | Docker Desktop |
| Temporal CLI | Ephemeral dev server | `brew install temporal` |
| gotestsum | Test output formatting, rerun, JUnit XML | `go install gotest.tools/gotestsum@latest` |
| Node.js 22 | Unified runner build (session-routing, wfexec-routing) | `brew install node@22` |
| OpenFGA CLI | FGA model loading (optional) | `go install github.com/openfga/cli/cmd/fga@latest` |

The `stigmer-service` fat JAR is built from the `stigmer-cloud` sibling repo:

```bash
cd ../stigmer-cloud && bazel build //backend/services/stigmer-service:stigmer_service_fatjar
```

Or set `STIGMER_SERVICE_JAR` to point to an existing JAR.

## Offline vs Provider Classification

**Offline** tests exercise the platform infrastructure without external API
calls. They run in CI on every PR and require no secrets.

**Provider-backed** tests make real calls to LLM providers (Anthropic, OpenAI)
or Cursor. They are gated by API key availability:

- Tests check for `ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, etc. at runtime
- Missing keys cause `t.Skip("...not set")` with a descriptive message
- The Makefile provider targets auto-fetch keys from Planton when available
- In CI, provider tests run only via manual `workflow_dispatch`

## Shared Harness

All four Go suites import `test/integration/harness/`, which provides:

- `TestHarness` — Testcontainers lifecycle (Mongo, Redis, Temporal, OpenFGA, MinIO, Jaeger)
- `StartJavaService` — Launches the fat JAR with configurable env
- `FindServiceJar` — Locates the JAR via env var or sibling-repo path
- `SeedDefaultAgent`, `ProvisionTestBillingAccount` — Common test data setup
- `FixtureDeployer` — Workflow/execution lifecycle with cleanup tracking
- `AgentFactory` — Builder pattern for test agent specs
- `AgentExecutionWaiter` — Polls execution status with timeout
- `MockHTTP`, `McpHttpServer` — Stub servers for HTTP and MCP testing
- `MockJWKSServer` — In-process OIDC/JWKS for security testing

## CI Workflows

| Workflow | Trigger | Suites |
|----------|---------|--------|
| `ci.integration-offline` | PR/push, weekly | All 4 offline suites |
| `ci.integration-providers` | Manual dispatch | Core providers + session routing Tier 3 |
| `ci.integration-stress` | Weekly | Core offline 3x (flake detection) |

## Test Output

Each suite writes artifacts to its own output directory:

| Suite | Output dir |
|-------|-----------|
| Core | `integration/.test-output/` |
| Security | `integration-security/.test-output-security/` |
| Session routing | `integration-session-routing/.test-output-session-routing/` |
| WfExec routing | `integration-wfexec-routing/.test-output-wfexec-routing/` |

Each directory contains:
- `junit.xml` — JUnit test report
- `test-output.json` — gotestsum JSON event stream
- `logs/` — Java service and runner process logs
