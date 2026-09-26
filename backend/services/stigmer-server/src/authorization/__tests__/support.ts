/**
 * Fixtures the authorization module's tests share: a stored row of any
 * declared kind with the facts the derivation reads set through the
 * kind's own schema — every resource carries `metadata` of the one shared
 * type and its audit under `status.audit`, so one builder serves every
 * declaration.
 *
 * A row's parent fields are filled from `kind_meta` itself: for the
 * kind's scope parent and every additional parent, the spec field the
 * config names gets `<parentKind>-1`, resolved to the field's generated
 * name through the schema descriptor (the reflection idiom
 * pipeline/steps/shapes.ts documents) so this file keeps no copy of the
 * config and no name transform of its own. A well-formed row for every
 * kind is what the create-time resolver demands (it throws on a missing
 * parent), which is what lets the parity pin run over all of them.
 * `spec` and `status` overrides sit on top for the arms that need a
 * pointer or a level set.
 *
 * A fixture row exists only for a kind this edition stores rows of: every
 * type of the model but a rowless one (`platform`, model/bindings.ts), so
 * the builders take a StoredKindDeclaration and `storedDeclaration`
 * refuses a rowless type by name.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";

import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import {
  getKindEnum,
  getKindMeta,
  kindEnumName,
} from "../../pipeline/apiresource-meta.js";
import { builtInModel } from "../model/index.js";
import type { KindDeclaration } from "../model/rewrite.js";

export interface FixtureRowFacts {
  readonly id: string;
  readonly org: string;
  readonly visibility: ApiResourceVisibility;
  readonly createdBy: string;
  /** Spec fields set over the parent defaults, by generated field name. */
  readonly spec?: Readonly<Record<string, unknown>>;
  /** Status fields set beside the audit, by generated field name. */
  readonly status?: Readonly<Record<string, unknown>>;
}

/** A declaration of a kind with stored rows: what a fixture row is built, saved and decoded with. */
export type StoredKindDeclaration = KindDeclaration & { readonly schema: DescMessage };

/** Whether rows of the declaration's kind are stored: every type but a rowless one. */
export function hasStoredRows(
  declaration: KindDeclaration,
): declaration is StoredKindDeclaration {
  return declaration.schema !== undefined;
}

/** The built-in model's declaration of `type`, which must be a kind with stored rows. */
export function storedDeclaration(type: string): StoredKindDeclaration {
  const declaration = builtInModel.byType(type);
  if (declaration === undefined) {
    throw new Error(`${type} is not a type of the model`);
  }
  if (!hasStoredRows(declaration)) {
    throw new Error(`${type} is rowless: no row of it is stored`);
  }
  return declaration;
}

/** The id the fixture gives the parent of `parentKind`: `<type>-1`. */
export function fixtureParentId(parentKind: string): string {
  return `${kindEnumName(getKindEnum(parentKind))}-1`;
}

/** A row of `declaration.kind` carrying exactly the given facts, its parents filled. */
export function fixtureRow(
  declaration: StoredKindDeclaration,
  facts: FixtureRowFacts,
): Message {
  // Typed loosely on purpose: the schema is any declared kind's, and
  // protobuf-es only knows the field set of a concrete schema. Every kind
  // shares these two paths (`metadata`, `status.audit`), which is the
  // premise the derivation itself rests on.
  const init: Record<string, unknown> = {
    metadata: {
      id: facts.id,
      name: facts.id,
      org: facts.org,
      visibility: facts.visibility,
    },
    spec: { ...parentFieldsOf(declaration), ...facts.spec },
    status: {
      audit: { specAudit: { createdBy: { id: facts.createdBy } } },
      ...facts.status,
    },
  };
  return create(declaration.schema, init);
}

/** `kind_meta`'s parent spec fields for the kind, by generated name, each naming `<parentKind>-1`. */
function parentFieldsOf(declaration: StoredKindDeclaration): Record<string, string> {
  const config = getKindMeta(declaration.kind).authorization;
  const spec = specSchemaOf(declaration.schema);
  const fields: Record<string, string> = {};
  if (config === undefined || spec === undefined) {
    return fields;
  }
  const parents = [
    ...(config.parent === undefined ? [] : [config.parent]),
    ...config.additionalParents,
  ];
  for (const parent of parents) {
    const field = spec.fields.find((f) => f.name === parent.specField);
    if (field === undefined) {
      throw new Error(
        `${declaration.type}: kind_meta names spec field '${parent.specField}', which ${spec.typeName} does not have`,
      );
    }
    fields[field.localName] = fixtureParentId(parent.kind);
  }
  return fields;
}

function specSchemaOf(schema: DescMessage): DescMessage | undefined {
  const spec = schema.fields.find((f) => f.name === "spec");
  return spec !== undefined && spec.fieldKind === "message"
    ? spec.message
    : undefined;
}
