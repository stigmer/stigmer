# Agent guide: backend/services/runner

The Temporal worker that runs agent turns and workflow executions, published as
`@stigmer/runner` and embedded by `stigmer up`, the cloud provisioner and the
desktop app. One turn runtime serves every harness (native deep-agent, Cursor);
a harness is a registry row and an SDK slice. This guide is an index; the
headers it names are the truth.

## Read in this order

- `README.md`: run modes, execution location versus transport, every environment
  variable. Operating knowledge lives there, not in `config.ts`.
- `src/harness/README.md`: the harness layer's own index, including every site a
  new harness touches and the contract kit.
- `src/harness/types.ts` header: the adapter contract, what the runtime owns
  versus what a harness owns, and what is deliberately not on the contract.
- `src/harness/run-turn.ts` header: the turn runtime, what runs there and
  nowhere else; then `src/harness/persist-chokepoint.ts` and
  `src/harness/terminal-table.ts`.
- `src/harness/capabilities.ts`: the flags the runtime branches on instead of
  harness names, with the capability matrix.
- `src/harness-adapters.ts` and `src/harness/registry.ts`: the one table of
  harnesses, its load-bearing boot order, the byte-pinned activity binding.
- `src/__test-utils__/harness-contract/`: the contract kit every adapter and the
  runtime itself must pass; `src/__test-utils__/harness-contract/types.ts`
  first.
- `src/ipc-protocol.ts` and `docs/ipc-protocol.md`: the manager-mode IPC
  contract and where its one home is.
- `src/workflows/`: the serverless-workflow engine and its orchestrators;
  `test/golden/` pins its behaviour.

## Laws

- One home per fact. Data that exists in two places drifts; a "sync" step
  between two representations is a duplication to delete, not a mechanism to
  polish.
- One writer per field. Name the writer before adding a mutable field to a
  shared status or record; a merge respects ownership and never overwrites a
  field with a stale value from a non-owner.
- Payloads carry only what the consumer cannot already read. An interrupt, a
  signal or an IPC message carries identity, not a copy of what the record
  holds.
- Direct identity, never fuzzy matching. Find the framework's identity primitive
  (LangGraph, MCP, Temporal, `@cursor/sdk`) before building a matcher or an
  alias map.
- Derived state is computed on read. Approval decisions are read from the
  persisted tool-call rows on the next invocation, never kept in a second map.
- The runtime branches on capability flags, never on harness names. A phase that
  must differ per engine asks `capabilities.ts`; a new harness is a row in
  `src/harness-adapters.ts`, an adapter under `src/activities/`, and a green run
  of the contract kit, not a new branch in a phase.
- Import direction is enforced: nothing under `src/harness/` imports from
  `src/activities/` (`src/harness/__tests__/import-direction.test.ts`).
- Every status write during a turn goes through the persist chokepoint; every
  terminal is written by `settleWith` and no other site.
- Wire vocabulary is pinned: Temporal activity and queue names, the IPC protocol
  version (bumped only on a breaking change), the terminal table's copy. A
  rename is a protocol break.
- LLM-dependent behaviour is tested with deterministic mocks and asserted on
  structure and side effects, never on prose; concurrent scenarios (two
  approvals at once, a status write racing an approval) get their own tests.

## Skills

- `.agents/skills/runner-dev-guidelines/SKILL.md`: the design procedure (map the
  data flow, find the framework's primitive, carry identity), the reasons behind
  the laws above, and the worked cases. Load it before changing turns,
  approvals, interrupts, MCP handling or Temporal coordination.

## Verify

The root map's row (`make test-runner`), plus from this directory
`npm run typecheck` and `npm test`; `make gen-ipc-fixtures-check` when
`src/ipc-protocol.ts` changes; `npm run build && npm run verify:dist` when the
composition roots or the harness table change.
