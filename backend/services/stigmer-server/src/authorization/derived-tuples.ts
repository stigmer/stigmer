/**
 * The derived tuple view — the ONE place the built-in authorizer knows
 * what open source's tuples would have been. The cloud stores tuples its
 * driver writes from every row's lifecycle (stigmer-cloud
 * iam/tuple-lifecycle.ts); open source stores none and computes the same
 * tuples from the row when a check asks ("derived state over stored
 * state"). `deriveTuples` is that computation, pure over `RowFacts`, in
 * the driver's own shapes:
 *
 *   - parent links:   <row>#<relation>@<parentKind>:<parentId>   (the scope link, then the additional parents)
 *   - owner DIRECT:   <row>#owner@identity_account:<creator stamp>
 *   - owner SELF:     <row>#owner@identity_account:<row id>
 *   - creator:        <row>#creator@identity_account:<creator stamp>   (kinds flagged requires_creator_tuple)
 *   - org-viewer:     <row>#viewer@organization:<org>#viewer          (visibility_org; cloud#257's shape)
 *   - platform-viewer: none — it fans out over identity providers, a kind this edition does not serve
 *
 * Two facts are this edition's own and are stated here, nowhere else:
 *   - The ORGANIZATION's owner is a ROW, not a derivation. 2b's role
 *     lifecycle (domain/iampolicy/role-lifecycle.ts) writes the creator's
 *     `owner` row for exactly that kind, and the grant path writes every
 *     other role; deriving an owner tuple from the creator stamp as well
 *     would keep a revoked founder owner forever. ROW_RECORDED_OWNER_KINDS
 *     is the read side of the lifecycle's "only organization" guard.
 *   - A stamp that names no person becomes no tuple: `""` and the
 *     unconfigured laptop's `"system"` (`isPersonStamp`, the membership
 *     rules' one predicate). The person comparison itself is the
 *     evaluator's, over the aliases `Person` carries.
 *
 * The SOURCE joins two records per (object, relation): the person's own
 * IamPolicy rows on the object (read ONCE per source through
 * `findByPrincipal` — every row open source writes names an account id,
 * so the person's account id is the whole key, and on the OSS adapter one
 * read is one scan whatever the number of organizations walked) and the
 * tuples derived from the object's row (loaded once per object through
 * the loader, which a declaration's `derived` rule also reads related
 * rows through). An absent row is no tuples — the target's own not-found
 * is the driver's arm, and a parent that no longer exists simply grants
 * nothing, as in the cloud; any other store fault propagates so the
 * driver folds it to `unavailable`. One source per check (or per list
 * call for the list scope): its memo is the check's.
 *
 * A source may be SEEDED with the facts of objects the caller already
 * holds (the list scope's candidates, decoded by the lane and carried on
 * every `ListEntryMeta`): a seeded object's tuples derive from those facts
 * and its row is never read — the facts are exactly what the derivation
 * reads (facts.ts). The seed stands in for the row only where the row
 * would have been read for FACTS; a declaration's `derived` rule reads
 * the row it needs through the loader as before (`default_of` reads the
 * instance's blueprint pointer, `execution_viewer` the instance's level —
 * spec fields the facts do not carry), so listing the two instance kinds
 * costs one row read per candidate, stated in the scope's cost pins.
 *
 * Rows are read through the generic Store, with one exception: an
 * `identity_account` object is read through the account PORT
 * (`accounts.findById`), the binding every other reader of accounts —
 * the verifiers, whoAmI, the create path — follows. A composition that
 * registers its own account store and keeps the built-in authorizer
 * therefore still lets a person read their own account (the derivation
 * is `owner@self`); a generic read would miss and deny them their own
 * row. IamPolicy rows are already the port's (`findByPrincipal`), so no
 * second exception is needed for them.
 */
import type { Message } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { isPersonStamp } from "../domain/iampolicy/membership.js";
import type { IamPolicyStore } from "../domain/iampolicy/store.js";
import type { IdentityAccountStore } from "../domain/identityaccount/store.js";
import type { VisibilityTupleShape } from "../extensions/resource-authorization.js";
import {
  getKindMeta,
  kindByEnumName,
  kindEnumName,
} from "../pipeline/apiresource-meta.js";
import { visibilityShapesFor } from "../pipeline/steps/authorization-tuples.js";
import type { Store } from "../store/interface.js";
import { ResourceNotFoundError } from "../store/interface.js";
import type { RowFacts } from "./facts.js";
import { rowFactsOf } from "./facts.js";
import type { Model } from "./model/index.js";
import { builtInModel } from "./model/index.js";
import type {
  ObjectRef,
  Person,
  RowLoader,
  Subject,
  Tuple,
  TupleSource,
} from "./tuples.js";
import { ACCOUNT_TYPE, formatObjectRef } from "./tuples.js";

