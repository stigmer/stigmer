# authorization/ — the built-in authorizer

Open source's own `Authorizer`, organization directory, schedule fire caller and
`ListReadScope`, composed when a server runs under an authentication posture and
no unit registers its own — the **built-in posture** (`posture.ts`; the other
two are the trusted-local laptop's permissive default and a unit's own
Authorizer). It is not a domain: it drives ports the registry declares
(`extensions/authorizer.ts`, `extensions/organization-directory.ts`,
`extensions/schedule-fire-caller.ts`, `extensions/list-read-scope.ts`) by
reading aggregates it does not own — resources through the generic `Store`,
accounts through the `IdentityAccountStore` port, roles through the
`IamPolicyStore` port — and writes nothing.

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
- `model/<kind>.ts` — one transcript per open-source kind (twenty-four), the
  `.fga` file's relations in the file's order, its path in the header.
  `model/index.ts` registers them in `fga.mod` order and answers by kind or by
  FGA type name. Two relations no row carries as a `kind_meta` fact have a
  `derived` rule beside their transcript: `default_of` on the two instance kinds
  (`model/default-of.ts`, from the blueprint's `status.default_instance_id`) and
  `execution_viewer` on the workflow instance (from
  `spec.execution_visibility`).
- `tuples.ts` — the tuple vocabulary (object, relation, subject; the string
  notation), the `Person` type (the caller as the model sees them: account id
  plus the aliases a creator stamp may carry). The model declares no wildcard
  subject and no condition, so a check carries no context and the parser refuses
  the `type:*` notation.
- `person.ts` — the one construction of a `Person`: `resolvePerson` reads the
  caller's account through the port the way whoAmI does, `personFor` builds the
  aliases (the account id and the issuer subject; an email is nobody's) and
  refuses an identity that names no person. Every driver resolves the caller
  here.
- `evaluator.ts` — OpenFGA's check over a model and a tuple source: type
  restrictions enforced on direct tuples (model drift fails closed), a memo per
  (object, relation), OpenFGA's depth bound, cycles and undeclared targets as
  faults, never silent denials.
- `facts.ts` — `RowFacts`, what a row carries that its tuples derive from: the
  seam's `RowAuthorizationFacts` with the kind beside them. Two producers, one
  resolver: a loaded row (`rowFactsOf`) and a list candidate (`rowFactsOfEntry`
  over the `ListEntryMeta` the lanes' helper builds) both read through the
  pipeline leaf `pipeline/steps/authorization-facts.ts`, the read-time twin of
  the tuple lifecycle's create-time resolution, pinned equal to it.
- `derived-tuples.ts` — the derivation (the cloud driver's shapes, from the
  facts) and the source that joins it with the person's IamPolicy rows, read
  once per source, and with the rows granted to each team the person holds
  `member` on (one read more per team; open source serves no team, so its
  callers never pay it). The two edition-specific facts live here: the
  organization's owner is a row, and a stamp that names no person is no tuple. A
  source may be seeded with candidates' facts (the list scope), so a seeded
  object's tuples derive without a read of its row; a `derived` rule still reads
  the row it needs.
- `store-test-kit.ts` — runs an OpenFGA store test (`.fga.yaml`) against the
  evaluator, vitest-free, exported from the barrel. Open source runs it over
  pinned copies of the cloud's own model tests (`__tests__/fixtures/fga/`, a
  byte-exact mirror of the cloud's `fga/tests/`); the cloud runs it over the
  live files at the re-pin. What it does not run it reports in three reasons: a
  target kind the model does not declare, a `list_objects` assertion, and an
  assertion whose walk read a grant through a type the model does not declare
  (the cloud's platform tenancy, `identity_provider#platform_user`).

- `authorizer.ts` — the `Authorizer` driver, arm for arm the cloud's
  (`stigmer-cloud src/authorizer/fga-authorizer.ts`): the four pre-check denials
  with the Java copy; a kind this edition does not serve denied (a platform
  capability no self-host holds); the target loaded once through the source;
  `not-found` for a missing row except on the kinds the cloud never probes
  (`NOT_FOUND_EXEMPT_KINDS`: `identity_account`, `iam_policy` — account ids
  cannot be enumerated); the model's answer with an empty reason on a denial so
  the annotation's copy wins; every fault `unavailable`, never a denial and
  never a throw.
- `organization-directory.ts` — `findMyOrganizations` as the cloud answers it
  (`listObjectIds(can_view, organization)`): the organizations the person's rows
  name, kept when `can_view` holds; the `internal` class sees all (the
  in-process authorization skip); enumeration refused.
- `schedule-fire-caller.ts` — a fire acts as the schedule's creator, resolved
  from the row's stamp as an account id or as the 3.14.x raw subject; a stamp
  that names no person is the seam's deterministic refusal, which the RunStarter
  counts against the schedule instead of retrying forever.
- `list-read-scope.ts` — the `ListReadScope` driver, the cloud's twin
  (`stigmer-cloud src/iam/list-read-scope.ts`): every candidate a list lane
  offers is answered by `can_view`, the same question a get asks — one evaluator
  walk per candidate over one source seeded with the candidates' facts, so no
  candidate row is read twice and a parent hop reads each distinct parent once;
  the enumeration verb (search, recent activity, the two execution summaries —
  the console library rides it) scans the kind and evaluates the same way, a row
  that does not decode skipped; the `internal` class keeps everything (the
  in-process skip); a fault throws and is never an empty answer; an undeclared
  kind is a consumer bug, loud.
- `posture.ts` — the three postures, named once for the composition root and the
  boot log.

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
alias matching, the memo, the bounds, the source and the two derived rules on
both store drivers. The four drivers are pinned arm by arm on both store drivers
(`__tests__/authorizer.test.ts`, `organization-directory.test.ts`,
`schedule-fire-caller.test.ts`, `list-read-scope.test.ts` — the adversarial
cells first: the outsider, the viewer rung, the admin who does not read members'
conversations, the orphaned execution, the memory with no subject), the posture
at the wire over three real boots
(`extensions/__tests__/built-in-authorization-composed.test.ts`, the list lanes
included, and the two-boot proof that the sole person's lists are byte-identical
with and without the scope), and the scope's cost is measured rather than
assumed (`list-read-scope.measure.test.ts`, gated on `AUTHORIZATION_MEASURE=1`).
