// Unit tests for `--attach` and `--file-id`: what each path resolves to (a
// workspace mention, a file the message carries, a folder the conversation
// holds), the Files already uploaded that the message names by id (counted
// toward its limit, never uploaded or deleted), the limits that fail before
// any upload, and how the Files are uploaded for a new
// conversation (the person's own, returned as originals to delete) and for an
// existing one (uploaded into it, its folders joining its resources through a
// masked update that keeps what it holds). Uploads that fail, and an update
// that fails, leave no File behind. The server is an in-memory Connect router
// behind a real Stigmer client, so the SDK's upload routing runs as it ships.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import type { UploadFileInput } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { type Session, SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import type { UpdateSessionInput } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import type { SessionResource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { Stigmer } from "@stigmer/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AttachmentPlan,
  deleteFiles,
  MAX_CONVERSATION_FILES,
  MAX_MESSAGE_FILES,
  NO_ATTACHMENTS,
  planAttachments,
  stageAttachments,
} from "../attachments.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attach-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content = "x"): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  return path;
}

interface FakeServer {
  readonly client: Stigmer;
  readonly uploads: UploadFileInput[];
  readonly deletes: string[];
  readonly updates: UpdateSessionInput[];
  readonly gets: string[];
}

interface FakeServerOptions {
  /** The conversation `session.get` answers. */
  readonly session?: Session;
  /** Filenames whose upload is refused. */
  readonly refuseUpload?: ReadonlySet<string>;
  readonly refuseUpdate?: boolean;
  readonly refuseDelete?: boolean;
}

// A Stigmer client over an in-memory router: each upload answers a File whose
// id names the upload's filename and its order, so a test can tell them apart.
function fakeServer(options: FakeServerOptions = {}): FakeServer {
  const uploads: UploadFileInput[] = [];
  const deletes: string[] = [];
  const updates: UpdateSessionInput[] = [];
  const gets: string[] = [];
  const transport = createRouterTransport(({ service }) => {
    service(FileCommandController, {
      upload: (input) => {
        if (options.refuseUpload?.has(input.filename) === true) {
          throw new ConnectError("too large", Code.InvalidArgument);
        }
        uploads.push(input);
        return create(FileSchema, { metadata: { id: `file_${uploads.length}_${input.filename}` } });
      },
      delete: (id) => {
        if (options.refuseDelete === true) throw new ConnectError("gone", Code.Unavailable);
        deletes.push(id.value);
        return create(FileSchema, { metadata: { id: id.value } });
      },
    });
    service(SessionQueryController, {
      get: (id) => {
        gets.push(id.value);
        if (options.session === undefined) throw new ConnectError("no session", Code.NotFound);
        return options.session;
      },
    });
    service(SessionCommandController, {
      update: (input) => {
        if (options.refuseUpdate === true) throw new ConnectError("changed", Code.Aborted);
        updates.push(input);
        return create(SessionSchema, input.resource);
      },
    });
  });
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
  return { client, uploads, deletes, updates, gets };
}

function fileResourceOf(resource: SessionResource): { fileId: string; mountPath: string } {
  if (resource.resource.case !== "file") throw new Error(`not a file resource: ${resource.resource.case}`);
  return { fileId: resource.resource.value.fileId, mountPath: resource.resource.value.mountPath };
}

