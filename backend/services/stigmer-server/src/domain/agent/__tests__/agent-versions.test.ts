/**
 * Pins agent versions through the REAL stack: a composed server on an
 * ephemeral port, a native gRPC client and the full interceptor chain,
 * with direct store reads where only the store can answer (row counts,
 * rows left after a delete).
 *
 * The load-bearing pins:
 *   - create records the first version; its snapshot (what getVersion
 *     serves) carries the default instance id the second persist writes;
 *   - an unchanged update records nothing and keeps the version chain; a
 *     changed one chains a new version; an A→B→A update repoints without a
 *     new row, and listVersions marks the older row current;
 *   - getByReference resolves the head, a hash and a tag, and an archived
 *     version reports the tag it holds now;
 *   - getVersion serves the full spec of any version, NotFound for one the
 *     agent never had;
 *   - tagVersion moves a tag single-holder and reconciles the head; an
 *     unchanged re-apply naming a tag moves it too;
 *   - delete drops the agent's version rows;
 *   - a reference to an agent that names a version is refused on a run
 *     surface (a share), the surface running the agent's current version.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { seedOrganizations } from "../../organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof AgentCommandController>;
let query: Client<typeof AgentQueryController>;
let shares: Client<typeof AgentShareCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-versions-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: a deterministically closed port.
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  await seedOrganizations(transport, [ORG]);
  command = createClient(AgentCommandController, transport);
  query = createClient(AgentQueryController, transport);
  shares = createClient(AgentShareCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function agentInput(
  name: string,
  instructions: string,
  version?: { tag?: string; message?: string },
) {
  return {
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org: ORG, ...(version !== undefined ? { version } : {}) },
    spec: { instructions: said(instructions) },
  };
}

/** The instructions a version carries: long enough for the spec's rule, distinct per label. */
function said(label: string): string {
  return `Agent instructions, ${label}.`;
}

