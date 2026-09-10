# Tests

The test surfaces of the Stigmer platform that live outside a package's own unit tests.

| Suite | Directory | What it tests | Runs |
|-------|-----------|---------------|------|
| **Conformance** | `conformance/` | The gRPC API contract, implementation-agnostic: the same suites run against the OSS `stigmer-server` (`local*` targets, booted from source) and against the cloud composition (`cloud*` targets, pre-provisioned by stigmer-cloud's readout recipe). Class A (CRUD) and the execution class (runner-backed), which since stigmer#1022 also carries the runner-behavior facets the Go offline suite used to hold — HITL and file review, structured output, sub-agents, memory retrieval, provider-error attribution, the LLM-backed workflow tasks — as scripted-turn arms on the same harness. The cross-edition instrument. | `make test-conformance`, `make test-conformance-execution`; the `cloud*` targets from stigmer-cloud |
| **Deterministic offline (runner)** | `integration-offline/` | The Go predecessor of the execution class's runner-behavior facets. Its 78 arms were ported to TypeScript arm for arm (stigmer#1022; the accounting is stigmer-cloud entry `20260910.02`'s `T01_1_arm-disposition.md`) and the suite is deleted together with the Go harness in the follow-up PR that closes #1022. | none — dormant until deleted |
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
| `git` | The execution class's file-review suites (a capture-mode workspace is a real work tree) | preinstalled on macOS and `ubuntu-latest` |
| Go 1.25+ | The offline runner suite's harness | `brew install go` |
| Docker | The offline suite's Testcontainers infra | Docker Desktop / Colima |

## CI workflows

- `ci.conformance.yaml` — Class A on the `local` targets (SQLite and Postgres drivers) plus the harness unit lane.
- `ci.conformance-execution.yaml` — the execution class on `local-execution`.
- `ci.integration-offline.yaml` — dormant (manual dispatch only) until the offline suite's re-point.
- `ci.e2e*.yaml` — Playwright.

## Test output

Each suite writes under its own `.test-output*/` directory (gitignored). The conformance suite prints per-target report lines readouts grep for (`tracked deviation …`, `tracked race …`).
