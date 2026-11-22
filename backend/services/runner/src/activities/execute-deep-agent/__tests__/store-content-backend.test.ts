/**
 * The store-backed skill route answers exactly as the platform folder's
 * route does for the same files (`../store-content-backend.ts`): one
 * fixture skill is served both ways, from disk through deepagents' own
 * `FilesystemBackend` (`PlatformContentBackend`) and from a reader through
 * `ArchiveRoutedPlatform`, and every method's answer is compared, the
 * timestamps aside (the store keeps none). The fixture holds a text file, a
 * file long enough to page, an empty file, an image, a PDF, a file over
 * grep's 10 MB limit, nested folders, and a file for every extension of
 * deepagents' MIME table, so a drift in that copied table is caught.
 * deepagents' ripgrep path is turned off, so both sides search literally,
 * as its own fallback does.
 *
 * Also pinned: writes, edits and deletes refused with the platform route's
 * sentence, and a reader's failure surfaced as a read error, never a crash.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CompositeBackend, FilesystemBackend } from "deepagents";
import type { BackendProtocolV2 } from "deepagents";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ArchiveFileNotFoundError, type ArchiveFileInfo, type TurnArchiveFiles } from "../../../shared/archive-reader.js";
import { ArchiveRoutedPlatform, PlatformContentBackend } from "../platform-route.js";
import { NON_PLAIN_MIME_TYPES } from "../store-content-backend.js";

const ROUTE = "/.stigmer/";
const SKILL = "skills/notes";

const longText = Array.from({ length: 1234 }, (_, i) => `line ${i + 1}${i % 50 === 0 ? " needle" : ""}`).join("\n") + "\n";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0xff, 0x00]);

function fixture(): Map<string, Uint8Array> {
  const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
  const files = new Map<string, Uint8Array>([
    [`${SKILL}/SKILL.md`, enc("---\nname: notes\n---\nRead refs/long.txt for the needle.\n")],
    [`${SKILL}/refs/long.txt`, enc(longText)],
    [`${SKILL}/refs/deeper/note.md`, enc("a needle here\nand none here\n")],
    [`${SKILL}/refs/empty.txt`, new Uint8Array()],
    [`${SKILL}/img/logo.png`, PNG],
    [`${SKILL}/docs/manual.pdf`, enc("%PDF-1.4 needle\n")],
    [`${SKILL}/data/big.txt`, enc(`needle\n${"x".repeat(10 * 1024 * 1024 + 16)}\n`)],
    [`${SKILL}/scripts/run.sh`, enc("#!/bin/sh\necho needle\n")],
  ]);
  for (const ext of [...Object.keys(NON_PLAIN_MIME_TYPES), ".txt", ".py", ".unknownext", ""]) {
    files.set(`${SKILL}/mime/sample${ext}`, enc("hello needle\n"));
  }
  return files;
}

/** A reader over in-memory files, as the turn's would be. */
function readerOver(files: ReadonlyMap<string, Uint8Array>, fail?: string): TurnArchiveFiles {
  return {
    folders: ["skills"],
    list: async () =>
      [...files].map(([path, content]): ArchiveFileInfo => ({ path, size: content.length, sha256: createHash("sha256").update(content).digest("hex"), executable: false })),
    read: async (path) => {
      if (path === fail) throw new Error("the store is unreachable");
      const content = files.get(path);
      if (content === undefined) throw new ArchiveFileNotFoundError(path);
      return content;
    },
  };
}

let root: string;
let onDisk: BackendProtocolV2;
let fromStore: BackendProtocolV2;
let files: Map<string, Uint8Array>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "store-parity-"));
  files = fixture();
  const platform = join(root, "platform");
  for (const [path, content] of files) {
    mkdirSync(dirname(join(platform, path)), { recursive: true });
    writeFileSync(join(platform, path), content);
  }
  const empty = join(root, "empty-platform");
  mkdirSync(empty);
  const workspace = join(root, "ws");
  mkdirSync(workspace);
  onDisk = new CompositeBackend(new FilesystemBackend({ rootDir: workspace, virtualMode: true }), { [ROUTE]: new PlatformContentBackend(platform) });
  fromStore = new CompositeBackend(new FilesystemBackend({ rootDir: workspace, virtualMode: true }), { [ROUTE]: new ArchiveRoutedPlatform(empty, readerOver(files)) });
  // Both sides search literally, as deepagents does without ripgrep.
  vi.spyOn(FilesystemBackend.prototype as unknown as { ripgrepSearch: () => Promise<null> }, "ripgrepSearch").mockResolvedValue(null);
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** An answer without the timestamps the store does not keep. */
function untimed(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, inner: unknown) => {
      if (key === "modified_at" || key === "created_at") return undefined;
      if (inner instanceof Uint8Array) return { bytes: [...inner] };
      return inner;
    }),
  );
}

const agentPath = (path: string): string => `${ROUTE}${path}`;

