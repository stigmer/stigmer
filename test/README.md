# Tests

The test surfaces of the Stigmer platform that live outside a package's own unit tests.

| Suite | Directory | What it tests | Runs |
|-------|-----------|---------------|------|
| **Conformance** | `conformance/` | The gRPC API contract, implementation-agnostic: the same suites run against the OSS `stigmer-server` (`local*` targets, booted from source) and against the cloud composition (`cloud*` targets, pre-provisioned by stigmer-cloud's readout recipe). Class A (CRUD) and the execution class (runner-backed). The cross-edition instrument. | `make test-conformance`, `make test-conformance-execution`; the `cloud*` targets from stigmer-cloud |
| **Deterministic offline (runner)** | `integration-offline/` | 74 arms that drive the runner with recorded LLM turns — HITL, structured output, file review, subagents, memory retrieval, provider-error attribution — through a booted backend. **Dormant since 2026-09-10**: the backend it booted was the Java `stigmer-service`, retired that day; it runs again once the shared harness boots the OSS `stigmer-server` instead (the re-point, stigmer#1022). | `make test-integration-offline` (after the re-point) |
| **E2E (Playwright)** | `e2e/` | Browser UI tests — smoke, functional, and interactive tiers | see `e2e/` |
| **Extension consumer** | `extension-consumer/` | A clean-room consumer of the `@stigmer/server` extension registry (DD-005/DD-006) | `make test-extension-consumer` |

`integration/` holds only the shared Go harness (`harness/`), its test data and tools now. The four Go suites that tested the Java service — core (`integration/*_test.go`, 130 files), `integration-security`, `integration-session-routing`, `integration-wfexec-routing` — were deleted with it on 2026-09-10 (stigmer-cloud DD-013). Their coverage accounting is E1's `go-suite-coverage-diff.md` (stigmer-cloud, `_projects/.completed/20260906.04.sp.cloud-capability-conformance-suites/`): what each file asserted maps to a conformance suite, an E1 inventory row, a composition unit, or retired with Java's behavior; the three items it left for the owner are tracked on stigmer#988.

## The conformance suite

`conformance/README.md` is the reference. In one paragraph: every suite file boots its own OSS server for the `local` targets (cheap), and connects to a pre-provisioned environment for the `cloud` targets (the `STIGMER_CONFORMANCE_CLOUD_*` contract in `conformance/src/harness/cloud-env.ts`). The `cloud` targets' provisioner is stigmer-cloud's readout recipe (`backend/services/stigmer-server/spike/README.md` there), which boots the composition on a hermetic substrate, starts the cloud-capability fixtures (`npm run fixtures:serve -w @stigmer/conformance`), mints the identities and exports the contract; this repository boots no cloud edition. The `TargetProfile.implementation` axis names whose code answers (`stigmer-server` is its one member since the Java service retired).

## Prerequisites

| Dependency | Purpose | Install |
|------------|---------|---------|
| Node (`.nvmrc`) | The conformance suite, the runner, the fixtures | `nvm use` |
| `temporal` CLI | The execution class (a dev server backs the runner) | `curl -sSf https://temporal.download/cli.sh \| sh` |
| Go 1.25+ | The offline runner suite's harness | `brew install go` |
| Docker | The offline suite's Testcontainers infra | Docker Desktop / Colima |

## CI workflows

- `ci.conformance.yaml` — Class A on the `local` targets (SQLite and Postgres drivers) plus the harness unit lane.
- `ci.conformance-execution.yaml` — the execution class on `local-execution`.
- `ci.integration-offline.yaml` — dormant (manual dispatch only) until the offline suite's re-point.
- `ci.e2e*.yaml` — Playwright.

## Test output

Each suite writes under its own `.test-output*/` directory (gitignored).
