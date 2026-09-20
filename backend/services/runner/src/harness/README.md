# harness/ — the turn runtime and the adapter contract

This folder is the turn runtime, the code that runs one agent turn for every
harness, and the contract a harness implements to run behind it
(`harness/types.ts`). A harness is one engine the runner can drive: today the
native LangGraph deep-agent and the Cursor SDK; the contract was designed
against the Claude Agent SDK and the Codex SDK as well
(`harness/capabilities.ts`). An adapter is the `HarnessAdapter` object a
harness's factory returns; a harness is that adapter plus its registry row.

This file is an index for someone adding a harness. To add one: read the modules
below in order, write the adapter files, touch the sites, prove it with the kit.
The rules this file follows are at the end.

## One harness, six spellings

The harness identity is spelled differently in each layer, and every spelling is
pinned somewhere. Read a row across before searching for anything.

| Spelling                                                                                                                                | Native                           | Cursor                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------- |
| The adapter's folder                                                                                                                    | `activities/execute-deep-agent/` | `activities/execute-cursor/` |
| `HarnessName` in `harness/registry.ts`                                                                                                  | `deep-agent`                     | `cursor`                     |
| The Temporal activity in `harness/registry.ts`                                                                                          | `ExecuteDeepAgent`               | `ExecuteCursor`              |
| The proto enum in `apis/ai/stigmer/agentic/session/v1/enum.proto`                                                                       | `HARNESS_NATIVE`                 | `HARNESS_CURSOR`             |
| The model registry's key in `backend/services/stigmer-server/src/domain/workflow/registry/data/model-registry.json`                     | `native`                         | `cursor`                     |
| The file-review id in `activities/execute-deep-agent/deep-agent-capabilities.ts` and `activities/execute-cursor/cursor-capabilities.ts` | `deep-agent`                     | `cursor`                     |
| The vendor SDK package in `backend/services/runner/package.json`                                                                        | `deepagents`                     | `@cursor/sdk`                |

## Modules, in reading order

- `harness/types.ts` — the contract: `HarnessAdapter`, `TurnInput`, `TurnSink`,
  `TurnOutcome`, and what was deliberately left off it.
- `harness/capabilities.ts` — the flags the runtime branches on instead of
  harness names (`HarnessCapabilities`, `PausePrimitive`, `StateIdSource`), the
  harness matrix the contract was designed against, and which values a real
  adapter stands behind.
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
  free: first visible token, model rounds, tool and sub-agent spans, the
  longest silence.
- `harness/capture.ts` — the file-review capture. The runtime owns all of it; an
  adapter supplies one fact, which CAS-owned paths its engine touched.
- `harness/turn-context.ts` — the resolution phases that build the `TurnInput`
  (`resolveTurnContext`), and what is deliberately left to the adapter.
- `harness/run-turn.ts` — the activity body (`runTurnActivity`) and
  `settleWith`, the one place a turn's terminal status is written.

## Adapter files

What the contract requires:

- `activities/<harness>/adapter.ts` — a factory returning a `HarnessAdapter`.
  `activities/execute-deep-agent/adapter.ts` (`createDeepAgentAdapter`) is the
  smaller real shape, with no per-session state;
  `activities/execute-cursor/adapter.ts` (`createCursorAdapter`) is the one with
  session state.
- `activities/<harness>/<harness>-capabilities.ts` — the flags, declared once,
  each with its reason:
  `activities/execute-deep-agent/deep-agent-capabilities.ts`
  (`DEEP_AGENT_CAPABILITIES`),
  `activities/execute-cursor/cursor-capabilities.ts` (`CURSOR_CAPABILITIES`).
- `activities/<harness>/translator.ts` — the engine's events rendered as
  `TranscriptEvent`s into `TranscriptBuilder` (`harness/transcript/events.ts` is
  the union): `activities/execute-deep-agent/translator.ts`,
  `activities/execute-cursor/translator.ts`.

Everything else in an adapter's folder is the engine's business and is not a
template: 17 of the native adapter's 20 modules and 32 of the Cursor adapter's
35, at the commit the footprint below measures. That business is:

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
  `activities/execute-cursor/__test-utils__/contract-subject.ts` the first.
- `activities/<harness>/__tests__/hermetic/harness-contract.test.ts` — both
  halves of the kit against the real adapter, with what the subject cannot
  produce declared SKIPPED:
  `activities/execute-deep-agent/__tests__/hermetic/harness-contract.test.ts`,
  `activities/execute-cursor/__tests__/hermetic/harness-contract.test.ts`. Their
  goldens: `activities/execute-deep-agent/__tests__/hermetic/goldens/`,
  `activities/execute-cursor/__tests__/hermetic/goldens/`.
