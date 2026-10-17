/**
 * Pins the access history's retention as the composition wires it
 * (boot/compose.ts): a unit of an edition that keeps the history declares
 * a window, and the server ages its history out from its first pass at
 * start; a unit that declares none composes no runner, and nothing is
 * removed. Over the library's own grant store on SQLite, entries written
 * through the Store with a change (as the adapter writes them) and
 * back-dated raw before `start()`, since a window cannot be waited out.
 * Enterprise's enterprise-access-history-retention.postgres.test.ts is the
 * same story over Postgres and the wire.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import { ServerEdition } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { baseConfig, fakeVerifier, silentLogger, widerEditionPurge } from "../../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import type { ResourceRowReader } from "../../../extensions/resource-row-reader.js";
import { platformTokenKeyRingFromPem } from "../../../platformtoken/key-ring.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const RING = platformTokenKeyRingFromPem({
  privateKeyPem: keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPems: [keys.publicKey.export({ format: "pem", type: "spki" }).toString()],
});
const noRows: ResourceRowReader = { findById: () => Promise.resolve(undefined) };
/** A test that boots a server waits for it. */
const BOOTS = 60_000;

/** A unit of an edition that keeps the history, on open source's own grant store. */
function licensedUnit(accessHistoryRetentionDays: number | undefined): ServerExtension {
  return {
    name: "licensed-fixture",
    edition: ServerEdition.enterprise,
    ...(accessHistoryRetentionDays === undefined ? {} : { accessHistoryRetentionDays }),
    orgPurge: widerEditionPurge,
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
    drivers: {
      platformTokenKeys: RING,
      resourceRowReaders: new Map([
        [ApiResourceKind.federation_issuer, noRows],
        [ApiResourceKind.invitation, noRows],
        [ApiResourceKind.team, noRows],
      ]),
    },
  };
}

const dirs: string[] = [];
const servers: ComposedServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.shutdown();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Composes a server with the window, writes three entries for Acme and
 * back-dates the first two, then starts it: the state retention meets on a
 * server's first start with a window.
 */
async function bootWithOldEntries(accessHistoryRetentionDays: number | undefined): Promise<ComposedServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "history-retention-composed-"));
  dirs.push(dir);
  const server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: silentLogger,
    extensions: [licensedUnit(accessHistoryRetentionDays)],
    portOverride: 0,
    host: "127.0.0.1",
  });
  servers.push(server);
  for (const n of [1, 2, 3]) {
    const grant = create(GrantSchema, {
      metadata: { id: `grt_retention_${n}` },
      spec: {
        principal: { kind: "identity_account", id: `ida_${n}` },
        relation: "member",
        resource: { kind: "organization", id: "acme" },
      },
    });
    await server.store.insertResource(ApiResourceKind.grant, `grt_retention_${n}`, GrantSchema, grant, {
      cause: "grant",
      actorId: "ida_ana",
      actorClass: "user",
      org: "acme",
    });
  }
  const db = new DatabaseSync(path.join(dir, "stigmer.db"));
  try {
    db.prepare(
      `UPDATE grant_history SET occurred_at = '2000-01-01T00:00:00.000Z' WHERE org = 'acme' AND sequence <= 2`,
    ).run();
  } finally {
    db.close();
  }
  await server.start();
  return server;
}

async function keptSequences(server: ComposedServer): Promise<number[]> {
  const records = await server.store.listPermissionHistory("acme", { limit: 10, after: 0n });
  return records.map((record) => Number(record.sequence));
}

describe("the access history's retention, composed", () => {
  it(
    "removes at start the entries older than a declared window",
    async () => {
      const server = await bootWithOldEntries(30);
      await vi.waitFor(async () => expect(await keptSequences(server)).toEqual([3]), { timeout: 10_000 });
    },
    BOOTS,
  );

  it(
    "composes no retention without a window, so every entry is kept",
    async () => {
      const server = await bootWithOldEntries(undefined);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await keptSequences(server)).toEqual([1, 2, 3]);
    },
    BOOTS,
  );
});
