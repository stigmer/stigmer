/**
 * A test store that names what it is handed: `saveResource` of a new row of
 * a named kind (pipeline/steps/names.ts NAMED_KINDS) also records its slug
 * as its current name in the name table, as the create chain's ClaimName
 * would have, and `deleteResource` lets its names go, as ReleaseNames
 * would. A test that seeds rows straight into the store, to drive a step or
 * a resolver past the chains that write them, wraps its store once with
 * this (once, or at each call: wrappers of one store share what they
 * saved), so a lookup by slug finds what it seeded.
 *
 * Organizations are left alone: their names have their own protocol
 * (domain/organization/names.ts), which their fixtures already follow. A
 * person's identity account names nothing; a service account names its
 * slug. A seed of a slug another row the wrapper saved still holds in the
 * organization throws: a store holds one row per name, and a fixture that
 * breaks that would test a state no server reaches.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { kindClaimsNames, resourceNameKey } from "../../pipeline/steps/names.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { Store } from "../interface.js";

/** `store`, its saves of a named kind's rows naming them and its deletes letting the names go. */
export function namingSaves<S extends Store>(store: S): S {
  const saved = savedRowsOf(store);
  const rowKey = (kind: ApiResourceKind, id: string) => `${kind}/${id}`;
  return new Proxy(store, {
    get(target, member, receiver) {
      if (member === "saveResource") {
        return async <Desc extends DescMessage>(
          kind: ApiResourceKind,
          id: string,
          schema: Desc,
          resource: MessageShape<Desc>,
        ): Promise<void> => {
          const org = await nameSeededRow(target, saved, kind, id, resource);
          await target.saveResource(kind, id, schema, resource);
          if (org !== undefined) {
            saved.set(rowKey(kind, id), org);
          }
        };
      }
      if (member === "deleteResource") {
        return async (kind: ApiResourceKind, id: string): Promise<void> => {
          await target.deleteResource(kind, id);
          const org = saved.get(rowKey(kind, id));
          if (org !== undefined) {
            saved.delete(rowKey(kind, id));
            await target.resourceNames.release(kindEnumName(kind), org, id);
          }
        };
      }
      const value: unknown = Reflect.get(target, member, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * The organization of each row a wrapper of `store` saved and has not
 * deleted, by kind and id: shared by every wrapper of one store, so a test
 * may wrap it at each call.
 */
const SAVED_ROWS = new WeakMap<Store, Map<string, string>>();

function savedRowsOf(store: Store): Map<string, string> {
  let saved = SAVED_ROWS.get(store);
  if (saved === undefined) {
    saved = new Map();
    SAVED_ROWS.set(store, saved);
  }
  return saved;
}

/** Names a seeded row; answers its organization when it names one, else undefined. */
async function nameSeededRow(
  store: Store,
  saved: ReadonlyMap<string, string>,
  kind: ApiResourceKind,
  id: string,
  resource: MessageShape<DescMessage>,
): Promise<string | undefined> {
  if (kind === ApiResourceKind.organization || !kindClaimsNames(kind)) {
    return undefined;
  }
  if (
    kind === ApiResourceKind.identity_account &&
    (resource as unknown as IdentityAccount).spec?.provisioningMode !==
      IdentityAccountProvisioningMode.service_account
  ) {
    return undefined;
  }
  const metadata = metadataOf(resource);
  const org = metadata?.org ?? "";
  const slug = metadata?.slug ?? "";
  if (org === "" || slug === "") {
    return undefined;
  }
  const key = resourceNameKey(kind, org, slug);
  const now = new Date().toISOString();
  const claim = await store.resourceNames.claim(key, id, now);
  if (claim.claimed || claim.entry.id === id) {
    return org;
  }
  if (saved.has(`${kind}/${claim.entry.id}`)) {
    throw new Error(
      `fixture seeds ${kindEnumName(kind)} '${id}' with slug '${slug}', which '${claim.entry.id}' holds in ${org}`,
    );
  }
  await store.resourceNames.releaseName(key, claim.entry.id);
  await store.resourceNames.claim(key, id, now);
  return org;
}