- `activities/<harness>/__tests__/adapter-is-temporal-free.test.ts` — the fence
  that keeps `@temporalio/*` out of the adapter:
  `activities/execute-deep-agent/__tests__/adapter-is-temporal-free.test.ts`,
  `activities/execute-cursor/__tests__/adapter-is-temporal-free.test.ts`.
- `activities/<harness>/__tests__/adapter-graph-is-sdk-free.test.ts` — the fence
  that walks the adapter module's static graph and refuses a vendor SDK on it. A
  new harness adds it.
  `activities/execute-deep-agent/__tests__/adapter-graph-is-sdk-free.test.ts` is
  the shape; the Cursor adapter predates it, and
  `__tests__/harness-boot-order.test.ts` proves its graph in a fresh process.

## Sites a new harness touches

Measured at commit f25d15131 (2026-09-16). Every list in this section is dated
by that line.

### In the runner

Read off the registry, its tests and the package, not off the probes below. The
composition roots, `runner.ts` and `runner-manager.ts`, read `HARNESS_ADAPTERS`
and nothing per harness; there is nothing to touch there.

- `harness-adapters.ts` — one row in `HARNESS_ADAPTERS`, in boot order.
- `harness/registry.ts` — one member of `HarnessName` and one entry in
  `HARNESS_ACTIVITY_NAMES`, byte-identical to the server's pin.
- `harness/capabilities.ts` — the harness matrix in the header gains a column.
- `config.ts` — the harness's own settings, if it has any (`cursorApiKey`,
  `checkpointerType` are the two adapters' today).
- `activities/call-agent.ts` — `resolveHarness`, the wire string to the proto
  enum for the workflow task.
- `workflow-engine/loader.ts` — the YAML shorthand map from harness word to enum
  name.
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
exactly that.

```bash
# The same exclusions for every probe. __test-utils__/ stays in: the kit and the hermetic drivers enumerate harnesses.
X=(-g '!node_modules' -g '!**/gen/**' -g '!*_pb.*' -g '!*.pb.go' -g '!apis/stubs/**' -g '!tools/codegen/output/**'
   -g '!**/dist/**' -g '!**/dist-slim/**' -g '!**/__tests__/**' -g '!*.test.*' -g '!**/goldens/**' -g '!*lock*')
rg -l "${X[@]}" 'HARNESS_NATIVE|HARNESS_CURSOR|Harness\.(NATIVE|CURSOR)|\bHarnessOption\b'   # the proto enum
rg -l "${X[@]}" 'ExecuteDeepAgent|ExecuteCursor|HARNESS_ACTIVITY_NAMES'                       # the activity name
rg -l "${X[@]}" '\bHarnessName\b|["'"'"']deep-agent["'"'"']|["'"'"']cursor["'"'"']'            # the registry name and file-review id
rg -l "${X[@]}" '"harness"\s*:\s*"(native|cursor)"'                                           # the model registry's key
rg -l "${X[@]}" '@cursor/sdk|\bdeepagents\b'                                                    # the vendor SDK package
```

Every hit falls into one of three classes:

- **Enumerates** — a switch, a record keyed by harness, a label table, a
  byte-pinned name, a per-harness data row, or a comment that states the closed
  set. A new harness must touch it.
- **Passes through** — reads, forwards or types by the value, or a fixture that
  carries it. Nothing to touch.
- **Generated** — rebuilt from the proto or the registry by `make codegen`.
  Never edited by hand.

### Outside the runner: sites that enumerate

