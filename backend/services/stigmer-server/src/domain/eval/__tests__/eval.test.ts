/**
 * Composed-server round trips for the Eval kind: a real server over a temp
 * SQLite store, raw Connect clients, folders zipped by the server's own
 * deterministic writer.
 *
 * Pins the push contract of an eval that is a pushed evals/ folder: a
 * first push creates the eval under the request's slug with its cases,
 * findings and mocked servers in its status; a re-push of the same bytes
 * at the same level returns the stored eval unchanged; a re-push naming a
 * tag moves the tag and adds no version; a changed folder is a second
 * version with its message, reachable by tag and by digest; an
 * unspecified level and an empty name keep the stored ones; a folder where
 * no case loads, an archive that is not a zip and a `latest` tag are
 * refused writing nothing; a renamed-away slug is refused for a push while
 * reads follow it. Downloads return the bytes that were pushed, at the
 * head and at an older digest, inline and over the transfer lane, as does
 * a push staged through an upload URL. The organization's evals list
 * newest first; updateVisibility re-levels; delete removes the eval and
 * its history, and a read then answers NotFound.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/command_pb";
import { EvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ORG = "acme";
let ORG_ID: string;

let server: ComposedServer;
let evals: Client<typeof EvalCommandController>;
let evalQuery: Client<typeof EvalQueryController>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "eval-domain-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  ORG_ID = organizationId(await seedOrganizations(transport, [ORG]), ORG);
  evals = createClient(EvalCommandController, transport);
  evalQuery = createClient(EvalQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const encoder = new TextEncoder();
const JUDGE = "---\ntype: llm\n---\n\nPASS if the reply follows the refund policy.\n";

/** An evals/ folder as the archive the CLI would push. */
function folder(files: Readonly<Record<string, string>>): Uint8Array {
  return writeArchive(Object.entries(files).map(([filePath, content]) => ({ path: filePath, bytes: encoder.encode(content) })));
}

/** Two cases, a suite-level mock and a case that does not load. */
function supportCases(extraPrompt = ""): Uint8Array {
  return folder({
    "refund-within-policy/prompt.md": `---\ntags: [refunds]\n---\nCan I return shoes I bought last week?${extraPrompt}`,
    "refund-within-policy/graders/judge.md": JUDGE,
    "escalates-angry-customer/prompt.md": "This is the third time I've asked!",
    "escalates-angry-customer/graders/judge.md": JUDGE,
    "broken/prompt.md": "No grader here.",
    "mocks/billing/refund.md": "Refunded.",
  });
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

let counter = 0;
function uniqueSlug(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function expectCode(promise: Promise<unknown>, code: Code, contains?: string): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    const connectError = error as ConnectError;
    expect(connectError.code, connectError.rawMessage).toBe(code);
    if (contains !== undefined) {
      expect(connectError.rawMessage).toContain(contains);
    }
    return connectError;
  }
  throw new Error("expected the call to fail");
}

async function versionCount(id: string): Promise<number> {
  return server.store.countAuditEntries(ApiResourceKind.eval, id);
}

