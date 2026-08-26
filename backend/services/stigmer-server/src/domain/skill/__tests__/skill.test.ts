/**
 * Pins the skill domain against Go's skill_controller_test.go +
 * push_test.go + versioning_repoint_test.go + transfer_lane_test.go +
 * get_artifact_test.go — through the REAL stack: a composed server on an
 * ephemeral port, a native gRPC client, the full interceptor chain, and
 * plain fetch against the HTTP transfer lane.
 *
 * The load-bearing pins the conformance suite CANNOT cover (needs direct
 * store access): repoint-never-duplicate row counts, the single-holder tag
 * column, audit-slot preservation across pushes (#540), and delete's
 * archive cleanup.
 */
import { mkdtempSync, rmSync } from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildZip } from "@stigmer/zip-structure/testing";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const ORG = "acme";

type CommandClient = Client<typeof SkillCommandController>;
type QueryClient = Client<typeof SkillQueryController>;

let server: ComposedServer;
let command: CommandClient;
let query: QueryClient;
let baseUrl: string;
let dir: string;

/**
 * Reserves a free port the way the CLI/conformance harness does: the
 * transfer lane mints capability URLs from CONFIG (base defaults to
 * http://localhost:{grpcPort}), so the server must boot with GRPC_PORT set
 * to its real port — a portOverride would leave minted URLs pointing at
 * the config default.
 */
async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "skill-domain-test-"));
  const grpcPort = await reserveFreePort();
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      GRPC_PORT: String(grpcPort),
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
    }),
    logger: silentLogger,
    host: "127.0.0.1",
  });
  const port = await server.start();
  baseUrl = `http://127.0.0.1:${port}`;
  const transport: Transport = createGrpcTransport({ baseUrl });
  command = createClient(SkillCommandController, transport);
  query = createClient(SkillQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let nameCounter = 0;
function uniqueName(): string {
  nameCounter += 1;
  return `test-skill-${nameCounter}`;
}

function makeArtifact(name: string, extra?: { body?: string; file?: string }): Uint8Array {
  return buildZip([
    {
      name: "SKILL.md",
      content: `---\nname: ${name}\ndescription: composed-server test skill\n---\n${extra?.body ?? "# Skill body"}`,
    },
    { name: extra?.file ?? "references/data.md", content: "supporting file" },
  ]);
}

/** PUT over cleartext HTTP/2 (h2c with prior knowledge — the demux's h2 lane). */
function h2Put(url: string, body: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const session = http2.connect(target.origin);
    session.on("error", reject);
    const stream = session.request({
      ":method": "PUT",
      ":path": target.pathname,
      "content-type": "application/zip",
    });
    stream.on("error", reject);
    stream.on("response", (headers) => {
      const status = Number(headers[":status"]);
      stream.resume();
      stream.on("end", () => {
        session.close();
        resolve(status);
      });
    });
    stream.end(body);
  });
}

async function expectCode(promise: Promise<unknown>, code: Code, arm: string): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    const connectError = ConnectError.from(error);
    expect(connectError.code, `${arm}: expected ${Code[code]}, got ${Code[connectError.code]} (${connectError.rawMessage})`).toBe(code);
    return connectError;
  }
  throw new Error(`${arm}: expected a ${Code[code]} error, got success`);
}