| File                                                                                                                                                                           | What enumerates the harness set                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apis/ai/stigmer/agentic/session/v1/enum.proto`                                                                                                                                | The `Harness` enum itself; the root. Then `make codegen`.                                                                                                                                                                                                                                                                     |
| `apis/ai/stigmer/agentic/session/v1/spec.proto`                                                                                                                                | The `harness` field's comment lists each harness and its activity.                                                                                                                                                                                                                                                            |
| `apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto`                                                                                                                   | The `harness` field's comment lists each harness.                                                                                                                                                                                                                                                                             |
| `apis/ai/stigmer/iam/identityaccount/v1/spec.proto`                                                                                                                            | `default_harness` names the allowed lowercase strings in its validation rule.                                                                                                                                                                                                                                                 |
| `apis/ai/stigmer/agentic/agentexecution/v1/filereview.proto`                                                                                                                   | `harness_id` comments state the closed set of file-review ids.                                                                                                                                                                                                                                                                |
| `apis/ai/stigmer/billing/v1/io.proto`, `apis/ai/stigmer/billing/v1/policy.proto`                                                                                               | Harness string fields whose comments state the set.                                                                                                                                                                                                                                                                           |
| `backend/services/stigmer-server/src/temporal/agentexecution/names.ts`                                                                                                         | `EXECUTE_CURSOR_ACTIVITY_NAME`, `EXECUTE_DEEP_AGENT_ACTIVITY_NAME`: the server side of the runner's byte-pinned names.                                                                                                                                                                                                        |
| `backend/services/stigmer-server/src/temporal/agentexecution/workflows/invoke-agent-execution.ts`                                                                              | The activity proxy typed per name, and a branch on the enum: `executeCursorFlow` for a harness whose engine mints the state id (the server reads it back), the deep-agent flow for one whose id the server mints first (`EnsureThread`). The largest site; a new harness needs an arm here, its own flow or one of these two. |
| `backend/services/stigmer-server/src/domain/workflow/converter/task-converters.ts`                                                                                             | A `switch` over `Harness` to the YAML shorthand.                                                                                                                                                                                                                                                                              |
| `backend/services/stigmer-server/src/domain/workflow/converter/unmarshal.ts`                                                                                                   | `normalizeEnumShorthands`: the YAML word to the enum name.                                                                                                                                                                                                                                                                    |
| `backend/services/stigmer-server/src/domain/workflow/registry/pin-validation.ts`                                                                                               | `HARNESS_NAME_CURSOR` and a Cursor-only pin rule.                                                                                                                                                                                                                                                                             |
| `backend/services/stigmer-server/src/domain/workflow/registry/data/model-registry.json`                                                                                        | Per-harness model rows; a harness with its own catalog adds rows.                                                                                                                                                                                                                                                             |
| `backend/services/stigmer-server/src/temporal/schedule/model-pinning.ts`                                                                                                       | A Cursor-only pinning rule.                                                                                                                                                                                                                                                                                                   |
| `backend/services/stigmer-server/scripts/capture-replay-histories.ts`                                                                                                          | A map keyed by activity name, one stub per activity (a maintainer script).                                                                                                                                                                                                                                                    |
| `client-apps/cli/src/commands/agent-exec-flags.ts`                                                                                                                             | The `--harness` flag's help text lists the values.                                                                                                                                                                                                                                                                            |
| `client-apps/cli/src/resources/run/create.ts`                                                                                                                                  | The flag string to the enum.                                                                                                                                                                                                                                                                                                  |
| `client-apps/cli/src/resources/run/prepare.ts`                                                                                                                                 | `HarnessFlag` and its checks.                                                                                                                                                                                                                                                                                                 |
| `client-apps/cli/src/resources/run/header.ts`                                                                                                                                  | The run header's harness label.                                                                                                                                                                                                                                                                                               |
| `client-apps/cli/src/resources/task-configs.ts`                                                                                                                                | The YAML shorthand map.                                                                                                                                                                                                                                                                                                       |
| `apis/ai/stigmer/agentic/agentexecution/v1/enum.proto`                                                                                                                         | A comment on tool-name casing per harness.                                                                                                                                                                                                                                                                                    |
| `backend/README.md`                                                                                                                                                            | Lists the harnesses and the SDK behind each.                                                                                                                                                                                                                                                                                  |
| `client-apps/desktop/scripts/stage-runner-slim.sh`, `client-apps/desktop/scripts/macos-codesign-tree.sh`                                                                       | Stage and sign the vendor SDKs' native helpers for the desktop app; a harness whose SDK ships one touches both.                                                                                                                                                                                                               |
| `sdk/react/src/models/harness.ts`                                                                                                                                              | The SDK hub: `HarnessOption`, `HARNESS_META`, `HARNESS_LABELS`, `HARNESS_OPTIONS`, `DEFAULT_HARNESS`, `toProtoHarness`, `fromProtoHarness`. `HarnessOption` carries four values beyond the proto's two; `toProtoHarness` maps them to `NATIVE` through its `default` arm.                                                     |
| `sdk/react/src/models/HarnessSelector.tsx`                                                                                                                                     | `OPTIONS`, the two selectable values.                                                                                                                                                                                                                                                                                         |
| `sdk/react/src/models/ModelSelector.tsx`                                                                                                                                       | A Cursor-only thinking rule, and the filter that hides the extra options by name.                                                                                                                                                                                                                                             |
| `sdk/react/src/identity-account/AccountPreferencesPanel.tsx`                                                                                                                   | One `HarnessOptionRow` per harness, placed by hand.                                                                                                                                                                                                                                                                           |
| `sdk/react/src/identity-account/useAccountExecutionDefaults.ts`                                                                                                                | Validates the preference against the two names.                                                                                                                                                                                                                                                                               |
| `sdk/react/src/workflow/inspector/forms/AgentCallForm.tsx`                                                                                                                     | Two radio buttons, placed by hand.                                                                                                                                                                                                                                                                                            |
| `sdk/react/src/pricing-governance/BaselineEditor.tsx`                                                                                                                          | A select with one option per harness.                                                                                                                                                                                                                                                                                         |
| `site/src/components/pages/pricing/ModelPricingTable.tsx`                                                                                                                      | Harness to display label.                                                                                                                                                                                                                                                                                                     |
| `docs/concepts/harnesses.mdx`, `docs/concepts/sessions.mdx`, `docs/guides/runners/cursor-harness.mdx`, `docs/guides/workflows/task-types/agent-call.mdx`, `docs/vocabulary.md` | Hand-authored pages that name the harness set; each has an entry in `docs/_inventory/classification.yaml` to keep current.                                                                                                                                                                                                    |

The cloud composition that serves api.stigmer.ai has sites of the same three
classes (billing gates, pricing arms, the channel broker's harness switch, its
own model registry). A harness that must run there is a change on that side too.

### Outside the runner: sites that pass the value through

Nothing to touch. Listed so a probe's hit here is a stop, not a lead.

- `apis/`: `apis/ai/stigmer/agentic/workflow/v1/tasks/meta/agent_call.yaml` (an
  example value); `apis/ai/stigmer/agentic/agentexecution/v1/io.proto`,
  `apis/ai/stigmer/agentic/agentexecution/v1/usage.proto`,
  `apis/ai/stigmer/billing/v1/model_pricing_baseline.proto`,
  `apis/ai/stigmer/billing/v1/pricing_override.proto` (free-form provider or
  harness strings with examples); the fixtures under
  `apis/testdata/hitl/file-review/`.
- The server: `backend/services/stigmer-server/src/domain/session/steps.ts` (the
  immutability check; no per-harness arm);
  `backend/services/stigmer-server/src/temporal/agentexecution/dispatch.ts`,
  `backend/services/stigmer-server/src/temporal/agentexecution/activities.ts`,
  `backend/services/stigmer-server/src/temporal/agentexecution/worker.ts`,
  `backend/services/stigmer-server/src/temporal/agentexecution/workflow-input.ts`
  (read the session's harness or name the activities in prose).
- The React SDK: `sdk/react/src/models/registry.ts`,
  `sdk/react/src/models/useModelRegistry.ts`,
  `sdk/react/src/models/service-tier.ts`; everything under
  `sdk/react/src/channel/`, `sdk/react/src/composer/`,
  `sdk/react/src/execution/`, `sdk/react/src/schedule/`,
  `sdk/react/src/session/` (typed by the option or defaulting to one value).
- Fixtures and clients: `test/e2e/helpers/approval.ts`,
  `test/extension-consumer/src/fake-extension.ts`, `test/fixtures/tool-view/`,
  `site/src/components/docs/demos/shared/StigmerPreviewProvider.tsx`,
  `sdk/java/src/main/java/ai/stigmer/sdk/BillingClient.java` (a hand-written
  client's field comment).
- Inside the runner: comments across `shared/` and the composition roots that
  name both activities or the native engine's tool names as examples;
  `__test-utils__/hermetic-activity.ts` and
  `__test-utils__/model-registry-fixture.ts`; the kit's
  `__test-utils__/harness-contract/runtime-contract.ts` and
  `__test-utils__/harness-contract/types.ts`, typed by `HarnessName` and
  selecting by it.

### Generated

`make codegen` rebuilds these from the proto and the registry; do not edit them:
`apis/stubs/`, `sdk/go/proto/`, `tools/codegen/output/`,
`tools/codegen/schemas/`,
`backend/services/stigmer-server/src/domain/workflow/registry/data/task-kind-registry.json`,
`docs/sdk/resources/`, `docs/sdk/react/`, `docs/cli/commands/`.

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

The hermetic goldens in each adapter's goldens folder (named above) are the
second net: they pin a turn's persisted status byte for byte.

## Footprint

Measured at commit f25d15131 (2026-09-16), production TypeScript only,
`__tests__/` and `__test-utils__/` excluded. Run from `backend/services/runner/`
to re-measure:

```bash
wc -l src/__test-utils__/harness-contract/scripted-adapter.ts
for d in src/activities/execute-deep-agent src/activities/execute-cursor src/harness; do
  printf '%s: ' "$d"
  find "$d" -name '*.ts' -not -path '*/__tests__/*' -not -path '*/__test-utils__/*' | xargs cat | wc -l
done
```

| What                                                                                                     | Lines  | Files |
| -------------------------------------------------------------------------------------------------------- | ------ | ----- |
| The template, `__test-utils__/harness-contract/scripted-adapter.ts`: the floor, no engine, no translator | 385    | 1     |
| The native adapter, `activities/execute-deep-agent/`                                                     | 4,308  | 20    |
| The Cursor adapter, `activities/execute-cursor/`: the ceiling, with its deny-and-retry hook and ledger   | 11,554 | 35    |
| The runtime, `harness/`, for scale: written once                                                         | 4,985  | 14    |
| The test side the native adapter adds: its subject, its hermetic kit file, its two fences                | 658    | 4     |

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
