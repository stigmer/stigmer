/**
 * Unit tests for the CAS snapshot/restore substrate (Phase 3).
 *
 * The substrate is exercised in isolation with an in-memory {@link ArtifactStorage}
 * fake and a map-backed {@link BlobReader}; workspace writes go to a real temp
 * dir. These prove the capture classification, content-addressed dedup,
 * manifest determinism, and byte-exact idempotent reconcile — the loop the
 * offline guard later exercises end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FileCaptureClass,
  FileChangeKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { LocalArtifactStorage, type ArtifactStorage } from "../../artifact-storage.js";
import { sha256Bytes } from "../digest.js";
import {
  applyCasApproved,
  casBlobKey,
  casBlobReader,
  casManifestKey,
  loadCasManifest,
  restoreCasToBaseline,
  snapshotCasChangeSet,
  type BlobReader,
  type CasCapturedFile,
} from "../cas-substrate.js";

const EXEC = "exec-1";
const CHANGE_SET = "exec-1:1";
const IGNORED = FileCaptureClass.GIT_IGNORED_CAPTURED;

function makeFakeStorage(): {
  storage: ArtifactStorage;
  readBlob: BlobReader;
  blobs: Map<string, Buffer>;
  uploadCount: () => number;
} {
  const blobs = new Map<string, Buffer>();
  let uploads = 0;
  const storage: ArtifactStorage = {
    async upload(key, content) {
      uploads++;
      blobs.set(key, Buffer.from(content));
      return key;
    },
    async getDownloadUrl(key) {
      return `mem://${key}`;
    },
    async exists(key) {
      return blobs.has(key);
    },
  };
  const readBlob: BlobReader = async (key) => {
    const b = blobs.get(key);
    if (!b) throw new Error(`missing blob ${key}`);
    return b;
  };
  return { storage, readBlob, blobs, uploadCount: () => uploads };
}

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

let workspace: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "cas-sub-"));
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("snapshotCasChangeSet — classification", () => {
  it("classifies ADD / MODIFY / DELETE and computes content hashes", async () => {
    const { storage } = makeFakeStorage();
    const { manifest } = await snapshotCasChangeSet({
      storage,
      executionId: EXEC,
      changeSetId: CHANGE_SET,
      captures: [
        { path: "created.env", before: null, after: bytes("NEW=1"), captureClass: IGNORED },
        { path: "changed.env", before: bytes("OLD=1"), after: bytes("OLD=2"), captureClass: IGNORED },
        { path: "removed.env", before: bytes("BYE=1"), after: null, captureClass: IGNORED },
      ],
    });

    const byPath = new Map(manifest.files.map((f) => [f.pathAfter || f.pathBefore, f]));

    const add = byPath.get("created.env")!;
    expect(add.kind).toBe(FileChangeKind.ADD);
    expect(add.pathBefore).toBe("");
    expect(add.before).toBeUndefined();
    expect(add.after?.sha256).toBe(sha256Bytes(bytes("NEW=1")));

    const mod = byPath.get("changed.env")!;
    expect(mod.kind).toBe(FileChangeKind.MODIFY);
    expect(mod.before?.sha256).toBe(sha256Bytes(bytes("OLD=1")));
    expect(mod.after?.sha256).toBe(sha256Bytes(bytes("OLD=2")));

    const del = byPath.get("removed.env")!;
    expect(del.kind).toBe(FileChangeKind.DELETE);
    expect(del.pathAfter).toBe("");
    expect(del.after).toBeUndefined();
    expect(del.before?.sha256).toBe(sha256Bytes(bytes("BYE=1")));
  });

  it("drops a touched-but-unchanged path (before == after)", async () => {
    const { storage } = makeFakeStorage();
    const { manifest } = await snapshotCasChangeSet({
      storage,
      executionId: EXEC,
      changeSetId: CHANGE_SET,
      captures: [
        { path: "same.env", before: bytes("X=1"), after: bytes("X=1"), captureClass: IGNORED },
      ],
    });
    expect(manifest.files).toHaveLength(0);
  });

  it("drops a fully absent capture (before and after null)", async () => {
    const { storage } = makeFakeStorage();
    const { manifest } = await snapshotCasChangeSet({
      storage,
      executionId: EXEC,
      changeSetId: CHANGE_SET,
      captures: [{ path: "ghost", before: null, after: null, captureClass: IGNORED }],
    });
    expect(manifest.files).toHaveLength(0);
  });

  it("flags a binary side as not diff-complete", async () => {
    const { storage } = makeFakeStorage();
    const bin = new Uint8Array([1, 0, 2, 0, 3]); // contains NUL
    const { manifest } = await snapshotCasChangeSet({
      storage,
      executionId: EXEC,
      changeSetId: CHANGE_SET,
      captures: [{ path: "blob.bin", before: null, after: bin, captureClass: IGNORED }],
    });
    expect(manifest.files[0].diffComplete).toBe(false);
    expect(manifest.files[0].after?.isBinary).toBe(true);
  });

  it("stamps the capture class through to the manifest", async () => {
    const { storage } = makeFakeStorage();
    const { manifest } = await snapshotCasChangeSet({
      storage,
      executionId: EXEC,
      changeSetId: CHANGE_SET,
      captures: [
        { path: "a", before: null, after: bytes("a"), captureClass: FileCaptureClass.NON_GIT_CAS },
      ],
    });
    expect(manifest.files[0].captureClass).toBe(FileCaptureClass.NON_GIT_CAS);
  });
});

describe("snapshotCasChangeSet — storage", () => {
  it("content-addresses blobs and dedupes identical bodies across paths", async () => {
    const { storage, uploadCount } = makeFakeStorage();
    await snapshotCasChangeSet({
      storage,
      executionId: EXEC,
      changeSetId: CHANGE_SET,
      captures: [
        { path: "a", before: null, after: bytes("SHARED"), captureClass: IGNORED },
        { path: "b", before: null, after: bytes("SHARED"), captureClass: IGNORED },
      ],
    });
    // Two files but one shared blob + one manifest = 2 uploads, not 3.
    expect(uploadCount()).toBe(2);
  });

  it("stores blobs under the execution-scoped content-address key", async () => {
    const { storage, blobs } = makeFakeStorage();
    await snapshotCasChangeSet({
      storage,
      executionId: EXEC,
      changeSetId: CHANGE_SET,
      captures: [{ path: "a", before: null, after: bytes("body"), captureClass: IGNORED }],
    });
    const expectedKey = casBlobKey(EXEC, sha256Bytes(bytes("body")));
    expect(blobs.has(expectedKey)).toBe(true);
  });

  it("persists a manifest whose digest is order-independent and reloadable", async () => {
    const a = makeFakeStorage();
    const b = makeFakeStorage();
    const capA = { path: "a", before: null, after: bytes("A"), captureClass: IGNORED };
    const capB = { path: "b", before: null, after: bytes("B"), captureClass: IGNORED };

    const r1 = await snapshotCasChangeSet({
      storage: a.storage, executionId: EXEC, changeSetId: CHANGE_SET, captures: [capA, capB],
    });
    const r2 = await snapshotCasChangeSet({
      storage: b.storage, executionId: EXEC, changeSetId: CHANGE_SET, captures: [capB, capA],
    });
    // Same files in a different input order -> identical manifest digest.
    expect(r1.ref.manifestDigest).toBe(r2.ref.manifestDigest);
    expect(r1.ref.artifactUri).toBe(casManifestKey(EXEC, CHANGE_SET));

    const loaded = await loadCasManifest({
      storage: a.storage, readBlob: a.readBlob, executionId: EXEC, changeSetId: CHANGE_SET,
    });
    expect(loaded?.files.map((f) => f.pathAfter)).toEqual(["a", "b"]);
  });

  it("loadCasManifest returns undefined when no manifest exists", async () => {
    const { storage, readBlob } = makeFakeStorage();
    const loaded = await loadCasManifest({
      storage, readBlob, executionId: "other", changeSetId: "nope:1",
    });
    expect(loaded).toBeUndefined();
  });
});

describe("reconcile — applyCasApproved", () => {
  it("writes approved after bytes for a MODIFY", async () => {
    const { storage, readBlob } = makeFakeStorage();
    const abs = join(workspace, "changed.env");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(abs, "OLD=2"); // the applied (after) state from the review window
    const { manifest } = await snapshotCasChangeSet({
      storage, executionId: EXEC, changeSetId: CHANGE_SET,
      captures: [{ path: "changed.env", before: bytes("OLD=1"), after: bytes("OLD=2"), captureClass: IGNORED }],
    });

    await applyCasApproved({ readBlob, workspaceRoot: workspace, files: manifest.files });
    expect(readFileSync(abs, "utf8")).toBe("OLD=2");
  });

  it("removes the file for an approved DELETE", async () => {
    const { storage, readBlob } = makeFakeStorage();
    const abs = join(workspace, "removed.env");
    const { manifest } = await snapshotCasChangeSet({
      storage, executionId: EXEC, changeSetId: CHANGE_SET,
      captures: [{ path: "removed.env", before: bytes("BYE=1"), after: null, captureClass: IGNORED }],
    });
    await applyCasApproved({ readBlob, workspaceRoot: workspace, files: manifest.files });
    expect(existsSync(abs)).toBe(false);
  });

  it("throws on a blob integrity mismatch rather than writing wrong bytes", async () => {
    const { storage, blobs } = makeFakeStorage();
    const { manifest } = await snapshotCasChangeSet({
      storage, executionId: EXEC, changeSetId: CHANGE_SET,
      captures: [{ path: "a", before: null, after: bytes("good"), captureClass: IGNORED }],
    });
    // Corrupt the stored blob so its bytes no longer hash to the content address.
    const key = manifest.files[0].after!.storageKey;
    blobs.set(key, Buffer.from("tampered"));
    const corruptReader: BlobReader = async (k) => blobs.get(k)!;

    await expect(
      applyCasApproved({ readBlob: corruptReader, workspaceRoot: workspace, files: manifest.files }),
    ).rejects.toThrow(/integrity check failed/);
    expect(existsSync(join(workspace, "a"))).toBe(false);
  });

  it("is idempotent — applying twice converges", async () => {
    const { storage, readBlob } = makeFakeStorage();
    const { manifest } = await snapshotCasChangeSet({
      storage, executionId: EXEC, changeSetId: CHANGE_SET,
      captures: [{ path: "a", before: null, after: bytes("v1"), captureClass: IGNORED }],
    });
    await applyCasApproved({ readBlob, workspaceRoot: workspace, files: manifest.files });
    await applyCasApproved({ readBlob, workspaceRoot: workspace, files: manifest.files });
    expect(readFileSync(join(workspace, "a"), "utf8")).toBe("v1");
  });
});

describe("reconcile — restoreCasToBaseline", () => {
  it("removes an agent-created file (rejected ADD)", async () => {
    const { storage, readBlob } = makeFakeStorage();
    const abs = join(workspace, "created.env");
    writeFileSync(abs, "NEW=1"); // the applied create, to be reverted
    const { manifest } = await snapshotCasChangeSet({
      storage, executionId: EXEC, changeSetId: CHANGE_SET,
      captures: [{ path: "created.env", before: null, after: bytes("NEW=1"), captureClass: IGNORED }],
    });
    await restoreCasToBaseline({ readBlob, workspaceRoot: workspace, files: manifest.files });
    expect(existsSync(abs)).toBe(false);
  });

  it("restores the before bytes for a rejected MODIFY", async () => {
    const { storage, readBlob } = makeFakeStorage();
    const abs = join(workspace, "changed.env");
    writeFileSync(abs, "OLD=2"); // applied edit
    const { manifest } = await snapshotCasChangeSet({
      storage, executionId: EXEC, changeSetId: CHANGE_SET,
      captures: [{ path: "changed.env", before: bytes("OLD=1"), after: bytes("OLD=2"), captureClass: IGNORED }],
    });
    await restoreCasToBaseline({ readBlob, workspaceRoot: workspace, files: manifest.files });
    expect(readFileSync(abs, "utf8")).toBe("OLD=1");
  });

  it("recreates a rejected DELETE from its before bytes", async () => {
    const { storage, readBlob } = makeFakeStorage();
    const abs = join(workspace, "removed.env");
    const { manifest } = await snapshotCasChangeSet({
      storage, executionId: EXEC, changeSetId: CHANGE_SET,
      captures: [{ path: "removed.env", before: bytes("BYE=1"), after: null, captureClass: IGNORED }],
    });
    // The delete was applied during review (file gone); rejecting restores it.
    await restoreCasToBaseline({ readBlob, workspaceRoot: workspace, files: manifest.files });
    expect(readFileSync(abs, "utf8")).toBe("BYE=1");
  });
});

describe("casBlobReader", () => {
  it("fetches bytes from the storage download URL", async () => {
    const { storage, blobs } = makeFakeStorage();
    await snapshotCasChangeSet({
      storage, executionId: EXEC, changeSetId: CHANGE_SET,
      captures: [{ path: "a", before: null, after: bytes("hello"), captureClass: IGNORED }],
    });
    const key = casBlobKey(EXEC, sha256Bytes(bytes("hello")));

    const fetchMock = vi.fn(async (url: string) => {
      const k = url.replace(/^mem:\/\//, "");
      // Return an isolated ArrayBuffer (a Node Buffer's .buffer is the shared pool).
      const copy = new Uint8Array(blobs.get(k)!);
      return { ok: true, arrayBuffer: async () => copy.buffer } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const reader = casBlobReader(storage);
    const got = await reader(key);
    expect(got.toString("utf8")).toBe("hello");

    vi.unstubAllGlobals();
  });
});

describe("casBlobReader — real LocalArtifactStorage serve path (OSS-local)", () => {
  it("uploads, resolves the download URL, fetches over HTTP, and returns exact bytes", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "cas-serve-"));
    // A minimal static server over the artifact base path — the OSS-local serve
    // endpoint the reconcile fetches from. Uses the REAL global fetch (no mock),
    // exercising the path unit tests with an injected reader never touch.
    const server = createServer((req, res) => {
      try {
        const key = decodeURIComponent((req.url ?? "").replace(/^\/+/, ""));
        res.writeHead(200);
        res.end(readFileSync(join(basePath, key)));
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const storage = new LocalArtifactStorage(basePath, `http://127.0.0.1:${port}`);

      const payload = Buffer.from("SECRET_TREASURE=42\n", "utf8");
      const key = casBlobKey(EXEC, sha256Bytes(payload));
      await storage.upload(key, payload, "application/octet-stream");

      const reader = casBlobReader(storage);
      const got = await reader(key);
      expect(got.equals(payload)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(basePath, { recursive: true, force: true });
    }
  });
});

describe("digest independence from capture class", () => {
  it("orders files deterministically by path", async () => {
    const { storage } = makeFakeStorage();
    const { manifest } = await snapshotCasChangeSet({
      storage, executionId: EXEC, changeSetId: CHANGE_SET,
      captures: [
        { path: "z", before: null, after: bytes("z"), captureClass: IGNORED },
        { path: "a", before: null, after: bytes("a"), captureClass: IGNORED },
        { path: "m", before: null, after: bytes("m"), captureClass: IGNORED },
      ],
    });
    const files = manifest.files as CasCapturedFile[];
    expect(files.map((f) => f.pathAfter)).toEqual(["a", "m", "z"]);
  });
});
