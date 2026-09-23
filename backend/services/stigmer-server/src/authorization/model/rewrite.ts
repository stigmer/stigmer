/**
 * The relation-rewrite vocabulary the model declarations are written in —
 * the four forms an OpenFGA `define` line takes in the cloud's 27 `.fga`
 * files, and nothing more:
 *
 *   define organization: [organization]                      → direct(objectOf("organization"))
 *   define owner: [identity_account] or admin from organization
 *                → union(direct(objectOf("identity_account")), from("admin", "organization"))
 *   define viewer: [identity_account, organization#member, organization#viewer]
 *                   or owner or platform_viewer
 *                → union(direct(objectOf(...), usersetOf(...), usersetOf(...)),
 *                        computed("owner"), computed("platform_viewer"))
 *   define can_view: viewer                                   → computed("viewer")
 *
 * A subject type is an object type or a userset; the model admits no
 * wildcard (`type:*`) and declares no condition, so neither has a form
 * here. The day a line needs one, the transcript cannot be written and
 * the gap is a design act.
 *
 * A declaration file (model/<kind>.ts) is a TRANSCRIPT of its `.fga`
 * file: the same relations, in the file's order, each line rewritten in
 * these builders so a reader with the model open sees the same text, and
 * so a structural compare against the file (the cloud's drift test at
 * the re-pin) needs no translation table. Intersection and exclusion
 * (`and`, `but not`) do not appear in the model and have no node here;
 * the day they do, the transcript cannot be written and the gap is a
 * design act, not a silent approximation.
 *
 * The direct form carries its type restrictions (`[identity_account,
 * organization#viewer]`) because the evaluator ENFORCES them: a tuple
 * whose subject the line does not list is ignored, which is what OpenFGA
 * does at write time. That is the fail-closed property of this design —
 * a derivation that drifts from the model (a userset the line dropped)
 * makes open source deny, never allow.
 *
 * `derived` names the relations `kind_meta.authorization` cannot derive
 * from the row alone: `default_of` on an instance (the
 * blueprint's `status.default_instance_id` must name this row — one
 * blueprint read through the loader; default-of.ts, shared by the two
 * instance kinds) and `execution_viewer` on a workflow instance
 * (`spec.execution_visibility`; workflow_instance.ts). A declaration that
 * has such a relation states the rule beside the transcript; the tuple
 * source dispatches to it by relation.
 */
import type { DescMessage, Message } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import type { ObjectRef, RowLoader, Tuple } from "../tuples.js";

/** One entry of a direct line's type restriction list. */
export type SubjectType =
  /** `[organization]`, `[identity_account]` — objects of the type. */
  | { readonly form: "object"; readonly type: string }
  /** `[organization#viewer]` — everyone holding `relation` on an object of the type. */
  | {
      readonly form: "userset";
      readonly type: string;
      readonly relation: string;
    };

export type Rewrite =
  /** `[…]` — the tuples stored on the relation itself, restricted to the listed subject types. */
  | { readonly node: "this"; readonly subjects: ReadonlyArray<SubjectType> }
  /** `or owner` — another relation of the same object. */
  | { readonly node: "computed"; readonly relation: string }
  /** `admin from organization` — `relation` on every object the `tupleset` relation links to. */
  | {
      readonly node: "from";
      readonly relation: string;
      readonly tupleset: string;
    }
  /** `a or b or c` — the first true member wins, in the line's order. */
  | { readonly node: "union"; readonly members: ReadonlyArray<Rewrite> };

// ---------------------------------------------------------------------------
// Builders — named so a transcript reads like its `.fga` line.
// ---------------------------------------------------------------------------

export function objectOf(type: string): SubjectType {
  return { form: "object", type };
}

export function usersetOf(type: string, relation: string): SubjectType {
  return { form: "userset", type, relation };
}

export function direct(...subjects: ReadonlyArray<SubjectType>): Rewrite {
  return { node: "this", subjects };
}

