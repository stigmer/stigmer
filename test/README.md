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
| live | real providers and models, within a spend bound: a fixed list of short cases, capped where the product has a cap (an execution's cost cap, a call's token cap) | beside the code | `*.live.test.ts`, collected only by the package's `vitest.live.config.ts` (`backend/services/runner` has one) | `npm run test:live` or `make test-live`, by hand; `ci.live.yaml` after each release |
| synthetic | production works now | stigmer-cloud `_ops/probes/*-smoke` | one probe per journey | on a schedule |
| tooling | a plain-Node repository script (`*.mjs`) | beside the script | `*.test.mjs` | `node --test`: `npm run test:scripts`, or the package's `test:scripts` |

Make targets and CI lanes keep the names they have (by package, artifact or cadence); the "Run by" column is the map from layer to entry point.

Coverage is measured from three layers: unit, integration and composed, which is the package's own vitest suite (`npm test`, or `test:unit` in the two packages named below), whose config collects it. The other layers do not count. Contract, e2e and install tests drive a spawned server or a shipped artifact. Browser, load and live tests run under configs of their own. A tooling test runs a repository script, which is not a package. So a server line that only the conformance suite reaches counts as never run. The test that would count it is a composed one (`*.composed.test.ts`). The rules are under "What holds them" below.

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
2. A missing dependency may skip a test only outside the gate. The gate provides every dependency. Inside it (`STIGMER_TEST_GATE=1`), the helpers for the services it provisions throw instead of skipping: Postgres (`testDatabaseAdminUrl()`) and the runner's Temporal paths (`IN_TEST_GATE`). The live class keeps the same rule for its provider keys: a suite skips through `liveSecret(...)` written in its skip condition, and inside the live workflow (`STIGMER_LIVE=1`) a missing key throws. A live test that calls a model pins it and runs under the product's cap wherever the product has one (an execution's cost cap, a call's token cap), and asserts structure and side effects, never a model's words.
3. A test is never retried into green. A flaky test is quarantined by name, against an open issue, until it is fixed: its skip carries `// quarantined: <repo>#<issue>` on the line above, and the pull request that adds it declares `Quarantine:` in its body. Every later pull request re-checks that the issue the marker names is still open.
4. A change that adds or changes behaviour changes the tests that pin it. A refactor that changes no behaviour keeps them passing as they are.
5. The gate's own files change only with a maintainer's explicit approval: the workflows under `.github/workflows/`, the vitest and Playwright configs, `scripts/ci-lanes.mjs`, `scripts/test-integrity.mjs`, `scripts/test-coverage.mjs` and its floors in `test/coverage-floors.json`, `scripts/review-verdict.mjs`, the review brief in `.agents/skills/review-pull-request/SKILL.md`, the weekly mutation sweep's `scripts/mutation-sweep.mjs` and `test/mutation-targets.json`, and this section.

What holds them:

- `scripts/test-integrity.mjs`, as the required `Test integrity` check, refuses the ways a suite goes quiet without going red. On every tree: a focused `.only`, a valueless `return` in a test body, a config that retries, passes with no tests or allows `.only`. On a pull request, against its base: a deleted case, a new skip, a weakened RPC waiver, and a lowered or removed coverage floor. Its header has the full rules. Its run-report rule, which refuses a run-time skip nothing explains, is not yet run by this repository's gate (#1610).
- An exception is declared in the pull request's body, one line each: `Test-removal: <case or file> -- <reason>`, `Quarantine: <case or file> -- <repo>#<issue>`, `Skip: <case or file> -- <why it does not apply there>`, `RPC-waiver: <Service>.<method> -- <why no conformance test pins it>`, `Coverage-drop: <package dir> -- <why its floor falls>` (a floor lowered or removed in `test/coverage-floors.json`). A declaration makes the exception loud; it does not make it right.
- `scripts/test-coverage.mjs`, as `Gate`'s `Coverage` job, refuses new code no test runs and a package whose tests run less of it than its floor allows. It reads what each package's own suite measured in the lanes (the three layers above) and reports each finding by file and line, or by package:
  - `unrun`: a line the change adds to a measured package's source that no test ran. A statement that spans several lines counts when any of them was added. The way out is a test. For a line no test can reach, the way out is the coverage provider's ignore hint with its reason after `--`, for example `/* v8 ignore next -- @preserve: the socket closes before a test can observe it */`. In TypeScript and JSX an `if`, `else` or `next` hint must carry `@preserve`, or the transform strips it and it ignores nothing.
  - `ignore-reason`: a hint the change adds with no reason, or one the transform would strip. `ignore file` is always refused: a module left out of its package's figures belongs in the vitest config's `exclude`.
  - `unmeasured`: a change to the source of a package with a floor, in a run that did not measure that package, so its new lines cannot be judged. `Gate` measures every package a change touches, so locally it means one of them was left out of the command below.
  - `floor`: a package below its floor in `test/coverage-floors.json`. A floor is the lowest share of its lines and branches the package's tests may run, and the fewest cases that may pass.
  - `no-floor`: a measured package with no entry. A new package adds its own entry: the figures the finding prints, less the file's `margin`, rounded down to one decimal place.
  - `floor-unmeasured`: a floor the change moves for a package the run did not measure. A change to the floors file runs every package's suite, so a new figure is always judged against a real run.
  - `mismatch`: one file measured twice with different statements or branches (two configs, or two versions of the source), so the runs cannot be merged.

  The floors only rise. A maintainer lifts them at the weekly release with `--raise`, over a dispatched `Gate` run, which runs every lane and every package. A pull request may raise its own package's floor early. Keep the new figure at least the margin below the `• measured` figure its `Coverage` report prints: the tool accepts any floor up to the measurement, but two runs of one commit can differ slightly, so a floor at the bare measurement can fail an unrelated pull request later. Lowering one takes two edits in the same pull request: the figure in `test/coverage-floors.json`, and a `Coverage-drop:` line in the body. Removing a test from a package at its case floor needs both, beside the `Test-removal:`, since the case margin is 0: the `cases` figure is lowered, and the drop declared. The tool's header has the full rules.

  To see a refusal before pushing, measure each package the change touches and judge it against the base:

  ```bash
  (cd <package> && npm test -- --coverage.enabled --coverage.reportsDirectory=coverage/v8 --reporter=default --reporter=json --outputFile.json=coverage/report.json)
  node scripts/test-coverage.mjs --floors test/coverage-floors.json --input <package>/coverage --base origin/main
  ```

  A few caveats about running it locally:
  - Two packages run another command in place of `npm test -- <flags>`: `site` runs `yarn test:unit <flags>` (yarn takes the flags with no `--`), and `test/conformance` runs `npm run test:unit -- <flags>`.
  - Run vitest in the package as above, or pass `--force` to `node scripts/turbo-set.mjs`. Otherwise a turbo cache hit runs no tests and leaves the last run's coverage on disk.
  - A suite that needs a service the machine lacks skips outside the gate (rule 2). Its lines then read as unrun, and a floor can read low. The gate provides every service, so its run gives the verdict.
