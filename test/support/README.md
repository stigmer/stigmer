# Test support

The test machinery two or more suites share, in one place (`test/README.md`, "The test standard"). Each component is one module under `src/`. Import it as `@stigmer/test-support/<module>` from a workspace package, or by its relative `.ts` path from a script that runs with no install.

| Module | What it is |
|---|---|
| `ts-build` | Builds the TypeScript server from source, once per run |
| `server-process`, `ports` | Spawns one hermetic server on free ports, or on a fixed `port` (the e2e console's 7234), with an optional `logFile`; the server's base environment (`HERMETIC_OAUTH_REDIRECT_URI` and the rest) |
| `temporal` | The Temporal dev server (`temporal server start-dev`) on a free port |
| `child-process` | Process lifecycle shared by the spawns: start, wait for readiness, stop and kill |
| `runner-build`, `runner-process` | Builds the runner and runs it as a child process against a server and a model endpoint; `artifactStore: "none"` boots it with no artifact store (the e2e file-gate stack) |
| `llm-wire` | The Anthropic and OpenAI wire shapes the model fakes write |
| `mock-llm` | `MockLlmProxy`: scripted model turns, served behind the proxy lane; every request captured with its disposition and arrival time, and an `onCapture` observer |
| `fake-llm-upstream` | `FakeLlmUpstream`: a provider the proxy dials, scripted per request; in default-reply mode every unscripted request gets `DEFAULT_REPLY_TEXT`, in default-error mode a non-retryable 400; it listens on `host` and reports its `port()` (the install journeys' fake, `test/install/lib/fake-model.mjs`) |
| `jwt`, `local-oidc-issuer`, `local-oidc-issuer-main` | A hermetic OIDC issuer, in process or as a process |
| `oauth-authorization-server` | A hermetic OAuth authorization server |

## The rule

A module here imports only `node:*` and its own files, by their `.ts` path. It is written in erasable TypeScript (no enums, namespaces or parameter properties). So the pinned Node runs it directly with its type stripping, with no build and no `node_modules`. That is how the install layer (`test/install`), which runs in the release with no install, uses the same fakes as the contract and e2e suites. `scripts/test-integrity.mjs` refuses any other import (`layout-support-import`), and `tsconfig.json` refuses non-erasable syntax.

A component one suite alone uses stays in that suite (`test/conformance/src/harness/`, `test/e2e/fixtures/`).

## Verify

`npm test -w @stigmer/test-support` runs the modules' own cases (`src/__tests__/`, collected by vitest's defaults; the package keeps no config of its own, since a config would import `vitest/config`). `npm run typecheck -w @stigmer/test-support` typechecks them under the rule's compiler options.
