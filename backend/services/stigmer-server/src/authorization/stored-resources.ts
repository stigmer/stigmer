/**
 * The grant path's reads outside the policy rows (`StoredResources`,
 * domain/iampolicy/grant-path.ts): two facts only a resource's own row
 * holds.
 *
 *   - Its recorded creator. When an account leaves an organization, the
 *     grant path keeps the rows that record the account as a resource's
 *     author, and only the resource's own row says who that is.
 *   - Its organization. A change record names the organization of the
 *     resource it is about, found through the resource's scope links; when
 *     a delete already removed those links (an organization's delete
 *     removes every link that names it and keeps the resources), the row's
 *     `metadata.org` still says it, the value the links were written from
 *     (pipeline/steps/authorization-facts.ts `parentLinksOf`; stigmer#1603).
 *
 * The row is read through the generic store with the schema the built-in
 * model binds to its kind, the same read the derived tuple source makes
 * for a check (derived-tuples.ts `loadRow`), and the creator is the stamp
 * that source derives an author's `owner` tuple from (`createdByOf`). A
 * kind the model binds no schema to, or a row the store does not hold (a
 * kind a composition keeps in its own table, or a row already deleted),
 * answers no creator and no organization here, so no row of it is kept as
 * authorship and no record takes an organization from it. An account's
 * row answers neither: an account is no organization's resource, and its
 * rows on itself record none.
 */
import type { Message } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { StoredResources } from "../domain/iampolicy/grant-path.js";
import { kindByEnumName } from "../pipeline/apiresource-meta.js";
import { createdByOf } from "../pipeline/steps/authorization-facts.js";
import { metadataOf } from "../pipeline/steps/shapes.js";
import type { Store } from "../store/interface.js";
import { ResourceNotFoundError } from "../store/interface.js";
import { builtInModel } from "./model/index.js";

export function newStoredResources(store: Store): StoredResources {
  /** The stored row of that kind and id, or undefined when this server holds none the grant path may read. */
  async function rowOf(
    kindName: string,
    id: string,
  ): Promise<Message | undefined> {
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
      return await store.getResource(kind, id, schema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  return {
    async creatorOf(kindName, id): Promise<string | undefined> {
      const row = await rowOf(kindName, id);
      return row === undefined ? undefined : createdByOf(row);
    },
    async organizationOf(kindName, id): Promise<string> {
      const row = await rowOf(kindName, id);
      return row === undefined ? "" : (metadataOf(row)?.org ?? "");
    },
  };
}
