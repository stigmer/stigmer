/**
 * The File mount (`shared/file-mount.ts`): the conversation's Files placed
 * under the session's `uploads/`, against a real HTTP server on loopback so
 * the bytes stream as they do from a signed link.
 *
 * Pinned:
 *  - each File lands at its mount path with its bytes, and the workspace
 *    `.stigmer` link exists after a mount even when nothing else made it;
 *  - an unchanged File is kept without a fetch; a File the agent edited, or
 *    one now naming another File id, is fetched again;
 *  - `uploads/` holds exactly the conversation's Files: a dropped File, its
 *    emptied folder, anything the agent wrote there and a planted link are
 *    removed, and `uploads/` itself replaced by a link is made a folder again;
 *  - an empty File mounts as an empty file;
 *  - a size mismatch, a refused or broken download, an unparsable link and
 *    a missing one end the mount with an error that never carries the link's query, and
 *    leave no partial file; a refused connection names the link's origin;
 *  - a body larger than the flush size is written in pieces, never whole;
 *  - a mount path outside `uploads/`, or two Files at one path, is refused;
 *  - an unreadable index costs a refetch, never a failure;
 *  - this message's Files are found among the mounted ones by id, in the
 *    message's order, and a message File the conversation lacks is refused;
 *  - a mounted image is offered to the vision budget, read from disk only
 *    when it could be accepted;
 *  - the door is asked under the run's scoped credential.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { FileMountSchema, type FileMount } from "@stigmer/apis/ai/stigmer/agentic/file/v1/mount_pb";
import { ContentBlockSchema, ContentSourceSchema, type ContentBlock } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";

import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { installAgentFs, localAgentFs } from "../agent-fs.js";
import { DEEP_AGENT_VISION_PROFILE, VisionBudget } from "../attachment-vision.js";
import {
  fetchRunFileMounts,
  FileMountError,
  FLUSH_BYTES,
  mountFiles,
  offerMountedImage,
  splitMessageFiles,
  UPLOADS_INDEX_FILE,
  type MountedFile,
} from "../file-mount.js";
import { getPlatformDir } from "../workspace/platform-dir.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const SECRET = "sig=very-secret";

/** What the server answers at each path; a function writes the response itself. */
const bodies = new Map<string, Buffer | ((res: import("node:http").ServerResponse) => void)>();
const requested: string[] = [];
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    requested.push(path);
    const body = bodies.get(path);
    if (body === undefined) {
      res.statusCode = 404;
      res.end();
    } else if (typeof body === "function") {
      body(res);
    } else {
      res.end(body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let root: string;
let workspace: string;
let sessionId: string;
let originalHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "file-mount-"));
  originalHome = process.env.HOME;
  process.env.HOME = join(root, "home");
  workspace = join(root, "ws");
  mkdirSync(workspace, { recursive: true });
  sessionId = "ses_files";
  bodies.clear();
  requested.length = 0;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A File the server serves at `/<id>`, with a signed query on its link. */
function served(fileId: string, mountPath: string, bytes: Buffer, fields: Partial<FileMount> = {}): FileMount {
  bodies.set(`/${fileId}`, bytes);
  return create(FileMountSchema, {
    fileId,
    mountPath,
    filename: mountPath.split("/").pop()!,
    mimeType: "text/plain",
    sizeBytes: BigInt(bytes.length),
    url: `${base}/${fileId}?${SECRET}`,
    ...fields,
  });
}

function uploads(...path: string[]): string {
  return join(getPlatformDir(sessionId), "uploads", ...path);
}

function mount(entries: readonly FileMount[]): Promise<MountedFile[]> {
  return mountFiles(entries, { sessionId, primaryWorkspaceDir: workspace });
}

async function refusal(entries: readonly FileMount[]): Promise<Error> {
  const err = await mount(entries).then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(FileMountError);
  return err as Error;
}

