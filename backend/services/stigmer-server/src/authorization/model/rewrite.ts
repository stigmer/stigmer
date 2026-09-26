/**
 * The evaluator's vocabulary for the authorization model: the five
 * relation-rewrite forms OpenFGA's JSON uses in the compiled model
 * (data/authorization-model.json, read by openfga-json.ts), and a kind's
 * declaration as the evaluator consumes it. The model itself is the
 * `.fga` files under fga/model; this module only names its shapes.
 *
 *   define organization: [organization]        → this, subjects [organization]
 *   define owner: [identity_account] or admin from organization
 *                → union(this, from("admin", "organization"))
 *   define viewer: [identity_account, organization#viewer] or owner
 *                → union(this, computed("owner"))
 *   define member: [identity_account] and viewer from organization
 *                → intersection(this, from("viewer", "organization"))
 *   define can_view: viewer                    → computed("viewer")
 *
 * `and` exists for one shape: a relation that is true only while another
 * holds too (a team's member is a person granted the role AND still one
 * of the organization's viewers, so leaving the organization ends every
 * team-derived grant with no cleanup). Operators nest to any depth, as
 * the DSL's parentheses allow; the evaluator recurses through them.
 * `but not`, wildcards (`type:*`) and conditions have no form here: the
 * reader refuses them by name, and the day the model needs one is a
 * design act.
 *
 * The direct form carries its type restrictions (`[identity_account,
 * organization#viewer]`) because the evaluator ENFORCES them: a tuple
 * whose subject the line does not list is ignored, which is what OpenFGA
 * does at write time. That is the fail-closed property of this design:
 * a derivation that drifts from the model (a userset the line dropped)
 * makes the evaluator deny, never allow.
 *
 * `derived` names the relations `kind_meta.authorization` cannot derive
 * from the row alone: `default_of` on an instance (the blueprint's
 * `status.default_instance_id` must name this row; default-of.ts, shared
 * by the two instance kinds) and `execution_viewer` on a workflow
 * instance (`spec.execution_visibility`; execution-viewer.ts). The
 * binding table (bindings.ts) attaches them; the tuple source dispatches
 * to them by relation.
 *
 * Only types live here: the one producer of production declarations is
 * the reader joined with the bindings (model/index.ts). Tests build
 * throwaway models (a cycle, a chain past the depth bound) with the
 * builders in __tests__/throwaway-model.ts.
 */
import type { DescMessage, Message } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

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
  | { readonly node: "union"; readonly members: ReadonlyArray<Rewrite> }
  /** `a and b` — true only when every member is, in the line's order; the first false one ends it. */
  | {
      readonly node: "intersection";
      readonly members: ReadonlyArray<Rewrite>;
    };

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
  /** The FGA type name: the kind's enum member name, as every edition renders objects. */
  readonly type: string;
  /**
   * The kind's message schema: what a stored row decodes with, and where
   * its audit lives. Undefined for a ROWLESS type (bindings.ts), one with
   * no stored resource (`platform`): it resolves over tuples alone, and
   * no row is ever loaded or listed for it.
   */
  readonly schema: DescMessage | undefined;
  /** The `.fga` file the type is defined in, relative to the server package. */
  readonly source: string;
  /** Every relation the type defines, sorted by name. */
  readonly relations: ReadonlyMap<string, Rewrite>;
  /** The relations `kind_meta` cannot derive (the module header). */
  readonly derived: ReadonlyMap<string, DerivedRelation>;
}
