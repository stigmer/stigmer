# Stigmer gRPC Conformance Suite

An implementation-agnostic suite that defines the Stigmer gRPC/proto API as an
executable contract. It runs unchanged against any backend that claims to
implement the API:

- the OSS Go `stigmer-server` (today),
- the TypeScript server rewrite (as it lands),
- the Java cloud `stigmer-service` (as an external target, later).

The contract — not any one implementation — is the product. This suite is what
keeps the implementations honest and makes agentic dual-maintenance safe:
"port feature X, make conformance pass" becomes a well-specified, self-verifying
task. See the project's `design-decisions/001-cloud-convergence-strategy.md`.

## Status

Covered against the `local-go` target:

- **Project** and **Organization** — flat tenancy resources.
- **Workflow** — the first **versioned** domain (CRUD, apply create/update
  branching, the version-history surface `listVersions` / `getVersion` /
  `getByReference` resolution by hash and apply-time tag, and the `validateSpec`
  clean contract).
- **Agent** and **McpServer** — flat (non-versioned) agentic blueprints (CRUD &
  identity, apply create/update branching, slug semantics, `getByReference`
  resolution, default-instance provisioning for Agent, and Layer-1 protovalidate
  negatives). The Agent suite also proves the cross-aggregate
  **Agent -> McpServer reference invariant** (`ValidateReferencesStep`): an
  agent referencing an existing McpServer is accepted with its reference org
  normalized, and one referencing a missing McpServer is rejected with
  `FailedPrecondition`.
- **Skill** — the second **versioned** domain, and the first whose versioning is
  **artifact-based**. A skill is `push`ed as a ZIP whose root `SKILL.md` carries
  YAML frontmatter; identity (`metadata.name` == `metadata.slug`) is derived
  server-side from that frontmatter, and a version is the SHA-256 of the artifact
  bytes. Coverage: push identity, server-derived slug, default-private
  visibility, cross-org isolation, push validation negatives (non-zip, missing
  `SKILL.md`, bad frontmatter); version history (idempotent re-push vs. changed
  bytes, newest-first with exactly one current); `getByReference` resolution by
  latest / exact hash / push-time tag (incl. the strict-lowercase-hex rule);
  byte-exact artifact download via `getArtifact` (live and historical);
  `listVersions` pagination, field mapping, and validation; `updateVisibility`;
  `delete`; and the reachable input-validation contract of the direct handler
  `pushFromExecutionArtifact`. Two behaviors are documented but deliberately not
  asserted as shared contract: in OSS the content-addressable artifact persists
  on disk after `delete` (so `getArtifact` still works post-delete), and
  `pushFromExecutionArtifact`'s happy path needs a real execution artifact and is
  covered at the integration layer instead.
- **Environment** — a flat platform resource holding configuration and secrets in
  `spec.data`. Coverage: CRUD & identity (`env_` id, slug derivation, apply
  create/update branching, `getByReference`, cross-org slug reuse); **secret
  handling** (the `secretRedaction`-gated value round-trip, the always-preserved
  `is_secret` flag, and the `getSecretValue` reveal endpoint that returns the
  unredacted value in every edition); the **redaction-marker preservation**
  contract (re-submitting `***REDACTED***` for an existing secret on `update`
  preserves the stored value, and using it for a non-existent secret is rejected);
  incremental variable management (`updateVariables` merge, `removeVariables`); and
  `list` filtering. Negatives include the shared duplicate/missing-name deviations
  plus the proper-code contrast that a duplicate **personal** environment returns
  a real `AlreadyExists`.
- **ExecutionContext** — the execution-scoped, flat resource the engine creates per
  run. Coverage: CRUD & identity (`ectx_` id, slug derivation); resolution by id,
  by reference, and by parent **`getByExecutionId`**; the distinctive **`apply` is
  create-or-fail** semantics (a real `AlreadyExists` over an existing slug, since
  there is no `update` RPC); and `secretRedaction`-gated secret handling. The
  *envmerge precedence* that populates `spec.data` at execution start is out of
  scope here (it needs a live execution) and is covered by the execution-lifecycle
  slice.
