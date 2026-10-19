/**
 * Pins the outputs collector (`../outputs.ts`) against a stand-in for the
 * server's output door that mints links to a real HTTP server here, which
 * keeps what is put to it:
 *   - what is saved in the folder comes back, each at its output path, two
 *     same-named files in two folders as two; what is saved outside it, a
 *     link inside it and an empty file do not;
 *   - an unchanged output is not uploaded again, a changed one is, a touched
 *     but identical one is not, and a deleted one loses its record;
 *   - each output is streamed in pieces and hashed for the door;
 *   - an output over the count cap is left for the next turn, and a door
 *     that refuses one output's link or registration returns the rest;
 *     collection never throws, and no error carries a link's query;
 *   - an output over the size cap, one that stops being a regular file or
 *     leaves the folder between the listing and its read, and one that
 *     shrinks while it is read are skipped; an index that cannot be read
 *     costs a hash of everything, never a turn; a reference spent with no
 *     File is uploaded once more;
 *   - the folder and the link are made by the phase before skills.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { FileSchema, type File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { OutputUploadSchema, type OutputUpload } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";

import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import { installAgentFs, localAgentFs } from "../agent-fs.js";
import {
  collectOutputs,
  isInOutputsFolder,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUTS_PER_TURN,
  OUTPUTS_INDEX_FILE,
  OUTPUTS_SUBDIR,
  prepareOutputsFolder,
  READ_CHUNK_BYTES,
} from "../outputs.js";
import { getPlatformDir } from "../workspace/platform-dir.js";

const SECRET = "sig=very-secret";

/** What each upload link received, by its reference. */
const received = new Map<string, Buffer>();
let refusePut = new Set<string>();
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const ref = new URL(req.url ?? "/", "http://x").pathname.slice(1);
    const parts: Buffer[] = [];
    req.on("data", (chunk: Buffer) => parts.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(parts);
      if (refusePut.has(ref) || Number(req.headers["content-length"]) !== body.length) {
        res.statusCode = 403;
        res.end(`refused ${req.url}`);
        return;
      }
      received.set(ref, body);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let root: string;
let workspace: string;
let originalHome: string | undefined;
const SESSION = "ses_outputs";

/** The door the collector talks to: links to this file's server, Files named by path and hash. */
interface Door {
  readonly client: StigmerClient;
  readonly minted: string[][];
  readonly registered: Array<Array<{ outputPath: string; uploadRef: string; contentSha256: string }>>;
}

function door(
  options: {
    readonly refuseMint?: (path: string) => boolean;
    readonly refuseRegister?: (path: string) => boolean;
    /** Paths whose first upload reference is spent with no File behind it. */
    readonly spentFirst?: ReadonlySet<string>;
  } = {},
): Door {
  const minted: string[][] = [];
  const registered: Door["registered"] = [];
  const firstRef = new Map<string, string>();
  let next = 0;
  const client = mockStigmerClient({
    acquireScopedRunnerToken: vi.fn().mockResolvedValue("scoped"),
    createOutputUploads: vi.fn(async (_run: string, entries: ReadonlyArray<{ outputPath: string; sizeBytes: number }>) => {
      minted.push(entries.map((entry) => entry.outputPath));
      if (entries.some((entry) => options.refuseMint?.(entry.outputPath))) {
        throw new ConnectError("the file is too large", Code.InvalidArgument);
      }
      return entries.map((entry): OutputUpload => {
        const ref = `fup_${next++}`;
        if (!firstRef.has(entry.outputPath)) firstRef.set(entry.outputPath, ref);
        return create(OutputUploadSchema, { outputPath: entry.outputPath, uploadRef: ref, url: `${base}/${ref}?${SECRET}`, ttlSeconds: 60 });
      });
    }),
    registerOutputs: vi.fn(async (_run: string, entries: ReadonlyArray<{ outputPath: string; uploadRef: string; contentSha256: string }>) => {
      registered.push(entries.map((entry) => ({ ...entry })));
      if (entries.some((entry) => options.refuseRegister?.(entry.outputPath))) {
        throw new ConnectError("refused", Code.Internal);
      }
      const spent = entries.find((entry) => options.spentFirst?.has(entry.outputPath) && firstRef.get(entry.outputPath) === entry.uploadRef);
      if (spent !== undefined) {
        throw new ConnectError("upload reference unknown or expired", Code.FailedPrecondition);
      }
      return entries.map(
        (entry): File =>
          create(FileSchema, {
            metadata: { id: `file_${entry.outputPath}_${entry.contentSha256.slice(0, 6)}` },
            status: { outputPath: entry.outputPath },
          }),
      );
    }),
  });
  return { client, minted, registered };
}

function outputsDir(): string {
  return join(getPlatformDir(SESSION), OUTPUTS_SUBDIR);
}

function save(outputPath: string, content: string | Buffer): void {
  const path = join(outputsDir(), outputPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function collect(d: Door) {
  return collectOutputs({ client: d.client, executionId: "run_1", sessionId: SESSION });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "outputs-"));
  originalHome = process.env.HOME;
  process.env.HOME = join(root, "home");
  workspace = join(root, "ws");
  mkdirSync(workspace, { recursive: true });
  received.clear();
  refusePut = new Set();
  await prepareOutputsFolder(SESSION, workspace);
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("prepareOutputsFolder", () => {
  it("makes the folder and the workspace link that reaches it, and replaces a link planted where the folder belongs", async () => {
    expect(lstatSync(outputsDir()).isDirectory()).toBe(true);
    expect(readlinkSync(join(workspace, ".stigmer"))).toBe(getPlatformDir(SESSION));

    rmSync(outputsDir(), { recursive: true });
    symlinkSync(workspace, outputsDir());
    await prepareOutputsFolder(SESSION, workspace);
    expect(lstatSync(outputsDir()).isDirectory()).toBe(true);
  });
});

describe("collectOutputs", () => {
  it("returns what was saved in the folder, two same-named files in two folders as two", async () => {
    save("variance-q3.csv", "a,b\n1,2\n");
    save("reports/north/summary.md", "# North\n");
    save("reports/south/summary.md", "# South\n");
    writeFileSync(join(workspace, "edited-in-the-repo.md"), "not an output\n");
    const d = door();

    const collected = await collect(d);

    expect([...collected.returned.keys()].sort()).toEqual(["reports/north/summary.md", "reports/south/summary.md", "variance-q3.csv"]);
    expect(d.minted).toEqual([["reports/north/summary.md", "reports/south/summary.md", "variance-q3.csv"]]);
    const [batch] = d.registered;
    expect(batch?.map((entry) => [entry.outputPath, entry.contentSha256])).toEqual([
      ["reports/north/summary.md", sha256("# North\n")],
      ["reports/south/summary.md", sha256("# South\n")],
      ["variance-q3.csv", sha256("a,b\n1,2\n")],
    ]);
    for (const entry of batch ?? []) {
      expect(received.get(entry.uploadRef)?.toString(), entry.outputPath).toBe(
        readFileSync(join(outputsDir(), entry.outputPath), "utf8"),
      );
    }
    expect(existsSync(join(getPlatformDir(SESSION), OUTPUTS_INDEX_FILE)), "the index sits beside the folder").toBe(true);
  });

  it("follows no link inside the folder and skips what is not a regular file, or empty", async () => {
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "secret elsewhere\n");
    symlinkSync(outside, join(outputsDir(), "linked.txt"));
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "deep.txt"), "deep\n");
    symlinkSync(join(root, "elsewhere"), join(outputsDir(), "linked-dir"));
    save("empty.txt", "");
    save("real.txt", "real\n");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = door();

    const collected = await collect(d);

    expect([...collected.returned.keys()]).toEqual(["real.txt"]);
    expect(collected.skipped.map((skip) => skip.outputPath).sort()).toEqual(["empty.txt", "linked-dir", "linked.txt"]);
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain("'linked.txt' is not returned: it is a link");
  });

  it("uploads an unchanged output once, a touched identical one never again, and a changed one as new", async () => {
    save("report.md", "first draft\n");
    const first = door();
    expect((await collect(first)).returned.size).toBe(1);

    const unchanged = door();
    const again = await collect(unchanged);
    expect(again.returned.size).toBe(0);
    expect(again.unchanged).toBe(1);
    expect(unchanged.minted, "nothing minted when nothing changed").toEqual([]);

    const later = new Date(Date.now() + 60_000);
    utimesSync(join(outputsDir(), "report.md"), later, later);
    const touched = door();
    expect((await collect(touched)).unchanged, "same bytes, new time").toBe(1);
    expect(touched.minted).toEqual([]);

    save("report.md", "second draft\n");
    const changed = door();
    const collected = await collect(changed);
    expect([...collected.returned.keys()]).toEqual(["report.md"]);
    expect(changed.registered[0]?.[0]?.contentSha256).toBe(sha256("second draft\n"));
  });

  it("forgets a deleted output, so the same bytes saved again come back again", async () => {
    save("report.md", "kept\n");
    await collect(door());
    rmSync(join(outputsDir(), "report.md"));
    await collect(door());
    const index = JSON.parse(readFileSync(join(getPlatformDir(SESSION), OUTPUTS_INDEX_FILE), "utf8")) as { outputs: object };
    expect(index.outputs).toEqual({});
    save("report.md", "kept\n");
    expect((await collect(door())).returned.size).toBe(1);
  });

  it("streams an output larger than one read in pieces", async () => {
    const big = Buffer.alloc(READ_CHUNK_BYTES * 2 + 17, 7);
    save("big.bin", big);
    const reads: number[] = [];
    const restore = installAgentFs({
      ...localAgentFs,
      readRange: (path, offset, length) => {
        reads.push(length);
        return localAgentFs.readRange(path, offset, length);
      },
      readFile: () => Promise.reject(new Error("an output is never read whole")),
    });
    try {
      const d = door();
      await collect(d);
      expect(received.get(d.registered[0]?.[0]?.uploadRef ?? "")?.equals(big)).toBe(true);
      expect(Math.max(...reads)).toBeLessThanOrEqual(READ_CHUNK_BYTES);
    } finally {
      restore();
    }
  });

  it("returns at most the turn's cap, leaving the rest for the next turn", async () => {
    for (let i = 0; i <= MAX_OUTPUTS_PER_TURN; i++) save(`many/${String(i).padStart(4, "0")}.txt`, `${i}\n`);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = door();
    const collected = await collect(d);
    expect(collected.returned.size).toBe(MAX_OUTPUTS_PER_TURN);
    expect(collected.skipped.map((skip) => skip.outputPath)).toEqual([`many/${String(MAX_OUTPUTS_PER_TURN).padStart(4, "0")}.txt`]);
    expect((await collect(door())).returned.size, "the next turn returns the one left").toBe(1);
  });

  it("returns the rest when the door refuses one output's link, its upload or its registration", async () => {
    save("a.md", "a\n");
    save("b.md", "b\n");
    save("c.md", "c\n");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = door({ refuseMint: (path) => path === "a.md", refuseRegister: (path) => path === "c.md" });

    const collected = await collect(d);

    expect([...collected.returned.keys()]).toEqual(["b.md"]);
    expect(collected.skipped.map((skip) => skip.outputPath).sort()).toEqual(["a.md", "c.md"]);
    expect(JSON.stringify(collected.skipped)).not.toContain(SECRET);
  });

  it("names a refused upload without the link's signature, and never throws", async () => {
    save("a.md", "a\n");
    refusePut = new Set(["fup_0"]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const collected = await collect(door());
    expect(collected.returned.size).toBe(0);
    expect(collected.skipped[0]?.reason).toContain("HTTP 403");
    expect(JSON.stringify(collected.skipped)).not.toContain(SECRET);

    const broken = mockStigmerClient({ acquireScopedRunnerToken: vi.fn().mockRejectedValue(new Error("no credential")) });
    await expect(collectOutputs({ client: broken, executionId: "run_1", sessionId: SESSION })).resolves.toMatchObject({ returned: new Map() });
  });

  it("returns nothing, asking nothing, for a session whose folder is gone", async () => {
    rmSync(outputsDir(), { recursive: true });
    const d = door();
    expect((await collect(d)).returned.size).toBe(0);
    expect(d.minted).toEqual([]);
  });
});

