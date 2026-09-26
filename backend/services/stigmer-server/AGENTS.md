# Agent guide: backend/services/stigmer-server

The control plane: one TypeScript library, `@stigmer/server`, and the bundled
deployable `@stigmer/server-slim`, published together from this directory. The
cloud edition is a composition that pins one exact release of the library, so a
core behaviour is written once here and reaches every edition when the pin
advances. This guide is an index; the files it names are the truth.

## Read in this order

- `README.md`: the two artifacts, the published contract, how to build and test.
- `src/index.ts` header: the barrel is the whole public surface; anything a
  composition needs that is not exported is a seam request, never a deep import.
- `src/boot/compose.ts` header: the staged composition root, boot and shutdown
  order, how extensions ride the stages.
- `src/pipeline/pipeline.ts` and `src/pipeline/steps/`: the step chain every
  domain RPC runs; `src/extensions/gate-slots.ts` and
  `src/extensions/registry.ts` for the points a composition may register.
- `src/store/README.md`: the driver seam, the two drivers, the contract test
  both must pass.
- `src/temporal/README.md`: the engine layout and the workflow-bundle import
  discipline.
- `src/query/README.md`: the two read-side services that are not domains.
- `docs/authorization-coverage.md`: every entry point's authorization posture.
- `fga/model/README.md`: the authorization model and its compiled file's
  contract.
- `test/conformance/README.md`: the cross-edition suite this server is held to.

## Laws

- Proto first, one implementation. A core RPC change starts in `apis/` and lands
  here once. Classify every change as core, cloud-only or OSS-only before
  writing code; a cloud need no extension point serves gets a new point here,
  never a composition-side copy of a core step.
- Store discipline. Domain code depends on `src/store/interface.ts` and never on
  a driver directory; drivers own their SQL; migrations are versioned per driver
  and reviewed like a proto change; every query pattern has an index. A
  behaviour both drivers must share is pinned in
  `src/store/__tests__/store-contract.ts`.
- Temporal discipline. Deterministic workflows, idempotent activities, signals
  that carry identity only, explicit timeouts, and the SDK's `patched` and
  `deprecatePatch` for changes that meet in-flight executions. Workflow, queue,
  signal and memo names are wire constants
  (`src/temporal/agentexecution/names.ts`).
- Errors are API surface. The correct Connect code, a message in domain terms
  naming the handle, and the store-fault mapping: `ResourceNotFoundError` is
  `NotFound`; any other store failure is an infrastructure fault, rethrown in a
  step or wrapped with `internalError` from `src/pipeline/errors.ts`, the real
  error logged and the sanitized text on the wire. Existing error copy is wire
  contract.
- Authorization is structural. Every pipeline chain opens with the `Authorize`
  step, and a direct handler evaluates the same annotation through
  `authorizeDirect` (`src/pipeline/steps/authorize.ts`). Adding, removing or
  re-annotating an RPC updates `docs/authorization-coverage.md` in the same
  change.
- Shared vocabulary is frozen. Pipeline step names and gate-slot names are never
  renamed and never given synonyms.
- The quality gate here is `tsc --noEmit`, Prettier and tests; there is no
  ESLint in this package by design. Tests are co-located in a `__tests__` folder
  beside the module, never in a parallel tree.

## Skills

- `.agents/skills/ts-server-dev-guidelines/SKILL.md`: the reasoning behind the
  laws above, the extension-point conventions, the error contract in full, and
  how a core change reaches the cloud edition. Load it before changing a chain,
  an extension point, a store driver or a workflow.
- `.agents/skills/model-fga-authorization/SKILL.md`: the order of work for an
  authorization-model change.

## Verify

The root map's row (`make test-server`), plus from this directory
`npm run typecheck` and `npm test`; `npm run build && npm run verify:dist` when
the barrel or the boot stages change; the touched domain's conformance suite
green on the `local` target (`make test-conformance`) before domain work counts
as done.
