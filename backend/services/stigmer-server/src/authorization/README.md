# authorization/ — the built-in authorizer

Open source's own `Authorizer` and `ListReadScope`, composed when a server runs
under an authentication posture and no unit registers its own. It is not a
domain: it drives two ports the registry declares (`extensions/authorizer.ts`,
`extensions/list-read-scope.ts`) by reading two aggregates it does not own —
resources through the generic `Store`, roles through the `IamPolicyStore` port —
and writes nothing.

The idea, once: in the cloud, authorization is the OpenFGA model evaluated over
stored tuples, and every tuple is derived from a row by
`kind_meta.authorization` except the one that is a fact, the IamPolicy row. So
open source evaluates the same model over the same tuples, derived from the row
when a check asks instead of stored. One meaning of authorization in both
editions; the cloud stores what open source computes.

## Parts

- `model/rewrite.ts` — the four relation-rewrite forms the 27 `.fga` files use
  (`this` with its type restrictions, `computed`, `from`, `union`), the
  builders, and `declareKind`, which refuses a transcript that cannot be right
  at module load.
- `model/<kind>.ts` — one transcript per open-source kind (twenty-three), the
  `.fga` file's relations in the file's order, its path in the header.
  `model/index.ts` registers them in `fga.mod` order and answers by kind or by
  FGA type name. Two relations no row carries as a `kind_meta` fact have a
  `derived` rule beside their transcript: `default_of` on the two instance kinds
  (`model/default-of.ts`, from the blueprint's `status.default_instance_id`) and
  `execution_viewer` on the workflow instance (from
  `spec.execution_visibility`).
- `tuples.ts` — the tuple vocabulary (object, relation, subject; the string
  notation), `Person` (the caller as the model sees them: account id plus the
  aliases a creator stamp may carry), `CheckContext` (the `allow_public`
  parameter: `allow: true` on a point check, `false` in a listing — the cloud's
  own posture).
- `evaluator.ts` — OpenFGA's check over a model and a tuple source: type
  restrictions enforced on direct tuples (model drift fails closed), a memo per
  (object, relation), OpenFGA's depth bound, cycles and undeclared targets as
  faults, never silent denials.
- `facts.ts` — `RowFacts`, what a row carries that its tuples derive from;
  produced from a loaded row here and from a list candidate's metadata in the
  list scope.
- `derived-tuples.ts` — the derivation (the cloud driver's shapes, from the
  facts) and the source that joins it with the person's IamPolicy rows, read
  once per source. The two edition-specific facts live here: the organization's
  owner is a row, and a stamp that names no person is no tuple.
- `store-test-kit.ts` — runs an OpenFGA store test (`.fga.yaml`) against the
  evaluator, vitest-free, exported from the barrel. Open source runs it over
  pinned copies of the cloud's own model tests (`__tests__/fixtures/fga/`, a
  byte-exact mirror of the cloud's `fga/tests/`); the cloud runs it over the
  live files at the re-pin. What it does not run it reports in three reasons: a
  target kind the model does not declare, a `list_objects` assertion, and an
  assertion whose walk read a grant through a type the model does not declare
  (the cloud's platform tenancy, `identity_provider#platform_user`).

Still to land: the `Authorizer` driver and the built-in organization directory
with the composition root's posture, the `ListReadScope` on both verbs.

## Proof

`__tests__/store-tests.test.ts` is the proof that this evaluator answers the
cloud's model the cloud's way: every `checkRelation` assertion of all twenty
documents on a declared kind, in the documents' own words, with what is not run
pinned as a named list. `__tests__/facts.test.ts` pins that the derivation reads
a row to the same links and shapes the tuple lifecycle writes from, for every
kind. `model/__tests__/registry.test.ts` pins the declared set to the
open-source tier and each kind's wire permissions to its file;
`__tests__/wire-permissions.test.ts` pins that every static `(kind, permission)`
a served RPC asks about is a declared relation. The rest pin the machinery:
alias matching, the wildcard's condition, the memo, the bounds, the source and
the two derived rules on both store drivers.
