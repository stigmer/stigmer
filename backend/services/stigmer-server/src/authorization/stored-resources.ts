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
 * The row is read where the built-in authorizer reads it: a unit's
 * registered reader for a kind the unit keeps in a store of its own (a
 * team, an identity provider, an invitation; `drivers.resourceRowReaders`),
 * else the generic store with the schema the built-in model binds to its
 * kind, the same read the derived tuple source makes for a check
 * (derived-tuples.ts `loadRow`). The creator is the stamp that source
 * derives an author's `owner` tuple from (`createdByOf`). A kind with no
 * reader and no schema, or a row nobody holds (one already deleted),
 * answers no creator and no organization here, so no row of it is kept as
 * authorship and no record takes an organization from it. An account's
 * row answers neither: an account is no organization's resource, and its
 * rows on itself record none.
 *
 * And, for an access move, what an account made in an organization
 * (`authoredIn`): the rows of every kind whose owner is its creator
 * (`OwnerAttributionType.DIRECT`, the derived owner tuple's own rule) in
 * that organization, whose creation stamp is the account, resolved as the
 * mints resolve one (an account id, or the raw issuer subject rows stamped
 * before 3.15.0 carry). One scan of the organization's rows per kind, asked
 * only when a person previews or makes a move, never per request. A kind a
 * unit keeps in its own store has no list here and answers nothing; those
 * kinds (a team, an identity provider, an invitation) are made by the
 * organization's admins, who own them by their role. The organization
 * kind is left out: its owner is a row, which the move never carries.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type { ApiResourceRef } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { StoredResources } from "../domain/iampolicy/grant-path.js";
import { isPersonStamp } from "../domain/iampolicy/membership.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import type { ResourceRowReader } from "../extensions/resource-row-reader.js";
import {
  getKindMeta,
  kindByEnumName,
  kindEnumName,
} from "../pipeline/apiresource-meta.js";
import { createdByOf } from "../pipeline/steps/authorization-facts.js";
import { metadataOf } from "../pipeline/steps/shapes.js";
import type { Store } from "../store/interface.js";
import { ResourceNotFoundError } from "../store/interface.js";
import { ROW_RECORDED_OWNER_KINDS } from "./derived-tuples.js";
import { builtInModel } from "./model/index.js";

export function newStoredResources(
  store: Store,
  rowReaders?: ReadonlyMap<ApiResourceKind, ResourceRowReader>,
  accounts?: AccountsByCaller,
): StoredResources {
  /** The stored row of that kind and id, or undefined when this server holds none the grant path may read. */
  async function rowOf(
    kindName: string,
    id: string,
  ): Promise<Message | undefined> {
    const kind = kindByEnumName(kindName);
    if (
      kind === ApiResourceKind.api_resource_kind_unknown ||
      kind === ApiResourceKind.identity_account ||
      id === ""
    ) {
      return undefined;
    }
    const reader = rowReaders?.get(kind);
    if (reader !== undefined) {
      return reader.findById(id);
    }
    const schema = builtInModel.byKind(kind)?.schema;
    if (schema === undefined) {
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
    async authoredIn(
      organizationId,
      accountId,
    ): Promise<ReadonlyArray<ApiResourceRef>> {
      if (organizationId === "" || accountId === "") {
        return [];
      }
      const stamps = new Map<string, Promise<boolean>>();
      const isTheAccount = (stamp: string): Promise<boolean> => {
        let known = stamps.get(stamp);
        if (known === undefined) {
          known =
            stamp === accountId
              ? Promise.resolve(true)
              : accounts === undefined
                ? Promise.resolve(false)
                : accountForStamp(accounts, stamp).then(
                    (account) => account?.metadata?.id === accountId,
                  );
          stamps.set(stamp, known);
        }
        return known;
      };
      const found: ApiResourceRef[] = [];
      for (const { kind, schema } of builtInModel.declarations) {
        if (
          schema === undefined ||
          ROW_RECORDED_OWNER_KINDS.has(kind) ||
          rowReaders?.has(kind) === true ||
          getKindMeta(kind).authorization?.ownerType !==
            OwnerAttributionType.DIRECT
        ) {
          continue;
        }
        const rows = await store.findAllByField(
          kind,
          "metadata.org",
          organizationId,
          schema,
        );
        for (const bytes of rows) {
          const row: Message = fromBinary(schema, bytes);
          const stamp = createdByOf(row);
          if (!isPersonStamp(stamp) || !(await isTheAccount(stamp))) {
            continue;
          }
          found.push(
            create(ApiResourceRefSchema, {
              kind: kindEnumName(kind),
              id: metadataOf(row)?.id ?? "",
            }),
          );
        }
      }
      return found;
    },
  };
}
