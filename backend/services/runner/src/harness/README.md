# harness/ — the turn runtime and the adapter contract

This folder is the turn runtime, the code that runs one agent turn for every
harness, and the contract a harness implements to run behind it
(`harness/types.ts`). A harness is one engine the runner can drive: today the
native LangGraph deep-agent, the Cursor SDK and the Claude Agent SDK; the
contract was designed against the Codex SDK as well
(`harness/capabilities.ts`). An adapter is the `HarnessAdapter` object a
harness's factory returns; a harness is that adapter plus its registry row.

This file is an index for someone adding a harness. To add one: read the modules
below in order, write the adapter files, touch the sites, prove it with the kit.
The rules this file follows are at the end.

## One harness, six spellings

The harness identity is spelled differently in each layer, and every spelling is
pinned somewhere. Read a row across before searching for anything.

| Spelling | Native | Cursor | Claude |
| --- | --- | --- | --- |
| The adapter's folder | `activities/execute-deep-agent/` | `activities/execute-cursor/` | `activities/execute-claude/` |
| `HarnessName` in `harness/registry.ts` | `deep-agent` | `cursor` | `claude` |
| The Temporal activity, declared once in `backend/libs/ts/temporal-codecs/src/activity-names/names.ts` | `ExecuteDeepAgent` | `ExecuteCursor` | `ExecuteClaude` |
| The proto enum in `apis/ai/stigmer/agentic/session/v1/enum.proto` | `HARNESS_NATIVE` | `HARNESS_CURSOR` | `HARNESS_CLAUDE` |
| The model registry's key in `backend/services/stigmer-server/src/modelcatalog/data/model-registry.json` | `native` | `cursor` | `claude` (no rows yet) |
| The file-review id in `activities/execute-deep-agent/deep-agent-capabilities.ts`, `activities/execute-cursor/cursor-capabilities.ts` and `activities/execute-claude/claude-capabilities.ts` | `deep-agent` | `cursor` | `claude` |
| The vendor SDK package in `backend/services/runner/package.json` | `deepagents` | `@cursor/sdk` | `@anthropic-ai/claude-agent-sdk` |

The runner runs a Claude turn; the server refuses Claude until the platform
offers it (`backend/services/stigmer-server/src/domain/session/harness.ts`),
and no published runner carries its engine yet
(`backend/services/runner/scripts/bundle-slim.mjs` stages none of it).

## Modules, in reading order

- `harness/types.ts` — the contract: `HarnessAdapter`, `TurnInput`, `TurnSink`,
  `TurnOutcome`, and what was deliberately left off it.
- `harness/capabilities.ts` — the flags the runtime branches on instead of
  harness names (`HarnessCapabilities`, `PausePrimitive`, `StateIdSource`,
  `boundaryRewritesRow`, `SubAgentProgress`, `MidTurnInput`), the harness matrix the contract was designed against,
  and which values a real adapter stands behind.
- `__test-utils__/harness-contract/scripted-adapter.ts` — the template: every
  rule of the contract as the smallest code that obeys it, with the reason
  beside it.
- `harness/registry.ts` — the wire vocabulary: `HarnessName`, the byte-pinned
  `HARNESS_ACTIVITY_NAMES`, the boot order and how a boot failure is handled,
  and `createHarnessActivities`.
- `harness-adapters.ts` — the one table of real rows (`HARNESS_ADAPTERS`), and
  why its static graph must stay SDK-free.
- `harness/transcript/events.ts` — `TranscriptEvent`, the canonical event a
  translator emits.
- `harness/transcript/builder.ts` — `TranscriptBuilder`, the one builder every
  harness folds its events through.
- `harness/turn-timeline.ts` — `TurnTimeline`, the runtime's fold over that
  builder's events into the `turn_phases` timing line every harness gets for
  free: first visible token, model rounds, tool and sub-agent spans, the longest
  silence.
- `harness/open-operations.ts` — `OpenOperations`, the runtime's fold over the
  same events into what is running right now: it holds the stall watchdog while
  a tool call or a delegated task is open, so a silent build is not a stall, and
  names the oldest open call for the backstop. An adapter supplies one fact,
  when its engine reports a sub-agent's work (`subAgentProgress`).
- `harness/continuation-digest.ts` — the platform's record of the current
  turn, rendered from the run's events in the session's log, and its two
  framings: the continuation an engine that holds its own conversation is
  sent instead of the task, and the recovery a fresh agent that lost its
  conversation reads. The runtime hands it on `TurnInput.continuation` to a
  harness whose `continuation` capability is `"digest"`; a `"checkpoint"`
  harness resumes from its engine's own saved state.
