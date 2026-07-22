# Datastore domain (OSS Go reference implementation)

The `Datastore` primitive: YAML-declared collections of typed business
records with constraints, role-aware access grants, and built-in
record RPCs agents call through the mcp-server bridge (T05). This
package is the **Go reference implementation** — the cloud Java
implementation (T04) mirrors every algorithm above the storage
interface byte-for-byte (validation messages, error contract, CEL
semantics, grant resolution).

Design decisions of record: DD-001–DD-009 in
`stigmer-cloud/_projects/2026-07/20260720.01.agent-datastore-primitive/`.

## Package layering

| Package | Responsibility |
|---|---|
| `controller` | gRPC handlers. Resource controllers (apply/create/update/delete/updateVisibility/get/getByReference/list) as pipelines; record controllers (find/insert/update/delete/describe) as the explicit authorization spine |
| `controller/steps` | Datastore-specific pipeline steps: spec validation, org quota, gating schema sync, the two delete guards, table drop |
| `schemasync` | Sync-on-apply engine: additive-plus change matrix, runtime DDL orchestration, seed-once insertion, the status sync report |
| `records` | Record write/read mechanics: payload validation, defaults, partial merge, constraint evaluation, filter/order-by validation, envelope projection |
| `authz` | Layer-2 record authorization: subject → binding → role → per-collection grant (verb + own scope) |
| `celeval` | Scope-fenced CEL engine: `this`/`that`/`tz`, curated `timeOfDay`/`localDate`, program cache. Conformance corpus: `apis/ai/stigmer/agentic/datastore/v1/conformance/` |
| `schema` | Canonical field-value encodings (the cross-edition value contract) |
| `recordstore` | SQLite substrate: per-(datastore, collection) tables in `stigmer.db`, uniques as partial expression indexes over `json_extract`, `BEGIN IMMEDIATE` write transactions |
| `identity` | The OSS caller subject: the fixed local principal + subject equality/keying (a cross-edition storage contract) |
| `dserrors` | The record-RPC error contract: gRPC codes + `google.rpc.ErrorInfo`, byte-identical messages both editions |
| `validation` | Cross-field spec validation the proto cannot express |

## Load-bearing invariants (tested)

- **Two-layer authorization, deny by default** (DD-002): Layer 1 reach
  is OSS local-trust; Layer 2 (bindings/`default_role`/verbs/`own`)
  runs identically to cloud against the fixed local principal. The
  cloud edition additionally dispatches by credential class (T05):
  sandbox-token callers take the DD-006 reach chain with the
  sender-identity subject and the instance-derived partition. OSS has
  no session-scoped tokens, so its agent sessions resolve as the local
  principal in the `default` partition — a recorded limitation
  (T05 R2, DD-010 amendment), not an accident.
- **Constraints inside the write transaction** (DD-004/DD-007): checks
  and exists/not_exists evaluate under `BEGIN IMMEDIATE`, so no write
  commits against a stale verdict — see the schedule-close vs
  booking-insert concurrency test in `controller`.
- **Uniques are substrate indexes, never read-then-write**: violations
  parse the deterministic index name back to the declared constraint;
  raw driver errors never cross the RPC boundary.
- **Schema sync is synchronous, gating, and fail-loud**: a rejected
  transition restores the prior schema (create rolls back; update
  restores with `last_sync_outcome: rejected`); no transition silently
  destroys or nulls data; removed-collection data is retained
  invisibly until the datastore's guarded delete.
- **System fields are server-stamped, never caller-writable**, on every
  surface including seeds.
- **Guarded delete** (DD-003): agent-reference block (never forceable),
  then non-empty force acknowledgment with real substrate counts.

## Testing

```bash
go test -race ./pkg/domain/datastore/...
```

Unit tests are co-located per package; `controller` holds the
in-process end-to-end tests (the clinic acceptance shape from the T01
spec §9), and `celeval` runs the cross-edition conformance corpus that
T04 consumes with a parity check.