describe("mountFiles", () => {
  it("places each File at its mount path and links the workspace's .stigmer to the platform folder", async () => {
    const mounted = await mount([
      served("file_a", "notes.txt", Buffer.from("hello")),
      served("file_b", "q3/ledger.csv", Buffer.from("a,b\n1,2\n"), { mimeType: "text/csv", filename: "ledger.csv" }),
    ]);

    expect(readFileSync(uploads("notes.txt"), "utf8")).toBe("hello");
    expect(readFileSync(uploads("q3", "ledger.csv"), "utf8")).toBe("a,b\n1,2\n");
    expect(mounted).toEqual([
      { fileId: "file_a", mountPath: "notes.txt", filename: "notes.txt", mimeType: "text/plain", sizeBytes: 5, relativePath: ".stigmer/uploads/notes.txt" },
      { fileId: "file_b", mountPath: "q3/ledger.csv", filename: "ledger.csv", mimeType: "text/csv", sizeBytes: 8, relativePath: ".stigmer/uploads/q3/ledger.csv" },
    ]);
    expect(readlinkSync(join(workspace, ".stigmer")), "no skill or other populator ran, and the link exists").toBe(getPlatformDir(sessionId));
    expect(existsSync(join(getPlatformDir(sessionId), UPLOADS_INDEX_FILE)), "the index sits beside uploads/, never in it").toBe(true);
  });

  it("mounts an empty File as an empty file", async () => {
    await mount([served("file_empty", "empty.txt", Buffer.alloc(0))]);
    expect(readFileSync(uploads("empty.txt")).length).toBe(0);
  });

  it("names a File by its mount path when the server sends no filename", async () => {
    const [file] = await mount([served("file_a", "deep/report.md", Buffer.from("x"), { filename: "" })]);
    expect(file!.filename).toBe("report.md");
  });

  it("keeps an unchanged File without fetching it again", async () => {
    const entries = [served("file_a", "notes.txt", Buffer.from("hello"))];
    await mount(entries);
    requested.length = 0;

    await mount(entries);

    expect(requested).toEqual([]);
    expect(readFileSync(uploads("notes.txt"), "utf8")).toBe("hello");
  });

  it("fetches a File again when the agent edited its copy", async () => {
    const entries = [served("file_a", "notes.txt", Buffer.from("hello"))];
    await mount(entries);
    writeFileSync(uploads("notes.txt"), "hello, edited");
    requested.length = 0;

    await mount(entries);

    expect(requested).toEqual(["/file_a"]);
    expect(readFileSync(uploads("notes.txt"), "utf8")).toBe("hello");
  });

  it("fetches again when the path now names another File", async () => {
    await mount([served("file_a", "notes.txt", Buffer.from("first"))]);
    await mount([served("file_b", "notes.txt", Buffer.from("second"))]);
    expect(readFileSync(uploads("notes.txt"), "utf8")).toBe("second");
  });

  it("removes a File the conversation dropped, its emptied folder, and anything else under uploads/", async () => {
    const kept = served("file_a", "keep/a.txt", Buffer.from("a"));
    await mount([kept, served("file_b", "gone/b.txt", Buffer.from("b"))]);
    writeFileSync(uploads("keep", "agent-wrote.txt"), "mine");
    symlinkSync("/etc/hosts", uploads("planted"));

    await mount([kept]);

    expect(readFileSync(uploads("keep", "a.txt"), "utf8")).toBe("a");
    expect(existsSync(uploads("gone"))).toBe(false);
    expect(existsSync(uploads("keep", "agent-wrote.txt"))).toBe(false);
    expect(() => lstatSync(uploads("planted"))).toThrow();
  });

  it("empties uploads/ when the conversation holds no File, and makes no link", async () => {
    await mount([served("file_a", "a.txt", Buffer.from("a"))]);
    rmSync(join(workspace, ".stigmer"));

    expect(await mount([])).toEqual([]);

    expect(existsSync(uploads("a.txt"))).toBe(false);
    expect(existsSync(join(workspace, ".stigmer"))).toBe(false);
  });

  it("makes uploads/ a folder again when the agent replaced it with a link", async () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(getPlatformDir(sessionId), { recursive: true });
    symlinkSync(elsewhere, uploads());

    await mount([served("file_a", "a.txt", Buffer.from("a"))]);

    expect(lstatSync(uploads()).isDirectory()).toBe(true);
    expect(existsSync(join(elsewhere, "a.txt")), "nothing is written through the planted link").toBe(false);
  });

  it("fetches every File again when the index cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entries = [served("file_a", "a.txt", Buffer.from("a"))];
    await mount(entries);
    writeFileSync(join(getPlatformDir(sessionId), UPLOADS_INDEX_FILE), "{not json");
    requested.length = 0;

    await mount(entries);

    expect(requested).toEqual(["/file_a"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("uploads index could not be read"));
  });

  it("refuses a File whose bytes are not its recorded size, without the link's query, and leaves no partial file", async () => {
    const entry = served("file_a", "a.txt", Buffer.from("short"), { sizeBytes: 99n });
    const err = await refusal([entry]);
    expect(err.message).toContain("got 5 bytes, expected 99");
    expect(err.message).not.toContain(SECRET);
    expect(existsSync(uploads("a.txt"))).toBe(false);
  });

  it("stops reading a body that runs past the recorded size", async () => {
    const err = await refusal([served("file_a", "a.txt", Buffer.alloc(64 * 1024, 1), { sizeBytes: 10n })]);
    expect(err.message).toMatch(/got \d+ bytes, expected 10/);
    expect(existsSync(uploads("a.txt"))).toBe(false);
  });

  it("refuses a download the server answers with an error, naming the link without its query", async () => {
    const entry = served("file_a", "a.txt", Buffer.from("a"));
    bodies.set("/file_a", (res) => {
      res.statusCode = 500;
      res.end();
    });
    const err = await refusal([entry]);
    expect(err.message).toContain(`HTTP 500 from ${base}/file_a`);
    expect(err.message).not.toContain(SECRET);
  });

  it("refuses a download cut off mid-body and leaves no partial file", async () => {
    const entry = served("file_a", "a.txt", Buffer.alloc(1024), { sizeBytes: 4096n });
    bodies.set("/file_a", (res) => {
      res.writeHead(200, { "content-length": "4096" });
      res.write(Buffer.alloc(1024));
      setTimeout(() => res.destroy(), 10);
    });
    const err = await refusal([entry]);
    expect(err.message).not.toContain(SECRET);
    expect(existsSync(uploads("a.txt"))).toBe(false);
  });

  it("names the origin a refused connection was to, without the link's path or query", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const url = `http://127.0.0.1:${port}/files/org_01a/blob?${SECRET}`;
    const err = await refusal([create(FileMountSchema, { fileId: "file_a", mountPath: "a.txt", sizeBytes: 1n, url })]);
    expect(err.message).toContain(`(from http://127.0.0.1:${port})`);
    expect(err.message).not.toContain("org_01a/blob");
    expect(err.message).not.toContain(SECRET);
  });

  it("never carries the query of a link that cannot even be parsed", async () => {
    const entry = create(FileMountSchema, { fileId: "file_a", mountPath: "a.txt", sizeBytes: 1n, url: `not a link?${SECRET}` });
    const err = await refusal([entry]);
    expect(err.message).not.toContain(SECRET);
    expect(err.message).toContain("could not be fetched");
  });

  it("refuses a File the server handed no link for", async () => {
    const err = await refusal([create(FileMountSchema, { fileId: "file_a", mountPath: "a.txt", sizeBytes: 1n, url: "" })]);
    expect(err.message).toContain("could not be fetched");
  });

  it("writes a body larger than the flush size in pieces, never whole", async () => {
    const big = Buffer.alloc(FLUSH_BYTES * 2 + 12345);
    for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
    const writes: number[] = [];
    const restore = installAgentFs({
      ...localAgentFs,
      appendFile: (path, data) => {
        writes.push(data.length);
        return localAgentFs.appendFile(path, data);
      },
    });
    try {
      await mount([served("file_big", "big.bin", big, { mimeType: "application/octet-stream" })]);
    } finally {
      restore();
    }

    expect(readFileSync(uploads("big.bin")).equals(big)).toBe(true);
    expect(writes.reduce((sum, n) => sum + n, 0)).toBe(big.length);
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...writes), "each piece is the flush size plus at most one network chunk").toBeLessThan(FLUSH_BYTES + 1024 * 1024);
  });

  it("refuses a mount path outside uploads/, an empty one, and two Files at one path", async () => {
    const at = (mountPath: string, fileId = "file_a") => create(FileMountSchema, { fileId, mountPath, sizeBytes: 0n, url: `${base}/x` });
    expect((await refusal([at("../escape.txt")])).message).toContain("not a place inside uploads/");
    expect((await refusal([at("/etc/passwd")])).message).toContain("not a place inside uploads/");
    expect((await refusal([at("")])).message).toContain("not a place inside uploads/");
    expect((await refusal([at("a.txt"), at("./a.txt", "file_b")])).message).toContain("name this mount path");
  });
});