export function computed(relation: string): Rewrite {
  return { node: "computed", relation };
}

export function from(relation: string, tupleset: string): Rewrite {
  return { node: "from", relation, tupleset };
}

export function union(...members: ReadonlyArray<Rewrite>): Rewrite {
  return { node: "union", members };
}

// ---------------------------------------------------------------------------
// A kind's declaration.
// ---------------------------------------------------------------------------

/**
 * A relation the row does not carry as a `kind_meta` fact: the rule that
 * derives its tuples for `object` from its decoded row, reading related
 * rows through the loader. The source hands the object it already
 * resolved so a rule never re-derives its own reference from the row.
 * Pure over its inputs; faults propagate.
 */
export type DerivedRelation = (
  object: ObjectRef,
  row: Message,
  loader: RowLoader,
) => Promise<ReadonlyArray<Tuple>>;

export interface KindDeclaration {
  readonly kind: ApiResourceKind;
  /** The FGA type name — the kind's enum member name, as the cloud renders objects. */
  readonly type: string;
  /** The kind's message schema: what a stored row decodes with, and where its audit lives. */
  readonly schema: DescMessage;
  /** The `.fga` file this transcribes, relative to the cloud's `fga/` folder. */
  readonly source: string;
  /** Every relation the file defines, in the file's order. */
  readonly relations: ReadonlyMap<string, Rewrite>;
  /** The relations `kind_meta` cannot derive (the module header). */
  readonly derived: ReadonlyMap<string, DerivedRelation>;
}

export interface KindDeclarationInput {
  readonly kind: ApiResourceKind;
  readonly schema: DescMessage;
  readonly source: string;
  readonly relations: ReadonlyArray<readonly [name: string, rewrite: Rewrite]>;
  readonly derived?: ReadonlyArray<
    readonly [name: string, rule: DerivedRelation]
  >;
}

/**
 * Builds a declaration and refuses a transcript that cannot be right at
 * module load: a relation declared twice, a `computed` naming a relation
 * the kind does not define, a `from` whose tupleset the kind does not
 * define (its `relation` is the PARENT's and is resolved at evaluation),
 * a derived rule for a relation the transcript does not declare.
 */
export function declareKind(input: KindDeclarationInput): KindDeclaration {
  const type = kindEnumName(input.kind);
  const relations = new Map<string, Rewrite>();
  for (const [name, rewrite] of input.relations) {
    if (relations.has(name)) {
      throw new Error(`${input.source}: relation '${name}' is declared twice`);
    }
    relations.set(name, rewrite);
  }
  for (const [name, rewrite] of relations) {
    for (const reference of localReferences(rewrite)) {
      if (!relations.has(reference.relation)) {
        throw new Error(
          `${input.source}: '${name}' names ${reference.role} '${reference.relation}', which ${type} does not declare`,
        );
      }
    }
  }
  const derived = new Map<string, DerivedRelation>();
  for (const [name, rule] of input.derived ?? []) {
    if (!relations.has(name)) {
      throw new Error(
        `${input.source}: a derived rule for '${name}', which ${type} does not declare`,
      );
    }
    derived.set(name, rule);
  }
  return {
    kind: input.kind,
    type,
    schema: input.schema,
    source: input.source,
    relations,
    derived,
  };
}

/** The relations of the SAME kind a rewrite names: computed targets and tuplesets. */
function localReferences(
  rewrite: Rewrite,
): ReadonlyArray<{ readonly role: string; readonly relation: string }> {
  switch (rewrite.node) {
    case "this":
      return [];
    case "computed":
      return [{ role: "relation", relation: rewrite.relation }];
    case "from":
      return [{ role: "tupleset", relation: rewrite.tupleset }];
    case "union":
      return rewrite.members.flatMap(localReferences);
    default: {
      const exhaustive: never = rewrite;
      throw new Error(`unknown rewrite node: ${JSON.stringify(exhaustive)}`);
    }
  }
}