- `harness/turn-input.ts` — the sink's `input` channel, the messages a person
  sends to the session while the turn works: the server's pending hint,
  recorded from every status write, and the claim that takes them as the
  run's, their files mounted as the turn's own are. An adapter claims where
  its engine delivers what it takes (its `midTurnInput` capability,
  `harness/capabilities.ts`), and a turn delivers every message it took,
  never a next turn.
- `harness/preview-pump.ts` — `PreviewPump`, which sends a running tool's output
  to the session between writes, on the streaming floor, through the persist
  chokepoint's single flight.
- `harness/liveness-pump.ts` — `LivenessPump`, which says what a working turn
  has open (each open operation and its age, and how long the turn has waited
  on its model) as a `stigmer.run.liveness` preview: at the start, on every
  change, and at `STIGMER_LIVENESS_INTERVAL_MS` (`config.ts`), alone, through
  the same single flight, for every harness.
- `harness/events/emitter.ts` — `SessionEventEmitter`, which writes what the
  agent did into the session's event log from the rows every persist carries,
  sealed facts only, each thread in order; `harness/events/ids.ts` derives every
  event's id from its run and row. An adapter supplies one fact, which rows its
  turn boundary may still rewrite (`boundaryRewritesRow`).
- `harness/capture.ts` — the file-review capture. The runtime owns all of it; an
  adapter supplies one fact, which CAS-owned paths its engine touched. Review is
  opt-in (the session's `file_review`); with it off a built-in file write or
  delete flows unasked and nothing is captured, and the secret-path refusal
  still applies (`shared/approval-policy.ts`). A captured turn never waits on
  review.
- `harness/approval-answers.ts` — the one door a person's answers reach a turn
  through: on a reinvocation, the run's user.tool_confirmation and
  stigmer.permission.grant events are read from the session's log and mapped
  onto the seeded WAITING rows (`TurnInput.approvalDecisions`, and a deny's
  reason in `TurnInput.approvalDenyMessages`, which the model reads on every
  engine). `harness/approval-decisions.ts` settles the rows that never run.
- `harness/owed-undos.ts` — the undos a person made after a turn, put back at
  every turn's start under the workspace lock, and the reconcile turn's whole
  act (`reconcileOwedUndos`).
- `harness/turn-context.ts` — the resolution phases that build the `TurnInput`
  (`resolveTurnContext`), and what is deliberately left to the adapter.
- `harness/run-turn.ts` — the activity body (`runTurnActivity`) and
  `settleWith`, the one place a turn's terminal status is written.

## Where an adapter runs

Every harness's adapter runs in the agent host, the runner's second process,
which holds none of its keys; the runner's own process loads no engine SDK
(`__tests__/harness-boot-order.test.ts`):

- `harness-adapters.ts` — `HOSTED_HARNESSES` names the hosted ones: all three.
- `agent-host/hosting.ts` — what the composition roots call: the table with
  each hosted row's adapter replaced by its remote stand-in.
- `agent-host/remote-adapter.ts` — the stand-in: `createRemoteAdapter` turns
  each member of the contract into a call over the host's pipe and checks
  everything the host sends back.
- `agent-host/host.ts` — the host's side: `serveAgentHost` runs the real
  adapter against a sink of its own (`agent-host/host-sink.ts`).
- `agent-host/codec.ts` — what crosses: the `TurnInput`, and the status split
  by the owners this file's contract names.
- `agent-proxy/server.ts` — `AgentProxy`, the runner's loopback proxy, the
  host's only way to a credentialed call; `agent-proxy/cursor-lane.ts` its
  Cursor lane, TLS on loopback, which keeps the Cursor access token.
- `shared/agent-fs.ts` — the runtime's file and process operations on the
  agent's paths, which the runner routes to the host (`agent-host/remote-fs.ts`,
  `agent-host/fs-service.ts`), so the runtime never acts on them with the
  runner's rights (`harness/__tests__/runtime-touches-no-agent-path.test.ts`).
- `shared/agent-identity.ts` — who the host runs as: in a container shape the
  agent user, started through `setpriv`; elsewhere the runner's own user.

An adapter written to the contract needs nothing more to be hosted: the hermetic
suites and both kits run it through the remote adapter
(`__test-utils__/loopback-host.ts`).

## Adapter files

What the contract requires:

- `activities/<harness>/adapter.ts` — a factory returning a `HarnessAdapter`.
  `activities/execute-deep-agent/adapter.ts` (`createDeepAgentAdapter`) is the
  smaller real shape, with no per-session state;
  `activities/execute-cursor/adapter.ts` (`createCursorAdapter`) is the one with
  session state; `activities/execute-claude/adapter.ts` (`createClaudeAdapter`)
  is the one whose engine is a separate program, and boots without it.
