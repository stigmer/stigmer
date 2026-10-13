/**
 * The open-source PlatformClientStore: the port (store.ts) over the
 * generic Store, rows of the `resources` table by kind. The composition
 * root installs it when no extension registers `drivers.platformClientStore`.
 *
 * `findById` is a primary-key read, the one lookup on a per-request path
 * (the verifier's liveness read, the origin guard). The other two scan
 * the kind: `findByClientId` through Store.findByField (ApiKey's lookup,
 * domain/apikey/lookup.ts: a decode-and-scan per mint, watched by
 * stigmer#987) and `findByOrg` by listing the kind. A PlatformClient
 * census is a handful of rows per organization, and neither sits on a
 * per-request path. A lookup by slug reads the name table, then this
 * store by id (steps.ts findClientByName).
 *
 * `save` is read-then-write because the generic Store's saveResource is an
 * upsert with no create-only form — the identity-account adapter's
 * posture, with its reasoning (domain/identityaccount/resource-store.ts):
 * it refuses a held id or client_id. A held slug is the name table's
 * refusal, taken by the create chain before this write. `modifyById` has
 * no such window: it IS Store.updateResource, the generic store's own
 * atomic read-modify-write, its not-found read as `undefined`; and
 * `readForWrite` and `swap` ARE Store.readResourceForWrite and
 * Store.swapResource.
 *
 * Store faults follow the store-fault mapping: a typed ResourceNotFoundError
 * reads as `undefined`; anything else propagates — an outage must never
 * read as "no client", which on the verifier's path would revoke every
 * live token.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { GuardedRead } from "../../store/guarded-port.js";
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

  return {
    async save(client): Promise<void> {
      const id = client.metadata?.id ?? "";
      if ((await readById(id)) !== undefined) {
        throw new DuplicatePlatformClientError(
          `platform client '${id}' already exists`,
        );
      }
      if ((await readByClientId(client.spec?.clientId ?? "")) !== undefined) {
        throw new DuplicatePlatformClientError(
          "a platform client already holds this client_id",
        );
      }
      await store.saveResource(KIND, id, PlatformClientSchema, client);
    },

    async readForWrite(id): Promise<GuardedRead<PlatformClient> | undefined> {
      try {
        const read = await store.readResourceForWrite(
          KIND,
          id,
          PlatformClientSchema,
        );
        return { row: read.resource, bytes: read.bytes };
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return undefined;
        }
        throw error;
      }
    },

    swap(id, expectedBytes, next): Promise<boolean> {
      return store.swapResource(
        KIND,
        id,
        PlatformClientSchema,
        expectedBytes,
        next,
      );
    },

    async modifyById(id, modify): Promise<PlatformClient | undefined> {
      try {
        return await store.updateResource(
          KIND,
          id,
          PlatformClientSchema,
          modify,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return undefined;
        }
        throw error;
      }
    },

    async deleteById(id): Promise<void> {
      await store.deleteResource(KIND, id);
    },

    findById: readById,

    findByClientId: readByClientId,

    findByOrg: listOrg,
  };
}