describe("planAttachments", () => {
  it("mentions a file inside a workspace root by its relative path, uploading nothing", () => {
    const root = join(dir, "repo");
    const file = write(join(root, "src", "main.ts"));

    const plan = planAttachments([file], [join(dir, "missing-root"), root]);
    expect(plan).toEqual({ ...NO_ATTACHMENTS, workspaceFileRefs: ["src/main.ts"] });
  });

  it("carries a file outside every workspace root with the message, and walks a folder for its files", () => {
    const root = join(dir, "repo");
    mkdirSync(root);
    const outside = write(join(dir, "report.pdf"), "pdf");
    const folder = join(dir, "bundle");
    write(join(folder, "a.txt"), "aaa");
    write(join(folder, "nested", "b.txt"), "bb");
    write(join(folder, ".hidden"), "secret");
    write(join(folder, ".git", "config"), "tool state");
    symlinkSync(outside, join(folder, "link.pdf"));

    const progress: string[] = [];
    const plan = planAttachments([outside, folder], [root], (line) => progress.push(line));

    expect(plan.messageFiles).toEqual([{ path: outside, size: 3 }]);
    expect(plan.folders).toHaveLength(1);
    expect(plan.folders[0].name).toBe("bundle");
    expect(plan.folders[0].files.map((f) => [f.relativePath, f.size]).sort()).toEqual([
      ["a.txt", 3],
      ["nested/b.txt", 2],
    ]);
    expect(plan.workspaceFileRefs).toEqual([]);
    expect(progress.some((line) => line.startsWith("Skipping symlink:"))).toBe(true);
  });

  it("refuses a missing path, an unreadable one, and one that is neither a file nor a folder", () => {
    expect(() => planAttachments([join(dir, "nope.txt")], [])).toThrow(/file not found/);
    const file = write(join(dir, "plain.txt"));
    expect(() => planAttachments([join(file, "child")], [])).toThrow(/failed to stat attachment/);
    expect(() => planAttachments(["/dev/null"], [])).toThrow(/not a file or a folder/);
  });

  it("refuses a folder with nothing to attach", () => {
    const empty = join(dir, "empty");
    write(join(empty, ".hidden"));
    expect(() => planAttachments([empty], [])).toThrow(/no attachable files/);
  });

  it("refuses more files than a message carries, before any upload", () => {
    const files = Array.from({ length: MAX_MESSAGE_FILES + 1 }, (_, i) => write(join(dir, `f${i}.txt`)));
    expect(() => planAttachments(files, [])).toThrow(/a message carries at most 20/);
  });

  it("carries Files named by id with the message, counted with the files it uploads toward its limit", () => {
    const report = write(join(dir, "report.pdf"), "pdf");
    const plan = planAttachments([report], [], undefined, ["file_kept1", "file_kept2"]);
    expect(plan.fileIds).toEqual(["file_kept1", "file_kept2"]);
    expect(plan.messageFiles).toHaveLength(1);

    const files = Array.from({ length: MAX_MESSAGE_FILES - 1 }, (_, i) => write(join(dir, `f${i}.txt`)));
    expect(() => planAttachments(files, [], undefined, ["file_a", "file_b"])).toThrow(
      "--attach and --file-id name 21 files; a message carries at most 20",
    );
  });

  it("refuses a --file-id that is not a File's id, pointing at --attach", () => {
    expect(() => planAttachments([], [], undefined, ["./report.pdf"])).toThrow(
      '--file-id takes a File\'s id (file_…), not "./report.pdf"; to send a file on disk, use --attach',
    );
  });

  it("refuses more files than a conversation holds, counting the message's with the folders'", () => {
    const folder = join(dir, "many");
    for (let i = 0; i < MAX_CONVERSATION_FILES - 1; i++) write(join(folder, `f${i}.txt`));
    const extra = [write(join(dir, "one.txt")), write(join(dir, "two.txt"))];
    expect(() => planAttachments([folder, ...extra], [])).toThrow(/gives 501 files; a conversation holds at most 500/);

    write(join(folder, "f-last.txt"));
    write(join(folder, "f-over.txt"));
    expect(() => planAttachments([folder], [])).toThrow(/more than 500 files/);
  });
});

describe("stageAttachments, a new conversation", () => {
  it("asks nothing of the server when nothing is attached", async () => {
    const server = fakeServer();
    expect(await stageAttachments(server.client, NO_ATTACHMENTS, { org: "acme" })).toEqual({
      fileIds: [],
      resources: [],
      originals: [],
    });
    expect(server.uploads).toHaveLength(0);
  });

  it("uploads the person's own Files: the message's by id, each folder's as resources under its name", async () => {
    const server = fakeServer();
    const report = write(join(dir, "report.pdf"), "pdf");
    write(join(dir, "a", "data", "one.csv"));
    write(join(dir, "a", "data", "sub", "two.csv"));
    write(join(dir, "b", "data", "three.csv"));
    const plan = planAttachments([report, join(dir, "a", "data"), join(dir, "b", "data")], []);

    const progress: string[] = [];
    const staged = await stageAttachments(server.client, plan, { org: "acme" }, (line) => progress.push(line));

    expect(server.gets, "a new conversation has nothing to read").toEqual([]);
    expect(server.uploads.every((u) => u.org === "acme" && u.sessionId === "")).toBe(true);
    expect(staged.fileIds).toHaveLength(1);
    expect(staged.fileIds[0]).toMatch(/_report\.pdf$/);
    expect(staged.resources.map((r) => fileResourceOf(r).mountPath).sort()).toEqual([
      "data-2/three.csv",
      "data/one.csv",
      "data/sub/two.csv",
    ]);
    expect(staged.resources.every((r) => r.name === "")).toBe(true);
    expect(staged.originals).toEqual([...staged.fileIds, ...staged.resources.map((r) => fileResourceOf(r).fileId)]);
    expect(progress).toContain("Uploading report.pdf (3 B)...");
    expect(progress.some((l) => l.includes("'data/'") && l.includes("'data-2/'"))).toBe(true);
  });

  it("deletes every File it uploaded when one upload fails, and names the file", async () => {
    const server = fakeServer({ refuseUpload: new Set(["bad.txt"]) });
    const files = ["a.txt", "b.txt", "bad.txt", "c.txt", "d.txt", "e.txt"].map((n) => write(join(dir, n)));
    const plan = planAttachments(files, []);

    await expect(stageAttachments(server.client, plan, { org: "acme" })).rejects.toThrow(
      /failed to upload ".*bad\.txt": .*too large/,
    );
    expect(server.uploads.length).toBeGreaterThan(0);
    expect(server.deletes.sort()).toEqual(
      server.uploads.map((u, i) => `file_${i + 1}_${u.filename}`).sort(),
    );
  });
});

