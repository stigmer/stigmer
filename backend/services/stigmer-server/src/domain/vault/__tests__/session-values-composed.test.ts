/**
 * Pins the stale-write rule for a conversation's own values and vaults
 * through the real session update chain: a composed server in the
 * trusted-local posture (no authentication, so the runner's writes carry
 * no caller class of their own), its write codec ("v9", an extension
 * codec) recording every destroy:
 *
 *   - a write that sends back an older read than the stored row (the
 *     runner's harness-state write after a turn) keeps every value added
 *     since, a secret, a connection and a repository's token, and destroys
 *     nothing;
 *   - a write built on the current read that omits a value drops it and
 *     destroys its backing state;
 *   - a stale write echoing the marker for a value removed since succeeds
 *     and leaves it removed, while a current write echoing it, or one that
 *     echoes no audit stamp at all, is refused;
 *   - a stale write whose own values and the stored ones it keeps come to
 *     more than 100 secrets, or 100 connections, is refused naming the
 *     limit, and the stored row is left as it was;
 *   - a stale write neither detaches a vault attached since nor
 *     re-attaches one removed since.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { WorkspaceEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { SecretCodec } from "../../../encryption/codec.js";
import { REDACTED_MARKER } from "../../../encryption/encryption.js";
import { seedOrganizations } from "../../organization/__tests__/support.js";
import { RecordingCodec, silentLogger } from "./support.js";

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "stale-writes";
const ADDRESS = "https://mcp.tracker.example/mcp";
const REPO_URL = "https://github.com/acme/app";

const codec = new RecordingCodec();
let dir: string;
let server: ComposedServer;
let command: Client<typeof SessionCommandController>;
let query: Client<typeof SessionQueryController>;
let vaultCommand: Client<typeof VaultCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "session-values-composed-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("STIGMER_ENCRYPTION_WRITE_VERSION", "v9");
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    extensions: [
      {
        name: "recording-secret-codec",
        drivers: {
          secretCodecs: new Map<string, SecretCodec>([["v9", codec]]),
        },
      },
    ],
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  await seedOrganizations(transport, [ORG]);
  command = createClient(SessionCommandController, transport);
  query = createClient(SessionQueryController, transport);
  vaultCommand = createClient(VaultCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/** A github.com repository entry carrying `token`. */
function repository(token: string) {
  return create(WorkspaceEntrySchema, {
    name: "app",
    source: { source: { case: "gitRepo", value: { url: REPO_URL, token } } },
  });
}

function repositoryToken(session: Session | undefined): string {
  const source = session?.spec?.workspaceEntries[0]?.source?.source;
  return source?.case === "gitRepo" ? source.value.token : "";
}

let counter = 0;
async function createSession(
  spec: Parameters<typeof command.create>[0]["spec"],
): Promise<string> {
  counter += 1;
  const created = await command.create({
    apiVersion: API_VERSION,
    kind: "Session",
    metadata: { name: `Stale write ${counter}`, org: ORG },
    spec,
  });
  return created.metadata!.id;
}

/** The session as a client reads it: every value shown as the marker. */
async function read(id: string): Promise<Session> {
  return query.get({ value: id });
}

/** The stored row, sealed values and all. */
async function row(id: string): Promise<Session> {
  return server.store.getResource(ApiResourceKind.session, id, SessionSchema);
}