/**
 * Kinds whose `[identity_account]` owner is recorded as an IamPolicy row
 * by this edition (the module header): the derivation writes no owner
 * tuple for them. Mirrors role-lifecycle.ts's create arm, which writes
 * the row for `organization` and nothing else.
 */
export const ROW_RECORDED_OWNER_KINDS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.organization,
]);

function account(id: string): Subject {
  return { form: "object", object: { type: ACCOUNT_TYPE, id } };
}

/** The tuples a row stands for, in the cloud driver's shapes and order. */
export function deriveTuples(facts: RowFacts): ReadonlyArray<Tuple> {
  const object: ObjectRef = { type: kindEnumName(facts.kind), id: facts.id };
  const config = getKindMeta(facts.kind).authorization;
  if (config === undefined) {
    return [];
  }
  const tuples: Tuple[] = [];
  for (const link of facts.parentLinks) {
    tuples.push({
      object,
      relation: link.relation,
      subject: {
        form: "object",
        object: { type: kindEnumName(link.parentKind), id: link.parentId },
      },
    });
  }
  const stampIsPerson = isPersonStamp(facts.createdBy);
  switch (config.ownerType) {
    case OwnerAttributionType.DIRECT:
      if (stampIsPerson && !ROW_RECORDED_OWNER_KINDS.has(facts.kind)) {
        tuples.push({
          object,
          relation: "owner",
          subject: account(facts.createdBy),
        });
      }
      break;
    case OwnerAttributionType.SELF:
      tuples.push({ object, relation: "owner", subject: account(facts.id) });
      break;
    case OwnerAttributionType.INHERITED:
    case OwnerAttributionType.NONE:
    case OwnerAttributionType.UNSPECIFIED:
      // Inherited: the model walks `owner from <parent>`; none: the kind has no owner.
      break;
    default: {
      const exhaustive: never = config.ownerType;
      throw new Error(`unknown owner attribution: ${String(exhaustive)}`);
    }
  }
  if (config.requiresCreatorTuple && stampIsPerson) {
    tuples.push({
      object,
      relation: "creator",
      subject: account(facts.createdBy),
    });
  }
  for (const shape of visibilityShapesFor(facts.kind, facts.visibility)) {
    const subject = visibilitySubject(shape, facts.org);
    if (subject !== undefined) {
      tuples.push({ object, relation: "viewer", subject });
    }
  }
  return tuples;
}

