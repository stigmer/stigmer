# store/ — the persistence layer

Ports `backend/libs/go/store`: `interface.ts` is the
driver-agnostic contract (surface-for-surface with Go's `store.Store`, plus the
consolidated members Go kept behind the `DB()` escape hatch — bootstrap state,
MCP OAuth). Two drivers implement it:

- `sqlite/` — the laptop-tier default (`node:sqlite`, zero-config, one file)
  with its versioned migration chain (v1–v6 adopted from Go DDL-faithful, then
  this port's own steps, each named at its constant in `sqlite/migrations.ts`).
- `postgres/` — the self-host/team tier (`pg` pool, row-level `FOR UPDATE`
  atomicity, its own independent migration chain with real indexes,
  `tsvector`/`tsquery` search).

Selection is boot config (`boot/config.ts`): `DATABASE_URL` set → Postgres (it
wins when both are set — `DB_PATH` always has a default value); else sqlite on
`DB_PATH`. Domain code depends on `interface.ts` only — never on a driver
directory. Driver-neutral helpers shared by both drivers live here
(`proto-fields.ts` reflection + scan semantics, `list-index.ts`, `logger.ts`).

## The list index

A list lane reads one organization's or one parent's rows in creation order
through `Store.queryResources`, never by decoding the whole kind.
`list-index.ts` is the one derivation: a kind's declaration (beside its lanes,
`domain/<kind>/list-index.ts`) names its keys as data, the composition root
opens the store with the one list of declarations (`boot/list-indexes.ts`), and
every driver keeps a declared row's facts (organization, creation instant, keys)
in the same statement as the row.

Reads are exact whoever wrote the rows. A row whose facts are not proven current
— written by a binary that does not know the index, as the old pod does while a
roll overlaps it with the new one, or under another revision of the declaration
— is evaluated from its bytes and repaired by a compare-and-set on those bytes.
The migrations that add the index are schema only; the reconciliation each
driver runs at open derives every unproven row, so the unproven set is empty in
steady state and reads stay one index range. Every read shape names or forces
its index, because a freshly written table has no planner statistics.

## The session event log

Each session's ordered event log (`session-events.ts`) is its own table, `session_events`, numbered per session (`seq`) and stamped with the fixed-width UTC time the store accepted each event. Writers reach it two ways: `Store.sessionEvents.append`, a runner's events guarded by its run's row, and `Store.writeResourceAppendingEvents`, the one door for a resource write that must commit with events (a run's phase change and its session's status). The second reads the committed row and counts the session's other working rows from one list key (`working_session` on runs) without decoding a row, hands both to a synchronous writer, and commits the row and its events in one transaction.

One lock order everywhere: the session first, then rows. Postgres takes a transaction-scoped advisory lock on the session (`hashtextextended('session_events/' || id)`), then the row `FOR UPDATE`; an append takes the session's lock, then reads its guard row `FOR SHARE`. SQLite serializes every writer under `BEGIN IMMEDIATE`. So a session's numbers, times and working count are assigned by one writer at a time. The contract both drivers pass, and a composition runs over its own database, is the kit `session-events-contract.ts`.

## Contract and continuity

The behavioral contract both drivers must satisfy identically is
`__tests__/store-contract.ts`, invoked by each driver's store-contract test (`sqlite/__tests__/store-contract.test.ts`, `postgres/__tests__/store-contract.postgres.test.ts`)
(sqlite always; Postgres under `TEST_DATABASE_URL` — visible skips locally, a
real service container in CI). Driver-physical behavior stays in each driver's
own tests. One deliberate semantic difference: sqlite
serializes ALL writes globally as a side effect of its single synchronous
connection; Postgres guarantees per-resource atomicity only — the interface
contract is the narrower one.

Schema continuity across the Go cutover (any Go-created database adopts forward)
is proven by `sqlite/__tests__/migrations.test.ts` against a real Go-created
fixture. The fixture is FROZEN: the Go server retired, its schema can no
longer change, and the committed v6 dump is the permanent record of what real pre-cutover databases look like. The generator
script (`scripts/regen-go-db-fixture.sh`) was retired with it and remains in git
history should the fixture ever need forensic regeneration. The Postgres chain
has no adoption story by construction — no Postgres database predates its
driver.