describe("Eval push", () => {
  it("creates the eval under the request's slug, its cases, findings and mocked servers in its status", async () => {
    const slug = uniqueSlug("support-agent-evals");
    const artifact = supportCases();
    const pushed = await evals.push({ org: ORG, slug, artifact, message: "9c2e4b7" });

    expect(pushed.kind).toBe("Eval");
    expect(pushed.metadata?.id).toMatch(/^evs_/);
    expect(pushed.metadata?.org).toBe(ORG_ID);
    expect(pushed.metadata?.slug).toBe(slug);
    expect(pushed.metadata?.name).toBe(slug);
    expect(pushed.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(pushed.metadata?.version?.id).toBe(digestOf(artifact));
    expect(pushed.metadata?.version?.message).toBe("9c2e4b7");
    expect(pushed.spec?.tag).toBe("");
    const status = pushed.status!;
    expect(status.digest).toBe(digestOf(artifact));
    expect(status.caseCount).toBe(2);
    expect(status.caseTags).toEqual(["refunds"]);
    expect(status.cases.map((c) => [c.caseName, c.path])).toEqual([
      ["escalates-angry-customer", "escalates-angry-customer"],
      ["refund-within-policy", "refund-within-policy"],
    ]);
    expect(status.findings.map((f) => [f.kind, f.path])).toEqual([["eval-case-invalid", "broken"]]);
    expect(status.mockServers).toEqual(["billing"]);

    const got = await evalQuery.get({ value: pushed.metadata!.id });
    expect(got.status?.digest).toBe(status.digest);
    expect(await versionCount(pushed.metadata!.id)).toBe(1);
  });

  it("returns the stored eval unchanged for a re-push of the same bytes", async () => {
    const slug = uniqueSlug("same");
    const first = await evals.push({ org: ORG, slug, artifact: supportCases() });
    const again = await evals.push({ org: ORG, slug, artifact: supportCases(), message: "ignored" });
    expect(again).toEqual(first);
    expect(await versionCount(first.metadata!.id)).toBe(1);
  });

  it("moves a tag onto the held folder without a version, and a changed folder is a second version", async () => {
    const slug = uniqueSlug("tagged");
    const v1 = supportCases();
    const first = await evals.push({ org: ORG, slug, artifact: v1, message: "first" });
    const id = first.metadata!.id;

    const retagged = await evals.push({ org: ORG, slug, artifact: v1, tag: "stable" });
    expect(retagged.spec?.tag).toBe("stable");
    expect(retagged.status?.digest).toBe(digestOf(v1));
    expect(await versionCount(id)).toBe(1);

    const v2 = supportCases(" I paid by card.");
    const second = await evals.push({ org: ORG, slug, artifact: v2, message: "second" });
    expect(second.metadata?.id).toBe(id);
    expect(second.status?.digest).toBe(digestOf(v2));
    expect(second.metadata?.version?.previousVersionId).toBe(digestOf(v1));
    expect(second.spec?.tag).toBe("");

    const history = await evalQuery.listVersions({ org: ORG, slug });
    expect(history.entries.map((e) => [e.digest, e.tag, e.isCurrent, e.message])).toEqual([
      [digestOf(v2), "", true, "second"],
      [digestOf(v1), "stable", false, "first"],
    ]);

    const byTag = await evalQuery.getByReference({ org: ORG, slug, kind: ApiResourceKind.eval, version: "stable" });
    expect(byTag.status?.digest).toBe(digestOf(v1));
    expect(byTag.spec?.tag).toBe("stable");
    const byDigest = await evalQuery.getByReference({ org: ORG, slug, kind: ApiResourceKind.eval, version: digestOf(v2) });
    expect(byDigest.status?.digest).toBe(digestOf(v2));
    const head = await evalQuery.getByReference({ org: ORG, slug, kind: ApiResourceKind.eval });
    expect(head.status?.digest).toBe(digestOf(v2));
  });

  it("keeps a stored level and display name a push does not name", async () => {
    const slug = uniqueSlug("kept");
    const first = await evals.push({
      org: ORG,
      slug,
      name: "Support agent tests",
      artifact: supportCases(),
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(first.metadata?.name).toBe("Support agent tests");
    expect(first.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);

    const same = await evals.push({ org: ORG, slug, artifact: supportCases() });
    expect(same).toEqual(first);
    const next = await evals.push({ org: ORG, slug, artifact: supportCases(" Again.") });
    expect(next.metadata?.name).toBe("Support agent tests");
    expect(next.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
  });

  it("refuses a folder where no case loads, naming why, and writes nothing", async () => {
    const slug = uniqueSlug("caseless");
    await expectCode(
      evals.push({ org: ORG, slug, artifact: folder({ "c/prompt.md": "No grader." }) }),
      Code.InvalidArgument,
      "eval cannot be pushed: no case in the folder loads, 1 problem found:\n  - c: ",
    );
    await expectCode(
      evals.push({ org: ORG, slug, artifact: folder({ "README.md": "notes" }) }),
      Code.InvalidArgument,
      "eval cannot be pushed: the folder holds no case",
    );
    await expectCode(
      evals.push({ org: ORG, slug, artifact: encoder.encode("not a zip") }),
      Code.InvalidArgument,
      "failed to read eval archive:",
    );
    await expectCode(evalQuery.getByReference({ org: ORG, slug, kind: ApiResourceKind.eval }), Code.NotFound);
  });

  it("refuses latest as a tag", async () => {
    await expectCode(
      evals.push({ org: ORG, slug: uniqueSlug("latest"), artifact: supportCases(), tag: "latest" }),
      Code.InvalidArgument,
    );
  });

  it("refuses a push naming a slug the eval was renamed away from, while reads follow it", async () => {
    const slug = uniqueSlug("old-name");
    const pushed = await evals.push({ org: ORG, slug, artifact: supportCases() });
    const renamed = await evals.rename({ resourceId: pushed.metadata!.id, slug: `${slug}-new` });
    expect(renamed.metadata?.slug).toBe(`${slug}-new`);

    const followed = await evalQuery.getByReference({ org: ORG, slug, kind: ApiResourceKind.eval });
    expect(followed.metadata?.id).toBe(pushed.metadata!.id);
    await expectCode(
      evals.push({ org: ORG, slug, artifact: supportCases(" Changed.") }),
      Code.FailedPrecondition,
    );
    const onNew = await evals.push({ org: ORG, slug: `${slug}-new`, artifact: supportCases(" Changed.") });
    expect(onNew.metadata?.id).toBe(pushed.metadata!.id);
  });
});

describe("Eval downloads", () => {
  it("return the bytes that were pushed, at the head and at an older digest, inline and over the transfer lane", async () => {
    const slug = uniqueSlug("downloaded");
    const v1 = supportCases();
    const v2 = supportCases(" Twice.");
    await evals.push({ org: ORG, slug, artifact: v1, tag: "stable" });
    await evals.push({ org: ORG, slug, artifact: v2 });

    const head = await evalQuery.download({ org: ORG, slug, kind: ApiResourceKind.eval });
    expect(head.digest).toBe(digestOf(v2));
    expect(new Uint8Array(head.artifact)).toEqual(v2);

    const old = await evalQuery.download({ org: ORG, slug, kind: ApiResourceKind.eval, version: digestOf(v1) });
    expect(new Uint8Array(old.artifact)).toEqual(v1);
    const stable = await evalQuery.download({ org: ORG, slug, kind: ApiResourceKind.eval, version: "stable" });
    expect(stable.digest).toBe(digestOf(v1));

    const minted = await evalQuery.getDownloadUrl({ org: ORG, slug, kind: ApiResourceKind.eval, version: "stable" });
    expect(minted.digest).toBe(digestOf(v1));
    expect(minted.sizeBytes).toBe(BigInt(v1.length));
    const response = await fetch(minted.url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(v1);

    await expectCode(
      evalQuery.download({ org: ORG, slug, kind: ApiResourceKind.eval, version: "0".repeat(64) }),
      Code.NotFound,
    );
  });

  it("stores a push staged through an upload URL as an inline one", async () => {
    const slug = uniqueSlug("staged");
    const artifact = supportCases();
    const minted = await evals.createArtifactUploadUrl({ org: ORG, slug, sizeBytes: BigInt(artifact.length) });
    expect(minted.artifactUploadRef).toMatch(/^sau_/);
    const put = await fetch(minted.url, {
      method: "PUT",
      body: Buffer.from(artifact),
      headers: { "content-type": "application/zip" },
    });
    expect(put.status).toBe(204);
    const pushed = await evals.push({ org: ORG, slug, artifactUploadRef: minted.artifactUploadRef });
    expect(pushed.status?.digest).toBe(digestOf(artifact));
    const back = await evalQuery.download({ org: ORG, slug, kind: ApiResourceKind.eval });
    expect(new Uint8Array(back.artifact)).toEqual(artifact);

    await expectCode(
      evals.createArtifactUploadUrl({ org: ORG, slug, sizeBytes: BigInt(100 * 1024 * 1024 + 1) }),
      Code.InvalidArgument,
      "exceeds the 104857600-byte (100MB) archive limit",
    );
  });
});

describe("Eval reads and removal", () => {
  it("lists the organization's evals newest first, re-levels one, and removes one with its history", async () => {
    const first = await evals.push({ org: ORG, slug: uniqueSlug("listed"), artifact: supportCases(" A.") });
    const second = await evals.push({ org: ORG, slug: uniqueSlug("listed"), artifact: supportCases(" B.") });
    const page = await evalQuery.list({ org: ORG, pageSize: 2 });
    expect(page.entries.map((e) => e.metadata?.id)).toEqual([second.metadata!.id, first.metadata!.id]);
    expect(page.nextPageToken).not.toBe("");

    const leveled = await evals.updateVisibility({
      resourceId: first.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(leveled.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    await expectCode(
      evals.updateVisibility({ resourceId: first.metadata!.id, visibility: ApiResourceVisibility.visibility_child_orgs }),
      Code.InvalidArgument,
    );

    const deleted = await evals.delete({ value: first.metadata!.id });
    expect(deleted.metadata?.id).toBe(first.metadata!.id);
    await expectCode(evalQuery.get({ value: first.metadata!.id }), Code.NotFound);
    expect(await versionCount(first.metadata!.id)).toBe(0);
    await expectCode(
      evalQuery.download({ org: ORG, slug: first.metadata!.slug, kind: ApiResourceKind.eval }),
      Code.NotFound,
    );
  });
});