function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix} ${counter}`;
}

async function versionRows(agentId: string): Promise<number> {
  return server.store.countAuditEntries(ApiResourceKind.agent, agentId);
}

async function expectCode(
  call: Promise<unknown>,
  code: Code,
  fragment: string,
): Promise<void> {
  const error = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  expect((error as ConnectError).code).toBe(code);
  expect((error as ConnectError).rawMessage).toContain(fragment);
}

describe("agent versions: what a write records", () => {
  it("create records the first version, whose snapshot carries the default instance id", async () => {
    const created = await command.create(
      agentInput(uniqueName("First"), "v1", { message: "the first cut" }),
    );
    const id = created.metadata!.id;
    const hash = created.status!.versionHash;

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.metadata?.version?.id).toBe(hash);
    expect(created.metadata?.version?.previousVersionId).toBe("");
    expect(await versionRows(id)).toBe(1);

    const archived = await server.store.getAuditByHash(
      ApiResourceKind.agent,
      id,
      hash,
      AgentSchema,
    );
    expect(archived.status?.defaultInstanceId).not.toBe("");

    const entry = await query.getVersion({ agentId: id, versionHash: hash });
    expect(entry.isCurrent).toBe(true);
    expect(entry.specSnapshot?.instructions).toBe(said("v1"));
    expect(entry.message).toBe("the first cut");
  });

  it("an unchanged update records nothing and keeps the chain; a changed one chains a version", async () => {
    const name = uniqueName("Chain");
    const v1 = await command.apply(agentInput(name, "v1", { message: "one" }));
    const id = v1.metadata!.id;

    const unchanged = await command.apply(agentInput(name, "v1"));
    expect(await versionRows(id)).toBe(1);
    expect(unchanged.status?.versionHash).toBe(v1.status?.versionHash);
    expect(unchanged.metadata?.version?.id).toBe(v1.status?.versionHash);
    expect(unchanged.metadata?.version?.message).toBe("one");

    const v2 = await command.apply(agentInput(name, "v2", { message: "two" }));
    expect(await versionRows(id)).toBe(2);
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);
    expect(v2.metadata?.version?.id).toBe(v2.status?.versionHash);
    expect(v2.metadata?.version?.previousVersionId).toBe(v1.status?.versionHash);
    expect(v2.metadata?.version?.message).toBe("two");
  });

  it("an A→B→A update repoints without a new row, and the older row is current", async () => {
    const name = uniqueName("Rollback");
    const a = await command.apply(agentInput(name, "A"));
    const id = a.metadata!.id;
    await command.apply(agentInput(name, "B"));
    const back = await command.apply(agentInput(name, "A"));

    expect(back.status?.versionHash).toBe(a.status?.versionHash);
    expect(await versionRows(id)).toBe(2);
    const history = await query.listVersions({ org: ORG, slug: a.metadata!.slug });
    expect(history.totalCount).toBe(2);
    const current = history.versions.filter((entry) => entry.isCurrent);
    expect(current.map((entry) => entry.versionHash)).toEqual([
      a.status?.versionHash,
    ]);
  });
});

describe("agent versions: reading them", () => {
  it("getByReference resolves the head, a hash and a tag; an archived version reports its tag now", async () => {
    const name = uniqueName("Ladder");
    const v1 = await command.apply(agentInput(name, "v1", { tag: "stable" }));
    const slug = v1.metadata!.slug;
    const v2 = await command.apply(agentInput(name, "v2", { tag: "stable" }));

    const head = await query.getByReference({ org: ORG, slug });
    expect(head.spec?.instructions).toBe(said("v2"));
    const byHash = await query.getByReference({
      org: ORG,
      slug,
      version: v1.status!.versionHash,
    });
    expect(byHash.spec?.instructions).toBe(said("v1"));
    expect(byHash.metadata?.version?.tag).toBe("");
    const byTag = await query.getByReference({ org: ORG, slug, version: "stable" });
    expect(byTag.status?.versionHash).toBe(v2.status?.versionHash);
    await expectCode(
      query.getByReference({ org: ORG, slug, version: "nope" }),
      Code.NotFound,
      "agent version",
    );
  });

  it("getVersion serves an archived version's full spec, and NotFound for a version the agent never had", async () => {
    const name = uniqueName("Get");
    const v1 = await command.apply(agentInput(name, "the old instructions"));
    const id = v1.metadata!.id;
    await command.apply(agentInput(name, "the new instructions"));

    const old = await query.getVersion({
      agentId: id,
      versionHash: v1.status!.versionHash,
    });
    expect(old.isCurrent).toBe(false);
    expect(old.specSnapshot?.instructions).toBe(said("the old instructions"));
    await expectCode(
      query.getVersion({ agentId: id, versionHash: "0".repeat(64) }),
      Code.NotFound,
      "agent version",
    );
    // The input's field rules refuse before the handler runs.
    await expectCode(
      query.getVersion({ agentId: "", versionHash: "0".repeat(64) }),
      Code.InvalidArgument,
      "agent_id",
    );
    await expectCode(
      query.getVersion({ agentId: id, versionHash: "stable" }),
      Code.InvalidArgument,
      "version_hash",
    );
  });
});

describe("agent versions: tags", () => {
  it("tagVersion moves a tag single-holder and reconciles the head", async () => {
    const name = uniqueName("Tagged");
    const v1 = await command.apply(agentInput(name, "v1"));
    const id = v1.metadata!.id;
    const slug = v1.metadata!.slug;
    const v2 = await command.apply(agentInput(name, "v2"));

    let head = await command.tagVersion({
      agentId: id,
      versionHash: v1.status!.versionHash,
      tag: "stable",
    });
    expect(head.metadata?.version?.tag).toBe("");
    head = await command.tagVersion({
      agentId: id,
      versionHash: v2.status!.versionHash,
      tag: "stable",
    });
    expect(head.metadata?.version?.tag).toBe("stable");

    const history = await query.listVersions({ org: ORG, slug });
    expect(history.versions.filter((entry) => entry.tag === "stable")).toHaveLength(1);
    await expectCode(
      command.tagVersion({ agentId: id, versionHash: "0".repeat(64), tag: "stable" }),
      Code.NotFound,
      "agent version",
    );
  });

  it("an unchanged re-apply naming a tag moves it without a new version", async () => {
    const name = uniqueName("Retag");
    const v1 = await command.apply(agentInput(name, "v1"));
    const id = v1.metadata!.id;

    const retagged = await command.apply(agentInput(name, "v1", { tag: "prod" }));
    expect(await versionRows(id)).toBe(1);
    expect(retagged.metadata?.version?.tag).toBe("prod");
    const history = await query.listVersions({ org: ORG, slug: v1.metadata!.slug });
    expect(history.versions.map((entry) => entry.tag)).toEqual(["prod"]);
  });
});

describe("agent versions: delete and references", () => {
  it("delete drops the agent's version rows", async () => {
    const name = uniqueName("Gone");
    const v1 = await command.apply(agentInput(name, "v1"));
    const id = v1.metadata!.id;
    await command.apply(agentInput(name, "v2"));
    expect(await versionRows(id)).toBe(2);

    await command.delete({ value: id });
    expect(await versionRows(id)).toBe(0);
  });

  it("a share whose agent reference names a version is refused: the share runs the current version", async () => {
    const agent = await command.apply(agentInput(uniqueName("Shared"), "v1"));
    await expectCode(
      shares.create({
        apiVersion: API_VERSION,
        kind: "AgentShare",
        metadata: { name: uniqueName("share"), org: ORG },
        spec: {
          agentRef: {
            kind: ApiResourceKind.agent,
            slug: agent.metadata!.slug,
            version: agent.status!.versionHash,
          },
        },
      }),
      Code.InvalidArgument,
      "runs the agent's current version and cannot run another; omit the version",
    );
  });
});
