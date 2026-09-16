---
name: conformance-test-authoring
description:
  How to add or extend a test in the cross-edition conformance suite under
  test/conformance, covering which class a behaviour belongs to, the three test
  shapes with their support helpers, the harness components to reuse, the
  determinism rules, and the adversarial posture a reviewer brings. Use when
  writing, extending or reviewing a conformance test or a harness component.
paths:
  - test/conformance/**
---

# Authoring conformance tests

`test/conformance/README.md` is the reference: how to run each class, the
design, the layout, and the two "Adding a ..." procedures. The package guide
(`test/conformance/AGENTS.md`) carries the laws. This skill carries the shapes a
new test takes, so that it looks like the suite it joins, and the posture that
makes a test worth having. The discipline shared with every test in the
repository is in [references/test-discipline.md](references/test-discipline.md).

## Which class, which file

- A cross-edition contract (an RPC's behaviour every edition must share) is a
  Class A test under `test/conformance/src/suites/`, run by
  `make test-conformance` against the OSS server built from source; the
  `local-postgres` target runs the same files over the Postgres driver.
- A runner behaviour read through execution status is an execution-class test
  under `test/conformance/src/suites-execution/`, run by
  `make test-conformance-execution` (Temporal, the server and the runner from
  source; every model turn scripted on the mock LLM).
- A cloud capability is a cloud-class test, connect-only against a
  pre-provisioned composition, tagged with its inventory rows.
- A server or runner unit belongs beside its module in a `__tests__` folder, not
  here. A harness unit belongs in `test/conformance/src/harness/__tests__/`.

Extend the existing `<domain>-<facet>.conformance.test.ts` when the facet
exists; the execution class has one file per facet (`agentexecution-approval`,
`agentexecution-file-review`, `workflowexecution-signal`, and the rest), and a
new file is a new facet, opened with an intent header that states the contract
it pins and what is deliberately out of scope.

## The three shapes

**A runner behaviour, read through execution status.** Script the model's turns,
create the execution, await the terminal phase, assert on the phase and on what
the mock consumed:

```ts
mock.enqueue(anthropicToolUse("call_1", ECHO_TOOL_NAME, { text: "ping" }));
mock.enqueue(anthropicText("Done."));
const execution = await clients.agentExecutionCommand.create(
  makeAgentExecution({ org, name, agentId, autoApproveAll: true }),
);
const final = await awaitTerminal(clients, execution.metadata!.id);
expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
expect(mock.consumed(), "exactly the scripted turns").toBe(2);
```

`anthropicText`, `anthropicToolUse` and the other turn builders live in
`test/conformance/src/harness/llm-wire.ts`; `makeAgentExecution` and
`awaitTerminal` in `test/conformance/src/support/agentexecutions.ts`.

**An approval gate.** Every submit goes through `submitApprovalPerContract`
(`test/conformance/src/support/agentexecutions.ts`), which asserts the
contract's pre- and post-conditions around the call. Never a bare submit
followed by an expectation on pending approvals: that shape passed while the
contract was broken, which is why the helper exists.

**A file-review turn.** Attach a `GitWorkspace`
(`test/conformance/src/harness/git-workspace.ts`) as the session's local
workspace, script write and edit turns, `awaitFileReview`, decide with
`submitFileDecisionByPath` or `submitChangeSetDecision`, then read the tree back
(`test/conformance/src/support/file-review.ts`).

For workflows: `makeLlmCallWorkflow`, `makeEvalWorkflow`,
`makeHumanInputWorkflow` and their siblings in
`test/conformance/src/support/workflows.ts`; `awaitTaskStatus` in
`test/conformance/src/support/workflowexecutions.ts`.

## Reuse the harness

One file per component under `test/conformance/src/harness/`: the server build
and process, the Temporal dev server, the runner build and the two runner
process modes, the mock LLM (`mock-llm.ts` with the wire builders in
`llm-wire.ts`), the MCP tool fixture (`mcp-server.ts`), the git workspace, the
model registry reader, the raw Connect clients, and the cloud fixtures with
their fakes. Read a component's header before using it. When a new pattern is
needed, add the utility to the harness so the next suite reuses it; a suite that
boots its own infrastructure is a second harness that will drift.

Edition differences are `CapabilityFlags` on the target
(`test/conformance/src/targets/target.ts`), each with a rationale, gated with
`describe.skipIf` so the run reports SKIPPED; never a target-name check and
never a silent return.

## Determinism, in the suite's own terms

- Poll with a timeout (`awaitTerminal`, `awaitTaskStatus`); never sleep.
- Unique resource names per test (`test/conformance/src/support/naming.ts`); no
  shared mutable state; no order dependence.
- Temp directories only; the harness owns cleanup in reverse order.
- Assertions on LLM-dependent behaviour read structure and side effects, never
  prose.
- The assertion message says what went wrong in terms a reader can act on: the
  execution id, the expected and observed phase, the elapsed time.

## Credentialed canaries

MCP servers in the catalogue that need a real credential are exercised by a
credentialed canary lane rather than by the offline classes. The manifest at
`seedpack/canary/credential-manifest.yaml` records each server's status; the
credentials themselves are held by the maintainers outside this repository. A
test that needs a live vendor has no offline arm and says so in its header.

## The package's own gates

From `test/conformance`: `npm run typecheck` (vitest does not typecheck),
`npm run test:unit` for the harness units, `npm run inventory:check` when a
cloud suite or `test/conformance/inventory/cloud-capabilities.yaml` changes. In
a fresh worktree, `make build-ts-stubs` first or the package cannot resolve
`@stigmer/protos`.