- `Gate` (every lane the change needs, with `STIGMER_TEST_GATE=1`), `Test integrity` and `Review verdict` are required checks on `main`, through the merge queue, with no bypass.
- A reviewer that did not write the pull request reads the change and every declaration, and `Review verdict` waits for its current approve (`.agents/skills/review-pull-request/SKILL.md`). Rule 4 is held by that review and by `Coverage` together. `Coverage` proves the change's new lines ran under a test, and the brief judges whether those tests check what the change does.
- Rule 5 is held only in part. The review treats an unjustified weakening of a required check's workflow, `scripts/review-verdict.mjs`, the brief, or the scripts and data `Gate` runs from the pull request's own tree (`scripts/test-coverage.mjs` and `test/coverage-floors.json` among them) as blocking. The integrity tool refuses the config settings above and an undeclared lowering of a floor. Nothing yet asks for a maintainer's approval on the other files it lists (#1611).

## The weekly mutation sweep

Coverage says a test ran a line. It does not say the test would notice the line breaking. Every Monday, `.github/workflows/mutation-sweep.yaml` plants small changes, one at a time, in the code that decides access, money and the engine's choices (the targets in `test/mutation-targets.json`): a flipped comparison, `&&` for `||`, an emptied function, a blanked string. It runs every test that imports the changed file. Each change no test noticed is applied again for real, as time allows, to confirm it; one not yet re-checked is marked so. Then it keeps one issue per target, labelled `mutation-sweep`, listing what is left. `scripts/mutation-sweep.mjs` has the mechanism. The sweep never blocks a merge: it reports.

- **A finding is closed by a test** that fails when the code is changed that way. When a change truly makes no difference (two ways of writing the same thing), the line above it carries Stryker's comment with the reason after a colon, for example `// Stryker disable next-line EqualityOperator: the count never equals the cap; the cap is checked first`. Review judges the reason as it judges a skip. The sweep lists a disable comment that gives no reason in its target's issue.
- **To check a fix,** sweep the one file with the command its issue prints, from the repository root. It needs the installs the workflow's job makes (`make build-ts-stubs`, then the target package's `npm ci`, which `make test-server` and `make test-runner` leave in place), and for a server target a Postgres (`make postgres-dev`, then its `TEST_DATABASE_URL`). `--only` writes beside the weekly report, never over it, and publishes nothing.
- **A change to the sweep** (the script, the targets file or the workflow) runs, on its pull request, every target's first unchanged test run under Stryker, and one file's sweep end to end, ending with the issue it would write. Removing a target, or narrowing its files, needs its reason in the pull request's body. A removed target's issue is closed by the next run.
- **A pull request that moves Stryker or vitest in a target's package** (`backend/services/stigmer-server`, `backend/services/runner`) is not checked that way, because lockfiles are not among the workflow's paths. Its author dispatches the sweep on the branch, `gh workflow run mutation-sweep.yaml --ref <branch>`. That sweeps every target from main's last state and publishes nothing. The body quotes the run.

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