/** Lets the clock pass the stored stamp's millisecond, so the next write's stamp is newer. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

/** The runner's write: the session it read, with a new harness state. */
function harnessWrite(readEarlier: Session, harnessStateId: string): Session {
  const write = clone(SessionSchema, readEarlier);
  write.spec!.harnessStateId = harnessStateId;
  return write;
}

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("a stale write of a conversation's own values", () => {
  it("keeps every value added since its read and destroys nothing; a current write that omits one drops and destroys it", async () => {
    const id = await createSession({
      secrets: { OLD: "a" },
      workspaceEntries: [repository("")],
    });
    const readAtTurnStart = await read(id);

    await tick();
    const adding = clone(SessionSchema, readAtTurnStart);
    adding.spec!.secrets["ADDED"] = "b";
    adding.spec!.connections[ADDRESS] = "tracker-token";
    adding.spec!.workspaceEntries = [repository("repo-token")];
    await command.update(adding);
    const added = await row(id);
    expect(Object.keys(added.spec!.secrets).sort()).toEqual(["ADDED", "OLD"]);

    await tick();
    const destroyedBefore = codec.deleted.length;
    await command.update(harnessWrite(readAtTurnStart, "harness-1"));
    const afterStale = await row(id);
    expect(afterStale.spec!.harnessStateId).toBe("harness-1");
    expect(afterStale.spec!.secrets).toEqual(added.spec!.secrets);
    expect(afterStale.spec!.connections).toEqual(added.spec!.connections);
    expect(repositoryToken(afterStale)).toBe(repositoryToken(added));
    expect(codec.deleted.slice(destroyedBefore)).toEqual([]);

    const current = clone(SessionSchema, await read(id));
    delete current.spec!.secrets["ADDED"];
    await command.update(current);
    const afterCurrent = await row(id);
    expect(Object.keys(afterCurrent.spec!.secrets)).toEqual(["OLD"]);
    expect(codec.deleted.slice(destroyedBefore)).toEqual([
      added.spec!.secrets["ADDED"],
    ]);
  });

  it("drops a marker whose value was removed since its read; a current write, or one with no stamp, echoing it is refused", async () => {
    const id = await createSession({
      secrets: { REMOVED: "a" },
      connections: { [ADDRESS]: "tracker-token" },
      workspaceEntries: [repository("repo-token")],
    });
    const readAtTurnStart = await read(id);
    expect(readAtTurnStart.spec!.secrets["REMOVED"]).toBe(REDACTED_MARKER);

    await tick();
    const removing = clone(SessionSchema, readAtTurnStart);
    removing.spec!.secrets = {};
    removing.spec!.connections = {};
    removing.spec!.workspaceEntries = [repository("")];
    await command.update(removing);

    await tick();
    await command.update(harnessWrite(readAtTurnStart, "harness-1"));
    const stored = await row(id);
    expect(stored.spec!.harnessStateId).toBe("harness-1");
    expect(stored.spec!.secrets).toEqual({});
    expect(stored.spec!.connections).toEqual({});
    expect(repositoryToken(stored)).toBe("");

    const current = clone(SessionSchema, await read(id));
    current.spec!.secrets["REMOVED"] = REDACTED_MARKER;
    const refused = await failureOf(command.update(current));
    expect(refused.code).toBe(Code.InvalidArgument);
    const unstamped = clone(SessionSchema, readAtTurnStart);
    unstamped.status = undefined;
    const refusedUnstamped = await failureOf(command.update(unstamped));
    expect(refusedUnstamped.code).toBe(Code.InvalidArgument);
  });

  it("refuses a stale write that would hold more than 100 secrets or 100 connections once the stored ones are kept, naming the limit", async () => {
    for (const kind of ["secrets", "connections"] as const) {
      const id = await createSession({});
      const readAtTurnStart = await read(id);

      await tick();
      const filling = clone(SessionSchema, readAtTurnStart);
      for (let index = 0; index < 100; index += 1) {
        if (kind === "secrets") {
          filling.spec!.secrets[`KEY_${index}`] = "v";
        } else {
          filling.spec!.connections[`https://tool${index}.example/mcp`] = "t";
        }
      }
      await command.update(filling);
      const filled = await row(id);

      await tick();
      const stale = harnessWrite(readAtTurnStart, "harness-1");
      if (kind === "secrets") {
        stale.spec!.secrets["ONE_MORE"] = "v";
      } else {
        stale.spec!.connections["https://one-more.example/mcp"] = "t";
      }
      const refused = await failureOf(command.update(stale));
      expect(refused.code, kind).toBe(Code.InvalidArgument);
      expect(refused.rawMessage, kind).toContain(`more than 100 ${kind}`);
      const after = await row(id);
      expect(after.spec!.harnessStateId, kind).toBe(filled.spec!.harnessStateId);
      expect(after.spec![kind], kind).toEqual(filled.spec![kind]);
    }
  });
});

describe("a stale write of a conversation's vaults", () => {
  it("neither detaches a vault attached since its read nor re-attaches one removed since", async () => {
    const slugs: string[] = [];
    for (const name of ["Stale first", "Stale second"]) {
      const vault = await vaultCommand.create({
        apiVersion: API_VERSION,
        kind: "Vault",
        metadata: { name, org: ORG },
      });
      slugs.push(vault.metadata!.slug);
    }
    const [first, second] = slugs as [string, string];
    const ref = (slug: string) => ({
      kind: ApiResourceKind.vault,
      org: ORG,
      slug,
    });
    const id = await createSession({ vaults: [ref(first)] });
    const readAtTurnStart = await read(id);

    await tick();
    const switching = clone(SessionSchema, readAtTurnStart);
    switching.spec!.vaults = [create(ApiResourceReferenceSchema, ref(second))];
    await command.update(switching);
    const switched = await row(id);
    expect(switched.spec!.vaults.map((vault) => vault.slug)).toEqual([second]);

    await tick();
    await command.update(harnessWrite(readAtTurnStart, "harness-1"));
    const stored = await row(id);
    expect(stored.spec!.harnessStateId).toBe("harness-1");
    expect(stored.spec!.vaults.map((vault) => vault.slug)).toEqual([second]);
    expect(stored.status!.vaultAttachers).toEqual(
      switched.status!.vaultAttachers,
    );
  });
});