describe("push — identity and versioning", () => {
  it("creates a skill with frontmatter-derived identity and content-addressed status", async () => {
    const name = uniqueName();
    const skill = await command.push({ org: ORG, artifact: makeArtifact(name) });

    expect(skill.metadata?.id).toMatch(/^skl_[0-9a-z]{26}$/);
    expect(skill.metadata?.name).toBe(name);
    expect(skill.metadata?.slug).toBe(name);
    expect(skill.metadata?.org).toBe(ORG);
    // Skill is a blueprint kind: default visibility is org (proto config).
    expect(skill.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(skill.spec?.name).toBe(name);
    expect(skill.spec?.description).toBe("composed-server test skill");
    expect(skill.spec?.skillMd).toContain(`name: ${name}`);
    expect(skill.status?.versionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(skill.status?.artifactStorageKey).toBe(`skills/${skill.status?.versionHash}.zip`);
    expect(skill.metadata?.version?.id).toBe(skill.status?.versionHash);
    expect(skill.metadata?.version?.previousVersionId).toBe("");
  });

  it("re-push with the same slug updates in place: same id, chained versions, spec_audit-only stamp (#540)", async () => {
    const name = uniqueName();
    const first = await command.push({ org: ORG, artifact: makeArtifact(name) });
    const second = await command.push({
      org: ORG,
      artifact: makeArtifact(name, { body: "# Changed body" }),
      message: "second push",
    });

    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.status?.versionHash).not.toBe(first.status?.versionHash);
    expect(second.metadata?.version?.previousVersionId).toBe(first.status?.versionHash);
    expect(second.metadata?.version?.message).toBe("second push");
    // #540: a push is a definition change — spec_audit re-stamped with the
    // original creation preserved; status_audit untouched.
    expect(second.status?.audit?.specAudit?.createdAt).toEqual(
      first.status?.audit?.specAudit?.createdAt,
    );
    expect(second.status?.audit?.statusAudit).toEqual(first.status?.audit?.statusAudit);
  });

  it("re-pushing identical bytes repoints without a new history row (A→B→A, #475)", async () => {
    const name = uniqueName();
    const artifactA = makeArtifact(name, { body: "# A" });
    const artifactB = makeArtifact(name, { body: "# B" });

    const pushA = await command.push({ org: ORG, artifact: artifactA });
    await command.push({ org: ORG, artifact: artifactB });
    const repushA = await command.push({ org: ORG, artifact: artifactA });

    expect(repushA.status?.versionHash).toBe(pushA.status?.versionHash);

    // Exactly TWO history rows — the A re-push repointed, never duplicated.
    const history = await query.listVersions({ org: ORG, slug: name });
    expect(history.totalCount).toBe(2);
    const current = history.versions.filter((v) => v.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]?.versionHash).toBe(pushA.status?.versionHash);
    // Direct store proof: two audit rows, not three.
    expect(
      await server.store.countAuditEntries(ApiResourceKind.skill, repushA.metadata!.id),
    ).toBe(2);
  });

  it("a tag is a single-holder: re-tagging content moves the tag off its prior holder", async () => {
    const name = uniqueName();
    await command.push({ org: ORG, artifact: makeArtifact(name, { body: "# A" }), tag: "stable" });
    await command.push({ org: ORG, artifact: makeArtifact(name, { body: "# B" }), tag: "stable" });

    const history = await query.listVersions({ org: ORG, slug: name });
    const tagged = history.versions.filter((v) => v.tag === "stable");
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.isCurrent).toBe(true);
  });

  it("push into a different org creates an independent skill under the same slug", async () => {
    const name = uniqueName();
    const inAcme = await command.push({ org: ORG, artifact: makeArtifact(name) });
    const inOther = await command.push({ org: "other-org", artifact: makeArtifact(name) });
    expect(inOther.metadata?.id).not.toBe(inAcme.metadata?.id);
    expect(inOther.metadata?.org).toBe("other-org");
  });
});

describe("get / getByReference — the version ladder", () => {
  it("gets by id and answers NotFound for unknown ids", async () => {
    const pushed = await command.push({ org: ORG, artifact: makeArtifact(uniqueName()) });
    const got = await query.get({ value: pushed.metadata!.id });
    expect(got.metadata?.id).toBe(pushed.metadata?.id);
    await expectCode(query.get({ value: "skl_missing" }), Code.NotFound, "get unknown id");
  });

  it("resolves empty and 'latest' to the live head", async () => {
    const name = uniqueName();
    await command.push({ org: ORG, artifact: makeArtifact(name, { body: "# v1" }) });
    const head = await command.push({ org: ORG, artifact: makeArtifact(name, { body: "# v2" }) });

    for (const version of ["", "latest"]) {
      const got = await query.getByReference({ org: ORG, slug: name, version });
      expect(got.status?.versionHash).toBe(head.status?.versionHash);
    }
  });

  it("resolves an archived version by its 64-hex hash", async () => {
    const name = uniqueName();
    const v1 = await command.push({ org: ORG, artifact: makeArtifact(name, { body: "# v1" }) });
    await command.push({ org: ORG, artifact: makeArtifact(name, { body: "# v2" }) });

    const got = await query.getByReference({
      org: ORG,
      slug: name,
      version: v1.status!.versionHash,
    });
    expect(got.status?.versionHash).toBe(v1.status?.versionHash);
    expect(got.spec?.skillMd).toContain("# v1");
  });

  it("resolves a tag on the live head and on archived versions", async () => {
    const name = uniqueName();
    const v1 = await command.push({
      org: ORG,
      artifact: makeArtifact(name, { body: "# v1" }),
      tag: "v1",
    });
    const v2 = await command.push({
      org: ORG,
      artifact: makeArtifact(name, { body: "# v2" }),
      tag: "v2",
    });

    const byLiveTag = await query.getByReference({ org: ORG, slug: name, version: "v2" });
    expect(byLiveTag.status?.versionHash).toBe(v2.status?.versionHash);
    const byArchivedTag = await query.getByReference({ org: ORG, slug: name, version: "v1" });
    expect(byArchivedTag.status?.versionHash).toBe(v1.status?.versionHash);
  });

  it("answers NotFound for an unknown version and an unknown slug", async () => {
    const name = uniqueName();
    await command.push({ org: ORG, artifact: makeArtifact(name) });
    const versionError = await expectCode(
      query.getByReference({ org: ORG, slug: name, version: "no-such-tag" }),
      Code.NotFound,
      "unknown version",
    );
    expect(versionError.rawMessage).toBe(`skill version not found: ${name}:no-such-tag`);
    await expectCode(
      query.getByReference({ org: ORG, slug: "no-such-skill" }),
      Code.NotFound,
      "unknown slug",
    );
  });

  it("rejects an org-less reference (org-scoped kind) and a kind mismatch", async () => {
    const orgError = await expectCode(
      query.getByReference({ slug: "anything" }),
      Code.InvalidArgument,
      "org-less reference",
    );
    // The kind's proto meta name ("Skill"), exactly Go's meta.GetName().
    expect(orgError.rawMessage).toBe("org is required for Skill lookup");
    const kindError = await expectCode(
      query.getByReference({ org: ORG, slug: "anything", kind: ApiResourceKind.agent }),
      Code.InvalidArgument,
      "kind mismatch",
    );
    expect(kindError.rawMessage).toBe("kind mismatch: expected skill, got agent");
  });
});