- `activities/<harness>/<harness>-capabilities.ts` — the flags, declared once,
  each with its reason:
  `activities/execute-deep-agent/deep-agent-capabilities.ts`
  (`DEEP_AGENT_CAPABILITIES`),
  `activities/execute-cursor/cursor-capabilities.ts` (`CURSOR_CAPABILITIES`),
  `activities/execute-claude/claude-capabilities.ts` (`CLAUDE_CAPABILITIES`).
- `activities/<harness>/translator.ts` — the engine's events rendered as
  `TranscriptEvent`s into `TranscriptBuilder` (`harness/transcript/events.ts` is
  the union): `activities/execute-deep-agent/translator.ts`,
  `activities/execute-cursor/translator.ts`,
  `activities/execute-claude/translator.ts`.

Everything else in an adapter's folder is the engine's business and is not a
template: 25 of the native adapter's 28 modules, 37 of the Cursor adapter's 40
and 17 of the Claude adapter's 20, at the commit the footprint below measures. That business is:

- how the engine is created or resumed,
- how the prompt is placed,
- how MCP servers are bound,
- how the engine is made to stop before a gated side effect.

What every adapter's test side carries:

- `activities/<harness>/__test-utils__/contract-subject.ts` — the harness as a
  `HarnessContractSubject`: the real adapter, with the kit's scenario vocabulary
  translated onto the harness's own SDK double.
  `activities/execute-deep-agent/__test-utils__/contract-subject.ts` is the
  smaller example;
  `activities/execute-cursor/__test-utils__/contract-subject.ts` the first;
  `activities/execute-claude/__test-utils__/contract-subject.ts` has no SDK
  double: it runs the real engine and scripts only what its model says, through
  the wire mock behind the runner's real proxy
  (`activities/execute-claude/__test-utils__/claude-wire.ts`).
- `activities/<harness>/__tests__/hermetic/harness-contract.test.ts` — both
  halves of the kit against the real adapter, with what the subject cannot
  produce declared SKIPPED:
  `activities/execute-deep-agent/__tests__/hermetic/harness-contract.test.ts`,
  `activities/execute-cursor/__tests__/hermetic/harness-contract.test.ts`,
  `activities/execute-claude/__tests__/hermetic/harness-contract.test.ts`. Their
  goldens: `activities/execute-deep-agent/__tests__/hermetic/goldens/`,
  `activities/execute-cursor/__tests__/hermetic/goldens/`,
  `activities/execute-claude/__tests__/hermetic/goldens/`.
- `activities/<harness>/__tests__/adapter-is-temporal-free.test.ts` — the fence
  that keeps `@temporalio/*` out of the adapter:
  `activities/execute-deep-agent/__tests__/adapter-is-temporal-free.test.ts`,
  `activities/execute-cursor/__tests__/adapter-is-temporal-free.test.ts`,
  `activities/execute-claude/__tests__/adapter-is-temporal-free.test.ts`.
- `activities/<harness>/__tests__/adapter-graph-is-sdk-free.test.ts` — the fence
  that walks the adapter module's static graph and refuses a vendor SDK on it. A
  new harness adds it.
  `activities/execute-deep-agent/__tests__/adapter-graph-is-sdk-free.test.ts` is
  the shape, `activities/execute-claude/__tests__/adapter-graph-is-sdk-free.test.ts`
  its second; the Cursor adapter predates it, and
  `__tests__/harness-boot-order.test.ts` proves its graph in a fresh process.

## Sites a new harness touches

Measured on 2026-10-24 at 9b7ef9a9ca with the change that named Claude applied
(stigmer#2199). Every list in this section is dated by that line.

### In the runner

Read off the registry, its tests and the package, not off the probes below. The
composition roots, `runner.ts` and `runner-manager.ts`, read `HARNESS_ADAPTERS`
and nothing per harness; there is nothing to touch there.

- `harness-adapters.ts` — one row in `HARNESS_ADAPTERS`, in boot order, and
  the harness in `HOSTED_HARNESSES` when its engine runs in the agent host.
- `harness/registry.ts` — one member of `HarnessName` and one entry in
  `HARNESS_ACTIVITY_NAMES`, read from the activity name's one declaration in
  `backend/libs/ts/temporal-codecs/src/activity-names/names.ts`, which the
  server's workflow schedules by too. A new engine's activity name is added
  there first; the runner's entry lands with its adapter row, since only a row
  is ever looked up.
- `harness/capabilities.ts` — the harness matrix in the header gains a column.
- `config.ts` — the harness's own settings, if it has any (`cursorApiKey`,
  `checkpointerType` are the two adapters' today).
- `shared/filereview/events.ts` — a comment stating the closed set of
  file-review ids.
- `__tests__/harness-boot-order.test.ts` — the header states the row count; its
  child process, `__test-utils__/harness-boot-order-child.ts`, boots
  `HARNESS_ADAPTERS` itself, so a new row runs with no code change.
- `backend/services/runner/package.json` — the vendor SDK dependency.
- `backend/services/runner/scripts/bundle-slim.mjs` — `RUNTIME_EXTERNALS`, the
  SDKs the slim bundle leaves external because they ship native helpers.
- `backend/services/runner/README.md` — the environment-variable table names
  each harness's settings.
- `backend/services/runner/Dockerfile.sandbox` — a comment listing the
  activities the image serves.

### Outside the runner: the method

The identity has six spellings (the table above); the folder is not searched
for, and each of the five probes below finds one of the others. Run all five
from the repository root and read every hit; the lists below came from doing
exactly that. They search hidden directories and take an explicit path, so they
run unchanged from a script, a CI step or an agent's shell (with no path, `rg`
reads stdin when it is not a terminal).

