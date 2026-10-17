/**
 * Pins what an update built on an earlier read does to a conversation's
 * repository tokens and its vault choice, through the real session update
 * chain: a composed server in the trusted-local posture, its write codec
 * ("v9", an extension codec) recording every destroy:
 *
 *   - an update that names another path (spec.subject) keeps a repository
 *     token added since its read and destroys nothing; one that names the
 *     workspace entries without the token drops it and destroys its
 *     backing state;
 *   - an update that names the workspace entries echoing the marker for a
 *     token removed since is refused; one that names another path lands;
 *   - an update that names another path neither detaches a vault attached
 *     since, nor re-attaches one removed since, nor switches back
 *     include_my_vault turned on since.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { WorkspaceEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/workspace_pb";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { SecretCodec } from "../../../encryption/codec.js";
import { REDACTED_MARKER } from "../../../encryption/encryption.js";
import { seedOrganizations } from "../../organization/__tests__/support.js";
import { RecordingCodec, silentLogger } from "./support.js";

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "stale-writes";
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

/**
 * An update built on `readEarlier` that names only the subject, as a
 * rename of the conversation does. It sends no etag: a sent one would be
 * refused once anything moved since the read, which is the etag's own arm.
 */
function subjectWrite(readEarlier: Session, subject: string): { resource: Session; updateMask: { paths: string[] } } {
  const write = clone(SessionSchema, readEarlier);
  write.metadata!.etag = "";
  write.spec!.subject = subject;
  return { resource: write, updateMask: { paths: ["spec.subject"] } };
}

/** An update that names the workspace entries, sending no etag. */
function entriesWrite(
  read: Session,
  entries: ReturnType<typeof repository>[],
): { resource: Session; updateMask: { paths: string[] } } {
  const write = clone(SessionSchema, read);
  write.metadata!.etag = "";
  write.spec!.workspaceEntries = entries;
  return { resource: write, updateMask: { paths: ["spec.workspace_entries"] } };
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

describe("an update built on an earlier read: a conversation's repository tokens", () => {
  it("keeps a token added since its read and destroys nothing; one that names the entries without it drops and destroys it", async () => {
    const id = await createSession({ workspaceEntries: [repository("")] });
    const readEarlier = await read(id);

    await command.update(entriesWrite(readEarlier, [repository("repo-token")]));
    const added = await row(id);
    expect(repositoryToken(added)).toMatch(/^enc:v9:/);

    const destroyedBefore = codec.deleted.length;
    await command.update(subjectWrite(readEarlier, "Renamed"));
    const afterRename = await row(id);
    expect(afterRename.spec!.subject).toBe("Renamed");
    expect(repositoryToken(afterRename)).toBe(repositoryToken(added));
    expect(codec.deleted.slice(destroyedBefore)).toEqual([]);

    await command.update(entriesWrite(await read(id), [repository("")]));
    const afterDrop = await row(id);
    expect(repositoryToken(afterDrop)).toBe("");
    expect(codec.deleted.slice(destroyedBefore)).toEqual([repositoryToken(added)]);
  });

  it("refuses an update naming the entries that echoes the marker of a token removed since; one naming another path lands", async () => {
    const id = await createSession({ workspaceEntries: [repository("repo-token")] });
    const readEarlier = await read(id);
    expect(repositoryToken(readEarlier)).toBe(REDACTED_MARKER);

    await command.update(entriesWrite(readEarlier, [repository("")]));

    await command.update(subjectWrite(readEarlier, "Renamed"));
    const stored = await row(id);
    expect(stored.spec!.subject).toBe("Renamed");
    expect(repositoryToken(stored)).toBe("");

    const refused = await failureOf(command.update(entriesWrite(readEarlier, [repository(REDACTED_MARKER)])));
    expect(refused.code).toBe(Code.InvalidArgument);
  });
});

describe("an update built on an earlier read: a conversation's vault choice", () => {
  it("neither detaches a vault attached since its read, nor re-attaches one removed since, nor switches My vault back", async () => {
    const slugs: string[] = [];
    const ids: string[] = [];
    for (const name of ["Earlier first", "Earlier second"]) {
      const vault = await vaultCommand.create({
        apiVersion: API_VERSION,
        kind: "Vault",
        metadata: { name, org: ORG },
      });
      slugs.push(vault.metadata!.slug);
      ids.push(vault.metadata!.id);
    }
    const [first, second] = slugs as [string, string];
    const secondId = ids[1]!;
    const ref = (slug: string) => ({
      kind: ApiResourceKind.vault,
      org: ORG,
      slug,
    });
    const id = await createSession({ vaults: [ref(first)], includeMyVault: false });
    const readEarlier = await read(id);

    const switching = clone(SessionSchema, readEarlier);
    switching.spec!.vaults = [create(ApiResourceReferenceSchema, ref(second))];
    switching.spec!.includeMyVault = true;
    await command.update({ resource: switching, updateMask: { paths: ["spec.vaults", "spec.include_my_vault"] } });
    const switched = await row(id);
    // The stored row holds the vault by id.
    expect(switched.spec!.vaults.map((vault) => vault.id)).toEqual([secondId]);
    expect(switched.spec!.includeMyVault).toBe(true);

    await command.update(subjectWrite(readEarlier, "Renamed"));
    const stored = await row(id);
    expect(stored.spec!.subject).toBe("Renamed");
    expect(stored.spec!.vaults.map((vault) => vault.id)).toEqual([secondId]);
    expect(stored.spec!.includeMyVault).toBe(true);
    expect(stored.status!.vaultAttachers).toEqual(
      switched.status!.vaultAttachers,
    );
  });
});
