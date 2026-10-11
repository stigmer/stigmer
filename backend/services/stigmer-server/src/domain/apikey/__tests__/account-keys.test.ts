/**
 * Pins the removal of every key that speaks for an account
 * (account-keys.ts `deleteKeysOwnedBy`) and the owner read under it
 * (queries.ts `keysOwnedBy`), over a real sqlite store opened with the
 * server's list indexes, so the read goes through the key owner index as
 * it does in production. The grant path is a recorder: what it pins is
 * that each removed key's access rows are revoked through it, once per
 * key, before the row goes.
 *
 * What the account delete relies on (stigmer/stigmer#1771): every key
 * stamped with the account's id AND every key stamped with its subject
 * (a key minted before the account existed) is removed, a key of anyone
 * else stays, the count answered is the number removed, and an empty owner
 * list removes nothing. The read answers newest first, ignores empty
 * names, and answers a key once when two names are the same.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, fromBinary } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiResourceRef } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { deleteKeysOwnedBy } from "../account-keys.js";
import { keysOwnedBy } from "../queries.js";

const ACCOUNT_ID = "ida_owner";
const SUBJECT = "auth0|owner";
const OTHER = "ida_other";

let dir: string;
let store: SqliteStore;
let revoked: ApiResourceRef[];

const grantPath = {
  cleanupResource(resource: ApiResourceRef): Promise<void> {
    revoked.push(resource);
    return Promise.resolve();
  },
};

let seq = 0;
async function seedKey(owner: string, createdAt: Date): Promise<string> {
  seq += 1;
  const id = `key_${seq}`;
  await store.saveResource(
    ApiResourceKind.api_key,
    id,
    ApiKeySchema,
    create(ApiKeySchema, {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { id, name: `key ${seq}`, slug: `key-${seq}`, org: "acme" },
      spec: { keyHash: `hash-${seq}` },
      status: {
        audit: {
          specAudit: {
            createdBy: { id: owner },
            createdAt: timestampFromDate(createdAt),
          },
        },
      },
    }),
  );
  return id;
}

async function storedKeyIds(): Promise<string[]> {
  const rows = await store.listResources(ApiResourceKind.api_key);
  return rows
    .map((row) => fromBinary(ApiKeySchema, row).metadata?.id ?? "")
    .sort();
}

function idsOf(keys: ReadonlyArray<ApiKey>): string[] {
  return keys.map((key) => key.metadata?.id ?? "");
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "apikey-account-keys-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
  revoked = [];
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("keysOwnedBy (the key owner index read)", () => {
  it("answers the keys of every named owner, newest first, and no one else's", async () => {
    const oldest = await seedKey(ACCOUNT_ID, new Date("2026-01-01T00:00:00Z"));
    const newest = await seedKey(SUBJECT, new Date("2026-03-01T00:00:00Z"));
    const middle = await seedKey(ACCOUNT_ID, new Date("2026-02-01T00:00:00Z"));
    await seedKey(OTHER, new Date("2026-04-01T00:00:00Z"));

    const owned = await keysOwnedBy(store, [ACCOUNT_ID, SUBJECT]);

    expect(idsOf(owned)).toEqual([newest, middle, oldest]);
  });

  it("ignores empty names and answers a key once when a name repeats", async () => {
    const only = await seedKey(ACCOUNT_ID, new Date("2026-01-01T00:00:00Z"));
    await seedKey("", new Date("2026-01-02T00:00:00Z"));

    expect(
      idsOf(await keysOwnedBy(store, [ACCOUNT_ID, ACCOUNT_ID, ""])),
    ).toEqual([only]);
    expect(await keysOwnedBy(store, [""])).toEqual([]);
    expect(await keysOwnedBy(store, [])).toEqual([]);
  });
});

describe("deleteKeysOwnedBy (an account's delete)", () => {
  it("removes every key stamped with the account's id or its subject, revokes each one's access rows, and leaves another owner's key", async () => {
    const byId = await seedKey(ACCOUNT_ID, new Date("2026-01-01T00:00:00Z"));
    const bySubject = await seedKey(SUBJECT, new Date("2026-01-02T00:00:00Z"));
    const secondById = await seedKey(
      ACCOUNT_ID,
      new Date("2026-01-03T00:00:00Z"),
    );
    const others = await seedKey(OTHER, new Date("2026-01-04T00:00:00Z"));

    const removed = await deleteKeysOwnedBy(
      {
        store,
        logger: silentLogger,
        grantPath,
        authorizationLifecycle: undefined,
      },
      [ACCOUNT_ID, SUBJECT],
      testCallerIdentity({ identityId: ACCOUNT_ID }),
    );

    expect(removed).toBe(3);
    expect(await storedKeyIds()).toEqual([others]);
    expect(revoked.map((ref) => `${ref.kind}:${ref.id}`).sort()).toEqual(
      [byId, bySubject, secondById].map((id) => `api_key:${id}`).sort(),
    );
  });

  it("removes nothing for an empty owner list, or for an owner that holds no key", async () => {
    const kept = await seedKey(OTHER, new Date("2026-01-01T00:00:00Z"));
    const deps = {
      store,
      logger: silentLogger,
      grantPath,
      authorizationLifecycle: undefined,
    };

    expect(await deleteKeysOwnedBy(deps, [], testCallerIdentity())).toBe(0);
    expect(
      await deleteKeysOwnedBy(deps, ["", ACCOUNT_ID], testCallerIdentity()),
    ).toBe(0);

    expect(await storedKeyIds()).toEqual([kept]);
    expect(revoked).toEqual([]);
  });

  it("a fault revoking a key's access rows propagates, and that key stays", async () => {
    const key = await seedKey(ACCOUNT_ID, new Date("2026-01-01T00:00:00Z"));
    const failing = {
      cleanupResource(): Promise<void> {
        return Promise.reject(new Error("policy store unavailable"));
      },
    };

    await expect(
      deleteKeysOwnedBy(
        {
          store,
          logger: silentLogger,
          grantPath: failing,
          authorizationLifecycle: undefined,
        },
        [ACCOUNT_ID],
        testCallerIdentity(),
      ),
    ).rejects.toThrow("policy store unavailable");
    expect(await storedKeyIds()).toEqual([key]);
  });
});