describe("collectOutputs at its edges", () => {
  it("skips an output over the size cap without reading it", async () => {
    save("huge.bin", "");
    truncateSync(join(outputsDir(), "huge.bin"), MAX_OUTPUT_BYTES + 1);
    save("small.txt", "small\n");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const collected = await collect(door());
    expect([...collected.returned.keys()]).toEqual(["small.txt"]);
    expect(collected.skipped[0]?.reason).toContain("over the");
  });

  it("skips what stops being a regular file or leaves the folder between the listing and its read, and what shrinks while read", async () => {
    save("swapped.txt", "x\n");
    save("escaped.txt", "y\n");
    save("vanished.txt", "v\n");
    save("shrinking.txt", "zzzz\n");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const restore = installAgentFs({
      ...localAgentFs,
      lstat: async (path) => {
        const stats = await localAgentFs.lstat(path);
        return path.endsWith("swapped.txt") ? { ...stats, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true } : stats;
      },
      realpath: async (path) => {
        if (path.endsWith("escaped.txt")) return join(root, "elsewhere.txt");
        if (path.endsWith("vanished.txt")) throw Object.assign(new Error("gone"), { code: "ENOENT" });
        return localAgentFs.realpath(path);
      },
      readRange: async (path, offset, length) => (path.endsWith("shrinking.txt") ? Buffer.alloc(0) : localAgentFs.readRange(path, offset, length)),
    });
    try {
      const d = door();
      const collected = await collect(d);
      expect(collected.skipped.slice(0, 3).map((skip) => [skip.outputPath, skip.reason])).toEqual([
        ["escaped.txt", "it is not inside the outputs folder"],
        ["swapped.txt", "it is not a regular file"],
        ["vanished.txt", "it is not inside the outputs folder"],
      ]);
      // A file that shrank to nothing is put short of its declared size, and its upload fails.
      expect(collected.returned.size).toBe(0);
      expect(collected.skipped[3]?.outputPath).toBe("shrinking.txt");
      expect(collected.skipped[3]?.reason).toContain("its upload failed");
    } finally {
      restore();
    }
  });

  it("reads past an index it cannot parse, hashing everything again", async () => {
    save("report.md", "kept\n");
    writeFileSync(join(getPlatformDir(SESSION), OUTPUTS_INDEX_FILE), "{ not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await collect(door())).returned.size).toBe(1);
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain("could not be read");
  });

  it("uploads an output once more when its reference was spent with no File, and names one it still cannot return", async () => {
    save("a.md", "a\n");
    save("b.md", "b\n");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = door({ spentFirst: new Set(["a.md"]) });
    const collected = await collect(d);
    expect([...collected.returned.keys()].sort()).toEqual(["a.md", "b.md"]);
    expect(d.minted.flat().filter((path) => path === "a.md"), "a.md minted twice").toHaveLength(2);

    save("c.md", "c\n");
    let mints = 0;
    const second = door({ spentFirst: new Set(["c.md"]), refuseMint: () => mints++ > 0 });
    const lost = await collect(second);
    expect(lost.returned.size).toBe(0);
    expect(lost.skipped.map((skip) => skip.outputPath)).toEqual(["c.md"]);
    expect(lost.skipped[0]?.reason).toContain("could not be registered");
  });
});

describe("isInOutputsFolder", () => {
  it("names a path inside the folder, normalized, and not the folder itself or a sibling", () => {
    expect(isInOutputsFolder("/.stigmer/outputs/report.md")).toBe(true);
    expect(isInOutputsFolder(".stigmer/outputs/reports/q3.md")).toBe(true);
    expect(isInOutputsFolder("/.stigmer/outputs")).toBe(false);
    expect(isInOutputsFolder("/.stigmer/outputs/")).toBe(false);
    expect(isInOutputsFolder("/.stigmer/outputs/../skills/x.md")).toBe(false);
    expect(isInOutputsFolder("/.stigmer/outputs.md")).toBe(false);
    expect(isInOutputsFolder("/src/.stigmer/outputs/x.md")).toBe(false);
  });
});