- **Session** — the runtime conversation thread that runs against an AgentInstance.
  Coverage: CRUD & identity (`ses_` id, slug derivation, apply create/update
  branching, update field preservation, cross-org slug reuse); the configuration
  fields (an omitted `harness` is stored as `UNSPECIFIED` — the "defaults to NATIVE"
  semantic is applied at execution dispatch, not at create — while an explicit
  `harness`/`execution_target` round-trips); the field-level **`updateSubject`**
  contract (only `spec.subject` changes, every other field is preserved); the
  queries `list` and **`listByAgent`** (note: the filter matches
  `spec.agent_instance_id`, so the value passed for the proto's `agent_id` field is
  an agent *instance* id — Finding F6); and spec-first negatives. Session has **no
  Temporal involvement**, so the lifecycle-bound behaviors it only gates — the
  `harness_state_id` sentinel and the `harness`/`execution_target` immutability it
  enables once an execution has run, plus the runtime merge of session-level
  `mcp_server_usages`/`skill_refs` into the agent graph — are out of scope here and
  belong to the execution-lifecycle slice.

Note: the **McpServer domain** suite (`mcpserver.conformance.test.ts`) is
distinct from `mcp.conformance.test.ts`, which exercises the `@stigmer/mcp-server`
**bridge** — its MCP tool surface against a live server — not the McpServer
resource controllers.

The harness, target-profile abstraction, capability flags, parity comparison,
and the spec-first deviation registry built here are reused by every later slice
(more domains, execution lifecycle, the cloud target).

## Running it

The suite imports the **built** proto stubs, so build them once first:

```bash
npm run build -w @stigmer/protos
npm run test -w @stigmer/conformance
```

`go` must be on `PATH`: the `local-go` target builds `stigmer-server` from
source (always testing HEAD) and boots it against a throwaway SQLite database on
an ephemeral port. No Temporal, runner, or external services are required for
this slice.

Select a target with `CONFORMANCE_TARGET` (default `local-go`):

```bash
CONFORMANCE_TARGET=local-go npm run test -w @stigmer/conformance
```

### Execution-engine suites (Class B)

The CRUD suites above (Class A) need no Temporal or runner. The **execution**
suites do: they provision the Go server's engine — a real Temporal dev server
plus the TypeScript unified runner — and drive a real execution end-to-end.

```bash
npm run test:execution -w @stigmer/conformance
```

