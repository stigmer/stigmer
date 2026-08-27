/**
 * Pins the apikey identity verifier — the chassis's first OSS entry:
 * claim-or-pass by the case-insensitive stk_ prefix, the byte-pinned
 * Java classifyAuthError copy on the two failure arms (unknown/revoked →
 * "invalid token", expired → "token has expired"), the
 * authenticates-as-owner identity mapping (created_by actor → identityId
 * + display fields), and instant revocation (delete visible on the very
 * next verify — the no-cache posture).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { generateApiKeyPlaintext, hashApiKey } from "../keymaterial.js";
import {
  INVALID_TOKEN_MESSAGE,
  TOKEN_EXPIRED_MESSAGE,
  newApiKeyIdentityVerifier,
} from "../verifier.js";

let dir: string;
let store: SqliteStore;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "apikey-verifier-test-"));
  store = SqliteStore.open(
    path.join(dir, "stigmer.db"),
    createLogger({ level: "error", pretty: false, write: () => {} }),
  );
});

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
        audit: { specAudit: { createdBy: owner }, statusAudit: { createdBy: owner } },
      },
    }),
  );
  return { plaintext, id };
}

describe("claim-or-pass", () => {
  it("passes (null) on anything without the stk_ prefix", async () => {
    const verifier = newApiKeyIdentityVerifier(store);
    expect(await verifier.verify("eyJhbGciOiJSUzI1NiJ9.x.y")).toBeNull();
    expect(await verifier.verify("Basic-ish-token")).toBeNull();
  });

  it("claims stk_ tokens case-insensitively (Java startsWithIgnoreCase)", async () => {
    const verifier = newApiKeyIdentityVerifier(store);
    // Recognized but unknown — must THROW, never pass (a forged key must
    // not fall through to a laxer verifier).
    await expect(verifier.verify("STK_unknown")).rejects.toSatisfy(
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
    const identity = await newApiKeyIdentityVerifier(store).verify(plaintext);
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
    await expect(
      newApiKeyIdentityVerifier(store).verify(plaintext),
    ).rejects.toSatisfy((error: unknown) => {
      expect(ConnectError.from(error).rawMessage).toBe(TOKEN_EXPIRED_MESSAGE);
      return true;
    });
  });

  it("a future expiry verifies fine (expires_at set and NOT past)", async () => {
    const { plaintext } = await seedKey({
      expiresAt: new Date(Date.now() + 60_000),
    });
    const identity = await newApiKeyIdentityVerifier(store).verify(plaintext);
    expect(identity?.callerClass).toBe("user");
  });

  it("a deleted key is rejected on the very next verify (no cache)", async () => {
    const { plaintext, id } = await seedKey();
    const verifier = newApiKeyIdentityVerifier(store);
    expect(await verifier.verify(plaintext)).not.toBeNull();

    await store.deleteResource(ApiResourceKind.api_key, id);
    await expect(verifier.verify(plaintext)).rejects.toSatisfy(
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
    await expect(
      newApiKeyIdentityVerifier(store).verify(plaintext),
    ).rejects.toSatisfy((error: unknown) => {
      expect(ConnectError.from(error).rawMessage).toBe(INVALID_TOKEN_MESSAGE);
      return true;
    });
  });
});
