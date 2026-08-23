# store/ — the persistence layer

Ports `backend/libs/go/store` (D2 §3, DD-003): `interface.ts` is the
driver-agnostic contract (surface-for-surface with Go's `store.Store`, plus
the consolidated members Go kept behind the `DB()` escape hatch — bootstrap
state, signal dedupe, MCP OAuth); `sqlite/` is the phase-1 `node:sqlite`
driver with the versioned migration chain (v1–v6 adopted from Go
DDL-faithful, v7 = the OD-3 consolidation).

Domain code depends on `interface.ts` only — never on `sqlite/` — so the
phase-2 Postgres driver drops in behind the same contract. Schema
continuity across cutover (any Go-created database adopts forward; a v7
database rolls back to Go untouched) is proven by
`sqlite/__tests__/migrations.test.ts` against a real Go-created fixture;
regenerate it with `scripts/regen-go-db-fixture.sh`.