/** The driver's grant table for a visibility shape; undefined where this edition writes nothing. */
function visibilitySubject(
  shape: VisibilityTupleShape,
  org: string,
): Subject | undefined {
  switch (shape) {
    case "org-viewer":
      // No organization to point at (a legacy row): no userset.
      return org === ""
        ? undefined
        : {
            form: "userset",
            object: { type: "organization", id: org },
            relation: "viewer",
          };
    case "platform-viewer":
      return undefined;
    default: {
      const exhaustive: never = shape;
      throw new Error(`unknown visibility shape: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The source.
// ---------------------------------------------------------------------------

export interface DerivedTupleSourceDeps {
  readonly store: Store;
  /** The port the grant path writes through — the rows are read from the same instance. */
  readonly policies: IamPolicyStore;
  /** The account port — an `identity_account` object is read through it, never the generic Store (the module header). */
  readonly accounts: Pick<IdentityAccountStore, "findById">;
  /** The declarations to derive with; the built-in model unless a test says otherwise. */
  readonly model?: Model;
}

export interface DerivedTupleSource extends TupleSource {
  /** The memoised row reads, exposed for a declaration's `derived` rules and for tests. */
  readonly loader: RowLoader;
  /**
   * The person's own IamPolicy rows as tuples — the ONE read of them this
   * source makes, shared with `tuplesOf`. A list-shaped consumer (the
   * organization directory; the list scope) reads its candidate objects
   * from here instead of scanning the port a second time.
   */
  personTuples(): Promise<ReadonlyArray<Tuple>>;
}

export interface DerivedTupleSourceSeed {
  /** Objects whose facts the caller already holds; their rows are not read for derivation. */
  readonly facts: ReadonlyArray<RowFacts>;
}

export function newDerivedTupleSource(
  deps: DerivedTupleSourceDeps,
  person: Person,
  seed?: DerivedTupleSourceSeed,
): DerivedTupleSource {
  const model = deps.model ?? builtInModel;
  const rows = new Map<string, Promise<Message | undefined>>();
  const derived = new Map<string, Promise<ReadonlyArray<Tuple>>>();
  const seeded = new Map<string, RowFacts>();
  for (const facts of seed?.facts ?? []) {
    seeded.set(
      formatObjectRef({ type: kindEnumName(facts.kind), id: facts.id }),
      facts,
    );
  }
  let personRows: Promise<ReadonlyArray<Tuple>> | undefined;

  const loader: RowLoader = {
    load(object) {
      const key = formatObjectRef(object);
      const held = rows.get(key);
      if (held !== undefined) {
        return held;
      }
      const loading = loadRow(deps, model, object);
      rows.set(key, loading);
      return loading;
    },
  };

  function derivedTuplesOf(object: ObjectRef): Promise<ReadonlyArray<Tuple>> {
    const key = formatObjectRef(object);
    const held = derived.get(key);
    if (held !== undefined) {
      return held;
    }
    const declaration = model.byType(object.type);
    const known = seeded.get(key);
    let deriving: Promise<ReadonlyArray<Tuple>>;
    if (declaration === undefined) {
      deriving = Promise.resolve([]);
    } else if (known !== undefined) {
      deriving = Promise.resolve(deriveTuples(known));
    } else {
      deriving = loader
        .load(object)
        .then((row) =>
          row === undefined
            ? []
            : deriveTuples(rowFactsOf(declaration.kind, row)),
        );
    }
    derived.set(key, deriving);
    return deriving;
  }

  function rowTuples(): Promise<ReadonlyArray<Tuple>> {
    if (personRows === undefined) {
      personRows = deps.policies
        .findByPrincipal(ACCOUNT_TYPE, person.accountId)
        .then((found) => found.map(tupleOfRow));
    }
    return personRows;
  }

  return {
    loader,
    personTuples: rowTuples,
    async tuplesOf(object, relation) {
      const onPair = (tuple: Tuple): boolean =>
        tuple.relation === relation &&
        tuple.object.type === object.type &&
        tuple.object.id === object.id;
      const fromRows = (await rowTuples()).filter(onPair);
      const declaration = model.byType(object.type);
      if (declaration === undefined) {
        return fromRows;
      }
      const fromRow = (await derivedTuplesOf(object)).filter(onPair);
      const rule = declaration.derived.get(relation);
      if (rule === undefined) {
        return [...fromRows, ...fromRow];
      }
      const row = await loader.load(object);
      const fromRule = row === undefined ? [] : await rule(object, row, loader);
      return [...fromRows, ...fromRow, ...fromRule];
    },
  };
}

/** The decoded row for an object, or undefined when the kind is not declared or the row does not exist. */
async function loadRow(
  deps: Pick<DerivedTupleSourceDeps, "store" | "accounts">,
  model: Model,
  object: ObjectRef,
): Promise<Message | undefined> {
  const declaration = model.byType(object.type);
  const kind = kindByEnumName(object.type);
  if (
    declaration === undefined ||
    kind === ApiResourceKind.api_resource_kind_unknown ||
    object.id === ""
  ) {
    return undefined;
  }
  if (kind === ApiResourceKind.identity_account) {
    return deps.accounts.findById(object.id);
  }
  try {
    return await deps.store.getResource(kind, object.id, declaration.schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

/** An IamPolicy row as the tuple it records: `resource#relation@principal`. */
function tupleOfRow(row: IamPolicy): Tuple {
  const spec = row.spec;
  const principal = spec?.principal;
  const resource = spec?.resource;
  const object: ObjectRef = {
    type: resource?.kind ?? "",
    id: resource?.id ?? "",
  };
  const principalObject: ObjectRef = {
    type: principal?.kind ?? "",
    id: principal?.id ?? "",
  };
  // A principal id of `*` (a wildcard row a cloud database may still hold
  // from the retired public level) is read as an ordinary object id here:
  // no person carries `*` among their aliases, so the row matches nobody
  // and reads as the inert grant it is, never as a fault that would turn
  // the resource unreadable.
  const subject: Subject =
    principal !== undefined && principal.relation !== ""
      ? {
          form: "userset",
          object: principalObject,
          relation: principal.relation,
        }
      : { form: "object", object: principalObject };
  return { object, relation: spec?.relation ?? "", subject };
}