```bash
# The same exclusions for every probe. __test-utils__/ stays in: the kit and the hermetic drivers enumerate harnesses.
X=(--hidden -g '!.git' -g '!node_modules' -g '!**/gen/**' -g '!*_pb.*' -g '!*.pb.go' -g '!apis/stubs/**'
   -g '!**/dist/**' -g '!**/dist-slim/**' -g '!**/.turbo/**' -g '!**/.yarn/**' -g '!**/.next/**'
   -g '!**/__tests__/**' -g '!*.test.*' -g '!**/goldens/**' -g '!*lock*')
rg -l "${X[@]}" 'HARNESS_(NATIVE|CURSOR|CLAUDE)|Harness\.(NATIVE|CURSOR|CLAUDE)|\bHarnessOption\b' . < /dev/null  # the proto enum
rg -l "${X[@]}" 'ExecuteDeepAgent|ExecuteCursor|ExecuteClaude|HARNESS_ACTIVITY_NAMES' . < /dev/null          # the activity name
rg -l "${X[@]}" '\bHarnessName\b|["'"'"'](deep-agent|cursor|claude)["'"'"']' . < /dev/null                    # the registry name and file-review id
rg -l "${X[@]}" '"harness"\s*:\s*"(native|cursor|claude)"' . < /dev/null                                    # the model registry's key
rg -l "${X[@]}" '@cursor/sdk|\bdeepagents\b|@anthropic-ai/claude-agent-sdk' . < /dev/null                   # the vendor SDK package
```

Every hit falls into one of five classes:

- **Enumerates** — a switch, a record keyed by harness, a label table, a
  byte-pinned name, a per-harness data row, a rule true of one engine only, or a
  comment that states the closed set. A new harness must touch it.
- **Refuses** — the offered-engine rule: a named engine the platform does not
  offer is refused where a request names it. A harness joins the offered set
  when it is offered.
- **Passes through** — reads, forwards or types by the value, defaults an
  unspecified engine to native, or a fixture that carries it. Nothing to touch.
- **Generated** — rebuilt from the proto or the registry by `make codegen` (the
  CLI pages by `make gen-cli-docs`). Never edited by hand.
- **Another vocabulary** — a word that only looks like the harness: a plugin's
  dialect, a provider's name. Nothing to touch.

Most mappings from the engine to behaviour are a `switch` with a `never`
default, so the compiler names them when the enum grows: the workflow's flow
choice, `harnessName` in
`backend/services/stigmer-server/src/modelcatalog/pin-validation.ts` and
`backend/services/stigmer-server/src/domain/run/usage-fold.ts`, the eval
trace's tool vocabulary, the React SDK's tables, the TypeScript SDK's result
document and the runner's sub-agent model check. The lists below are for the
sites the compiler cannot see: prose, data and rules true of one engine.

### Outside the runner: sites that enumerate