describe("listVersions — pagination", () => {
  it("pages newest-first with base64 cursors and a stable total", async () => {
    const name = uniqueName();
    for (const body of ["# 1", "# 2", "# 3"]) {
      await command.push({ org: ORG, artifact: makeArtifact(name, { body }) });
    }

    const page1 = await query.listVersions({ org: ORG, slug: name, pageSize: 2 });
    expect(page1.totalCount).toBe(3);
    expect(page1.versions).toHaveLength(2);
    expect(page1.nextPageToken).not.toBe("");

    const page2 = await query.listVersions({
      org: ORG,
      slug: name,
      pageSize: 2,
      pageToken: page1.nextPageToken,
    });
    expect(page2.versions).toHaveLength(1);
    expect(page2.nextPageToken).toBe("");

    const hashes = [...page1.versions, ...page2.versions].map((v) => v.versionHash);
    expect(new Set(hashes).size).toBe(3);
  });

  it("rejects malformed page tokens", async () => {
    const name = uniqueName();
    await command.push({ org: ORG, artifact: makeArtifact(name) });
    for (const pageToken of ["!!!not-base64!!!", Buffer.from("garbage").toString("base64")]) {
      const err = await expectCode(
        query.listVersions({ org: ORG, slug: name, pageToken }),
        Code.InvalidArgument,
        `page token ${pageToken}`,
      );
      expect(err.rawMessage).toBe("invalid page_token");
    }
  });

  it("answers NotFound for an unknown slug, naming the org", async () => {
    const err = await expectCode(
      query.listVersions({ org: ORG, slug: "never-pushed" }),
      Code.NotFound,
      "listVersions unknown slug",
    );
    expect(err.rawMessage).toBe(`skill not found: never-pushed (org: ${ORG})`);
  });
});

describe("getArtifact — capability-key reads", () => {
  it("returns the pushed ZIP verbatim", async () => {
    const artifact = makeArtifact(uniqueName());
    const pushed = await command.push({ org: ORG, artifact });
    const got = await query.getArtifact({
      artifactStorageKey: pushed.status!.artifactStorageKey,
    });
    expect(Buffer.from(got.artifact).equals(Buffer.from(artifact))).toBe(true);
  });

  it("answers NotFound for unknown and traversal-shaped keys", async () => {
    const missing = await expectCode(
      query.getArtifact({ artifactStorageKey: "skills/deadbeef.zip" }),
      Code.NotFound,
      "unknown key",
    );
    expect(missing.rawMessage).toBe("skill artifact not found: skills/deadbeef.zip");
    await expectCode(
      query.getArtifact({ artifactStorageKey: "../../etc/passwd" }),
      Code.NotFound,
      "traversal key",
    );
  });
});