describe("stageAttachments, Files named by id", () => {
  it("names them after the files it uploads, uploads nothing for them, and never returns them as originals", async () => {
    const server = fakeServer();
    const report = write(join(dir, "report.pdf"), "pdf");
    const staged = await stageAttachments(
      server.client,
      planAttachments([report], [], undefined, ["file_kept"]),
      { org: "acme" },
    );
    expect(server.uploads.map((u) => u.filename)).toEqual(["report.pdf"]);
    expect(staged.fileIds).toEqual([expect.stringMatching(/_report\.pdf$/), "file_kept"]);
    expect(staged.originals).toEqual([staged.fileIds[0]]);
  });

  it("asks nothing of the server when the message only names Files", async () => {
    const server = fakeServer();
    const staged = await stageAttachments(server.client, planAttachments([], [], undefined, ["file_kept"]), {
      org: "acme",
    });
    expect(staged).toEqual({ fileIds: ["file_kept"], resources: [], originals: [] });
    expect(server.uploads).toHaveLength(0);
  });
});

describe("stageAttachments, an existing conversation", () => {
  const held: Session = create(SessionSchema, {
    metadata: { id: "ses_1", org: "acme", etag: "etag-1" },
    spec: {
      resources: [
        { name: "app", resource: { case: "gitRepository", value: { url: "https://github.com/acme/app" } } },
        { resource: { case: "file", value: { fileId: "file_old", mountPath: "data/old.csv" } } },
        { resource: { case: "file", value: { fileId: "file_named", mountPath: "" } } },
      ],
    },
  });

  it("uploads into the conversation and adds its folders to what it holds, renamed past a name it has", async () => {
    const server = fakeServer({ session: held });
    const report = write(join(dir, "report.pdf"));
    write(join(dir, "data", "new.csv"));
    const plan = planAttachments([report, join(dir, "data")], []);

    const staged = await stageAttachments(server.client, plan, { org: "acme", sessionId: "ses_1" });

    expect(server.uploads.every((u) => u.sessionId === "ses_1")).toBe(true);
    expect(staged.fileIds).toHaveLength(1);
    expect(staged.resources, "the conversation already holds them").toEqual([]);
    expect(staged.originals, "the conversation's own Files stay").toEqual([]);

    expect(server.updates).toHaveLength(1);
    const update = server.updates[0];
    expect(update.updateMask?.paths).toEqual(["spec.resources"]);
    expect(update.resource?.metadata?.id).toBe("ses_1");
    expect(update.resource?.metadata?.etag).toBe("etag-1");
    const sent = update.resource?.spec?.resources ?? [];
    expect(sent.slice(0, 3)).toEqual(held.spec?.resources);
    expect(sent.slice(3).map((r) => fileResourceOf(r).mountPath)).toEqual(["data-2/new.csv"]);
  });

  it("names the message's Files without touching the conversation's resources", async () => {
    const server = fakeServer({ session: held });
    const plan: AttachmentPlan = planAttachments([write(join(dir, "report.pdf"))], []);

    const staged = await stageAttachments(server.client, plan, { org: "acme", sessionId: "ses_1" });

    expect(staged.fileIds).toHaveLength(1);
    expect(server.updates).toEqual([]);
  });

  it("deletes the Files it uploaded when the conversation refuses the update", async () => {
    const server = fakeServer({ session: held, refuseUpdate: true });
    write(join(dir, "data", "new.csv"));
    const plan = planAttachments([join(dir, "data")], []);

    await expect(stageAttachments(server.client, plan, { org: "acme", sessionId: "ses_1" })).rejects.toThrow(
      /failed to add the attached folders to the conversation/,
    );
    expect(server.deletes).toEqual(server.uploads.map((u, i) => `file_${i + 1}_${u.filename}`));
  });
});

describe("deleteFiles", () => {
  it("deletes each File, and reports one it could not delete instead of failing", async () => {
    const ok = fakeServer();
    await deleteFiles(ok.client, ["file_a", "file_b"]);
    expect(ok.deletes.sort()).toEqual(["file_a", "file_b"]);

    const refusing = fakeServer({ refuseDelete: true });
    const warnings: string[] = [];
    await deleteFiles(refusing.client, ["file_a"], (line) => warnings.push(line));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Could not delete the uploaded File file_a: /);
  });
});
