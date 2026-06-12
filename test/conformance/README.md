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
clients; `fixtures` tracks created resources for best-effort reverse-order
cleanup.

## Layout

```
src/
  harness/   go-build, ports, server-process, clients, fixtures, global-setup
  targets/   target (interface + capabilities), local-go, cloud (stub), index
  contract/  errors, deviations, parity
  support/   naming, workflows, agents, mcpservers, skills, environments, executioncontexts, sessions (canonical valid builders)
  suites/    *.conformance.test.ts
```

## Adding a domain

1. Add its controllers to `ConformanceClients` in `harness/clients.ts`.
2. Add `src/suites/<domain>.conformance.test.ts` following the existing suites.
3. Assert the intended contract; register any genuine implementation bug as a
   known deviation rather than asserting the wrong behavior.
