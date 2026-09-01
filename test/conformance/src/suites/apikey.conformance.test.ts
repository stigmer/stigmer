// Conformance suite for the ApiKey domain (O3, 20260827.06 — the shared
// credential contract, served by the OSS TS server and the cloud Java
// service alike).
// Domain: iam / apikey.
//
// Drives ApiKeyCommandController + ApiKeyQueryController through the raw
// proto stubs and asserts the cross-edition contract:
//   - create mints a key_ id and returns the PLAINTEXT (stk_ + 43 Base64URL
//     chars) exactly once, in spec.key_hash of the create response;
//   - every later read returns the stored hash — which must equal
//     base64url(sha256(plaintext)), the storage encoding both editions'
//     hashers implement (this suite recomputes it, pinning the algorithm
//     itself cross-edition);
//   - the fingerprint is the plaintext's last 6 characters;
//   - update round-trips the expiry fields; delete returns the resource and
//     the key stops resolving;
//   - update NEVER changes key material (ruling Q9, closed by
//     stigmer-cloud#544): altered spec.key_hash/fingerprint in an update
//     are ignored and the stored values survive, proven on a post-update
//     read. Both editions strip-and-restore (TS PreserveKeyMaterial;
//     Java ApiKeyUpdateHandler.PreserveKeyMaterial) — this arm is red
//     against a cloud target older than the #544 fix by design.
//
// Deliberately OUT of this suite (edition authorization postures, not
// contract divergences — O3 gate ruling Q5):
//   - getByKeyHash: the cloud gates it behind a platform-admin FGA check;
//     OSS's permissive single-team default serves it openly. The lookup
//     path is pinned by the server's own unit suites on both sides.
import { createHash } from "node:crypto";

import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

const API_VERSION = "iam.stigmer.ai/v1";
const KIND = "ApiKey";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

function storageHash(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("base64url");
}

async function createKey(
  org: string,
  extras?: { expiresAt?: Date; neverExpires?: boolean },
) {
  const created = await clients.apiKeyCommand.create({
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name: uniqueName("key"), org },
    spec: {
      ...(extras?.expiresAt !== undefined
        ? { expiresAt: timestampFromDate(extras.expiresAt) }
        : {}),
      ...(extras?.neverExpires !== undefined
        ? { neverExpires: extras.neverExpires }
        : {}),
    },
  });
  fixtures.defer(() =>
    clients.apiKeyCommand.delete({ value: created.metadata!.id }),
  );
  return created;
}

describe("ApiKey conformance", () => {
  it("create assigns a key_ id and returns the plaintext exactly once", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createKey(org);

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(
      /^key_[0-9a-z]+$/,
    );
    const plaintext = created.spec?.keyHash ?? "";
    expect(plaintext, "the create response carries the plaintext").toMatch(
      /^stk_[A-Za-z0-9_-]{43}$/,
    );
    expect(
      created.spec?.fingerprint,
      "fingerprint is the plaintext's last 6 chars",
    ).toBe(plaintext.slice(-6));
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("get returns the stored hash — base64url(sha256(plaintext)), never the plaintext again", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createKey(org);
    const plaintext = created.spec?.keyHash ?? "";

    const fetched = await clients.apiKeyQuery.get({
      value: created.metadata!.id,
    });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    expect(
      fetched.spec?.keyHash,
      "the stored hash IS the shared storage encoding",
    ).toBe(storageHash(plaintext));
    expect(fetched.spec?.keyHash).not.toBe(plaintext);
    expect(fetched.spec?.fingerprint).toBe(created.spec?.fingerprint);
  });

  it("findAll lists the caller's key with the stored hash", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createKey(org);
    const plaintext = created.spec?.keyHash ?? "";

    const all = await clients.apiKeyQuery.findAll({});
    const mine = all.entries.find(
      (entry) => entry.metadata?.id === created.metadata?.id,
    );

    expect(mine, "findAll must include the freshly created key").toBeDefined();
    expect(mine?.spec?.keyHash).toBe(storageHash(plaintext));
  });

  it("update round-trips the expiry fields", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createKey(org);
    const expiry = new Date("2030-06-01T00:00:00Z");

    const updated = await clients.apiKeyCommand.update({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: {
        id: created.metadata?.id ?? "",
        name: created.metadata?.name ?? "",
        org: created.metadata?.org ?? "",
      },
      spec: {
        // The stored hash echoed back unchanged — full-spec-replacement
        // update semantics without touching key material (see header).
        keyHash: storageHash(created.spec?.keyHash ?? ""),
        fingerprint: created.spec?.fingerprint ?? "",
        expiresAt: timestampFromDate(expiry),
        neverExpires: true,
      },
    });

    expect(updated.spec?.expiresAt?.seconds).toBe(
      BigInt(Math.floor(expiry.getTime() / 1000)),
    );
    expect(updated.spec?.neverExpires).toBe(true);
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update ignores altered key material — the stored hash and fingerprint survive (ruling Q9 / stigmer-cloud#544)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createKey(org);
    const plaintext = created.spec?.keyHash ?? "";
    const storedHash = storageHash(plaintext);

    const updated = await clients.apiKeyCommand.update({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: {
        id: created.metadata?.id ?? "",
        name: created.metadata?.name ?? "",
        org: created.metadata?.org ?? "",
      },
      spec: {
        // Forged key material a caller with edit permission might send —
        // both editions must ignore it (strip-and-restore), never persist
        // it, and never wipe the stored values.
        keyHash: storageHash("stk_attacker-known-plaintext"),
        fingerprint: "forged",
        neverExpires: true,
      },
    });

    expect(
      updated.spec?.keyHash,
      "the update response carries the stored hash, not the forged one",
    ).toBe(storedHash);
    expect(updated.spec?.fingerprint).toBe(created.spec?.fingerprint);

    const fetched = await clients.apiKeyQuery.get({
      value: created.metadata!.id,
    });
    expect(
      fetched.spec?.keyHash,
      "the stored hash survives the update — neither forged nor wiped",
    ).toBe(storedHash);
    expect(fetched.spec?.fingerprint).toBe(created.spec?.fingerprint);
    expect(fetched.spec?.neverExpires, "the expiry change still lands").toBe(
      true,
    );
  });

  it("delete returns the resource; the id stops resolving", async () => {
    const { org } = await target.provisionTenancy();
    const created = await clients.apiKeyCommand.create({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { name: uniqueName("key"), org },
      spec: {},
    });

    const deleted = await clients.apiKeyCommand.delete({
      value: created.metadata!.id,
    });
    expect(deleted.metadata?.id).toBe(created.metadata?.id);

    await expectGrpcCode(
      () => clients.apiKeyQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
  });

  it("get with an unknown id is NotFound; a blank id is rejected", async () => {
    await expectGrpcCode(
      () =>
        clients.apiKeyQuery.get({ value: "key_00000000000000000000000000" }),
      Code.NotFound,
      "get unknown id",
    );
    await expectGrpcCode(
      () => clients.apiKeyQuery.get({ value: "" }),
      Code.InvalidArgument,
      "get blank id",
    );
  });
});
