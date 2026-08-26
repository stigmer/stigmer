# store/ — the persistence layer

Ports `backend/libs/go/store` (D2 §3, DD-003): `interface.ts` is the
driver-agnostic contract (surface-for-surface with Go's `store.Store`, plus
the consolidated members Go kept behind the `DB()` escape hatch — bootstrap
state, signal dedupe, MCP OAuth). Two drivers implement it:

- `sqlite/` — the laptop-tier default (`node:sqlite`, zero-config, one
  file) with the versioned migration chain (v1–v6 adopted from Go
  DDL-faithful, v7 = the OD-3 consolidation).
- `postgres/` — the self-host/team tier (DD-010: `pg` pool, row-level
  `FOR UPDATE` atomicity, its own independent migration chain v1 with real
  indexes, `tsvector`/`tsquery` search per DD-009).

Selection is boot config (`boot/config.ts`): `DATABASE_URL` set → Postgres
(it wins when both are set — `DB_PATH` always has a default value); else
sqlite on `DB_PATH`. Domain code depends on `interface.ts` only — never on
a driver directory. Driver-neutral helpers shared by both drivers live
here (`proto-fields.ts` reflection + scan semantics, `logger.ts`).

The behavioral contract both drivers must satisfy identically is
`__tests__/store-contract.ts`, invoked by each driver's
`store-contract.test.ts` (sqlite always; Postgres under
`TEST_DATABASE_URL` — visible skips locally, a real service container in
CI). Driver-physical behavior stays in each driver's own tests. One
deliberate semantic difference is recorded in DD-010: sqlite serializes
ALL writes globally as a side effect of its single synchronous connection;
Postgres guarantees per-resource atomicity only — the interface contract
is the narrower one.

Schema continuity across the Go cutover (any Go-created database adopts
forward) is proven by `sqlite/__tests__/migrations.test.ts` against a real
Go-created fixture. The fixture is FROZEN: the Go server retired
(go-server-retirement, D4 #25), its schema can no longer change, and the
committed v6 dump is the permanent record of what real pre-cutover
databases look like. The generator script
(`scripts/regen-go-db-fixture.sh`) lived until #25 and remains in git
history should the fixture ever need forensic regeneration. The Postgres
chain has no adoption story by construction — no Postgres database
predates its driver.
