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

Covered against the `local-go` target: **Project** and **Organization** (flat
tenancy), and **Workflow** — the first **versioned** domain (CRUD, apply
create/update branching, the version-history surface `listVersions` /
`getVersion` / `getByReference` resolution by hash and apply-time tag, and the
`validateSpec` clean contract). The harness, target-profile abstraction,
capability flags, parity comparison, and the spec-first deviation registry built
here are reused by every later slice (more domains, execution lifecycle, the
cloud target).

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
with no IAM filtering), and `versionTagging` is `false` (the dedicated
`tagVersion` RPC has no OSS handler, so it is expected to be `Unimplemented`;
version tags are set at apply time via `metadata.version.tag` instead).

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
  support/   naming, workflows (canonical valid spec/resource builders)
  suites/    *.conformance.test.ts
```

## Adding a domain

1. Add its controllers to `ConformanceClients` in `harness/clients.ts`.
2. Add `src/suites/<domain>.conformance.test.ts` following the existing suites.
3. Assert the intended contract; register any genuine implementation bug as a
   known deviation rather than asserting the wrong behavior.
