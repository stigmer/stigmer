/**
 * The removal sweep's one read outside the policy rows: a stored
 * resource's recorded creator (`ResourceCreators`,
 * domain/iampolicy/grant-path.ts). When an account leaves an
 * organization, the grant path keeps the rows that record the account as
 * a resource's author, and only the resource's own row says who that is.
 *
 * The row is read through the generic store with the schema the built-in
 * model binds to its kind, the same read the derived tuple source makes
 * for a check (derived-tuples.ts `loadRow`), and the creator is the stamp
 * that source derives an author's `owner` tuple from (`createdByOf`). A
 * kind the model binds no schema to, or a row the store does not hold (a
 * kind a composition keeps in its own table), has no recorded creator
 * here, so no row of it is kept as authorship.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceCreators } from "../domain/iampolicy/grant-path.js";
import { kindByEnumName } from "../pipeline/apiresource-meta.js";
import { createdByOf } from "../pipeline/steps/authorization-facts.js";
import type { Store } from "../store/interface.js";
import { ResourceNotFoundError } from "../store/interface.js";
import { builtInModel } from "./model/index.js";

export function newStoreResourceCreators(store: Store): ResourceCreators {
  return {
    async creatorOf(kindName, id): Promise<string | undefined> {
      const kind = kindByEnumName(kindName);
      const schema = builtInModel.byKind(kind)?.schema;
      if (
        kind === ApiResourceKind.api_resource_kind_unknown ||
        kind === ApiResourceKind.identity_account ||
        schema === undefined ||
        id === ""
      ) {
        return undefined;
      }
      try {
        return createdByOf(await store.getResource(kind, id, schema));
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return undefined;
        }
        throw error;
      }
    },
  };
}
