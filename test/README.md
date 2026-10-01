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
| contract | every assembled edition keeps the API's promises | `test/conformance/src/suites*/` | `*.conformance.test.ts`; `*.harness.test.ts` for a suite that proves the harness itself is wired (it boots the same stack and asserts no domain contract) | `make test-conformance`, `make test-conformance-execution` |
| e2e | a person's journey through an app in a browser | `test/e2e/tests/` (the console), `site/e2e/` (the site) | `*.spec.ts` | `make test-e2e*`, `make test-demos` |
| install | a shipped artifact installs, runs an agent, upgrades | `test/install/` (`smoke-<artifact>.mjs`, `rehearse-upgrade.mjs`; their drivers in `test/install/lib/`) | one script per artifact | `make smoke-<artifact>`, `make rehearse-upgrade ARTIFACT=<artifact>` |
| load | behaviour under volume, on its own cadence | beside the code | `*.load.test.ts`, collected only by the package's `vitest.load.config.ts` (`backend/services/stigmer-server` has one, as does stigmer-cloud's composition) | `npm run test:load`, by hand |
| live | real providers and models, within a spend bound: a fixed list of short cases, each under a cost cap or a token cap | beside the code | `*.live.test.ts`, collected only by the package's `vitest.live.config.ts` (`backend/services/runner` has one) | `npm run test:live` or `make test-live`, by hand |
| synthetic | production works now | stigmer-cloud `_ops/probes/*-smoke` | one probe per journey | on a schedule |
| tooling | a plain-Node repository script (`*.mjs`) | beside the script | `*.test.mjs` | `node --test`: `npm run test:scripts`, or the package's `test:scripts` |

Make targets and CI lanes keep the names they have (by package, artifact or cadence); the "Run by" column is the map from layer to entry point.

### Names

The name of a test file is read at its last dotted segments before `.test` or `.spec`. A segment there is either a reserved word, which must be true, or a topic, which is free (`workflow.undo.test.tsx`, `list-read-scope.load-tenancy.test.ts`).

- **Services**, the ones a gate provides: `postgres`, `openfga`, `vault` (OpenBAO), `temporal`. A file that reaches one carries its word, and a file that carries one reaches it. Reaching is a value use of the service's entry point, in the file or in a test helper it imports: a call of `testDatabaseAdminUrl` or `createTestDatabase`, a `gateDependency` call for the service's variable, or a `TestWorkflowEnvironment.createLocal()` or `createTimeSkipping()` that starts a Temporal test server (`MockActivityEnvironment` starts none). A type-only import or a mention in a string reaches nothing. Reaching is judged per module, not per imported name: importing anything from a helper that reaches a service reaches it, so a helper that mixes the two is split rather than named around.
- **Layers**: `composed`, `conformance`, `browser`, `load`, `live`. A layer word goes only where its layer lives. A `composed`, `conformance`, `load` or `live` file may use any service without naming it, but may not name one it never reaches.
- **Retired**, and refused as the last word or right before the service and layer words: `integration`, `e2e`, `contract`, `smoke`, `measure`, `a11y`, `layout`. The one exception is `a11y` or `layout` before `browser`, which names what a browser test audits. Each meant something different in different places. A test that used to say `integration` is unit, integration or composed by the table; an accessibility audit is `<topic>.a11y.browser.test.tsx`.

`git`, `process` and `docker` are not words: every machine that runs the tests has the first two, and no gate provides the third, so the word could promise a run that never happens.

### Placement

- A TypeScript test sits in a `__tests__` directory beside the module it tests. The suites' own trees are the exception: `test/conformance/src/suites*/` and `test/e2e/tests/`.
- A `*.spec.ts` sits only under `test/e2e/tests/` or `site/e2e/`.
- A `*.test.mjs` sits beside the script it tests.
- Machinery that two or more suites use lives once, in `test/support`: it imports only `node:*` and its own files, in TypeScript that Node runs without a build, so the install layer can load it with no install. A suite's own machinery stays in the suite.
- The install layer lives in `test/install`: plain-Node scripts that run straight after a checkout, with no install, importing only `node:*`, their own files, `test/support` by relative path, and the release scripts under `scripts/`.

### How it is enforced

`scripts/test-integrity.mjs` checks, on the tree and in the `Test integrity` check on every pull request: the retired words, where each layer word may go, that every service word is true both ways, that a TypeScript test sits in `__tests__` and a spec in its homes, and what `test/support` imports. The other conventions above (the order of two service words, where a `*.test.mjs` sits, the `conformance` word inside the suites, what the install layer imports) are read in review. Files that do not yet follow the standard are listed in `scripts/test-layout-baseline.txt`, one finding per line: its rule, its path, and the word, service or import it is about. A violation not listed there is refused, a line added to the list is refused (except one that follows its file through a rename, with the same rule and detail), and a line whose file now passes is refused as stale, so the list only shrinks. In this repository it is empty, and stays as an empty file so that any line added to it is refused.

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
