/**
 * Pins the apikey identity verifier — the chassis's first OSS entry:
 * claim-or-pass by the case-insensitive stk_ prefix, the byte-pinned
 * Java classifyAuthError copy on the two failure arms (unknown/revoked →
 * "invalid token", expired → "token has expired"), the
 * authenticates-as-owner identity mapping (created_by actor → identityId
 * + display fields), and instant revocation (delete visible on the very
 * next verify — the no-cache posture).
 *
 * Since 20260911.11 (T01_1_review.md A6) the creator stamp is resolved
 * the way the OIDC lane resolves `sub`: a key minted before its owner
 * was provisioned carries the raw subject and answers the owner's
 * ACCOUNT id once one exists; a stamp that is already an account id is
 * kept; one primary-key read either way, no cache. The account store is
 * the REAL open-source adapter over the same SQLite store the keys live
 * in, so what is pinned is the production pair; only the fault arm
 * substitutes a one-method lookup that rejects.
 *
 * An accepted key's use lands on its own row (stigmer/stigmer#1255):
 * stamped on the first verify, left alone inside the resolution, moved
 * forward after it; a refused key records nothing; a stamp that cannot be
 * written is logged and the request is still authenticated.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Logger } from "../../../boot/logger.js";
import { LAST_USED_RESOLUTION_MS } from "../../../identity/credential-use.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { accountIdFor } from "../../identityaccount/constants.js";
import type { AccountsBySubject } from "../../identityaccount/resolve.js";
import { newResourceIdentityAccountStore } from "../../identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../identityaccount/store.js";
import { generateApiKeyPlaintext, hashApiKey } from "../keymaterial.js";
import {
  INVALID_TOKEN_MESSAGE,
  TOKEN_EXPIRED_MESSAGE,
  newApiKeyIdentityVerifier,
} from "../verifier.js";

let dir: string;
let store: SqliteStore;
let accounts: IdentityAccountStore;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "apikey-verifier-test-"));
  store = SqliteStore.open(
    path.join(dir, "stigmer.db"),
    createLogger({ level: "error", pretty: false, write: () => {} }),
  );
  accounts = newResourceIdentityAccountStore(store);
});

const silent = createLogger({ level: "error", pretty: false, write: () => {} });

/** The verifier as compose builds it: the key store and the account port over ONE store. */
function verifier(
  lookup: AccountsBySubject = accounts,
  options: { store?: Store; now?: () => Date; logger?: Logger } = {},
) {
  return newApiKeyIdentityVerifier({
    store: options.store ?? store,
    accounts: lookup,
    logger: options.logger ?? silent,
    now: options.now ?? (() => new Date()),
  });
}

/** The key's row as stored now. */
function storedKey(id: string) {
  return store.getResource(ApiResourceKind.api_key, id, ApiKeySchema);
}

/** A direct account for `sub` through the real adapter — derived id, as provisioning writes it. */
async function provisionAccount(sub: string, email: string): Promise<string> {
  const id = accountIdFor(sub);
  await accounts.save(
    create(IdentityAccountSchema, {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "IdentityAccount",
      metadata: { id, name: email },
      spec: {
        idpId: sub,
        email,
        provisioningMode: IdentityAccountProvisioningMode.direct,
      },
    }),
  );
  return id;
}

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function seedKey(options?: {
  expiresAt?: Date;
  ownerId?: string;
  email?: string;
  displayName?: string;
}): Promise<{ plaintext: string; id: string }> {
  seq += 1;
  const plaintext = generateApiKeyPlaintext();
  const id = `key_test${seq}`;
  const owner = {
    id: options?.ownerId ?? "user@example.com",
    email: options?.email ?? "user@example.com",
    displayName: options?.displayName ?? "Test User",
  };
  await store.saveResource(
    ApiResourceKind.api_key,
    id,
    ApiKeySchema,
    create(ApiKeySchema, {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { id, name: `key ${seq}`, org: "local" },
      spec: {
        keyHash: hashApiKey(plaintext),
        fingerprint: plaintext.slice(-6),
        ...(options?.expiresAt !== undefined
          ? { expiresAt: timestampFromDate(options.expiresAt) }
          : {}),
      },
      status: {
        audit: {
          specAudit: { createdBy: owner },
          statusAudit: { createdBy: owner },
        },
      },
    }),
  );
  return { plaintext, id };
}

