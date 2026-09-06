# Stigmer gRPC Conformance Suite

An implementation-agnostic suite that defines the Stigmer gRPC/proto API as an
executable contract. It runs unchanged against any backend that claims to
implement the API:

- the OSS TypeScript `stigmer-server` (the `local` / `local-execution`
  targets),
- the Java cloud `stigmer-service` (the `cloud` / `cloud-execution` targets).

(History: the targets were born as `local-go`/`local-go-execution` against the
original Go server, then grew `local-ts` twins whose per-sub-project roster
growth gated the TypeScript rewrite — roster equality was the cutover gate.
The Go server retired at go-server-retirement (D4 #25) and the surviving
targets took the plain names. See the stigmer-cloud program
`20260822.01.oss-ts-server-and-self-hosting`.)

The contract — not any one implementation — is the product. This suite is what
keeps the implementations honest and makes agentic dual-maintenance safe:
"port feature X, make conformance pass" becomes a well-specified, self-verifying
task. See the project's `design-decisions/001-cloud-convergence-strategy.md`.

## Status

Covered against the `local` target:

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
  handling** (redaction on every read in both editions since stigmer#405, the
  always-preserved `is_secret` flag, and the `getSecretValue` reveal endpoint
  that returns the unredacted value in every edition); the **redaction-marker preservation**
  contract (re-submitting `***REDACTED***` for an existing secret on `update`
  preserves the stored value, and using it for a non-existent secret is rejected);
  incremental variable management (`updateVariables` merge, `removeVariables`); and
  `list` filtering. Negatives include the shared duplicate/missing-name contract
  checks plus the proper-code contrast that a duplicate **personal** environment
  returns a real `AlreadyExists`.
- **ExecutionContext** — the execution-scoped, flat resource the engine creates per
  run. Coverage: CRUD & identity (`ectx_` id, slug derivation); resolution by id,
  by reference, and by parent **`getByExecutionId`**; the distinctive **`apply` is
  create-or-fail** semantics (a real `AlreadyExists` over an existing slug, since
  there is no `update` RPC); and secret handling (redacted on every user-shaped
  read in both editions since stigmer#535; decrypted values flow only through
  the scope-bound runner lane). The
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
  queries `list` and **`listByAgentInstance`** (filters `spec.agent_instance_id`
  by the request's `agent_instance_id`); and spec-first negatives. Session has **no
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

The `local` target compiles `stigmer-server` from source (always testing HEAD)
and boots it against a throwaway SQLite database on an ephemeral port. No
Temporal, runner, or external services are required for this slice.

Select a target with `CONFORMANCE_TARGET` (default `local`):

```bash
CONFORMANCE_TARGET=local npm run test -w @stigmer/conformance
```

### Execution-engine suites (Class B)

The CRUD suites above (Class A) need no Temporal or runner. The **execution**
suites do: they provision the server's engine — a real Temporal dev server
plus the unified runner — and drive a real execution end-to-end.

```bash
npm run test:execution -w @stigmer/conformance
```

This needs the **`temporal` CLI** on `PATH` (`brew install temporal`, or see
the [Temporal CLI docs](https://docs.temporal.io/cli)). The execution
`globalSetup` builds the server and the runner from source and fails fast with
an install hint if the CLI is missing. The default target is
`local-execution`.

### Cloud target (Class A vs the Java `stigmer-service`)

The `cloud` run drives the same Class A suites against the Stigmer Cloud Java
service, hermetically:

```bash
npm run test:cloud -w @stigmer/conformance   # or: make test-conformance-cloud
```

Its `globalSetup` (`global-setup-cloud.ts`) boots the environment **once per
run** — a Go launcher (`test/integration/cmd/conformance-cloudenv`, reusing the
integration harness) starts Testcontainers Postgres/Redis/MinIO/OpenFGA, a
Temporal dev server, and the service fat JAR in test security mode with **real
OpenFGA authorization** — then bootstraps a real identity (PlatformClient ->
`mintUserToken`) and publishes endpoint + token to workers via env vars
(`STIGMER_CONFORMANCE_CLOUD_*`). The `CloudTarget` itself is **connect-only**:
point those env vars at any pre-provisioned endpoint and the globalSetup boot
is skipped entirely.

Requirements: Docker, `go`, the `fga` CLI (`brew install openfga/tap/fga`), the
`temporal` CLI, and the service JAR — `STIGMER_SERVICE_JAR`, or built in the
sibling `stigmer-cloud` checkout with
`./bazelw build //backend/services/stigmer-service:stigmer_service_fatjar`.
Files run serially (they share one multi-tenant service), and
`mcp.conformance.test.ts` is excluded (it tests the `@stigmer/mcp-server`
bridge against the OSS server specifically, not a target). Tenancy is real
here: `provisionTenancy()` creates an organization through the production RPC
(the primary user becomes owner; a zero-balance billing account is provisioned
automatically), unlike the local targets where an org is just a unique slug.
CI: `.github/workflows/ci.conformance-cloud.yaml` builds the JAR from
`stigmer-cloud@main` and runs this nightly — the cron is what catches
cloud-side drift, since path triggers in this repo cannot see stigmer-cloud
merges.

**The direct-login arms** (`direct-login.conformance.test.ts`, stigmer-cloud#604)
drive the lane a console, desktop, CLI or MCP client actually rides: the raw
access token the PLATFORM'S OWN identity tenant mints, verified and resolved
to the caller's account at position 1. The suite forges nothing about the
tenant — it mints through `CloudTarget.directLoginTenant()`, which exists only
where the environment hands the harness the tenant's signing key
(`STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_ISSUER` / `_SIGNING_KEY_BASE64` /
`_KID` / `_API_AUDIENCE` / optional `_MCP_AUDIENCE`): the composition readout
substrate's mock tenant (`stigmer-cloud` `backend/services/stigmer-server/spike/identity-tenant.ts`
writes that group beside the composition's own `STIGMER_IDP_*` boot trio). The
hermetic Java launcher (test security mode, no edge) and every deployed
endpoint (a real tenant's key is never conformance's) leave the group unset,
and the arms skip VISIBLY with the target's reason.

**The cloud-capability suites** (E1 of the convergence program's DD-012 reset,
stigmer-cloud entry `20260906.04`) cover the three surfaces the Java service
owned alone until the composition takes them: the billing ledger
(`billing.conformance.test.ts` + `suites-execution/billing-gates`), the
side-channel proxy (`proxy.conformance.test.ts`) and the public REST lane
(`public-lane.conformance.test.ts`). Three things make them different from the
CRUD suites:

- **They are enumerated from an inventory, not written from taste.**
  `inventory/cloud-capabilities.yaml` lists every behavior of those surfaces
  read out of the Java code, each with a disposition saying where it is
  proven (`conformance` here; `unit` in an edition's own tables; `smoke` on a
  live lane; `debris` cut by the owner; `deviation` where Java is wrong and
  the suite asserts the contract). Every `it` carries its row id as a
  `[billing.rpc.foo.bar]` tag, and `npm run inventory:check` fails the CI
  lanes when a `conformance` row has no test or a tag names no row — "every
  behavior is covered" is computed, never claimed.
- **The server under test dials fakes the run owns.** The global setup boots a
  fake LLM provider (Anthropic + OpenAI wire shapes), a fake Stripe API with
  request capture and a Stripe-Signature signer, and a fake Discord webhook
  receiver (`harness/cloud-fixtures.ts`) BEFORE the launcher, hands their
  addresses to the JVM through explicit launcher fields, and publishes a
  control URL the workers script them through (`support/cloud-fixtures-client.ts`).
  Suites reset the fakes in `afterEach` — they are shared across every file.
  For a pre-provisioned environment (the composition readout), `npm run
  fixtures:serve` starts them standalone and prints the lines to export.
- **Lanes have their own addresses.** `STIGMER_CONFORMANCE_CLOUD_{PROXY,CURSOR_BIDI,PUBLIC,STRIPE_WEBHOOK}_ADDRESS`
  (+ `_STRIPE_WEBHOOK_SECRET`, `_FIXTURES_CONTROL_URL`), because the
  composition serves extension-owned lanes on separate listeners. The flags
  (`billingLedger`, `sideChannelProxy`, `publicLane`) state the EDITION's
  contract; the addresses state where the environment serves it — a cloud
  target whose flag is true and whose lane is missing FAILS, never skips.
  That red is the implementing entry's acceptance.

Authentication-class arms (401 without a bearer, foreign tokens, CORS,
`denyAll`, the require-scope header) are unobservable in the launcher's test
security mode and skip through `edgeAuthenticationBypass()` until the launcher
runs production security (its own entry).

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

So the registry can never hide a regression or bless a bug permanently. There
are currently no tracked deviations: every target returns the contract code.
The previous local-target entries — duplicate-create / missing-name / missing-spec
returning `Unknown`, and `getVersion` with a malformed hash returning `NotFound`
— were resolved (stigmer/stigmer#192) by enforcing protovalidate at the gRPC
transport boundary and by making the affected pipeline steps return typed gRPC
status errors, and their registry entries were removed.

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
with no IAM filtering), `versionTagging` is `true` (the dedicated `tagVersion`
RPC is implemented in both editions; assigning a tag moves it to name exactly
one version, and apply-time `metadata.version.tag` flows through the same
single-holder primitive), and
`workflowChildApprovalForwarding` is `true` where the
`child_approval_required` signal — which surfaces a child agent's gate to its
parent workflow — is sent: cloud and, since D4 #23, this server's HITL loop.
(The retired Go server never sent it, which is why the flag exists — see
`design-decisions/012-workflowexecution-child-approval-forwarding-contract.md`).
Capabilities are retired when a surface converges: secret redaction was gated
per edition until the Environment (stigmer#405) and ExecutionContext
(stigmer#535) surfaces converged, after which the suites assert redaction
unconditionally. See the project's
`design-decisions/005-secret-redaction-capability-flag.md` for the original
flag's rationale.

### Harness (`src/harness/`)

`ts-build` compiles the server once per run (vitest `globalSetup`); each suite
file boots its own instance (`server-process` + `ports`) against a private temp
dir, so files run in parallel without colliding. `clients` builds the Connect
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
`local-execution` boots Temporal (`temporal.ts`) -> the server pointed at it
(`server-process` with `temporalHostPort`) -> the runner in static mode
(`runner-process`, built by `runner-build` via `make build-runner`). The
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
**engine-present** contract; the engine-unavailable create-boundary (issue #195,
formerly the F7/F8 asymmetry) is now one symmetric contract across both execution
domains — a create while the engine is down fails fast with Unavailable and
persists nothing — and is only reachable with Temporal down, so it is covered by
the server's controller unit tests (and the Java guard unit tests) rather than asserted
here — see
`design-decisions/008-workflowexecution-domain-engine-present-contract.md`. Class
B files run serially (`fileParallelism: false`) so multiple suites don't boot
multiple Temporal+runner stacks at once.

`agentexecution.conformance.test.ts` is the second whole execution domain. An
agent run always hits an LLM, so the `local-execution` target also boots a
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
McpServer that exposes an approval-gated tool, so the `local-execution` target
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
resume, and `args_preview`), exactly the boundary the integration HITL suite
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
observable task statuses), the full timeout-policy contract — `FAIL` fails the
run on its own, `APPROVE` completes it and reaches the downstream task, `DENY`
resolves to the last declared outcome and completes, and a timed-out `APPROVE`
with custom outcomes maps to the FIRST declared outcome and routes its `then`
(the stigmer/stigmer#779 pins; before that fix only FAIL passed, by accident) —
and the negative codes (empty fields / unknown task / non-
`human_input` task -> `InvalidArgument`; missing execution -> `NotFound`; submit
on a terminal execution -> `FailedPrecondition`). It deliberately does **not**
assert idempotency (the signal-based gate is not deduped, unlike the agent DB
projection) or the `task.output` projection (outcome-honoring is proven
behaviorally via routing). The sibling `submitApproval` (the workflow->child-agent
tool-forwarding composite) is a **different mechanism** and lives in its own file,
described next. See the project's
`design-decisions/011-workflowexecution-human-input-hitl-contract.md`.

`workflowexecution-child-approval.conformance.test.ts` adds the **child-agent
approval FORWARDING** (`submitApproval`) contract — distinct from `human_input`
(DD-011): a workflow invokes an agent via an `agent_call` task, and when that
*child* AgentExecution gates on a tool, the gate surfaces at the parent's
`status.pending_approvals` (carrying `child_agent_execution_id`); `submitApproval`
routes the decision down to the child's `AgentExecution.submitApproval`. The
`child_approval_required` signal that populates the parent's
`pending_approvals` is sent by cloud and — since D4 #23 — this server's HITL
loop (the DD-012 derivation design: identity-only signal, the runner derives
the gate from the child's persisted record; the retired Go server had the
receiver but never the sender, which is what the capability flag encoded).
The suite splits along the `workflowChildApprovalForwarding`
capability: the **negatives** never need a populated `pending_approvals` and run
unconditionally against every target (empty `execution_id`/`tool_call_id` /
UNSPECIFIED action -> `InvalidArgument`; missing execution -> `NotFound`; a running
*or* terminal execution with no pending approvals -> `FailedPrecondition`); the
**happy path** is `describe.skipIf`-gated so it reports as genuinely **SKIPPED**
(not a false green) where the sender or the mock fixtures are absent, and RUNS
on `local-execution`. See the project's
`design-decisions/012-workflowexecution-child-approval-forwarding-contract.md`.

## Layout

```
src/
  harness/          ts-build, ports, server-process, grpc-ready, clients, fixtures, global-setup
                    + execution: temporal, runner-build, runner-process, mock-llm, mcp-server, global-setup-execution
                    + cloud: cloud-env, global-setup-cloud
  targets/          target (interface + capabilities), local, local-execution, cloud, cloud-execution, index
  contract/         errors, deviations, parity
  support/          naming, workflows (set_vars + wait + human_input + agent_call), execution-poll, workflowexecutions, agentexecutions,
                    agents, mcpservers, skills, environments, executioncontexts, sessions
  suites/           *.conformance.test.ts            (Class A — CRUD, no Temporal)
  suites-execution/ harness.smoke.test.ts + agent.harness.smoke.test.ts + mcp.harness.smoke.test.ts
                    + workflowexecution.conformance.test.ts + workflowexecution-approval.conformance.test.ts
                    + workflowexecution-child-approval.conformance.test.ts
                    + agentexecution.conformance.test.ts + agentexecution-approval.conformance.test.ts  (Class B)
```

## Adding a domain

1. Add its controllers to `ConformanceClients` in `harness/clients.ts`.
2. Add `src/suites/<domain>.conformance.test.ts` (Class A) — or, for an
   execution domain, `src/suites-execution/<domain>.conformance.test.ts` driven
   by the `local-execution` target.
3. Assert the intended contract; register any genuine implementation bug as a
   known deviation rather than asserting the wrong behavior.

## Adding a cloud capability

For a surface only the cloud edition serves (the E1 pattern):

1. Add a `CapabilityFlags` entry in `targets/target.ts` with the rationale
   block the others carry — true on `cloud`, false on the local targets with
   the DD-001 reason — and, if it is an HTTP lane, an optional address
   accessor beside `proxyBaseUrl()`, fed from a new `CLOUD_ENV` entry that
   both `global-setup-cloud.ts` and the composition readout publish.
2. Enumerate its behaviors as rows in `inventory/cloud-capabilities.yaml`
   (stable dotted ids; one disposition each; cite the Java source and test).
3. Write the suite gated at collection time (`describe.skipIf(!flag)`), every
   `it` tagged with its row ids; script any upstream the server dials through
   `harness/cloud-fixtures.ts` and its control client, never by importing a
   fake into the worker.
4. Run `npm run inventory:check` (zero problems) and the hermetic cloud run
   green before the composition run — Java's behavior is the spec.
