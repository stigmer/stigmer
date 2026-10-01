# Test support

The test machinery two or more suites share, in one place (`test/README.md`, "The test standard"). Each component is one module under `src/`. Import it as `@stigmer/test-support/<module>` from a workspace package, or by its relative `.ts` path from a script that runs with no install.

| Module | What it is |
|---|---|
| `ts-build` | Builds the TypeScript server from source, once per run |
| `server-process`, `ports` | Spawns one hermetic server on port 0 and reads the ports it bound from its ready line; the server's base environment (`HERMETIC_OAUTH_REDIRECT_URI` and the rest). `ports` states the law (a listener binds 0 and reports, nothing hands it a probed port) and holds `UNREACHABLE_HOST_PORT`, the address nothing can listen on |
| `temporal` | The Temporal dev server (`temporal server start-dev`), whose CLI cannot be told port 0: a boot that loses a port to another listener is retried on a fresh one, loudly, and any other failure is not |
| `child-process` | Process lifecycle shared by the spawns: start, wait for readiness, stop and kill |
| `runner-build`, `runner-process` | Builds the runner and runs it as a child process against a server and a model endpoint |
| `llm-wire` | The Anthropic and OpenAI wire shapes the model fakes write |
| `mock-llm` | `MockLlmProxy`: scripted model turns, served behind the proxy lane |
| `fake-llm-upstream` | `FakeLlmUpstream`: a provider that answers every unscripted request with `DEFAULT_REPLY_TEXT` |
| `jwt`, `local-oidc-issuer`, `local-oidc-issuer-main` | A hermetic OIDC issuer, in process or as a process |
| `oauth-authorization-server` | A hermetic OAuth authorization server |

## The rule

A module here imports only `node:*` and its own files, by their `.ts` path. It is written in erasable TypeScript (no enums, namespaces or parameter properties). So the pinned Node runs it directly with its type stripping, with no build and no `node_modules`. That is how the install layer, which runs in the release with no install, uses the same fakes as the contract and e2e suites. `scripts/test-integrity.mjs` refuses any other import (`layout-support-import`), and `tsconfig.json` refuses non-erasable syntax.

A component one suite alone uses stays in that suite (`test/conformance/src/harness/`, `test/e2e/fixtures/`).

## Verify

`npm test -w @stigmer/test-support` runs the modules' own cases (`src/__tests__/`, collected by vitest's defaults; the package keeps no config of its own, since a config would import `vitest/config`). `npm run typecheck -w @stigmer/test-support` typechecks them under the rule's compiler options.
