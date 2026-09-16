# Agent guide: test/conformance

The cross-edition gRPC contract suite: one set of tests run against every
edition of the control plane, and the one instrument that turns a behavioural
difference between editions into a failing test. Runner behaviour is proven here
too, read through execution status against a scripted LLM. This guide is an
index; `README.md` is the reference.

## Read in this order

- `README.md`: status, how to run each class, the design (raw stubs rather than
  the SDK, spec-first contract, targets and capability flags, the harness, the
  execution class), the layout, and the two "Adding a ..." procedures.
- `src/targets/target.ts`: the `TargetProfile` interface and every
  `CapabilityFlags` member with its rationale; `src/targets/` for the six
  profiles.
- `src/harness/`: one file per component (server, Temporal, runner, mock LLM,
  MCP fixture, git workspace, cloud fixtures); read a file's header before using
  it, and extend the harness rather than reinventing a piece in a suite.
- `src/support/`: the per-domain helpers a suite calls; `src/contract/` for the
  error and parity vocabulary.
- `inventory/cloud-capabilities.yaml`: the cloud capability rows every tagged
  `it` must name.

## Laws

- Raw stubs, never `@stigmer/sdk`. The suite is a black box over the proto
  contract; a convenience layer under test would hide drift in the layer it
  wraps.
- An edition difference is a `CapabilityFlags` entry with a rationale, gated
  with `describe.skipIf` so the run reports SKIPPED. Never a target-name check,
  never a silent return, never a forked assertion.
- The suite asserts the intended contract. A server answer that disagrees is a
  server bug or a contract question, never something the test is bent to accept.
- Where a test lives: a cross-edition contract or a runner behaviour read
  through execution status is here; a server or runner unit sits beside its
  module in a `__tests__` folder; React units under `sdk/react/src/`; Playwright
  under `test/e2e/tests/`.
- Facet files, not new files. A behaviour extends the existing
  `<domain>-<facet>.conformance.test.ts`; a new facet opens with an intent
  header stating the contract it pins and what is deliberately out of scope.
- The three shapes: a runner behaviour is scripted on the mock LLM and read from
  the terminal execution status; every approval goes through
  `submitApprovalPerContract` in `src/support/agentexecutions.ts`, never a bare
  submit followed by an expectation on pending approvals; a file-review turn
  attaches a `GitWorkspace` and decides through `src/support/file-review.ts`.
- Determinism: poll with a timeout, never sleep; unique resource names per test
  (`src/support/naming.ts`); no order dependence; temp dirs only; LLM-dependent
  assertions on structure and side effects, never on prose.
- A cloud capability suite tags each `it` with its inventory row ids and scripts
  upstreams through the cloud fixtures' control client, never by importing a
  fake into the worker.

## Skills

- `.agents/skills/conformance-test-authoring/SKILL.md`: which class a behaviour
  belongs to, the three shapes with code, the harness components to reuse, and
  the test discipline. Load it before adding or extending a suite.
- `.agents/skills/test-gate/SKILL.md`: the adversarial gate, invoked by name
  when a change must not leave the conversation without tests.

## Verify

The root map's rows, plus from the package: `npm run test:unit` for the
harness's own units, `npm run inventory:check` when a cloud suite or the
inventory changes, `make test-conformance-execution` when a runner behaviour
changes (needs the `temporal` and `stigmer` CLIs and git).
