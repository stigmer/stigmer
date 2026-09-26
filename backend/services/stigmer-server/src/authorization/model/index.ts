/**
 * The built-in model: every type of the authorization model, reached by
 * kind (the driver's `AuthzCheck.resourceKind`) or by FGA type name (an
 * object reference inside a tuple), in `fga.mod` order.
 *
 * It is built at module load from the one set of bytes every edition
 * reads: data/authorization-model.json, OpenFGA's JSON compiled from the
 * `.fga` files under fga/model (`make gen-authorization-model`), which the
 * engine suites under fga/tests also run against. The reader
 * (openfga-json.ts) turns it into the evaluator's vocabulary, and the
 * binding table (bindings.ts) adds what JSON cannot carry: each kind's row
 * schema and its derived rules. A model this server cannot evaluate, or a
 * type and a binding that disagree, fails the load, so it fails the boot
 * and every test that imports the model, never an answer.
 *
 * The model declares every type, whichever edition serves it. Which kinds
 * an edition evaluates is the tier's question, answered before any
 * evaluation (authorizer.ts, `kindServedByEdition`): open source refuses a
 * check that targets `team`, `identity_provider`, `invitation` or
 * `platform`, and a tuple that names one resolves over tuples alone, since
 * this edition stores no row of those kinds.
 *
 * `newModel` exists for tests that need a throwaway model (a cycle, a
 * chain past the depth bound).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { kindByEnumName } from "../../pipeline/apiresource-meta.js";
import type { KindBinding } from "./bindings.js";
import { KIND_BINDINGS } from "./bindings.js";
import compiledModel from "./data/authorization-model.json" with { type: "json" };
import type { ModelType } from "./openfga-json.js";
import { readOpenFgaModel } from "./openfga-json.js";
import type { DerivedRelation, KindDeclaration } from "./rewrite.js";

export interface Model {
  /** In registry order. */
  readonly declarations: ReadonlyArray<KindDeclaration>;
  byKind(kind: ApiResourceKind): KindDeclaration | undefined;
  byType(type: string): KindDeclaration | undefined;
}

export function newModel(declarations: ReadonlyArray<KindDeclaration>): Model {
  const byKind = new Map<ApiResourceKind, KindDeclaration>();
  const byType = new Map<string, KindDeclaration>();
  for (const declaration of declarations) {
    if (byKind.has(declaration.kind)) {
      throw new Error(`${declaration.type} is declared twice in the model`);
    }
    byKind.set(declaration.kind, declaration);
    byType.set(declaration.type, declaration);
  }
  return {
    declarations,
    byKind: (kind) => byKind.get(kind),
    byType: (type) => byType.get(type),
  };
}

/**
 * Joins the compiled model's types with their bindings, in the model's
 * order. Refuses a type that names no `ApiResourceKind`, a type with no
 * binding, a binding with no type, and a derived rule for a relation the
 * type does not define.
 */
export function bindModel(
  types: ReadonlyArray<ModelType>,
  bindings: ReadonlyMap<ApiResourceKind, KindBinding>,
): ReadonlyArray<KindDeclaration> {
  const bound = new Set<ApiResourceKind>();
  const declarations = types.map((entry): KindDeclaration => {
    const kind = kindByEnumName(entry.type);
    if (kind === ApiResourceKind.api_resource_kind_unknown) {
      throw new Error(`${entry.source}: type '${entry.type}' names no ApiResourceKind`);
    }
    const binding = bindings.get(kind);
    if (binding === undefined) {
      throw new Error(`${entry.source}: type '${entry.type}' has no binding (model/bindings.ts)`);
    }
    bound.add(kind);
    const derived = new Map<string, DerivedRelation>();
    for (const [relation, rule] of Object.entries(binding.derived ?? {})) {
      if (!entry.relations.has(relation)) {
        throw new Error(
          `model/bindings.ts: a derived rule for '${entry.type}#${relation}', which ${entry.source} does not define`,
        );
      }
      derived.set(relation, rule);
    }
    return {
      kind,
      type: entry.type,
      schema: binding.schema,
      source: entry.source,
      relations: entry.relations,
      derived,
    };
  });
  for (const kind of bindings.keys()) {
    if (!bound.has(kind)) {
      throw new Error(`model/bindings.ts: a binding for '${ApiResourceKind[kind]}', which the model does not define`);
    }
  }
  return declarations;
}

/** Every type of the authorization model, in `fga.mod` order. */
export const builtInModel: Model = newModel(
  bindModel(readOpenFgaModel(compiledModel as unknown), KIND_BINDINGS),
);

/** The built-in model's declaration for a kind, or undefined for a kind the model does not define. */
export function declarationFor(
  kind: ApiResourceKind,
): KindDeclaration | undefined {
  return builtInModel.byKind(kind);
}
