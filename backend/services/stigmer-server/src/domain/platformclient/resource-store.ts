/**
 * The open-source PlatformClientStore: the port (store.ts) over the
 * generic Store, rows of the `resources` table by kind. The composition
 * root installs it when no extension registers `drivers.platformClientStore`.
 *
 * `findById` is a primary-key read, the one lookup on a per-request path
 * (the verifier's liveness read, the origin guard). The other three scan
 * the kind: `findByClientId` through Store.findByField (ApiKey's lookup,
 * domain/apikey/lookup.ts: a decode-and-scan per mint, watched by
 * stigmer#987), `findByOrg` by listing the kind, and `findByOrgAndSlug`
 * over that listing — an exact pair, unlike the shared slug helper, whose
 * empty org matches every organization. A
 * PlatformClient census is a handful of rows per organization, and none of
 * the three sits on a per-request path.
 *
 * `save` and `update` are read-then-write because the generic Store's
 * saveResource is an upsert with neither a create-only nor an update-only
 * form — the identity-account adapter's posture, with its reasoning
 * (domain/identityaccount/resource-store.ts): `save` refuses a held id,
 * (org, slug) or client_id; `update` writes nothing for an unknown id; the
 * residual window between the read and the write is the platform-wide
 * CheckDuplicate-then-upsert window, not this adapter's to close.
 *
 * Store faults follow the ratified mapping: a typed ResourceNotFoundError
 * reads as `undefined`; anything else propagates — an outage must never
 * read as "no client", which on the verifier's path would revoke every
 * live token.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { DuplicatePlatformClientError } from "./store.js";
import type { PlatformClientStore } from "./store.js";

const KIND = ApiResourceKind.platform_client;

export function newResourcePlatformClientStore(
  store: Store,
): PlatformClientStore {
  async function readById(id: string): Promise<PlatformClient | undefined> {
    try {
      return await store.getResource(KIND, id, PlatformClientSchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  async function readByClientId(
    clientId: string,
  ): Promise<PlatformClient | undefined> {
    if (clientId === "") {
      return undefined;
    }
    try {
      return await store.findByField(
        KIND,
        "spec.clientId",
        clientId,
        PlatformClientSchema,
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  /** Every client of the organization; a row that does not decode is skipped, as every scan does. */
  async function listOrg(org: string): Promise<PlatformClient[]> {
    const clients: PlatformClient[] = [];
    for (const data of await store.listResources(KIND)) {
      let client: PlatformClient;
      try {
        client = fromBinary(PlatformClientSchema, data);
      } catch {
        continue;
      }
      if ((client.metadata?.org ?? "") === org) {
        clients.push(client);
      }
    }
    return clients;
  }

  /** The exact (org, slug) pair — an empty org is no wildcard here. */
  async function readByOrgAndSlug(
    org: string,
    slug: string,
  ): Promise<PlatformClient | undefined> {
    if (org === "" || slug === "") {
      return undefined;
    }
    return (await listOrg(org)).find(
      (client) => (client.metadata?.slug ?? "") === slug,
    );
  }

  return {
    async save(client): Promise<void> {
      const id = client.metadata?.id ?? "";
      const org = client.metadata?.org ?? "";
      const slug = client.metadata?.slug ?? "";
      if ((await readById(id)) !== undefined) {
        throw new DuplicatePlatformClientError(
          `platform client '${id}' already exists`,
        );
      }
      if ((await readByOrgAndSlug(org, slug)) !== undefined) {
        throw new DuplicatePlatformClientError(
          `platform client '${org}/${slug}' already exists`,
        );
      }
      if ((await readByClientId(client.spec?.clientId ?? "")) !== undefined) {
        throw new DuplicatePlatformClientError(
          "a platform client already holds this client_id",
        );
      }
      await store.saveResource(KIND, id, PlatformClientSchema, client);
    },

    async update(client): Promise<void> {
      const id = client.metadata?.id ?? "";
      if ((await readById(id)) === undefined) {
        return;
      }
      await store.saveResource(KIND, id, PlatformClientSchema, client);
    },

    async deleteById(id): Promise<void> {
      await store.deleteResource(KIND, id);
    },

    findById: readById,

    findByClientId: readByClientId,

    findByOrgAndSlug: readByOrgAndSlug,

    findByOrg: listOrg,
  };
}
