# Agent guide: stigmer

Stigmer is an open-source platform for AI agents and automation workflows:
agents, workflows, skills and MCP servers are declared as YAML resources, served
by a TypeScript control plane over a public gRPC/Connect contract, and consumed
through generated SDKs, a CLI, a web console and a desktop app. This file is the
always-on guide for the whole repository. Keep it short; it is paid for in every
conversation.

## How guidance is organised

- This file: repo map, commands, verification, hard laws. Always loaded.
- `<package>/AGENTS.md`: a package's binding laws and read-order, attached when
  files in that package are touched. Each one is an index over the code, never a
  restatement of it; a header or README that disagrees with a guide wins, and
  the guide is corrected.
- `.agents/skills/<name>/SKILL.md`: engineering procedures loaded on demand, by
  task or by `/name`. Package doctrine skills carry `paths:` so they surface
  only for matching files.
- `.agents/README.md` explains the mechanism, the measured loading behaviour,
  and how to add or change guidance. `make agents-check` proves every cited path
  resolves and every Cursor shim is current.

Vocabulary hazard: a "Skill" in Stigmer's product vocabulary
(`docs/vocabulary.md`) is a resource the platform serves to agents
(`plugins/*/skills/`). A repo skill under `.agents/skills/` follows the same
`SKILL.md` standard but guides the people and agents building Stigmer. Say "repo
skill" when it could be misread.

## Repository map

- `apis/`: the protobuf contract (`apis/ai/stigmer/`), buf config, and the
  committed generated stubs (`stubs/{go,java,python,ts}`). The single source of
  truth for the resource model.
- `backend/services/stigmer-server/`: the control plane, published as
  `@stigmer/server`. Own lockfile. `backend/services/stigmer-server/fga/` is the
  authorization model every edition reads.
- `backend/services/runner/`: the Temporal worker that executes agent sessions
  and workflow tasks through two harnesses (Cursor, native deep-agent). Own
  lockfile.
- `backend/libs/ts/`: `temporal-codecs`, `zip-structure`, `plugin-package` (the
  Agent Plugins reader the CLI validates with and the server installs from),
  `outbound` (the egress address policy and the MCP OAuth rules the server, the
  runner and the catalogue audit dial user-supplied URLs by).
- `sdk/`: `typescript` (`@stigmer/sdk`), `react`, `theme`, `ink`, `embed`, `go`,
  `python`, `java`. Generated clients live under each SDK's `gen` directory.
- `client-apps/`: `cli` (the `stigmer` command), `web` (Next.js console),
  `desktop` (Tauri + Vite).
- `mcp-server/`: Stigmer's own MCP server for IDEs.
- `crates/stigmer-runner-host/`: Rust host that drives the runner as a
  subprocess (desktop).
- `tools/codegen/`: the generator behind every `gen-*` target;
  `tools/eslint-plugin-stigmer/`.
- `test/conformance/`: the cross-edition gRPC contract suite; `test/e2e/`:
  Playwright; `test/extension-consumer/`.
- `plugins/`: the official plugin marketplace, published as `@stigmer/plugins`;
  what `stigmer install` and the console's Marketplace offer when no other
  source is named. Nothing in it is installed unasked.
- `docs/` and `site/`: documentation content (MDX, Vale, Prettier) and the
  Fumadocs site; `demos/`: Scenar tours; `docs-agent/`: the Ask AI agent.
- `deploy/`: Helm chart and all-in-one image; `examples/`; `marketing/`;
  `blog/`.
- `scripts/`: repo-level Node scripts, each with a `*.test.mjs` sibling run by
  `npm run test:scripts`.

Dependency direction: `@stigmer/protos` (from `apis/stubs/ts`) -> `@stigmer/sdk`
-> `@stigmer/react` -> client apps. The server and runner depend on
`backend/libs/ts` and the protos; nothing depends on a client app.

## Toolchains

Root `package.json` is an npm workspace driven by Turborepo (`turbo.json`); Node
is pinned in `.nvmrc`. Two packages sit outside the workspace with their own
lockfiles and are run from their directory: `backend/services/stigmer-server`
and `backend/services/runner`. `site/` uses yarn 4. `sdk/python` uses uv. Go
modules are joined by `go.work`. Rust lives in `crates/` and
`client-apps/desktop/src-tauri`. Prettier formats `docs/` and the guidance files
with `proseWrap: always`; Vale lints `docs/` only.

## Commands

- `make help` lists every target with its one-line purpose; the Makefile is the
  orchestrator.
- `make setup` once; `make check` is the full local CI gate (`check-prep` then
  parallel `check-go check-node check-site check-rust check-java`).
