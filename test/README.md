# Tests

The test surfaces of the Stigmer platform that live outside a package's own unit tests.

| Suite | Directory | What it tests | Runs |
|-------|-----------|---------------|------|
| **Conformance** | `conformance/` | The gRPC API contract, implementation-agnostic: the same suites run against the OSS `stigmer-server` (`local*` targets, booted from source) and against the cloud composition (`cloud*` targets, pre-provisioned by stigmer-cloud's readout recipe). Class A (CRUD) and the execution class (runner-backed), which since stigmer#1022 also carries the runner-behavior facets the Go offline suite used to hold — HITL and file review, structured output, sub-agents, memory retrieval, provider-error attribution, the LLM-backed workflow tasks — as scripted-turn arms on the same harness. The cross-edition instrument. | `make test-conformance`, `make test-conformance-execution`; the `cloud*` targets from stigmer-cloud |
| **E2E (Playwright)** | `e2e/` | Browser UI tests — smoke, functional, and interactive tiers | see `e2e/` |
| **Extension consumer** | `extension-consumer/` | A clean-room consumer of the `@stigmer/server` extension registry | `make test-extension-consumer` |

## The test standard

Every test in this repository and in stigmer-cloud belongs to one layer. The layer decides where the file lives, what its name may say, and what runs it. Go (`_test.go` beside the source), Java (`src/test/java`), Python (`tests/`) and Rust (inline `#[cfg(test)]`) keep their languages' layouts and use the same layer names; the table is the TypeScript and Node layout.

| Layer | Proves | Lives in | Name | Run by |
|---|---|---|---|---|
| unit | one module, or one wired slice, inside the test process: no external service. An in-process loopback server, local `git`, and child processes the test starts itself are allowed | `<package>/src/**/__tests__/` | `*.test.ts(x)` | the package's `npm test` (`make test-server`, `make test-runner`) |
| integration | a module against a real service the gate provides | the same `__tests__` directories | `*.<service>.test.ts`; two services in alphabetical order (`*.openfga.postgres.test.ts`) | the same |
| composed | the assembled server in-process with its real services, through its extension points | the same `__tests__` directories | `*.composed.test.ts` | the same |
| browser | a component that needs real layout, paint or pixels | the same `__tests__` directories | `*.browser.test.ts(x)` | the package's browser config (`npm run test:a11y -w @stigmer/react`) |
| contract | every assembled edition keeps the API's promises | `test/conformance/src/suites*/` | `*.conformance.test.ts` | `make test-conformance`, `make test-conformance-execution` |
| e2e | a person's journey through an app in a browser | `test/e2e/tests/` (the console), `site/e2e/` (the site) | `*.spec.ts` | `make test-e2e*`, `make test-demos` |
| install | a shipped artifact installs, runs an agent, upgrades | `test/install/` (today `scripts/smoke-*.mjs` and `scripts/rehearse-upgrade.mjs`) | one script per artifact | `make smoke-<artifact>`, `make rehearse-upgrade ARTIFACT=<artifact>` |
| load | behaviour under volume, on its own cadence | beside the code | `*.load.test.ts`, collected only by the package's `vitest.load.config.ts` | `npm run test:load`, by hand |
| live | real providers and models, budget-capped | beside the code | `*.live.test.ts` | by hand or at release |
| synthetic | production works now | stigmer-cloud `_ops/probes/*-smoke` | one probe per journey | on a schedule |
| tooling | a plain-Node repository script (`*.mjs`) | beside the script | `*.test.mjs` | `node --test`: `npm run test:scripts`, or the package's `test:scripts` |

Make targets and CI lanes keep the names they have (by package, artifact or cadence); the "Run by" column is the map from layer to entry point.

### Names

The name of a test file is read at its last dotted segments before `.test` or `.spec`. A segment there is either a reserved word, which must be true, or a topic, which is free (`workflow.undo.test.tsx`, `list-read-scope.load-tenancy.test.ts`).

- **Services**, the ones a gate provides: `postgres`, `openfga`, `vault` (OpenBAO), `temporal`. A file that reaches one carries its word, and a file that carries one reaches it. Reaching is a value use of the service's entry point, in the file or in a test helper it imports: a call of `testDatabaseAdminUrl` or `createTestDatabase`, a `gateDependency` call for the service's variable, or a value import of `@temporalio/testing`. A type-only import or a mention in a string reaches nothing.
- **Layers**: `composed`, `conformance`, `browser`, `load`, `live`. A layer word goes only where its layer lives. A `composed`, `conformance`, `load` or `live` file may use any service without naming it.
- **Retired**, and refused: `integration`, `e2e`, `contract`, `smoke`, `measure`, `a11y`, `layout`. Each meant something different in different places. A test that used to say `integration` is unit, integration or composed by the table; an accessibility audit is `<topic>.a11y.browser.test.tsx`.

`git`, `process` and `docker` are not words: every machine that runs the tests has the first two, and no gate provides the third, so the word could promise a run that never happens.

### Placement

- A TypeScript test sits in a `__tests__` directory beside the module it tests. The suites' own trees are the exception: `test/conformance/src/suites*/` and `test/e2e/tests/`.
- A `*.spec.ts` sits only under `test/e2e/tests/` or `site/e2e/`.
- A `*.test.mjs` sits beside the script it tests.
- Machinery that two or more suites use lives once, in `test/support`: it imports only `node:*` and its own files, in TypeScript that Node runs without a build, so the install layer can load it with no install. A suite's own machinery stays in the suite.

### How it is enforced

`scripts/test-integrity.mjs` checks every rule above on the tree, in the `Integrity` check on every pull request and in stigmer-cloud's merge gate. Files that do not yet follow the standard are listed in `scripts/test-layout-baseline.txt`, one rule and path per line. A violation not listed there is refused, a line added to the list is refused, and a line whose file now passes is refused as stale, so the list only shrinks. It is deleted when it is empty.

There is no Go test harness any more. The five Go suites under `test/integration*` booted the retired Java service and retired with it on 2026-09-10: the four Java-only suites in stigmer#1024, their coverage accounted for row by row in the conformance suite; the offline runner suite in stigmer#1022, ported arm for arm into the conformance execution class; and the shared harness deleted with it in stigmer#1031. The follow-ups that retirement left open are tracked on stigmer#988.

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