describe("claim-or-pass", () => {
  it("passes (null) on anything without the stk_ prefix", async () => {
    const apikey = verifier();
    expect(await apikey.verify("eyJhbGciOiJSUzI1NiJ9.x.y")).toBeNull();
    expect(await apikey.verify("Basic-ish-token")).toBeNull();
  });

  it("claims stk_ tokens case-insensitively (Java startsWithIgnoreCase)", async () => {
    const apikey = verifier();
    // Recognized but unknown — must THROW, never pass (a forged key must
    // not fall through to a laxer verifier).
    await expect(apikey.verify("STK_unknown")).rejects.toSatisfy(
      (error: unknown) => {
        expect(ConnectError.from(error).code).toBe(Code.Unauthenticated);
        expect(ConnectError.from(error).rawMessage).toBe(INVALID_TOKEN_MESSAGE);
        return true;
      },
    );
  });
});

describe("verification arms", () => {
  it("a valid key authenticates as its owning user with display fields", async () => {
    const { plaintext } = await seedKey({
      ownerId: "ida_owner1",
      email: "owner@example.com",
      displayName: "Key Owner",
    });
    const identity = await verifier().verify(plaintext);
    expect(identity).toEqual({
      identityId: "ida_owner1",
      callerClass: "user",
      issuer: "",
      rawToken: plaintext,
      email: "owner@example.com",
      displayName: "Key Owner",
    });
  });

  it("an expired key is rejected with the byte-pinned copy", async () => {
    const { plaintext } = await seedKey({
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(verifier().verify(plaintext)).rejects.toSatisfy(
      (error: unknown) => {
        expect(ConnectError.from(error).rawMessage).toBe(TOKEN_EXPIRED_MESSAGE);
        return true;
      },
    );
  });

  it("a future expiry verifies fine (expires_at set and NOT past)", async () => {
    const { plaintext } = await seedKey({
      expiresAt: new Date(Date.now() + 60_000),
    });
    const identity = await verifier().verify(plaintext);
    expect(identity?.callerClass).toBe("user");
  });

  it("a deleted key is rejected on the very next verify (no cache)", async () => {
    const { plaintext, id } = await seedKey();
    const apikey = verifier();
    expect(await apikey.verify(plaintext)).not.toBeNull();

    await store.deleteResource(ApiResourceKind.api_key, id);
    await expect(apikey.verify(plaintext)).rejects.toSatisfy(
      (error: unknown) => {
        expect(ConnectError.from(error).rawMessage).toBe(INVALID_TOKEN_MESSAGE);
        return true;
      },
    );
  });

  it("a key without creator attribution fails closed", async () => {
    seq += 1;
    const plaintext = generateApiKeyPlaintext();
    const id = `key_orphan${seq}`;
    await store.saveResource(
      ApiResourceKind.api_key,
      id,
      ApiKeySchema,
      create(ApiKeySchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "ApiKey",
        metadata: { id, name: "orphan", org: "local" },
        spec: { keyHash: hashApiKey(plaintext) },
      }),
    );
    await expect(verifier().verify(plaintext)).rejects.toSatisfy(
      (error: unknown) => {
        expect(ConnectError.from(error).rawMessage).toBe(INVALID_TOKEN_MESSAGE);
        return true;
      },
    );
  });
});

describe("creator stamp → account resolution (20260911.11 A6)", () => {
  it("a key minted BEFORE its owner was provisioned resolves to the owner's account once one exists; the display fields stay the stamp's", async () => {
    const { plaintext } = await seedKey({
      ownerId: "auth0|early-adopter",
      email: "early@example.com",
      displayName: "Early Adopter",
    });
    const accountId = await provisionAccount(
      "auth0|early-adopter",
      "early@example.com",
    );
    expect(await verifier().verify(plaintext)).toEqual({
      identityId: accountId,
      callerClass: "user",
      issuer: "",
      rawToken: plaintext,
      email: "early@example.com",
      displayName: "Early Adopter",
    });
  });

  it("a stamp that is already an account id is kept — no account carries it as a subject", async () => {
    const accountId = await provisionAccount(
      "auth0|provisioned-first",
      "first@example.com",
    );
    const { plaintext } = await seedKey({ ownerId: accountId });
    expect((await verifier().verify(plaintext))?.identityId).toBe(accountId);
  });

  it("resolution is one read per verify with no cache — an account provisioned between two verifies is seen by the second", async () => {
    const { plaintext } = await seedKey({ ownerId: "auth0|late-bloomer" });
    const apikey = verifier();
    expect((await apikey.verify(plaintext))?.identityId).toBe(
      "auth0|late-bloomer",
    );
    const accountId = await provisionAccount(
      "auth0|late-bloomer",
      "late@example.com",
    );
    expect((await apikey.verify(plaintext))?.identityId).toBe(accountId);
  });

  it("an account-store fault is an infrastructure fault (plain error), never a credential rejection", async () => {
    const { plaintext } = await seedKey({ ownerId: "auth0|anyone" });
    const broken: AccountsBySubject = {
      findDirectByIdpId: () => Promise.reject(new Error("store is on fire")),
    };
    const error = await verifier(broken)
      .verify(plaintext)
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (e: unknown) => e,
      );
    expect(error).not.toBeInstanceOf(ConnectError);
    expect(String(error)).toContain("store is on fire");
  });

  it("a revoked or expired key never reaches the account store — credential checks come first", async () => {
    const reads: string[] = [];
    const counting: AccountsBySubject = {
      findDirectByIdpId: async (idpId) => {
        reads.push(idpId);
        return undefined;
      },
    };
    const { plaintext: expired } = await seedKey({
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(verifier(counting).verify(expired)).rejects.toBeInstanceOf(
      ConnectError,
    );
    await expect(
      verifier(counting).verify("stk_never_minted"),
    ).rejects.toBeInstanceOf(ConnectError);
    expect(reads).toEqual([]);
  });
});

describe("last use (stigmer/stigmer#1255)", () => {
  it("an accepted key stamps its last use on its own row, once per resolution, forward after it", async () => {
    const { plaintext, id } = await seedKey();
    let clock = new Date("2026-09-28T12:00:00Z");
    const apikey = verifier(accounts, { now: () => clock });

    expect((await storedKey(id)).status?.lastUsedAt).toBeUndefined();
    await apikey.verify(plaintext);
    const first = (await storedKey(id)).status;
    expect(timestampDate(first!.lastUsedAt!)).toEqual(clock);
    expect(first?.audit?.statusAudit?.event).toBe("updated");
    expect(
      first?.audit?.statusAudit?.createdBy?.id,
      "the status-audit slot keeps who created the key",
    ).toBe("user@example.com");
    expect(first?.audit?.specAudit?.updatedAt, "the spec audit is not touched").toBeUndefined();

    clock = new Date(clock.getTime() + LAST_USED_RESOLUTION_MS - 1);
    await apikey.verify(plaintext);
    expect(
      (await storedKey(id)).status,
      "inside the resolution nothing is written",
    ).toEqual(first);

    clock = new Date(clock.getTime() + 1);
    await apikey.verify(plaintext);
    expect(timestampDate((await storedKey(id)).status!.lastUsedAt!)).toEqual(clock);
  });

  it("a refused key records nothing", async () => {
    const { plaintext, id } = await seedKey({
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(verifier().verify(plaintext)).rejects.toBeInstanceOf(ConnectError);
    expect((await storedKey(id)).status?.lastUsedAt).toBeUndefined();
  });

  it("a stamp that cannot be written is logged with the key's id and the request is still authenticated", async () => {
    const { plaintext, id } = await seedKey({ ownerId: "ida_resilient" });
    const lines: string[] = [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: (line) => lines.push(line),
    });
    const failingWrites = {
      findByField: store.findByField.bind(store),
      updateResource: () => Promise.reject(new Error("disk full")),
    } as unknown as Store;

    const identity = await verifier(accounts, { store: failingWrites, logger }).verify(plaintext);

    expect(identity?.identityId).toBe("ida_resilient");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: "warn", credential: "api key", id, error: "disk full" });
    expect(lines[0], "the token is never logged").not.toContain(plaintext);
  });
});
