/**
 * Pins a conversation's resources (../session-resources.ts, ../instances.ts)
 * through the composed server's session create and update, on a
 * trusted-local server:
 *   - a File of the organization named in a new conversation becomes the
 *     conversation's own copy: a new id, the conversation's, over the same
 *     bytes, mounted at its filename; the original stays, and deleting it
 *     leaves the copy downloadable;
 *   - a File is mounted beside a repository, and more than 500 Files are
 *     refused before any is copied;
 *   - two Files sharing a filename are mounted `name` and `name-2`; a
 *     writer's own mount path is normalized and kept, and two writers'
 *     paths that clash are refused;
 *   - a File of another organization is refused; a repository or folder
 *     name given twice is refused, as is a File named twice;
 *   - an update that keeps the Files makes no new copy, and one that adds a
 *     File copies only that one;
 *   - a create that fails after copying (its slug already held) leaves no
 *     copy behind;
 *   - deleting a conversation's own File takes it out of the
 *     conversation's resources, and a File a routine names cannot be
 *     deleted, the refusal naming the routine.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import type { SessionResource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { baseConfig, silentLogger, transportFor } from "../../../extensions/__tests__/composed-support.js";
import { errorOf } from "../../../pipeline/__tests__/support.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";
import { normalizeMountPath, uniquifyMountPath } from "../session-resources.js";

const ORG = "res-acme";
const OTHER_ORG = "res-globex";

let dir: string;
let server: ComposedServer;
let orgId: string;
let files: Client<typeof FileCommandController>;
let fileQuery: Client<typeof FileQueryController>;
let sessions: Client<typeof SessionCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "session-resources-"));
  vi.stubEnv("STIGMER_ACTIVITY_ROUTING", "session");
  server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = transportFor(port);
  orgId = organizationId(await seedOrganizations(transport, [ORG, OTHER_ORG]), ORG);
  files = createClient(FileCommandController, transport);
  fileQuery = createClient(FileQueryController, transport);
  sessions = createClient(SessionCommandController, transport);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function upload(filename: string, org = ORG, text = filename): Promise<string> {
  const file = await files.upload({ org, filename, source: { case: "data", value: new TextEncoder().encode(text) } });
  return file.metadata!.id;
}

function fileEntry(fileId: string, mountPath = ""): SessionResource {
  return create(SessionResourceSchema, { resource: { case: "file", value: { fileId, mountPath } } });
}

function repoEntry(name: string): SessionResource {
  return create(SessionResourceSchema, {
    name,
    resource: { case: "gitRepository", value: { url: "https://github.com/acme/app" } },
  });
}

let counter = 0;
async function newSession(resources: SessionResource[], name = `res-chat-${++counter}`): Promise<Session> {
  return sessions.create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Session",
    metadata: { name, org: ORG },
    spec: { resources },
  });
}

function fileMounts(session: Session): Array<[string, string]> {
  return (session.spec?.resources ?? []).flatMap((entry) =>
    entry.resource.case === "file" ? [[entry.resource.value.fileId, entry.resource.value.mountPath] as [string, string]] : [],
  );
}

async function fileCount(): Promise<number> {
  return (await fileQuery.list({ org: ORG, pageSize: 100 })).entries.length;
}

describe("a conversation's Files", () => {
  it("makes a named File the conversation's own copy over the same bytes, which outlives the original", async () => {
    const original = await upload("ledger.csv", ORG, "a,b\n");
    const session = await newSession([fileEntry(original)]);
    const [[copyId, mountPath]] = fileMounts(session) as [[string, string]];
    expect(copyId).toMatch(/^file_/);
    expect(copyId).not.toBe(original);
    expect(mountPath).toBe("ledger.csv");
    const copy = await fileQuery.get({ value: copyId });
    expect(copy.status?.sessionId).toBe(session.metadata!.id);
    expect(copy.spec?.filename).toBe("ledger.csv");

    await files.delete({ value: original });
    const link = await fileQuery.getDownloadUrl({ value: copyId });
    expect(await (await fetch(link.url)).text()).toBe("a,b\n");
  });

  it("mounts two Files of one name apart, keeps a writer's normalized path, and refuses two paths that clash", async () => {
    const first = await upload("report.pdf");
    const second = await upload("report.pdf");
    const third = await upload("notes.md");
    const session = await newSession([fileEntry(first), fileEntry(second), fileEntry(third, "./docs//notes.md")]);
    expect(fileMounts(session).map(([, mount]) => mount)).toEqual(["report.pdf", "report-2.pdf", "docs/notes.md"]);

    const clash = await errorOf(() => newSession([fileEntry(first, "a.txt"), fileEntry(second, "a.txt")]));
    expect(clash.code).toBe(Code.InvalidArgument);
    expect(clash.rawMessage).toContain("two files are mounted at 'a.txt'");
  });

  it("refuses another organization's File, a repository named twice, and a File named twice", async () => {
    const foreign = await upload("theirs.txt", OTHER_ORG);
    const refused = await errorOf(() => newSession([fileEntry(foreign)]));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toContain("belongs to another organization");

    const twice = await errorOf(() => newSession([repoEntry("app"), repoEntry("app")]));
    expect(twice.code).toBe(Code.InvalidArgument);
    expect(twice.rawMessage).toContain("resource 'app' appears more than once");

    const once = await upload("once.txt");
    const doubled = await errorOf(() => newSession([fileEntry(once), fileEntry(once)]));
    expect(doubled.code).toBe(Code.InvalidArgument);
  });

  it("mounts a File beside a repository, and refuses more than 500 Files before copying any", async () => {
    const beside = await upload("beside.txt");
    const session = await newSession([repoEntry("app"), fileEntry(beside)]);
    expect(fileMounts(session).map(([, mount]) => mount)).toEqual(["beside.txt"]);
    expect(session.spec?.resources[0]?.resource.case).toBe("gitRepository");

    const before = await fileCount();
    const tooMany = Array.from({ length: 501 }, (_, i) => fileEntry(`file_01toomany${String(i).padStart(3, "0")}`));
    const refused = await errorOf(() => newSession(tooMany));
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toContain("at most 500 files");
    expect(await fileCount()).toBe(before);
  });

  it("copies nothing on an update that keeps the Files, and only the File an update adds", async () => {
    const kept = await upload("kept.txt");
    const session = await newSession([fileEntry(kept)]);
    const before = await fileCount();
    const keptUpdate = await sessions.update({ resource: session, updateMask: { paths: ["spec.resources"] } });
    expect(fileMounts(keptUpdate)).toEqual(fileMounts(session));
    expect(await fileCount()).toBe(before);

    const added = await upload("added.txt");
    const grown = await sessions.update({
      resource: { ...keptUpdate, spec: { ...keptUpdate.spec!, resources: [...keptUpdate.spec!.resources, fileEntry(added)] } },
      updateMask: { paths: ["spec.resources"] },
    });
    expect(fileMounts(grown).map(([, mount]) => mount)).toEqual(["kept.txt", "added.txt"]);
    expect(await fileCount()).toBe(before + 2);
  });

  it("leaves no copy behind when the create fails after copying", async () => {
    const named = await upload("orphan.txt");
    await newSession([], "res-held-slug");
    const before = await fileCount();
    const failed = await errorOf(() => newSession([fileEntry(named)], "res-held-slug"));
    expect(failed.code).toBe(Code.AlreadyExists);
    expect(await fileCount()).toBe(before);
  });
});

describe("deleting a File a list names", () => {
  it("takes a conversation's own File out of its resources", async () => {
    const original = await upload("drop.txt");
    const session = await newSession([fileEntry(original)]);
    const [[copyId]] = fileMounts(session) as [[string, string]];
    await files.delete({ value: copyId });
    const stored = await server.store.getResource(ApiResourceKind.session, session.metadata!.id, SessionSchema);
    expect(fileMounts(stored)).toEqual([]);
  });

  it("refuses deleting a File a routine names, naming the routine", async () => {
    const named = await upload("nightly.xlsx");
    await server.store.saveResource(
      ApiResourceKind.routine,
      "rtn_01filesnightly",
      RoutineSchema,
      create(RoutineSchema, {
        metadata: { id: "rtn_01filesnightly", org: orgId, name: "Nightly", slug: "nightly" },
        spec: { agent: { resources: [{ resource: { case: "file", value: { fileId: named } } }] } },
      }),
    );
    const refused = await errorOf(() => files.delete({ value: named }));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toContain("routine 'nightly'");
    await server.store.deleteResource(ApiResourceKind.routine, "rtn_01filesnightly");
    await files.delete({ value: named });
  });
});

describe("mount paths", () => {
  it("normalizes a writer's path and refuses one naming nothing under uploads", () => {
    expect(normalizeMountPath("./a//b/./c.txt")).toBe("a/b/c.txt");
    expect(() => normalizeMountPath("a/../../b")).toThrow("does not name a file");
    expect(() => normalizeMountPath(".")).toThrow("does not name a file");
  });

  it("renames a derived name stem-2.ext, keeping a hidden file's leading dot and the folder", () => {
    expect(uniquifyMountPath("a.txt", new Set())).toBe("a.txt");
    expect(uniquifyMountPath("a.txt", new Set(["a.txt", "a-2.txt"]))).toBe("a-3.txt");
    expect(uniquifyMountPath(".env", new Set([".env"]))).toBe(".env-2");
    expect(uniquifyMountPath("q3/ledger", new Set(["q3/ledger"]))).toBe("q3/ledger-2");
  });
});