describe("the store route answers as the platform folder's route does", () => {
  it("answers something to compare: the fixture is there on both sides", async () => {
    expect((await onDisk.ls(agentPath(SKILL))).files?.map((file) => file.path)).toContain(agentPath(`${SKILL}/SKILL.md`));
    expect((await fromStore.ls(agentPath(SKILL))).files?.map((file) => file.path)).toContain(agentPath(`${SKILL}/SKILL.md`));
    expect((await fromStore.ls(ROUTE)).files?.map((file) => file.path)).toEqual([`${ROUTE}skills/`]);
    expect((await fromStore.read(agentPath(`${SKILL}/refs/long.txt`))).nextOffset).toBe(500);
    expect((await fromStore.grep("needle", agentPath(SKILL))).matches?.length).toBeGreaterThan(10);
  });

  it("ls, at every folder, a file, and a missing path", async () => {
    const dirs = new Set<string>([ROUTE, `${ROUTE}skills`, `${ROUTE}skills/`]);
    for (const path of files.keys()) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i += 1) dirs.add(agentPath(parts.slice(0, i).join("/")));
    }
    for (const path of [...dirs, agentPath(`${SKILL}/SKILL.md`), agentPath(`${SKILL}/missing`)]) {
      expect(untimed(await fromStore.ls(path)), path).toEqual(untimed(await onDisk.ls(path)));
    }
  });

  it("read, of every file, paged, past its end, and of a folder", async () => {
    for (const path of files.keys()) {
      expect(untimed(await fromStore.read(agentPath(path))), path).toEqual(untimed(await onDisk.read(agentPath(path))));
    }
    const long = agentPath(`${SKILL}/refs/long.txt`);
    for (const [offset, limit] of [[0, 500], [500, 500], [1000, 500], [1233, 10], [5000, 10], [2.7, 3.2], [0, 0]] as const) {
      expect(untimed(await fromStore.read(long, offset, limit)), `${offset},${limit}`).toEqual(untimed(await onDisk.read(long, offset, limit)));
    }
    expect(await fromStore.read(agentPath(`${SKILL}/refs`))).toEqual(await onDisk.read(agentPath(`${SKILL}/refs`)));
  });

  it("read of a missing file: the same error, without the disk's real path", async () => {
    const path = agentPath(`${SKILL}/refs/missing.md`);
    const store = (await fromStore.read(path)).error;
    const disk = (await onDisk.read(path)).error;
    expect(store).toBe("Error reading file '/skills/notes/refs/missing.md': ENOENT: no such file or directory");
    expect(disk?.startsWith(store!)).toBe(true);
  });

  it("readRaw, of every file", async () => {
    for (const path of files.keys()) {
      expect(untimed(await fromStore.readRaw(agentPath(path))), path).toEqual(untimed(await onDisk.readRaw(agentPath(path))));
    }
  });

  it("grep, literal, skipping non-text and over-limit files, by path, file and glob, with a cap", async () => {
    const sorted = (result: { matches?: { path: string; line: number }[] }) => ({
      ...result,
      matches: [...(result.matches ?? [])].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
    });
    const cases: [string, string | undefined, string | null, number | null][] = [
      ["needle", agentPath(SKILL), null, null],
      ["needle", agentPath(`${SKILL}/refs`), null, null],
      ["needle", agentPath(`${SKILL}/refs/deeper/note.md`), null, null],
      ["needle", agentPath(SKILL), "*.md", null],
      ["line 1", agentPath(`${SKILL}/refs/long.txt`), null, null],
      ["(needle", agentPath(SKILL), null, null],
      ["absent text", agentPath(SKILL), null, null],
      ["needle", agentPath(`${SKILL}/missing`), null, null],
    ];
    for (const [pattern, path, glob, max] of cases) {
      expect(sorted(await fromStore.grep(pattern, path, glob, max)), `${pattern} in ${path} ${glob ?? ""}`).toEqual(sorted(await onDisk.grep(pattern, path, glob, max)));
    }
    const capped = await fromStore.grep("needle", agentPath(SKILL), null, 3);
    expect(capped.matches).toHaveLength(3);
    expect(capped.truncated).toBe(true);
  });

  it("glob, by pattern and folder", async () => {
    for (const [pattern, path] of [["**/*.md", agentPath(SKILL)], ["*.txt", agentPath(`${SKILL}/refs`)], ["**/*", agentPath(`${SKILL}/img`)], ["mime/sample.*", agentPath(SKILL)]] as const) {
      expect(untimed(await fromStore.glob(pattern, path)), `${pattern} in ${path}`).toEqual(untimed(await onDisk.glob(pattern, path)));
    }
  });
});

describe("the store route refuses every change", () => {
  it("refuses a write, an edit and a delete with the platform route's sentence", async () => {
    const path = agentPath(`${SKILL}/SKILL.md`);
    const sentence = "Error: '/.stigmer/skills/notes/SKILL.md' is platform content (skills, attached inputs, the approved plan) and is read-only";
    expect((await fromStore.write(path, "x")).error).toContain(sentence);
    expect((await fromStore.edit(path, "a", "b")).error).toContain(sentence);
    expect((await fromStore.delete!(path)).error).toContain(sentence);
  });

  it("answers a reader's failure as a read error, never a crash", async () => {
    const failing = new CompositeBackend(new FilesystemBackend({ rootDir: root, virtualMode: true }), {
      [ROUTE]: new ArchiveRoutedPlatform(join(root, "empty-platform"), readerOver(files, `${SKILL}/SKILL.md`)),
    });
    expect((await failing.read(agentPath(`${SKILL}/SKILL.md`))).error).toBe(
      "Error reading file '/skills/notes/SKILL.md': the store is unreachable",
    );
  });
});
