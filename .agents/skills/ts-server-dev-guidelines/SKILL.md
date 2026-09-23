---
name: ts-server-dev-guidelines
description:
  House rules for the TypeScript control plane under
  backend/services/stigmer-server and the shared backend libraries under
  backend/libs/ts, covering wire-pinned identifiers, pipeline and
  extension-point conventions, the error contract, test discipline, and how a
  core change reaches the cloud edition. Use when adding or changing server
  code, pipeline steps, extension points, store drivers or Temporal workflows.
paths:
  - backend/services/stigmer-server/**
  - backend/libs/ts/**
---

# TypeScript server development guidelines

The package guide (`backend/services/stigmer-server/AGENTS.md`) carries the
binding laws and the read-order; this skill carries the reasoning behind them
and the conventions that take more than a line. A rule you cannot justify is a
rule you will eventually violate creatively, so each one here says why. Module
headers are the truth nearest the code: when a header and this skill disagree,
the header wins and this skill is corrected.

## Parity is the prime directive

The server began as a strict port of a retired Go implementation and is now the
one implementation of the core for every edition: the cloud composition pins an
exact published release of `@stigmer/server`, and `test/conformance/` holds both
editions to the same contract. "Parity" means parity with that suite and with
every client already in the field.

- Byte-pinned wire identifiers are never cleaned up. Workflow, activity, queue
  and signal names, memo keys, id prefixes (`agt_`, `ses_`), refusal copy and
  error messages are shared with the runner, the cloud composition, the
  published SDKs and databases written before any rename you might make. However
  inconsistent their casing looks, renaming one is a protocol break the
  conformance suite catches late and expensively. The names live in one module
  per domain (for example
  `backend/services/stigmer-server/src/temporal/agentexecution/names.ts`).
- Deliberate divergences inherited from the port are contract. Where two chains
  answer the same fault with different codes on purpose, the code carries a
  comment citing the issue that fixed the behaviour; preserve it. A new
  cross-edition divergence goes to the maintainers before it ships; nothing
  diverges silently.
- A value that looks arbitrary is not therefore tunable. Every semantic timeout,
  loop cap, TTL and retry policy is a named constant whose rationale rides
  beside it (`backend/services/stigmer-server/src/transport/constants.ts` is the
  shape). If you cannot find a value's reason in the module's own comments or in
  git history, ask; do not normalise it.

## Module shape

- One directory per domain under `backend/services/stigmer-server/src/domain/`,
  each owning its steps, its converters, its constants and its tests.
- Every module opens with an intent header: what the module is for, the
  trade-offs it embodies, the issues its behaviour traces to, and the
  conformance suite that proves it. A header is the first thing a stranger
  reads; write it for them.
- Tests are co-located in `__tests__/*.test.ts` beside the module, never in a
  parallel tree, and each test file opens with a header stating what it pins.
- Functions do one thing. A handler that validates, loads, mutates, persists and
  formats in one body is what the pipeline exists to prevent.

## Pipeline and composition

Every domain RPC runs a chain of named steps
(`backend/services/stigmer-server/src/pipeline/pipeline.ts`, the shared steps
under `backend/services/stigmer-server/src/pipeline/steps/`). A composition
extends a chain only through the registered points; it never patches a step.

- Step names are shared vocabulary (`ValidateProto`, `ResolveSlug`,
  `CheckDuplicate`, `Persist`, and the rest): never renamed, never given a
  synonym. A domain-specific step stays domain-local and is promoted to the
  shared folder only when a second domain needs the identical step.
- Gate slots are protected vocabulary. The declared slots, their positions in
  each chain and the reasons for those positions are the header and the literal
  tuple of `backend/services/stigmer-server/src/extensions/gate-slots.ts`; read
  it before touching a chain that carries one. Adding a slot is a design act the
  maintainers see; renaming one is a wire break. A gate registered into a slot
  owns its own idempotency, runs wherever its chain runs (in-process callers
  included), and refuses by throwing a `ConnectError` with the correct code and
  pinned copy, exactly as a step does.
- The authorization-tuple lifecycle rides every resource chain. The three shared
  steps in
  `backend/services/stigmer-server/src/pipeline/steps/authorization-tuples.ts`
  are no-ops until a composition registers a lifecycle driver; a new create,
  delete or update-visibility chain must splice the matching step, and the
  header there names the one domain that is exempt and why.
- A store port a composition can drive ships its contract as a kit: a
  vitest-free case list the OSS adapter's test and a composition's driver test
  both iterate, so the port is proven per driver and never restated per
  repository.
  `backend/services/stigmer-server/src/domain/identityaccount/store-contract.ts`
  is the precedent and
  `backend/services/stigmer-server/src/store/port-contract.ts` the runner; the
  in-package `Store` contract
  (`backend/services/stigmer-server/src/store/__tests__/store-contract.ts`)
  keeps its vitest shape because no other package runs it.
- Status-transition hooks fire from every phase-transition persist site, not
  from one chokepoint. The exhaustive list of sites is the header of
  `backend/services/stigmer-server/src/domain/agentexecution/status-observers.ts`;
  a new phase write calls `notifyStatusObservers` and extends that list in the
  same change. Observers fire only on an actual phase change, after the persist
  and before any broadcast; an observer's failure is logged, never a failed
  transition.
- Caller guards enforce the minting client's contract after the identity stamp,
  on the serving chain only
  (`backend/services/stigmer-server/src/extensions/caller-guards.ts`). A guard
  is not a verifier and is never folded into one; its refusal is its own wire
  mapping, and any other throw from it is an infrastructure fault, never
  softened into a denial. The in-process chain takes no guards by structure, not
  by a runtime skip.
- Server code that calls another domain's RPCs rides the in-process transport
  (`backend/services/stigmer-server/src/boot/inprocess.ts`), whose identity
  position mints the `internal` caller class and whose chain validates, logs and
  tags the call like an external one. A new server-internal caller adds a
  narrow, method-segregated edge to the in-process clients and resolves it
  lazily when it is built before the routes exist. A domain port the composition
  root injects (the identity-account create path, the IamPolicy grant path, the
  membership hook) may be called directly, because it is not an RPC. Either way,
  every `CallerIdentity` is built in
  `backend/services/stigmer-server/src/pipeline/interceptors/auth.ts` or, for an
  account acting as itself, in
  `backend/services/stigmer-server/src/domain/identityaccount/actor.ts`; the
  server acting for a principal it authenticated itself is `serverActingFor`
  there; and the trusted-local identity is the wire fallback for an unclaimed
  request, never a worker's identity.
- The require-authentication posture has exactly two sources, combined in
  `backend/services/stigmer-server/src/boot/compose.ts`: the OSS OIDC issuer
  setting, and a composed unit's single declaration. Which authorizer runs under
  each posture is
  `backend/services/stigmer-server/src/authorization/posture.ts`. Under the
  posture, tokenless requests are refused except where `isAuthenticationExempt`
  in `backend/services/stigmer-server/src/pipeline/interceptors/auth.ts` says
  so: methods our protos mark public, and third-party services listed in
  `AUTHENTICATION_EXEMPT_SERVICES` by name (today the gRPC health service,
  because Kubernetes probes are tokenless). Registering a new third-party
  service that must answer anonymous callers adds it to that set in the same
  change. Never add an environment knob for the posture: a forgotten knob is the
  failure the two-source rule exists to prevent.
- The composition root is staged plain functions (config, storage, temporal,
  controllers, routes, listen). No DI framework: a missing dependency is a
  compile error or a loud boot throw, never a silent no-op. Lazy providers are
  for true cycles only.
- Optional infrastructure is an explicit modelled state, never a nullable.
  "Temporal is down" and "forgot to wire Temporal" must be distinguishable.

## Language posture

- Strict TypeScript in the runner's shape (ES2022, NodeNext,
  `"type": "module"`). No ESLint here by design: quality is `tsc --noEmit`,
  Prettier from the repo root, tests and review. No `any`; no `@ts-ignore` or
  `@ts-expect-error` without a one-line reason; every `switch` over a union
  closes with a `never` default.
- No TODO comments. An improvement discovered en route is filed as an issue or
  fixed; a drift marker is neither.
- Comments state intent and trade-offs, never narration. An issue number or a
  file is a verifiable source; "for compatibility reasons" is not.

## Errors

Errors are API surface: the CLI, the console and the SDKs render them directly.

- Correct codes (`NotFound`, `AlreadyExists`, `InvalidArgument`,
  `FailedPrecondition`, `PermissionDenied`), never `Internal` as a catch-all.
  Messages are in domain terms and name the identifying handle
  (`agent 'x' not found`), with the copy pinned in one constants module per
  domain.
- The store-fault mapping: a typed store not-found (`ResourceNotFoundError`,
  `AuditNotFoundError`, checked with `instanceof`) maps to `NotFound`. Any other
  store failure is an infrastructure fault: rethrow it in a pipeline step (the
  executor answers a sanitized `Internal`) or wrap it with
  `internalError(cause, "failed to <do thing>")` from
  `backend/services/stigmer-server/src/pipeline/errors.ts` in a direct handler.
  Presenting a locked file or a corrupted page as "not found" invites clients to
  discard real state, which is why the retired implementation's
  everything-is-not-found mapping was deliberately not ported.
- Quoting: new messages quote identifiers with single quotes (`'${x}'`) and
  render lists with `quoteJoin` from
  `backend/services/stigmer-server/src/domain/mcpserver/enabledtools/enabledtools.ts`.
  The existing double-quoted messages are frozen wire constants shared with the
  cloud edition: contract, not a style to imitate.
- Log the real error; the wire carries the sanitized message. Never log secrets:
  the redaction conventions (`***REDACTED***`, the `enc:v1:` prefix) extend to
  logs and to Temporal payloads.
- The serving chain's error boundary
  (`backend/services/stigmer-server/src/pipeline/interceptors/error-boundary.ts`)
  is a net, not a licence: a raw non-`ConnectError` escaping any handler is
  converted to the sanitized `Internal` before the wire, and a composed policy
  may rewrite leak-prone descriptions for anonymous callers. Direct handlers
  still self-sanitize with `internalError`; authored copy beats the generic net,
  and the boundary exists for the path someone forgot.

## Tests ship with the feature

- A unit test for every step, converter and validation rule with branching
  logic; Temporal tests through `@temporalio/testing` where a workflow changes;
  the domain's conformance suite green on the `local` target before the change
  counts as done.
- Determinism is non-negotiable: no sleeps (poll with a timeout), no shared
  mutable state, unique resources per test, failure paths tested on purpose.
- Verification runs per touched layer: `npm run typecheck && npm test` in this
  directory always; `make test-conformance` for domain work; the runner's full
  suite when `backend/libs/ts/temporal-codecs` changes, because the codecs are
  the wire between the two.

## How a core change reaches the cloud edition

The cloud repository has no copy of this code; it depends on the published
`@stigmer/server`, `@stigmer/protos` and `@stigmer/temporal-codecs` at one exact
version. A change that the cloud needs therefore follows one order:

1. The OSS pull request lands the seam (the new extension point, the new export,
   the behaviour) here, with its tests and its conformance coverage.
2. While the seam is in flight, the cloud pull request may pin a development
   build of the library to prove the composition against it; it stays red on the
   cloud's pin guard until the release exists.
3. The OSS release publishes the library.
4. The cloud pull request re-pins to the released version and merges.

A cloud-only behaviour never lands here for parity's sake, and a core behaviour
is never re-implemented in the composition: if no extension point fits, the
answer is a new point here, designed as such.

## When surprised

Anything the code or its headers did not anticipate (framework behaviour, an
inherited nuance without a recorded reason, a failure class nobody named) goes
to the maintainers before a workaround is adopted, in the pull request or an
issue, so the next reader does not re-walk the trap.
