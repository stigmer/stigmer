/**
 * Builders for tests' throwaway models: a declaration written by hand in
 * the evaluator's vocabulary (model/rewrite.ts), for the shapes the one
 * real model must never hold (a cycle, a chain past the depth bound) and
 * for proving a mechanism over a model small enough to read in the test.
 * The built-in model is never written this way: it is the compiled
 * OpenFGA JSON, read by model/openfga-json.ts.
 *
 * Nothing here validates: a test that declares a cycle means to. The
 * builders are named so a declaration reads like the `.fga` line it
 * stands for:
 *
 *   define viewer: [identity_account, organization#viewer] or owner
 *     → union(direct(objectOf("identity_account"), usersetOf("organization", "viewer")), computed("owner"))
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import type {
  DerivedRelation,
  KindDeclaration,
  Rewrite,
  SubjectType,
} from "../model/rewrite.js";

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

export function intersection(...members: ReadonlyArray<Rewrite>): Rewrite {
  return { node: "intersection", members };
}

export interface ThrowawayDeclarationInput {
  readonly kind: ApiResourceKind;
  /** Omitted for a rowless type. */
  readonly schema?: DescMessage;
  readonly source?: string;
  readonly relations: ReadonlyArray<readonly [name: string, rewrite: Rewrite]>;
  readonly derived?: ReadonlyArray<readonly [name: string, rule: DerivedRelation]>;
}

/** A declaration exactly as written, for `newModel`. */
export function throwawayDeclaration(input: ThrowawayDeclarationInput): KindDeclaration {
  return {
    kind: input.kind,
    type: kindEnumName(input.kind),
    schema: input.schema,
    source: input.source ?? "throwaway",
    relations: new Map(input.relations),
    derived: new Map(input.derived ?? []),
  };
}
