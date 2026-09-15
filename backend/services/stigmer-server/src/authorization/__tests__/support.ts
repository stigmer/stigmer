/**
 * Fixtures the authorization module's tests share: a stored row of any
 * declared kind with the four facts the derivation reads (id, org,
 * visibility, creator stamp) set through the kind's own schema — every
 * resource carries `metadata` of the one shared type and its audit under
 * `status.audit`, so one builder serves every declaration.
 */
import { create } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";

import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { KindDeclaration } from "../model/rewrite.js";

export interface FixtureRowFacts {
  readonly id: string;
  readonly org: string;
  readonly visibility: ApiResourceVisibility;
  readonly createdBy: string;
}

/** A row of `declaration.kind` carrying exactly the given facts. */
export function fixtureRow(
  declaration: KindDeclaration,
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
    status: {
      audit: { specAudit: { createdBy: { id: facts.createdBy } } },
    },
  };
  return create(declaration.schema, init);
}