| File | What enumerates the harness set |
| --- | --- |
| `apis/ai/stigmer/agentic/session/v1/enum.proto` | The `Harness` enum itself; the root. Then `make codegen`. |
| `apis/ai/stigmer/agentic/session/v1/spec.proto` | The `harness` field's comment lists each harness and its activity. |
| `apis/ai/stigmer/iam/identityaccount/v1/spec.proto` | `default_harness` names the allowed lowercase strings in its validation rule; each harness has its own default-model field. |
| `apis/ai/stigmer/agentic/run/v1/filereview.proto` | `harness_id` comments state the closed set of file-review ids. |
| `apis/ai/stigmer/billing/v1/io.proto`, `sdk/java/src/main/java/ai/stigmer/sdk/BillingClient.java` | Harness string fields whose comments state the set. |
| `apis/ai/stigmer/agentic/agent/docs/agent-resource-guide.md` | Prose naming the engines an agent may name. |
| `backend/libs/ts/temporal-codecs/src/activity-names/names.ts` | The byte-pinned Temporal activity names, declared once for the server's workflow and the runner. |
| `backend/libs/ts/tool-vocabulary/src/vocabulary.ts` | `ToolEngine` and each engine's tool-name table, which the eval trace reads. |
| `backend/services/runner/proto/ai/stigmer/runner/turn/v1/enum.proto`, `backend/services/runner/proto/ai/stigmer/runner/turn/v1/ledger.proto` | Comments stating each harness's tool-name style and the file-review ids. |
| `backend/services/runner/package.json`, `backend/services/runner/scripts/bundle-slim.mjs`, `backend/services/runner/scripts/verify-slim-artifact.mjs` | The vendor SDK dependencies, the slim bundle's `RUNTIME_EXTERNALS`, and the check that loads them from the slim artifact. |
| `backend/services/runner/README.md`, `backend/README.md` | List the harnesses and the SDK behind each. |
| `backend/services/stigmer-server/src/temporal/agentexecution/workflows/invoke-agent-execution.ts` | The exhaustive switch on the enum: the deterministic-state flow (`EnsureThread`, then the engine's `Execute*` activity) for an engine whose state id derives from the session, the Cursor flow for one that mints its own. The largest site; a new harness needs an arm here, one of these two flows or its own. |
| `backend/services/stigmer-server/src/temporal/agentexecution/workflow-input.ts` | The `harness` field's comment lists each number and its activity. |
| `backend/services/stigmer-server/scripts/capture-replay-histories.ts` | One stub per activity, and a committed history per flow (a maintainer script). |
| `backend/services/stigmer-server/src/modelcatalog/pin-validation.ts` | `harnessName` and the `HARNESS_NAME_*` section words. |
| `backend/services/stigmer-server/src/modelcatalog/data/model-registry.json` | Per-harness model rows; a harness with its own catalog adds rows. |
| `backend/services/stigmer-server/src/domain/run/usage-fold.ts` | The usage report's engine word and its per-engine token arithmetic. |
| `backend/services/stigmer-server/src/domain/score/eval/trace.ts` | The engine's tool vocabulary for the eval's graders. |
| `backend/services/stigmer-server/src/domain/eval-run/matrix.ts`, `backend/services/stigmer-server/src/domain/eval/case-from-run.ts`, `backend/services/stigmer-server/src/temporal/routine/model-pinning.ts` | Rules true of Cursor alone (features it lacks, a recorded history it cannot resume, the unattended pin); a new harness states its own answer. |
| `client-apps/cli/src/commands/agent-exec-flags.ts` | The `--harness` flag's help text lists the values. |
| `client-apps/cli/src/resources/run/create.ts`, `client-apps/cli/src/resources/run/prepare.ts`, `client-apps/cli/src/resources/eval-run/options.ts` | The flag and target words to the enum and back (`HarnessFlag`, `harnessFlagOf`, `parseTarget`). |
| `client-apps/cli/src/resources/run/header.ts` | The run header surfaces only a Cursor session's harness. |
| `sdk/react/src/models/harness.ts` | The SDK hub: `HarnessOption`, `HARNESS_META`, `HARNESS_LABELS`, `DEFAULT_HARNESS`, `toProtoHarness`, `fromProtoHarness`, all read from one option-to-enum table typed over the whole enum; and `HARNESS_OPTIONS`, the offered engines, kept by hand with `isHarnessOption`. |
| `sdk/react/src/models/registry.ts` | The default model per harness. |
| `sdk/react/src/models/HarnessSelector.tsx` | The premium mark on the Cursor segment; the segments come from `HARNESS_OPTIONS`. |
| `sdk/react/src/identity-account/AccountPreferencesPanel.tsx`, `sdk/react/src/identity-account/useAccountExecutionDefaults.ts` | One option row and one default-model field per harness, placed by hand. |
| `sdk/react/src/model-catalog/BaselineEditor.tsx` | A select with one option per harness. |
| `sdk/react/src/session/useNewSessionFlow.ts`, `sdk/react/src/session/usePersistedModel.ts` | A storage key and a default-model pick per harness. |
| `sdk/react/src/run/tool-categories.ts` | The file-tool fields of each engine's tool shapes. |
| `sdk/typescript/src/eval-run/result-document.ts` | The engine's word in an eval result. |
| `test/conformance/src/benchmark/cells.ts`, `test/conformance/src/benchmark/run.ts`, `test/conformance/src/benchmark/report.ts`, `test/conformance/src/benchmark/quality-eval.ts`, `test/conformance/src/benchmark/temporal-history.ts`, `test/conformance/scripts/benchmark-harnesses.ts`, `test/conformance/scripts/long-turn-live.ts` | The benchmark's harness list and its per-harness keys, models, costs and sides. |
| `docs/concepts/harnesses.mdx`, `docs/guides/runners/cursor-harness.mdx`, `docs/vocabulary.md` | Hand-authored pages that name the harness set; each has an entry in `docs/_inventory/classification.yaml` to keep current. |

The cloud composition that serves api.stigmer.ai has sites of the same classes
(run admission, the usage meter's call description, the channel broker's
harness switch, its own model registry). A harness that must run there is a
change on that side too.

### Outside the runner: the sites that refuse

`backend/services/stigmer-server/src/domain/session/harness.ts` holds the
offered set (`OFFERED_HARNESSES`) and the refusal. The step that applies it is
added to the agent, session, routine and eval-run write chains
(`backend/services/stigmer-server/src/domain/agent/controller.ts`,
`backend/services/stigmer-server/src/domain/session/controller.ts`,
`backend/services/stigmer-server/src/domain/routine/controller.ts`,
`backend/services/stigmer-server/src/domain/eval-run/controller.ts`), and to
the message admission chain after `ResolveRunConfig`
(`backend/services/stigmer-server/src/domain/run/refuse-unoffered-engine.ts`,
again in `backend/services/stigmer-server/src/domain/run/create-steps.ts`
after a re-resolve). Offering a harness is one entry
in `OFFERED_HARNESSES`, with the surfaces above that offer it.

### Outside the runner: sites that pass the value through

Nothing to touch. Listed so a probe's hit here is a stop, not a lead.

- `apis/`: `apis/ai/stigmer/agentic/run/v1/io.proto`,
  `apis/ai/stigmer/agentic/run/v1/spec.proto`,
  `apis/ai/stigmer/billing/v1/model_pricing_baseline.proto`,
  `apis/ai/stigmer/agentic/agent/docs/overview.md`,
  `apis/ai/stigmer/agentic/agent/docs/subagents.md` (free-form strings with
  examples, or prose naming one engine).
- The server: `backend/services/stigmer-server/src/domain/session/steps.ts` (the
  immutability check; no per-harness arm);
  `backend/services/stigmer-server/src/domain/run/resolve-run-config.ts`,
  `backend/services/stigmer-server/src/domain/run/usage.ts`,
  `backend/services/stigmer-server/src/domain/eval-run/target.ts`,
  `backend/services/stigmer-server/src/domain/eval-run/try-run.ts`,
  `backend/services/stigmer-server/src/domain/score/judge/judge-run.ts`,
  `backend/services/stigmer-server/src/temporal/agentexecution/dispatch.ts`,
  `backend/services/stigmer-server/src/temporal/agentexecution/activities.ts`,
  `backend/services/stigmer-server/src/extensions/metered-usage.ts`,
  `backend/services/stigmer-server/src/store/sub-agents-retired.ts` (read the
  session's harness, or default an unspecified one to native).
- The React SDK: `sdk/react/src/index.ts`, `sdk/react/src/models/index.ts`,
  `sdk/react/src/models/ModelSelector.tsx`,
  `sdk/react/src/models/service-tier.ts`,
  `sdk/react/src/models/useModelRegistry.ts`,
  `sdk/react/src/agent/AgentRunDefaultsSection.tsx`,
  `sdk/react/src/agent/run-defaults.ts`,
  `sdk/react/src/channel/ChannelRunConfigDialog.tsx`,
  `sdk/react/src/composer/ComposerToolbar.tsx`,
  `sdk/react/src/composer/SessionComposer.tsx`,
  `sdk/react/src/eval-run/EvalFormFields.tsx`,
  `sdk/react/src/eval-run/eval-view.ts`,
  `sdk/react/src/routine/RoutineDetailView.tsx`,
  `sdk/react/src/routine/RoutineForm.tsx`, `sdk/react/src/run/useCreateRun.ts`,
  `sdk/react/src/session/NewSessionViewer.tsx`,
  `sdk/react/src/session/facets/SetupTab.tsx`,
  `sdk/react/src/session/useCreateSession.ts`,
  `sdk/react/src/session/useSessionPageFlow.ts` (typed by the option, or
  reading the tables).
- Clients and the CLI's rendering: `sdk/typescript/src/run/tool-view.ts` (reads
  an engine's results by shape; a new result shape is a new case there),
  `client-apps/cli/src/resources/render.ts`.
- Packaging: `backend/services/runner/Dockerfile.sandbox`,
  `backend/services/runner/scripts/check-langchain-deps.sh`,
  `.github/workflows/release.runner-images.yaml`,
  `client-apps/desktop/scripts/stage-runner-slim.sh`,
  `client-apps/desktop/scripts/macos-codesign-tree.sh`,
  `client-apps/desktop/scripts/verify-staged-runtime.mjs` (name the vendor SDKs
  in comments or version listings; a harness whose SDK ships a native helper
  touches the staging and signing scripts).
- Guidance and docs: `backend/services/runner/AGENTS.md`,
  `.agents/skills/runner-dev-guidelines/SKILL.md`, `docs/concepts/agents.mdx`,
  `docs/concepts/sessions.mdx`,
  `docs/guides/integrations/model-provider-keys.mdx`.
- Tests and fixtures: `test/e2e/helpers/approval.ts`,
  `test/e2e/tests/interactive/agent-run-defaults.spec.ts`,
  `test/extension-consumer/src/fake-extension.ts`,
  `test/fixtures/tool-view/README.md`,
  `test/fixtures/tool-view/result-views.json`, `test/support/src/llm-wire.ts`,
  `test/conformance/inventory/cloud-capabilities.yaml`,
  `test/conformance/src/benchmark/judge/calibrate.ts`,
  `test/conformance/src/benchmark/tool-call-facts.ts`,
  `test/conformance/src/long-turn/profile.ts`.
- Inside the runner: comments across `shared/` and the composition roots that
  name both activities or the native engine's tool names as examples;
  `__test-utils__/hermetic-activity.ts` and
  `__test-utils__/model-registry-fixture.ts`; the kit's
  `__test-utils__/harness-contract/runtime-contract.ts` and
  `__test-utils__/harness-contract/types.ts`, typed by `HarnessName` and
  selecting by it.

### Generated

`make codegen` rebuilds these from the proto and the registry, and
`make gen-cli-docs` the CLI pages; do not edit them: `apis/stubs/`,
`sdk/go/proto/`, `mcp-server/src/gen/`, `tools/codegen/schemas/`,
`docs/sdk/resources/`, `docs/sdk/react/`, `docs/cli/commands/`.

### Another vocabulary

Words the probes match that are not the harness. Nothing to touch.

- The plugin dialects (`claude`, `cursor`, `codex`) and hook formats:
  `plugins/<plugin>/.cursor-plugin/plugin.json` (44 manifests),
  `backend/libs/ts/plugin-package/src/` (its types, dialect detection,
  presentation, dialects, marketplace reader and normalisers),
  `backend/services/stigmer-server/src/domain/agent/steps.ts`,
  `backend/services/stigmer-server/src/domain/plugin/push.ts`,
  `sdk/typescript/src/hook-words.ts`.
- The Cursor SDK as a subject: `plugins/cursor-sdk/` (a plugin teaching agents
  to build with it).
- `cursor` as a model provider (its provider key and usage rows):
  `apis/ai/stigmer/agentic/run/v1/usage.proto`,
  `apis/ai/stigmer/billing/providerkey/v1/api.proto`,
  `apis/ai/stigmer/billing/providerkey/v1/io.proto`,
  `sdk/react/src/billing/ProviderKeysSection.tsx`,
  `sdk/react/src/billing/useProviderKeys.ts`,
  `sdk/react/src/session/useSessionUsage.ts`,
  `test/conformance/src/targets/cloud.ts`.

### Verifying

`make codegen` after the proto edit. `npm test` in `backend/services/runner/`
runs the kit, every fence, the boot-order test and this file's own test.

## The contract kit

- `__test-utils__/harness-contract/contract.ts` — the adapter-side half:
  `describeHarnessContract`, the invariants every adapter owes the runtime, and
  what the kit cannot measure.
- `__test-utils__/harness-contract/runtime-contract.ts` — the runtime-side half:
  `describeHarnessRuntimeContract`, what the runtime owes every harness, proven
  through the real activity.
- `__test-utils__/harness-contract/types.ts` — `HarnessContractSubject`, the one
  interface a real adapter implements to join the kit, and the scenario
  vocabulary (`ScenarioStep`).
- `__test-utils__/hermetic-activity.ts` — `runActivityHermetically`: a real
  activity with no network, and the rule for a golden that will not hold still.
  The vendor SDK double is the adapter's own.
- `__tests__/harness-contract.test.ts` — the template under both pause
  primitives and both state-id sources; a real adapter registers both halves in
  its own hermetic file instead.
- `__test-utils__/__tests__/harness-contract-self-check.test.ts` — every
  invariant run against an adapter broken in exactly the way it exists to catch.
- `harness/__tests__/run-turn.test.ts` — the runtime-side half against the
  template, one arm per row of the terminal table, and the template's own
  timing, not any engine's.

The "long turn" arms in `__test-utils__/harness-contract/runtime-contract.ts`
state what a turn that works for hours owes the user: a silent operation and a
working subagent outlive the stall window, a running command's output reaches
the session as it prints, a turn completes through three compactions (each
one `agent.thread_context_compacted` on the root thread, the summary never
spoken as the agent, and, where the runner makes the summary call, its cost
counted and the call asking for the runner's checkpoint
(`middleware/compaction-prompt.ts`): the first summary is handed the person's
opening message and each later one the summary before it to update; whose
summarizer it is, `HarnessCapabilities.contextCompaction`), a
drained turn lets its running tool finish and yields at the boundary after it
(`TurnSink.yieldSignal`) with no ending written, a second signal stops it at
once and it still continues, a drain or a stop while the log lags behind the
engine runs nothing past its boundary, and a continued turn (after a drain, a lost
runner, or a drain after an approved call ran) never hands the engine the
task or the decision again. A continued turn says once why it paused, carries
the run's cost count, and settles with no model call when its engine had
already finished. A `checkpoint` engine also continues a run lost before
anything of it reached the log, from its own save. A stall while the turn
waits on its model continues (the provider's); one with nothing owed fails
as before. A turn of many invocations is one change set, and a turn stopped
by an arm that returns still leaves its edits to keep or undo. They drive
the `open` and `compact` steps of `__test-utils__/harness-contract/types.ts`
through the subject's `longTurn` controls, timed on the scripted clock. The
"messages sent while the turn works" arms drive its `message` step: a message
sent while a tool runs, or as the turn answers, is read by that turn once,
never with the task and never left for a next turn, and one a drained turn
could not read is read once by its continuation. An arm
that is not true on a harness today is a known gap: its registration names the
open issue (`knownGaps`), and the arm passes while the gap's own outcome holds
and fails the day it closes (`__test-utils__/known-gap.ts`), so the fix's pull
request is where the mark comes off.

The hermetic goldens in each adapter's goldens folder (named above) are the
second net: they pin a turn's persisted status byte for byte.

## Footprint

Measured on 2026-10-25 at dca730bb11 with the change that added the Claude adapter
applied, production TypeScript only, `__tests__/` and `__test-utils__/`
excluded. Run from `backend/services/runner/` to re-measure:

```bash
wc -l src/__test-utils__/harness-contract/scripted-adapter.ts
for d in src/activities/execute-deep-agent src/activities/execute-cursor src/activities/execute-claude src/harness; do
  printf '%s: ' "$d"
  find "$d" -name '*.ts' -not -path '*/__tests__/*' -not -path '*/__test-utils__/*' | xargs cat | wc -l
done
```

| What                                                                                                     | Lines  | Files |
| -------------------------------------------------------------------------------------------------------- | ------ | ----- |
| The template, `__test-utils__/harness-contract/scripted-adapter.ts`: the floor, no engine, no translator | 609    | 1     |
| The native adapter, `activities/execute-deep-agent/`                                                     | 6,393  | 28    |
| The Cursor adapter, `activities/execute-cursor/`: the ceiling, with its deny-and-retry hook and ledger   | 14,938 | 40    |
| The Claude adapter, `activities/execute-claude/`: an engine that is its own program, with its gate        | 2,620  | 20    |
| The runtime, `harness/`, for scale: written once                                                         | 11,338 | 29    |
| The test side the native adapter adds: its subject, its hermetic kit file, its two fences                | 935    | 4     |
| The test side the Claude adapter adds: its subject, its wire stack, its hermetic kit file, its two fences | 882    | 5     |

## Design history

The pull requests carry the measured acceptance of each step; the module headers
carry the reasoning.

- #1048 — the hermetic regression net: a real activity, no network, goldens byte
  for byte.
- #1064 — the adapter contract, the scripted template, the contract kit and the
  registry.
- #1070 — the turn runtime extracted; the Cursor activity became an adapter.
- #1096 — the native deep-agent harness as an adapter over the same runtime.
- #1097 — one transcript builder over one canonical event for every harness.
- #1136 — the headers made readable to a stranger; every citation public.

## About this file

Every fact about the design has one home, the header of the module that owns it.
This file points at that home in one sentence and restates nothing; if this file
and a header disagree, the header is right and this file is corrected. It adds
two things no header can carry: the sites outside the runner, derived by the
method above, and the footprint. Paths inside the runner's `src` directory are
spelled from `src`; every other path is spelled from the repository root.
`harness/__tests__/readme-index.test.ts` fails when a path or a symbol named
here stops resolving.