- `make codegen` after any `.proto` change; the `*-check` twins
  (`gen-sdk-docs-check`, `gen-task-registry-check`, `gen-ipc-fixtures-check`,
  `stubs-internal-check`) are the freshness gates CI runs.
- Tests: `make test-server`, `make test-runner`,
  `npm run test -w @stigmer/react`, `make test-conformance`,
  `make test-conformance-execution` (needs the `temporal` and `stigmer` CLIs),
  `make test-e2e`, `make test-plugins-static`, `npm run test:scripts`.
- Docs: `make lint-docs`, `make format-docs`, `make check-docs-yaml`,
  `make check-docs-inventory`, `make build-site`.
- Guidance: `make agents-sync` regenerates the Cursor shims; `make agents-check`
  verifies them and every cited path.

## Verification map

Run the checks for every path prefix a change touches, then quote each check's
summary line in the final message. Never report unverified work as done.

- `apis/**`: `make -C apis lint`; for `.proto` changes also
  `make check-docs-yaml gen-proto-sdk-docs-check gen-task-docs-check gen-task-registry-check`,
  and `buf breaking` runs in CI.
- `backend/services/stigmer-server/**`: `make test-server`.
  `backend/services/stigmer-server/fga/**`: also
  `make test-authorization-model`. `tools/codegen/src/authorization-model/**`:
  `npm run test -w @stigmer/codegen && make gen-authorization-model-check`.
- `backend/services/runner/**`: `make test-runner`.
- `sdk/typescript/**`: `npm run typecheck -w @stigmer/sdk`. `sdk/react/**`:
  `npm run lint -w @stigmer/react && npm run typecheck -w @stigmer/react && npm run test -w @stigmer/react`.
  `sdk/ink/**`: `npm run typecheck -w @stigmer/ink`.
- `client-apps/web/**`: `make verify-web`. `client-apps/desktop/**`:
  `make verify-desktop`. `client-apps/cli/**`:
  `npm run typecheck -w @stigmer/cli && npm run test -w @stigmer/cli && make gen-cli-docs-check`.
- `crates/**`:
  `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
  in the crate.
- `test/conformance/**`:
  `npm run typecheck -w @stigmer/conformance && make check-conformance-inventory`;
  suites under `test/conformance/src/suites/` also `make test-conformance`.
- `plugins/**`: `make test-plugins-static`. `deploy/helm/**`:
  `make lint-helm test-helm`.
- `docs/**`, `site/**`:
  `make lint-docs format-docs-check check-docs-yaml check-docs-inventory build-site`,
  `make -C site lint typecheck`.
- `scripts/**`: `npm run test:scripts`. Any `AGENTS.md` or `.agents/**`:
  `make agents-check`.

## Hard laws

- Work in a git worktree, never in the primary checkout, and never add the
  worktree to the window: changing the window's folder set disconnects every
  other chat's tools until a reload. Package guides and path-scoped skills reach
  a worktree through `scripts/agents-context-hook.mjs` (`.agents/README.md`).
  Branch `fix/<component>-<issue>-<slug>` for an issue, `<type>/<project-slug>`
  for a program; one PR per branch; merging is a separate, explicitly requested
  act.
- Nothing a reader of this public repository cannot open goes into source, docs,
  rules, guidance or issues: no private planning paths, task ids, ruling or
  finding ids, stage names. Write the reason in your own words, or cite a PR, an
  issue, a SHA, a file.
- Generated files are never hand-edited: `apis/stubs/**`, every `gen` directory,
  generated docs under `docs/sdk/`, the task registry data, the compiled
  authorization model, the Cursor shims in `.cursor/rules/agents-*.mdc` and
  `.cursor/hooks.json`. Re-run the generator.
- Wire identifiers are pinned bytes: Temporal workflow, activity and queue
  names, proto field names, event kinds. A rename is a protocol break, not a
  cleanup.
- Relative imports in published TypeScript carry an explicit `.js` extension
  (Node ESM consumers), enforced by `scripts/verify-esm-node.mjs`.
- Strict TypeScript is the quality gate: no `any`, no `@ts-ignore` without a
  one-line reason, every `switch` over a union closed with a `never` default. No
  TODO comments: file an issue or fix it. Comments state intent and trade-offs,
  never narration of the diff or its review history.
- Every module and test file opens with an intent header: what it is for, the
  trade-offs it embodies, what the tests pin.
- Match verification to risk. A test earns its place by pinning behaviour that
  could regress unnoticed; a bug fix starts with the smallest failing test.
- End the turn with evidence: the quoted summary line of each check that ran,
  which checks were skipped and why, and nothing left pending.