describe("transfer lane (#675) — mint → PUT → push-by-ref → download", () => {
  it("round-trips bytes and identity exactly like an inline push", async () => {
    const name = uniqueName();
    const artifact = makeArtifact(name);

    const minted = await command.createArtifactUploadUrl({
      org: ORG,
      sizeBytes: BigInt(artifact.length),
    });
    expect(minted.url).toMatch(/^http:\/\//);
    expect(minted.artifactUploadRef).toMatch(/^sau_/);
    expect(minted.ttlSeconds).toBe(900);

    const put = await fetch(minted.url, {
      method: "PUT",
      body: Buffer.from(artifact),
      headers: { "content-type": "application/zip" },
    });
    expect(put.status).toBe(204);

    const pushed = await command.push({ org: ORG, artifactUploadRef: minted.artifactUploadRef });
    expect(pushed.metadata?.name).toBe(name);

    const stored = await query.getArtifact({
      artifactStorageKey: pushed.status!.artifactStorageKey,
    });
    expect(Buffer.from(stored.artifact).equals(Buffer.from(artifact))).toBe(true);
  });

  it("rejects a replayed upload ref (single-use) with the re-mint hint", async () => {
    const artifact = makeArtifact(uniqueName());
    const minted = await command.createArtifactUploadUrl({
      org: ORG,
      sizeBytes: BigInt(artifact.length),
    });
    await fetch(minted.url, { method: "PUT", body: Buffer.from(artifact) });
    await command.push({ org: ORG, artifactUploadRef: minted.artifactUploadRef });

    const err = await expectCode(
      command.push({ org: ORG, artifactUploadRef: minted.artifactUploadRef }),
      Code.InvalidArgument,
      "replayed ref",
    );
    expect(err.rawMessage).toBe(
      "artifact_upload_ref not usable: upload reference unknown or expired — request a new upload URL via createArtifactUploadUrl",
    );
  });

  it("a ref whose slot was minted but never uploaded is rejected at push", async () => {
    const minted = await command.createArtifactUploadUrl({ org: ORG, sizeBytes: 1024n });
    const err = await expectCode(
      command.push({ org: ORG, artifactUploadRef: minted.artifactUploadRef }),
      Code.InvalidArgument,
      "empty slot",
    );
    expect(err.rawMessage).toBe(
      "artifact_upload_ref not usable: upload reference has no uploaded bytes — request a new upload URL via createArtifactUploadUrl",
    );
  });

  it("mint refuses an over-limit declaration BEFORE any bytes move, naming the limit", async () => {
    const err = await expectCode(
      command.createArtifactUploadUrl({ org: ORG, sizeBytes: BigInt(101 * 1024 * 1024) }),
      Code.InvalidArgument,
      "over-limit mint",
    );
    expect(err.rawMessage).toBe(
      "skill artifact size 105906176 bytes exceeds the 104857600-byte (100MB) skill limit",
    );
  });

  it("HTTP lane arms: unknown ref 404, size mismatch 400, replay 409, wrong methods 405", async () => {
    expect((await fetch(`${baseUrl}/v1/skill-artifacts/uploads/sau_unknown`, { method: "PUT", body: "x" })).status).toBe(404);

    const minted = await command.createArtifactUploadUrl({ org: ORG, sizeBytes: 10n });
    const short = await fetch(minted.url, { method: "PUT", body: "short" });
    expect(short.status).toBe(400);
    expect(await short.text()).toContain("upload size mismatch: received 5 bytes, declared 10");

    const artifact = makeArtifact(uniqueName());
    const minted2 = await command.createArtifactUploadUrl({ org: ORG, sizeBytes: BigInt(artifact.length) });
    await fetch(minted2.url, { method: "PUT", body: Buffer.from(artifact) });
    expect((await fetch(minted2.url, { method: "PUT", body: Buffer.from(artifact) })).status).toBe(409);

    expect((await fetch(minted2.url, { method: "GET" })).status).toBe(405);
    expect((await fetch(`${baseUrl}/v1/skill-artifacts/skills/x.zip`, { method: "PUT", body: "x" })).status).toBe(405);
  });

  it("the lane serves BOTH protocol stacks: a PUT and a size-mismatch arm over h2c behave exactly as over HTTP/1.1", async () => {
    // fetch speaks HTTP/1.1; the demux hands cleartext-HTTP/2 connections
    // to the http2 server, which runs the SAME lane router — this pins the
    // Http2ServerRequest/Response half of the LaneHandler contract.
    const name = uniqueName();
    const artifact = makeArtifact(name);
    const minted = await command.createArtifactUploadUrl({
      org: ORG,
      sizeBytes: BigInt(artifact.length),
    });
    expect(await h2Put(minted.url, Buffer.from(artifact))).toBe(204);
    const pushed = await command.push({ org: ORG, artifactUploadRef: minted.artifactUploadRef });
    expect(pushed.metadata?.name).toBe(name);

    const mismatch = await command.createArtifactUploadUrl({ org: ORG, sizeBytes: 10n });
    expect(await h2Put(mismatch.url, Buffer.from("short"))).toBe(400);
  });

  it("getArtifactDownloadUrl serves the exact stored bytes over HTTP; download space is skills/-only", async () => {
    const artifact = makeArtifact(uniqueName());
    const pushed = await command.push({ org: ORG, artifact });

    const minted = await query.getArtifactDownloadUrl({
      artifactStorageKey: pushed.status!.artifactStorageKey,
    });
    expect(minted.ttlSeconds).toBe(0);
    expect(minted.sizeBytes).toBe(BigInt(artifact.length));

    const resp = await fetch(minted.url);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("application/zip");
    expect(new Uint8Array(await resp.arrayBuffer())).toEqual(artifact);

    // Keys outside skills/ never reach the artifact store from this lane.
    expect((await fetch(`${baseUrl}/v1/skill-artifacts/etc/passwd`)).status).toBe(404);

    await expectCode(
      query.getArtifactDownloadUrl({ artifactStorageKey: "skills/deadbeef.zip" }),
      Code.NotFound,
      "download-url unknown key",
    );
  });
});

describe("updateVisibility", () => {
  it("flips only metadata.visibility and stamps status_audit", async () => {
    const pushed = await command.push({ org: ORG, artifact: makeArtifact(uniqueName()) });
    const updated = await command.updateVisibility({
      resourceId: pushed.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(updated.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    expect(updated.spec?.skillMd).toBe(pushed.spec?.skillMd);
    expect(updated.status?.versionHash).toBe(pushed.status?.versionHash);
  });

  it("NOT_FOUND wins over level validation (load-before-validate, the cloud-parity ordering)", async () => {
    // Unknown id + an unsupported level: the load must fail first.
    await expectCode(
      command.updateVisibility({
        resourceId: "skl_missing",
        visibility: ApiResourceVisibility.visibility_public,
      }),
      Code.NotFound,
      "unknown id with bad level",
    );
  });
});

describe("delete", () => {
  it("returns the deleted skill and cleans up its version history", async () => {
    const name = uniqueName();
    await command.push({ org: ORG, artifact: makeArtifact(name, { body: "# v1" }) });
    const head = await command.push({ org: ORG, artifact: makeArtifact(name, { body: "# v2" }) });
    const skillId = head.metadata!.id;
    expect(await server.store.countAuditEntries(ApiResourceKind.skill, skillId)).toBe(2);

    const deleted = await command.delete({ value: skillId });
    expect(deleted.metadata?.id).toBe(skillId);

    await expectCode(query.get({ value: skillId }), Code.NotFound, "get after delete");
    expect(await server.store.countAuditEntries(ApiResourceKind.skill, skillId)).toBe(0);
  });
});

describe("pushFromExecutionArtifact — validation surface (happy path is integration-layer per D1)", () => {
  it("rejects missing required fields — the protovalidate interceptor answers on the wire (both editions run it before the handler's manual arms)", async () => {
    const cases: Array<[Record<string, string>, string]> = [
      [
        { storageKey: "artifacts/aex_x/skill.zip", org: ORG },
        "execution_id: must be at least 1 characters [string.min_len]",
      ],
      [
        { executionId: "aex_x", org: ORG },
        "storage_key: must be at least 1 characters [string.min_len]",
      ],
      [
        { executionId: "aex_x", storageKey: "artifacts/aex_x/skill.zip" },
        "org: value is required [required]",
      ],
    ];
    for (const [request, message] of cases) {
      const err = await expectCode(
        command.pushFromExecutionArtifact(request),
        Code.InvalidArgument,
        message,
      );
      expect(err.rawMessage).toBe(message);
    }
  });

  it("rejects a storage key outside the execution's namespace (traversal guard)", async () => {
    const err = await expectCode(
      command.pushFromExecutionArtifact({
        org: ORG,
        executionId: "aex_example",
        storageKey: "artifacts/aex_other/skill.zip",
      }),
      Code.InvalidArgument,
      "prefix guard",
    );
    expect(err.rawMessage).toBe("storage_key does not belong to this execution");
  });
});
