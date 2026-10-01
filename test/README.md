# Tests

The test surfaces of the Stigmer platform that live outside a package's own unit tests.

| Suite | Directory | What it tests | Runs |
|-------|-----------|---------------|------|
| **Conformance** | `conformance/` | The gRPC API contract, implementation-agnostic: the same suites run against the OSS `stigmer-server` (`local*` targets, booted from source) and against the cloud composition (`cloud*` targets, pre-provisioned by stigmer-cloud's readout recipe). Class A (CRUD) and the execution class (runner-backed), which since stigmer#1022 also carries the runner-behavior facets the Go offline suite used to hold — HITL and file review, structured output, sub-agents, memory retrieval, provider-error attribution, the LLM-backed workflow tasks — as scripted-turn arms on the same harness. The cross-edition instrument. | `make test-conformance`, `make test-conformance-execution`; the `cloud*` targets from stigmer-cloud |
| **E2E (Playwright)** | `e2e/` | Browser UI tests — smoke, functional, and interactive tiers | see `e2e/` |
| **Extension consumer** | `extension-consumer/` | A clean-room consumer of the `@stigmer/server` extension registry | `make test-extension-consumer` |

There is no Go test harness any more. The five Go suites under `test/integration*` booted the retired Java service and retired with it on 2026-09-10: the four Java-only suites in stigmer#1024, their coverage accounted for row by row in the conformance suite; the offline runner suite in stigmer#1022, ported arm for arm into the conformance execution class; and the shared harness deleted with it in stigmer#1031. The follow-ups that retirement left open are tracked on stigmer#988.

## The rules every test keeps

A green run must mean the tests ran. Every test in this repository keeps five rules:

1. A test that cannot run fails, or skips with its reason printed. It never passes.
2. A missing dependency may skip a test only outside the gate. The gate provides every dependency. Inside it (`STIGMER_TEST_GATE=1`), the helpers for the services it provisions throw instead of skipping: Postgres (`testDatabaseAdminUrl()`) and the runner's Temporal paths (`IN_TEST_GATE`).
3. A test is never retried into green. A flaky test is quarantined by name, against an open issue, until it is fixed: its skip carries `// quarantined: <repo>#<issue>` on the line above, and the pull request that adds it declares `Quarantine:` in its body. Every later pull request re-checks that the issue the marker names is still open.
4. A change that adds or changes behaviour changes the tests that pin it. A refactor that changes no behaviour keeps them passing as they are.
5. The gate's own files change only with a maintainer's explicit approval: the workflows under `.github/workflows/`, the vitest and Playwright configs, `scripts/ci-lanes.mjs`, `scripts/test-integrity.mjs`, `scripts/review-verdict.mjs`, the review brief in `.agents/skills/review-pull-request/SKILL.md`, and this section.

What holds them:

- `scripts/test-integrity.mjs`, as the required `Test integrity` check, refuses the ways a suite goes quiet without going red. On every tree: a focused `.only`, a valueless `return` in a test body, a config that retries, passes with no tests or allows `.only`. On a pull request, against its base: a deleted case, a new skip, and a weakened RPC waiver. Its header has the full rules. Its run-report rule, which refuses a run-time skip nothing explains, is not yet run by this repository's gate (#1610).
- An exception is declared in the pull request's body, one line each: `Test-removal: <case or file> -- <reason>`, `Quarantine: <case or file> -- <repo>#<issue>`, `Skip: <case or file> -- <why it does not apply there>`, `RPC-waiver: <Service>.<method> -- <why no conformance test pins it>`. A declaration makes the exception loud; it does not make it right.
- `Gate` (every lane the change needs, with `STIGMER_TEST_GATE=1`), `Test integrity` and `Review verdict` are required checks on `main`, through the merge queue, with no bypass.
- A reviewer that did not write the pull request reads the change and every declaration, and `Review verdict` waits for its current approve (`.agents/skills/review-pull-request/SKILL.md`). Rule 4 is held by that review: the brief judges the tests a change carries.
- Rule 5 is held only in part. The review treats an unjustified weakening of a required check's workflow, `scripts/review-verdict.mjs` or the brief as blocking, and the integrity tool refuses the config settings above. Nothing yet asks for a maintainer's approval on the other files it lists (#1611).

## The conformance suite

`conformance/README.md` is the reference. In one paragraph: every suite file boots its own OSS server for the `local` targets (cheap), and connects to a pre-provisioned environment for the `cloud` targets (the `STIGMER_CONFORMANCE_CLOUD_*` contract in `conformance/src/harness/cloud-env.ts`). The `cloud` targets' provisioner is stigmer-cloud's readout recipe (`backend/services/stigmer-server/spike/README.md` there), which boots the composition on a hermetic substrate, starts the cloud-capability fixtures (`npm run fixtures:serve -w @stigmer/conformance`), mints the identities and exports the contract; this repository boots no cloud edition.

## Prerequisites

| Dependency | Purpose | Install |
|------------|---------|---------|
| Node (`.nvmrc`) | The conformance suite, the runner, the fixtures | `nvm use` |
| `temporal` CLI | The execution class (a dev server backs the runner) | `make install-temporal-cli` (writes `~/bin/temporal`, the version `stigmer up` runs) |
| `git` | The execution class's file-review suites (a capture-mode workspace is a real work tree) | preinstalled on macOS and `ubuntu-latest` |

## CI workflows

- `ci.conformance.yaml` — Class A on the `local` targets (SQLite and Postgres drivers) plus the harness unit lane.
- `ci.conformance-execution.yaml` — the execution class on `local-execution`.
- `ci.e2e*.yaml` — Playwright.

## Test output

Each suite writes under its own `.test-output*/` directory (gitignored).