describe("splitMessageFiles", () => {
  const file = (fileId: string): MountedFile => ({
    fileId,
    mountPath: `${fileId}.bin`,
    filename: `${fileId}.bin`,
    mimeType: "application/octet-stream",
    sizeBytes: 1,
    relativePath: `.stigmer/uploads/${fileId}.bin`,
  });
  const block = (type: string, fileId: string, sourceType = "file"): ContentBlock =>
    create(ContentBlockSchema, { type, source: create(ContentSourceSchema, { type: sourceType, fileId }) });

  it("takes this message's Files in the message's order, each kind from its block, and leaves the rest to the conversation", () => {
    const { message, conversation } = splitMessageFiles(
      [block("document", "file_c"), block("image", "file_a"), block("image", "file_a"), block("text", "", "text")],
      [file("file_a"), file("file_b"), file("file_c")],
    );
    expect(message.map((f) => [f.fileId, f.kind])).toEqual([["file_c", "document"], ["file_a", "image"]]);
    expect(conversation.map((f) => f.fileId)).toEqual(["file_b"]);
  });

  it("refuses a message File the conversation does not hold", () => {
    expect(() => splitMessageFiles([block("image", "file_x")], [file("file_a")])).toThrow(FileMountError);
  });
});

describe("offerMountedImage", () => {
  const image = (sizeBytes: number): MountedFile => ({
    fileId: "file_img",
    mountPath: "shot.png",
    filename: "shot.png",
    mimeType: "image/png",
    sizeBytes,
    relativePath: ".stigmer/uploads/shot.png",
  });

  it("reads the mounted bytes and offers them to the budget", async () => {
    await mount([served("file_img", "shot.png", PNG, { mimeType: "image/png" })]);
    const outcome = await offerMountedImage(image(PNG.length), sessionId, new VisionBudget(DEEP_AGENT_VISION_PROFILE));
    expect(outcome).toMatchObject({ kind: "accepted", image: { filename: "shot.png", mimeType: "image/png", byteSize: PNG.length } });
  });

  it("settles a blind model and an oversized image without reading the file", async () => {
    const read = vi.fn();
    const restore = installAgentFs({ ...localAgentFs, readFile: read });
    try {
      const blind = await offerMountedImage(image(10), sessionId, new VisionBudget(DEEP_AGENT_VISION_PROFILE, { modelVision: false }));
      const oversized = await offerMountedImage(image(10), sessionId, new VisionBudget(DEEP_AGENT_VISION_PROFILE, { maxImageBytes: 5 }));
      expect(blind).toEqual({ kind: "degraded", reason: "model_no_vision" });
      expect(oversized).toEqual({ kind: "degraded", reason: "too_large" });
    } finally {
      restore();
    }
    expect(read).not.toHaveBeenCalled();
  });
});

describe("fetchRunFileMounts", () => {
  it("asks the door for the run's Files under the run's scoped credential", async () => {
    const entries = [create(FileMountSchema, { fileId: "file_a" })];
    const client = mockStigmerClient({
      acquireScopedRunnerToken: vi.fn().mockResolvedValue("scoped-tok"),
      mountRunFiles: vi.fn().mockResolvedValue(entries),
    });

    expect(await fetchRunFileMounts(client, "aex_1")).toBe(entries);
    expect(client.acquireScopedRunnerToken).toHaveBeenCalledWith({ agentExecutionId: "aex_1" });
    expect(client.mountRunFiles).toHaveBeenCalledWith("aex_1", "scoped-tok");
  });
});