This needs the **`temporal` CLI** on `PATH` (`brew install temporal`, or see the
[Temporal CLI docs](https://docs.temporal.io/cli)) in addition to `go` and
`node`. The execution `globalSetup` builds the Go server and the runner from
source and fails fast with an install hint if the CLI is missing. The default
target is `local-go-execution`; the same suites will later run against the
`cloud` target via `CONFORMANCE_TARGET`.

## Design

### Raw stubs, not the SDK

Suites drive the server through the generated `@stigmer/protos` controllers via
`createClient(...)` over a `createGrpcTransport` (h2c). They deliberately do not
use `@stigmer/sdk`: the SDK is itself an implementation with conveniences that
can drift from the proto API. Testing the raw contract keeps the suite a true
black box.

### Spec-first contract (`src/contract/`)

Tests assert the **intended** contract, not whatever an implementation happens
to do today. When a target legitimately deviates because of a known bug, it gets
a tracked entry in the **known-deviation registry** (`deviations.ts`) instead of
the test quietly asserting the wrong behavior. `expectCodeOrDeviation(...)`:

- asserts the contract code for targets without a registered deviation;
- asserts the recorded (wrong) code for targets that have one, and reports it;
- **fails** if a deviating target starts returning the contract code — that
  signals the bug is fixed and the entry should be deleted.

So the registry can never hide a regression or bless a bug permanently. Current
entries (all `local-go`): duplicate-create and missing-name/missing-spec return
`Unknown` instead of `AlreadyExists` / `InvalidArgument` (the Go pipeline wraps
plain errors and loses the gRPC status), and `getVersion` with a malformed hash
returns `NotFound` instead of `InvalidArgument` (the handler skips protovalidate,
so the proto's `version_hash` pattern is never enforced).

`parity.ts` compares resources while ignoring server-owned, non-deterministic
fields (`metadata.id`, `metadata.version`, `status`). `errors.ts` asserts gRPC
status codes with diagnostic messages.

### Target profiles and capability flags (`src/targets/`)

A `TargetProfile` hides everything that differs between things under test: how
the server is reached (spawned vs. external), how tenancy is provisioned, and
which optional behaviors exist. `CapabilityFlags` gate behaviors that
legitimately differ across editions rather than forking the tests — e.g.
`externalOrgLookup` is `false` locally (so `getByExternalOrgId` is expected to
be `Unimplemented`), `multiTenant` is `false` (so list RPCs return everything,
with no IAM filtering), `versionTagging` is `false` (the dedicated
`tagVersion` RPC has no OSS handler, so it is expected to be `Unimplemented`;
version tags are set at apply time via `metadata.version.tag` instead), and
`secretRedaction` is `false` (single-user OSS returns secret values in plaintext
on bulk reads, whereas cloud redacts them; the `is_secret` flag and the
`getSecretValue` reveal endpoint are edition-agnostic). See the project's
`design-decisions/005-secret-redaction-capability-flag.md`.

### Harness (`src/harness/`)

`go-build` builds the server once per run (vitest `globalSetup`); each suite file
boots its own instance (`server-process` + `ports`) against a private temp dir,
so files run in parallel without colliding. `clients` builds the Connect
clients; `grpc-ready` is the shared store-probe readiness gate; `fixtures`
tracks created resources for best-effort reverse-order cleanup.

### Execution engine (Class B, `src/suites-execution/`)

The execution domains (WorkflowExecution, AgentExecution) are 100% Temporal-
gated, so they run on their own config (`vitest.execution.config.ts`,
`test:execution`) rather than the dependency-light CRUD one. This split keeps the
Class A signal fast (no Temporal/runner) — see the project's
`design-decisions/007-execution-engine-harness-target.md`.

Having an execution engine is **not** an edition difference (cloud has one too),
so it is not a `CapabilityFlag`. Instead it is a heavier **target**:
`local-go-execution` boots Temporal (`temporal.ts`) -> the Go server pointed at
it (`server-process` with `temporalHostPort`) -> the runner in static mode
(`runner-process`, built by `runner-build` via `make build-runner`). The Go
server is a pure orchestrator: on create it persists an execution then starts a
Temporal workflow that dispatches the real work to the runner on `stigmer_runner`.

A `*.smoke.test.ts` here proves the harness is wired (the engine runs an
execution); a `*.conformance.test.ts` asserts a domain's full contract. They are
distinct on purpose: the smoke test is a permanent, cheap liveness guard, and
per DD-006 an execution **domain** enters the suite whole on this same harness.

`workflowexecution.conformance.test.ts` is the first such whole domain. It uses
two hermetic fixtures: `set_vars` (sub-second, for create/complete/query/terminal
cases) and `wait` (a durable Temporal timer, for acting on a genuinely *running*
execution — IN_PROGRESS, cancel, terminate, pause/resume). It asserts the
**engine-present** contract; the F7/F8 create-boundary (zombie PENDING when the
engine is absent) is a known Go deficiency, only reachable with Temporal down, so
it is documented rather than asserted — see the project's
`design-decisions/008-workflowexecution-domain-engine-present-contract.md`. Class
B files run serially (`fileParallelism: false`) so multiple suites don't boot
multiple Temporal+runner stacks at once.

`agentexecution.conformance.test.ts` is the second whole execution domain. An
agent run always hits an LLM, so the `local-go-execution` target also boots a
**TS-pure mock-LLM proxy** (`harness/mock-llm.ts`): a long-lived HTTP server with
a programmable response queue that replays canned Anthropic SSE to the runner via
a base-URL override (`STIGMER_PROXY_ENDPOINT`) — no API key, no network. A single
text turn reaches COMPLETED; a `delayMs`-held turn keeps an execution genuinely
IN_PROGRESS, the lever for the cancel/terminate/pause/resume happy paths (the
agent analogue of the `wait` timer). It asserts the engine-present contract and
encodes AgentExecution's divergences from WorkflowExecution — **no `AlreadyExists`
on create** (repeated identical creates yield distinct `aex_` ids), the query
analogue is **`listBySession`**, and a create with **neither `session_id` nor
`agent_id`** returns `NotFound` (the default-agent resolution step runs first and
the OSS target seeds no default agent), not `InvalidArgument`. See the project's
`design-decisions/009-agentexecution-domain-and-ts-mock-llm-proxy.md`. The two
execution domains share one enum-agnostic poll core (`support/execution-poll.ts`).

`agentexecution-approval.conformance.test.ts` adds the **HITL tool-approval**
(`submitApproval`) contract. It is the first slice that exercises a real *tool*:
an agent can only reach `EXECUTION_WAITING_FOR_APPROVAL` when it references an
McpServer that exposes an approval-gated tool, so the `local-go-execution` target
also boots a **TS-pure HTTP (Streamable) MCP fixture** (`harness/mcp-server.ts`):
a long-lived `node:http` server fronting `@modelcontextprotocol/sdk`'s `McpServer`
that exposes one deterministic `echo` tool. Crucially, the McpServer resource is
only **created** (with the fixture's URL) — there is **no `connect`/discovery
step**, because the runner resolves MCP servers from their spec and connects
*live* at execution setup, computing the gate from the agent's
`tool_approval_overrides` (the conformance runner already sets
`SKIP_MCP_CONNECT_BACKFILL=true`). The suite asserts the server-owned contract —
the phase lifecycle (gate reached -> COMPLETED) for APPROVE/SKIP/REJECT/
APPROVE_ALL, the `pending_approvals` read model (`tool_call_id`, `tool_name`,
`mcp_server_slug`), `auto_approve_all` bypass, idempotency, and the negative
codes — and deliberately does **not** assert runner-internal projections that are
not stable black-box observables (per-tool-call *final* status after the approval
resume, and `args_preview`), exactly the boundary the Go integration HITL suite
draws. See the project's
`design-decisions/010-mcp-server-fixture-and-agentexecution-hitl-contract.md`.

`workflowexecution-approval.conformance.test.ts` adds the **workflow `human_input`
HITL** (`submitWorkflowTaskApproval`) contract — the workflow analogue of the
agent suite, but a genuinely different machine, so it is a separate file. A
WorkflowExecution has **no execution-level waiting phase**: a `human_input` task
gates at the **task** level (`WORKFLOW_TASK_WAITING_APPROVAL`, surfacing as
`WORKFLOW_TASK_APPROVAL`) while the execution phase stays `EXECUTION_IN_PROGRESS`,
and `submitWorkflowTaskApproval` resolves it by sending a Temporal signal
(`human_input_{task_name}`) — the handler returns the execution unchanged, so the
suite polls the per-task status (`support/workflowexecutions.ts` gains
`taskByName` / `awaitTaskStatus` / `awaitTaskWaitingApproval`). It is **fully
hermetic** (Temporal + runner only; no LLM, MCP, or child execution): the
`makeHumanInputWorkflow` fixture is `awaitApproval` (human_input) -> `afterApproval`
(set_vars), the downstream set_vars completing being the proof the gate resumed.
The suite asserts the server-owned contract — the task-level gate, that `approve`
completes the run and the downstream task, that a **declared** non-approve outcome
(`deny`) is *data* (resolves and still completes — only the implicit no-outcomes
binary form fails on deny), that an outcome's `then` **routes** the workflow to
the named task (proving the submitted outcome value drives behavior through
observable task statuses), that `on_timeout=HUMAN_INPUT_TIMEOUT_FAIL` fails the
run on its own, and the negative codes (empty fields / unknown task / non-
`human_input` task -> `InvalidArgument`; missing execution -> `NotFound`; submit
on a terminal execution -> `FailedPrecondition`). It deliberately does **not**
assert idempotency (the signal-based gate is not deduped, unlike the agent DB
projection) or the `task.output` projection (outcome-honoring is proven
behaviorally via routing). The sibling `workflowexecution.conformance.test.ts`'s
deferred `submitApproval` (the workflow->child-agent tool-forwarding composite)
remains **out of scope** — it is a different mechanism (a forwarder to a child
AgentExecution) and a Session-12 investigation. See the project's
`design-decisions/011-workflowexecution-human-input-hitl-contract.md`.

## Layout

```
src/
  harness/          go-build, ports, server-process, grpc-ready, clients, fixtures, global-setup
                    + execution: temporal, runner-build, runner-process, mock-llm, mcp-server, global-setup-execution
  targets/          target (interface + capabilities), local-go, local-go-execution, cloud (stub), index
  contract/         errors, deviations, parity
  support/          naming, workflows (set_vars + wait + human_input), execution-poll, workflowexecutions, agentexecutions,
                    agents, mcpservers, skills, environments, executioncontexts, sessions
  suites/           *.conformance.test.ts            (Class A — CRUD, no Temporal)
  suites-execution/ harness.smoke.test.ts + agent.harness.smoke.test.ts + mcp.harness.smoke.test.ts
                    + workflowexecution.conformance.test.ts + workflowexecution-approval.conformance.test.ts
                    + agentexecution.conformance.test.ts + agentexecution-approval.conformance.test.ts  (Class B)
```

## Adding a domain

1. Add its controllers to `ConformanceClients` in `harness/clients.ts`.
2. Add `src/suites/<domain>.conformance.test.ts` (Class A) — or, for an
   execution domain, `src/suites-execution/<domain>.conformance.test.ts` driven
   by the `local-go-execution` target.
3. Assert the intended contract; register any genuine implementation bug as a
   known deviation rather than asserting the wrong behavior.
