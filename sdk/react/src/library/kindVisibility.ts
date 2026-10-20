// The visibility levels a resource kind declares in the contract. Domain: library.
//
// Each ApiResourceKind carries its authorization config in its `kind_meta`
// option, including which audience levels it supports. Reading the option
// here, the way the server and the CLI's parity test read it, keeps the
// console from deciding by a kind's name which levels it offers: a kind
// whose declaration changes is offered its new levels with no console edit.

import { getOption } from "@bufbuild/protobuf";
import {
  ApiResourceKindSchema,
  kind_meta,
  type ApiResourceKind,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

/** Which audience levels beyond Private a kind supports. */
export interface KindVisibility {
  /** Whether a resource of the kind can be shared with its whole organization. */
  readonly supportsOrg: boolean;
  /** Whether it can be shared with its organization's child organizations. */
  readonly supportsChildOrgs: boolean;
}

/** The levels `kind` declares in its `kind_meta`; none for a kind the contract does not know. */
export function kindVisibility(kind: ApiResourceKind): KindVisibility {
  const value = ApiResourceKindSchema.values.find((v) => v.number === kind);
  const visibility = value ? getOption(value, kind_meta).authorization?.visibility : undefined;
  return {
    supportsOrg: visibility?.supportsOrg ?? false,
    supportsChildOrgs: visibility?.supportsChildOrgs ?? false,
  };
}
