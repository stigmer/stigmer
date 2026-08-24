import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";

import {
  validateZipForExtraction,
  injectAttachments,
  AttachmentValidationError,
  AttachmentInjectionError,
  MAX_ZIP_FILES,
  MAX_ZIP_EXTRACTED_SIZE,
} from "../attachment-injector.js";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";
import { buildZip, type ZipFixtureFile } from "@stigmer/zip-structure/testing";
import {
  DEEP_AGENT_VISION_PROFILE,
  VisionBudget,
} from "../../../shared/attachment-vision.js";

// ── ZIP Construction Helpers ─────────────────────────────────────────
//
// All archives come from the shared real-shape builder
// (@stigmer/zip-structure/testing):
// local headers, payloads, central directory, EOCD — the only shape real
// ZIP writers produce and the shape central-directory parsing requires.
// The record-form helpers below keep ordinary call sites terse; tests that
// need streaming or declared-size shapes call buildZip directly.

function makeZip(entries: Record<string, string | Buffer>): Buffer {
  return makeZipWith(entries, { method: "deflated" });
}

function makeStoredZip(entries: Record<string, Buffer>): Buffer {
  return makeZipWith(entries, { method: "stored" });
}

function makeZipWith(
  entries: Record<string, string | Buffer>,
  shape: Pick<ZipFixtureFile, "method" | "streaming">,
): Buffer {
  const files: ZipFixtureFile[] = Object.entries(entries).map(([name, content]) => ({
    name,
    content: typeof content === "string" ? content : new Uint8Array(content),
    ...shape,
  }));
  return Buffer.from(buildZip(files));
}

function makeDirectoryOnlyZip(): Buffer {
  return Buffer.from(buildZip([{ name: "empty_dir/", content: "" }]));
}

function makeAttachment(overrides: Partial<{
  filename: string;
  storageKey: string;
  mountPath: string;
  contentType: string;
  extract: boolean;
  localPath: string;
}> = {}) {
  return {
    filename: overrides.filename ?? "data.zip",
    storageKey: overrides.storageKey ?? "attachments/abc/data.zip",
    mountPath: overrides.mountPath ?? "",
    contentType: overrides.contentType ?? "application/zip",
    extract: overrides.extract ?? false,
    localPath: overrides.localPath ?? "",
    $typeName: "ai.stigmer.agentic.agentexecution.v1.Attachment" as const,
    $unknown: undefined,
  } as any;
}

function makeMockStorage() {
  // The canonical in-memory double; cloud downloads read from what was uploaded,
  // so tests seed a blob via `storage.upload` and assert on `storage.download`.
  const { storage } = makeInMemoryArtifactStorage();
  return storage;
}

// ═══════════════════════════════════════════════════════════════════════
// validateZipForExtraction
// ═══════════════════════════════════════════════════════════════════════

describe("validateZipForExtraction", () => {
  it("returns sorted manifest for valid ZIP with multiple files", () => {
    const zip = makeZip({ "b.txt": "beta", "a.txt": "alpha", "c.txt": "charlie" });
    const result = validateZipForExtraction(zip, "test.zip");

    expect(result).toHaveLength(3);
    expect(result.map(e => e.relativePath)).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("preserves nested directory paths in entries", () => {
    const zip = makeZip({
      "src/main.py": "print('hi')",
      "README.md": "# Hello",
      "src/lib/util.py": "pass",
    });
    const result = validateZipForExtraction(zip, "project.zip");
    const paths = result.map(e => e.relativePath);

    expect(paths).toContain("src/main.py");
    expect(paths).toContain("src/lib/util.py");
    expect(paths).toContain("README.md");
  });

  it("reports correct uncompressed sizes", () => {
    const contentA = "hello world";
    const contentB = "x".repeat(500);
    const zip = makeZip({ "a.txt": contentA, "b.txt": contentB });

    const result = validateZipForExtraction(zip, "test.zip");
    const sizeMap = new Map(result.map(e => [e.relativePath, e.uncompressedSize]));

    expect(sizeMap.get("a.txt")).toBe(Buffer.from(contentA).length);
    expect(sizeMap.get("b.txt")).toBe(Buffer.from(contentB).length);
  });

  it("excludes directory-only entries", () => {
    const zip = makeDirectoryOnlyZip();
    expect(() => validateZipForExtraction(zip, "dirs.zip")).toThrow(
      AttachmentValidationError,
    );
  });

  it("rejects invalid ZIP format (random bytes)", () => {
    expect(() => validateZipForExtraction(Buffer.from("not-a-zip"), "bad.zip"))
      .toThrow(AttachmentValidationError);
    expect(() => validateZipForExtraction(Buffer.from("not-a-zip"), "bad.zip"))
      .toThrow(/not a valid ZIP archive/);
  });

  it("rejects file too small to be a ZIP", () => {
    expect(() => validateZipForExtraction(Buffer.from([0x50, 0x4b]), "tiny.zip"))
      .toThrow(/too small/);
  });

  it("rejects absolute path entries (forward slash)", () => {
    const zip = makeZip({ "/etc/passwd": "root:x:0:0" });
    expect(() => validateZipForExtraction(zip, "evil.zip"))
      .toThrow(/absolute path/);
  });

  it("rejects absolute path entries (backslash)", () => {
    const zip = makeZip({ "\\windows\\system32\\evil.dll": "payload" });
    expect(() => validateZipForExtraction(zip, "evil.zip"))
      .toThrow(/absolute path/);
  });

  it("rejects path traversal with leading ..", () => {
    const zip = makeZip({ "../../etc/passwd": "root:x:0:0" });
    expect(() => validateZipForExtraction(zip, "evil.zip"))
      .toThrow(/path traversal/);
  });

  it("rejects path traversal with embedded ..", () => {
    const zip = makeZip({ "foo/../../etc/passwd": "root:x:0:0" });
    expect(() => validateZipForExtraction(zip, "evil.zip"))
      .toThrow(/path traversal/);
  });

  it("rejects null bytes in filenames", () => {
    const zip = makeZip({ "file\u0000.txt": "test" });
    expect(() => validateZipForExtraction(zip, "null.zip"))
      .toThrow(/null bytes/);
  });

  it("rejects empty archive (valid ZIP, zero file entries)", () => {
    const zip = makeDirectoryOnlyZip();
    expect(() => validateZipForExtraction(zip, "empty.zip"))
      .toThrow(/empty ZIP archive/);
  });

  it("rejects file count exceeding limit", () => {
    const entries: Record<string, Buffer> = {};
    for (let i = 0; i < MAX_ZIP_FILES + 1; i++) {
      entries[`file_${String(i).padStart(4, "0")}.txt`] = Buffer.from("x");
    }
    const zip = makeStoredZip(entries);
    expect(() => validateZipForExtraction(zip, "bomb.zip"))
      .toThrow(new RegExp(`limit: ${MAX_ZIP_FILES}`));
  });

  it("rejects total uncompressed size exceeding limit", () => {
    const overLimit = MAX_ZIP_EXTRACTED_SIZE + 1;
    const zip = makeStoredZip({ "big.bin": Buffer.alloc(overLimit, 0) });
    expect(() => validateZipForExtraction(zip, "bomb.zip"))
      .toThrow(/limit: 100 MB/);
  });

  it("accepts ZIP at exactly the file count limit", () => {
    const entries: Record<string, Buffer> = {};
    for (let i = 0; i < MAX_ZIP_FILES; i++) {
      entries[`f${i}.txt`] = Buffer.from("x");
    }
    const zip = makeStoredZip(entries);
    const result = validateZipForExtraction(zip, "ok.zip");
    expect(result).toHaveLength(MAX_ZIP_FILES);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Central-directory parsing (issue #567)
// ═══════════════════════════════════════════════════════════════════════
// The archive shapes the old local-header walk corrupted or rejected:
// stored streaming entries (silent manifest truncation) and Go-default
// deflated streaming entries (rejected outright). Sizes come from the
// central directory — the format's authoritative index — and structural
// failures are fail-hard, unlike the skill-artifact reader's non-fatal
// empty return: nothing upstream vouches for an attachment.

describe("validateZipForExtraction — central-directory parsing (issue #567)", () => {
  it("validates every entry of a stored streaming archive (no silent truncation)", () => {
    // Method 0 + flag bit 3 + zeroed local sizes: the old walk admitted the
    // first entry with size 0, landed mid-payload, and quietly dropped the
    // rest of the manifest.
    const zip = Buffer.from(buildZip([
      { name: "first.txt", content: "first file content", streaming: true },
      { name: "second.txt", content: "second file content", streaming: true },
    ]));

    const result = validateZipForExtraction(zip, "streamed.zip");
    expect(result.map((e) => e.relativePath)).toEqual(["first.txt", "second.txt"]);
    expect(result.map((e) => e.uncompressedSize)).toEqual([
      "first file content".length,
      "second file content".length,
    ]);
  });

  it("accepts a Go-default archive (deflated streaming entries)", () => {
    const zip = Buffer.from(buildZip([
      { name: "main.go", content: "package main", method: "deflated", streaming: true },
      { name: "go.mod", content: "module example", method: "deflated", streaming: true },
    ]));

    const result = validateZipForExtraction(zip, "go-built.zip");
    expect(result.map((e) => e.relativePath)).toEqual(["go.mod", "main.go"]);
  });

  it("rejects an archive with no central directory (fail-hard, unlike skill extraction)", () => {
    const zip = Buffer.from(buildZip(
      [{ name: "a.txt", content: "aaa" }],
      { omitCentralDirectory: true },
    ));

    expect(() => validateZipForExtraction(zip, "truncated.zip"))
      .toThrow(AttachmentValidationError);
    expect(() => validateZipForExtraction(zip, "truncated.zip"))
      .toThrow(/not a valid ZIP archive/);
  });

  it("rejects duplicate entry paths (a contradictory manifest)", () => {
    const zip = Buffer.from(buildZip([
      { name: "dup.txt", content: "one" },
      { name: "dup.txt", content: "two" },
    ]));

    expect(() => validateZipForExtraction(zip, "dup.zip"))
      .toThrow(/duplicate entry/);
  });

  it("locates the central directory behind a trailing archive comment", () => {
    const zip = Buffer.from(buildZip(
      [{ name: "a.txt", content: "aaa" }],
      { comment: "release archive — built by tooling" },
    ));

    const result = validateZipForExtraction(zip, "commented.zip");
    expect(result.map((e) => e.relativePath)).toEqual(["a.txt"]);
  });
});

describe("injectAttachments — central-directory extraction (issue #567)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "attachment-cd-"));
  });

  async function extractArchive(zip: Uint8Array) {
    const localFile = join(tempDir, "archive.zip");
    await writeFile(localFile, zip);
    const backend = mockWorkspaceBackend();
    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "archive.zip",
        mountPath: ".stigmer/inputs/archive",
        extract: true,
        localPath: localFile,
      })],
      storage: makeMockStorage(),
      isLocalMode: true,
    });
    return { backend, result };
  }

  it("extracts a stored streaming archive completely, contents intact", async () => {
    const { backend, result } = await extractArchive(buildZip([
      { name: "first.txt", content: "first file content", streaming: true },
      { name: "second.txt", content: "second file content", streaming: true },
    ]));

    expect(result.map((f) => f.path).sort()).toEqual([
      ".stigmer/inputs/archive/first.txt",
      ".stigmer/inputs/archive/second.txt",
    ]);
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(
      ".stigmer/inputs/archive/first.txt", Buffer.from("first file content"),
    );
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(
      ".stigmer/inputs/archive/second.txt", Buffer.from("second file content"),
    );
  });

  it("extracts a Go-default deflated streaming archive", async () => {
    const { backend, result } = await extractArchive(buildZip([
      { name: "src/main.go", content: "package main\n", method: "deflated", streaming: true },
    ]));

    expect(result).toHaveLength(1);
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(
      ".stigmer/inputs/archive/src/main.go", Buffer.from("package main\n"),
    );
  });

  it("aborts when an entry inflates past its declared size (crafted archive)", async () => {
    await expect(extractArchive(buildZip([
      {
        name: "bomb.txt",
        content: "x".repeat(4096),
        method: "deflated",
        declaredUncompressedSize: 16,
      },
    ]))).rejects.toThrow(AttachmentValidationError);
  });

  it("aborts when a stored entry's payload disagrees with its declared size", async () => {
    await expect(extractArchive(buildZip([
      { name: "short.txt", content: "eleven byte", declaredUncompressedSize: 4096 },
    ]))).rejects.toThrow(/declare/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// injectAttachments
// ═══════════════════════════════════════════════════════════════════════

describe("injectAttachments", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "attachment-test-"));
  });

  it("returns empty array for empty attachments list", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    const result = await injectAttachments({
      backend,
      attachments: [],
      storage,
      isLocalMode: false,
    });

    expect(result).toEqual([]);
  });

  it("injects single non-ZIP attachment in local mode", async () => {
    const content = Buffer.from("hello world");
    const localFile = join(tempDir, "input.txt");
    await writeFile(localFile, content);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "input.txt",
        localPath: localFile,
      })],
      storage,
      isLocalMode: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("input.txt");
    expect(result[0].path).toBe(".stigmer/inputs/input.txt");
    expect(result[0].sizeBytes).toBe(content.length);
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(
      ".stigmer/inputs/input.txt",
      content,
    );
  });

  it("injects single non-ZIP attachment in cloud mode", async () => {
    const content = Buffer.from("cloud data");
    const storage = makeMockStorage();
    await storage.upload("attachments/xyz/data.csv", content);

    const backend = mockWorkspaceBackend();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "data.csv",
        storageKey: "attachments/xyz/data.csv",
      })],
      storage,
      isLocalMode: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("data.csv");
    expect(result[0].path).toBe(".stigmer/inputs/data.csv");
    expect(result[0].sizeBytes).toBe(content.length);
    expect(storage.download).toHaveBeenCalledWith("attachments/xyz/data.csv");
  });

  it("extracts ZIP when extract=true", async () => {
    const zip = makeZip({ "main.py": "print('hi')", "lib/util.py": "pass" });
    const localFile = join(tempDir, "project.zip");
    await writeFile(localFile, zip);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "project.zip",
        mountPath: ".stigmer/inputs/project",
        extract: true,
        localPath: localFile,
      })],
      storage,
      isLocalMode: true,
    });

    expect(result).toHaveLength(2);
    const paths = result.map(f => f.path);
    expect(paths).toContain(".stigmer/inputs/project/lib/util.py");
    expect(paths).toContain(".stigmer/inputs/project/main.py");
  });

  it("writes ZIP as single file when extract=false", async () => {
    const zip = makeZip({ "a.txt": "hello" });
    const localFile = join(tempDir, "archive.zip");
    await writeFile(localFile, zip);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "archive.zip",
        localPath: localFile,
        extract: false,
      })],
      storage,
      isLocalMode: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("archive.zip");
    expect(result[0].path).toBe(".stigmer/inputs/archive.zip");
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(
      ".stigmer/inputs/archive.zip",
      expect.any(Buffer),
    );
  });

  it("honors custom mountPath", async () => {
    const content = Buffer.from("custom path");
    const localFile = join(tempDir, "file.txt");
    await writeFile(localFile, content);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "file.txt",
        mountPath: "workspace/custom/location.txt",
        localPath: localFile,
      })],
      storage,
      isLocalMode: true,
    });

    expect(result[0].path).toBe("workspace/custom/location.txt");
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(
      "workspace/custom/location.txt",
      content,
    );
  });

  it("uses default mountPath .stigmer/inputs/{filename}", async () => {
    const content = Buffer.from("test");
    const localFile = join(tempDir, "readme.md");
    await writeFile(localFile, content);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "readme.md",
        mountPath: "",
        localPath: localFile,
      })],
      storage,
      isLocalMode: true,
    });

    expect(result[0].path).toBe(".stigmer/inputs/readme.md");
  });

  it("processes multiple attachments in order", async () => {
    const fileA = join(tempDir, "a.txt");
    const fileB = join(tempDir, "b.txt");
    await writeFile(fileA, "alpha");
    await writeFile(fileB, "beta");

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    const result = await injectAttachments({
      backend,
      attachments: [
        makeAttachment({ filename: "a.txt", localPath: fileA }),
        makeAttachment({ filename: "b.txt", localPath: fileB }),
      ],
      storage,
      isLocalMode: true,
    });

    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe("a.txt");
    expect(result[1].filename).toBe("b.txt");
  });

  it("propagates error when local file not found", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    await expect(injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "missing.txt",
        localPath: "/nonexistent/path/missing.txt",
      })],
      storage,
      isLocalMode: true,
    })).rejects.toThrow(AttachmentInjectionError);
  });

  it("propagates error when storage download fails", async () => {
    const storage = makeMockStorage();
    storage.download.mockRejectedValue(new Error("network timeout"));

    const backend = mockWorkspaceBackend();

    await expect(injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "data.csv",
        storageKey: "attachments/xyz/data.csv",
      })],
      storage,
      isLocalMode: false,
    })).rejects.toThrow(AttachmentInjectionError);
  });

  it("propagates error when storageKey is missing in cloud mode", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    await expect(injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "file.txt",
        storageKey: "",
        localPath: "",
      })],
      storage,
      isLocalMode: false,
    })).rejects.toThrow(/missing storageKey/);
  });

  it("rejects a caller-supplied mountPath that escapes the workspace root", async () => {
    // `resolveMountPath` only stripped leading slashes, so `..` segments on a
    // non-`.stigmer/` mount path reached the unchecked join(rootDir, path).
    const storage = makeMockStorage();
    storage.download.mockResolvedValue(Buffer.from("owned"));
    const backend = mockWorkspaceBackend();

    const escapes = ["../../escape.txt", "../etc/evil", "foo/../../bar"];
    for (const mountPath of escapes) {
      await expect(injectAttachments({
        backend,
        attachments: [makeAttachment({
          filename: "data.txt",
          storageKey: "attachments/xyz/data.txt",
          mountPath,
        })],
        storage,
        isLocalMode: false,
      })).rejects.toThrow(/mount path .* escapes the workspace root|traversal/i);
    }
  });

  it("preserves binary content via writeFileBuffer", async () => {
    const binaryContent = Buffer.from([0x00, 0x01, 0xFF, 0xFE, 0x89, 0x50, 0x4E, 0x47]);
    const localFile = join(tempDir, "image.png");
    await writeFile(localFile, binaryContent);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "image.png",
        localPath: localFile,
      })],
      storage,
      isLocalMode: true,
    });

    const writtenBuffer = (backend.writeFileBuffer as any).mock.calls[0][1] as Buffer;
    expect(Buffer.compare(writtenBuffer, binaryContent)).toBe(0);
  });

  it("uniquifies duplicate default-derived filenames instead of failing (issue #364)", async () => {
    const contentA = Buffer.from("first");
    const contentB = Buffer.from("second");
    const storage = makeMockStorage();
    await storage.upload("attachments/a/data.csv", contentA);
    await storage.upload("attachments/b/data.csv", contentB);

    const backend = mockWorkspaceBackend();

    const result = await injectAttachments({
      backend,
      attachments: [
        makeAttachment({ filename: "data.csv", storageKey: "attachments/a/data.csv" }),
        makeAttachment({ filename: "data.csv", storageKey: "attachments/b/data.csv" }),
      ],
      storage,
      isLocalMode: false,
    });

    // Both files land, both downloads run — the execution is never burned
    // over a mechanically resolvable name.
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      filename: "data.csv",
      path: ".stigmer/inputs/data.csv",
    });
    expect(result[0].renamedFrom).toBeUndefined();
    // The rename follows the platform's stem-2.ext semantics and carries the
    // disclosure payload for the prompt.
    expect(result[1]).toMatchObject({
      filename: "data-2.csv",
      path: ".stigmer/inputs/data-2.csv",
      renamedFrom: "data.csv",
    });
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(
      ".stigmer/inputs/data.csv", contentA,
    );
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(
      ".stigmer/inputs/data-2.csv", contentB,
    );
  });

  it("rejects two attachments explicitly pinning the same mountPath (a user contradiction)", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    await expect(injectAttachments({
      backend,
      attachments: [
        makeAttachment({ filename: "a.csv", storageKey: "key1", mountPath: "inputs/data.csv" }),
        makeAttachment({ filename: "b.csv", storageKey: "key2", mountPath: "inputs/data.csv" }),
      ],
      storage,
      isLocalMode: false,
    })).rejects.toThrow(/collides with/);

    // The contradiction is detected before any downloads
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("default-derived names dodge an explicit mountPath already inside the inputs prefix", async () => {
    const storage = makeMockStorage();
    await storage.upload("attachments/a/pinned", Buffer.from("pinned"));
    await storage.upload("attachments/b/report.pdf", Buffer.from("derived"));

    const backend = mockWorkspaceBackend();

    const result = await injectAttachments({
      backend,
      attachments: [
        // Listed AFTER the default-derived attachment: explicit paths claim
        // first regardless of order, so the default still dodges.
        makeAttachment({ filename: "report.pdf", storageKey: "attachments/b/report.pdf" }),
        makeAttachment({
          filename: "report.pdf",
          storageKey: "attachments/a/pinned",
          mountPath: ".stigmer/inputs/report.pdf",
        }),
      ],
      storage,
      isLocalMode: false,
    });

    const byPath = new Map(result.map((f) => [f.path, f]));
    expect(byPath.get(".stigmer/inputs/report.pdf")?.renamedFrom).toBeUndefined();
    expect(byPath.get(".stigmer/inputs/report-2.pdf")).toMatchObject({
      filename: "report-2.pdf",
      renamedFrom: "report.pdf",
    });
  });

  it("derives filename from storageKey when filename is empty", async () => {
    const content = Buffer.from("fallback");
    const localFile = join(tempDir, "fallback.txt");
    await writeFile(localFile, content);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "",
        storageKey: "attachments/ulid123/fallback.txt",
        localPath: localFile,
      })],
      storage,
      isLocalMode: true,
    });

    expect(result[0].path).toBe(".stigmer/inputs/fallback.txt");
  });

  it("strips leading slashes from mountPath", async () => {
    const content = Buffer.from("data");
    const localFile = join(tempDir, "data.csv");
    await writeFile(localFile, content);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "data.csv",
        mountPath: "/workspace/input.csv",
        localPath: localFile,
      })],
      storage,
      isLocalMode: true,
    });

    expect(result[0].path).toBe("workspace/input.csv");
  });

  it("explicit-collision error names both attachments and stays actionable", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    try {
      await injectAttachments({
        backend,
        attachments: [
          makeAttachment({ filename: "first.csv", mountPath: "inputs/shared.csv" }),
          makeAttachment({ filename: "second.csv", storageKey: "key2", mountPath: "inputs/shared.csv" }),
        ],
        storage,
        isLocalMode: false,
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachmentInjectionError);
      const injErr = err as AttachmentInjectionError;
      expect(injErr.attachmentFilename).toBe("second.csv");
      expect(injErr.message).toContain("first.csv");
      expect(injErr.message).toContain("mountPath");
    }
  });

  it("contentType does not affect extraction behavior", async () => {
    const zip = makeZip({ "data.txt": "content" });
    const localFile = join(tempDir, "data.zip");
    await writeFile(localFile, zip);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    // contentType says zip, but extract=false → writes as single file
    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "data.zip",
        contentType: "application/zip",
        extract: false,
        localPath: localFile,
      })],
      storage,
      isLocalMode: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("data.zip");
  });

  it("ZIP with only directory entries produces validation error via extract", async () => {
    const zip = makeDirectoryOnlyZip();
    const localFile = join(tempDir, "dirs.zip");
    await writeFile(localFile, zip);

    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();

    await expect(injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "dirs.zip",
        extract: true,
        localPath: localFile,
      })],
      storage,
      isLocalMode: true,
    })).rejects.toThrow(AttachmentValidationError);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Vision selection during injection (T04)
// ═══════════════════════════════════════════════════════════════════════
// Vision is strictly additive: every case also asserts the file was written
// exactly as it would be without a budget.

describe("injectAttachments — vision selection", () => {
  const PNG_BYTES = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(56, 0xab),
  ]);
  const WEBP_BYTES = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "ascii"),
    Buffer.alloc(52, 0xcd),
  ]);

  it("accepts a PNG into the vision payload (deep-agent profile) and still writes the file", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();
    await storage.upload("attachments/abc/photo.png", PNG_BYTES);

    const [injected] = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "photo.png",
        storageKey: "attachments/abc/photo.png",
        contentType: "image/png",
      })],
      storage,
      isLocalMode: false,
      visionBudget: new VisionBudget(DEEP_AGENT_VISION_PROFILE),
    });

    expect(injected.vision).toMatchObject({
      filename: "photo.png",
      mimeType: "image/png",
      byteSize: PNG_BYTES.length,
    });
    expect(Buffer.from(injected.vision!.base64, "base64").equals(PNG_BYTES)).toBe(true);
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(".stigmer/inputs/photo.png", PNG_BYTES);
  });

  it("degrades an image with model_no_vision on a blind model, file written intact", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();
    await storage.upload("attachments/abc/photo.png", PNG_BYTES);

    const [injected] = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "photo.png",
        storageKey: "attachments/abc/photo.png",
        contentType: "image/png",
      })],
      storage,
      isLocalMode: false,
      visionBudget: new VisionBudget(DEEP_AGENT_VISION_PROFILE, { modelVision: false }),
    });

    expect(injected.vision).toBeUndefined();
    expect(injected.visionDegraded).toBe("model_no_vision");
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(".stigmer/inputs/photo.png", PNG_BYTES);
  });

  it("accepts WebP on the deep-agent profile (unlike the Cursor harness)", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();
    await storage.upload("attachments/abc/pic.webp", WEBP_BYTES);

    const [injected] = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "pic.webp",
        storageKey: "attachments/abc/pic.webp",
        contentType: "image/webp",
      })],
      storage,
      isLocalMode: false,
      visionBudget: new VisionBudget(DEEP_AGENT_VISION_PROFILE),
    });

    expect(injected.vision?.mimeType).toBe("image/webp");
  });

  it("carries no vision fields for a non-image attachment", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();
    await storage.upload("attachments/abc/doc.pdf", Buffer.from("%PDF-1.7"));

    const [injected] = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "doc.pdf",
        storageKey: "attachments/abc/doc.pdf",
        contentType: "application/pdf",
      })],
      storage,
      isLocalMode: false,
      visionBudget: new VisionBudget(DEEP_AGENT_VISION_PROFILE),
    });

    expect(injected.vision).toBeUndefined();
    expect(injected.visionDegraded).toBeUndefined();
  });

  it("degrades a declared image whose bytes are not one (type_mismatch)", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();
    await storage.upload("attachments/abc/photo.jpg", Buffer.from("actually HEIC"));

    const [injected] = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "photo.jpg",
        storageKey: "attachments/abc/photo.jpg",
        contentType: "image/jpeg",
      })],
      storage,
      isLocalMode: false,
      visionBudget: new VisionBudget(DEEP_AGENT_VISION_PROFILE),
    });

    expect(injected.vision).toBeUndefined();
    expect(injected.visionDegraded).toBe("type_mismatch");
  });

  it("labels a duplicate-renamed image's vision payload with the on-disk name", async () => {
    // Coherence pin: the prompt lists the renamed path and the vision
    // disclosure lists image filenames — if the offer used the original
    // attachment.filename, the agent would see two images with one
    // indistinguishable name.
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();
    await storage.upload("attachments/a/photo.png", PNG_BYTES);
    await storage.upload("attachments/b/photo.png", PNG_BYTES);

    const injected = await injectAttachments({
      backend,
      attachments: [
        makeAttachment({ filename: "photo.png", storageKey: "attachments/a/photo.png", contentType: "image/png" }),
        makeAttachment({ filename: "photo.png", storageKey: "attachments/b/photo.png", contentType: "image/png" }),
      ],
      storage,
      isLocalMode: false,
      visionBudget: new VisionBudget(DEEP_AGENT_VISION_PROFILE),
    });

    expect(injected[0].vision?.filename).toBe("photo.png");
    expect(injected[1]).toMatchObject({
      filename: "photo-2.png",
      renamedFrom: "photo.png",
    });
    expect(injected[1].vision?.filename).toBe("photo-2.png");
  });

  it("never offers an extract archive to the budget — extracted files carry no vision fields", async () => {
    // A PNG inside a ZIP has no attachment-level bytes; the archive rides the
    // normal extraction story with no vision involvement or disclosure.
    const zip = makeZip({ "inner.png": PNG_BYTES });
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();
    await storage.upload("attachments/abc/bundle.zip", zip);

    const injected = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "bundle.zip",
        storageKey: "attachments/abc/bundle.zip",
        extract: true,
      })],
      storage,
      isLocalMode: false,
      visionBudget: new VisionBudget(DEEP_AGENT_VISION_PROFILE),
    });

    expect(injected.length).toBeGreaterThan(0);
    for (const file of injected) {
      expect(file.vision).toBeUndefined();
      expect(file.visionDegraded).toBeUndefined();
    }
  });

  it("degrades over the total budget in attachment order (budget_exhausted)", async () => {
    const backend = mockWorkspaceBackend();
    const storage = makeMockStorage();
    await storage.upload("attachments/a/a.png", PNG_BYTES);
    await storage.upload("attachments/b/b.png", PNG_BYTES);

    const injected = await injectAttachments({
      backend,
      attachments: [
        makeAttachment({ filename: "a.png", storageKey: "attachments/a/a.png", contentType: "image/png" }),
        makeAttachment({ filename: "b.png", storageKey: "attachments/b/b.png", contentType: "image/png" }),
      ],
      storage,
      isLocalMode: false,
      visionBudget: new VisionBudget(DEEP_AGENT_VISION_PROFILE, {
        maxImageBytes: PNG_BYTES.length,
        maxTotalBytes: PNG_BYTES.length,
      }),
    });

    expect(injected[0].vision).toBeDefined();
    expect(injected[1].vision).toBeUndefined();
    expect(injected[1].visionDegraded).toBe("budget_exhausted");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// injectAttachments — download-URL hand-off (issue #532)
// ═══════════════════════════════════════════════════════════════════════
// The URL is strictly additive (shared/attachment-download-urls.ts): every
// case also asserts the file injected exactly as it would without one.

describe("injectAttachments — download-URL hand-off", () => {
  it("mints a URL for a storage-key attachment", async () => {
    const content = Buffer.from("cloud data");
    const storage = makeMockStorage();
    await storage.upload("attachments/xyz/data.csv", content);
    const backend = mockWorkspaceBackend();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({ filename: "data.csv", storageKey: "attachments/xyz/data.csv" })],
      storage,
      isLocalMode: false,
    });

    expect(result[0]).toMatchObject({
      path: ".stigmer/inputs/data.csv",
      downloadUrl: "mem://attachments/xyz/data.csv",
    });
  });

  it("mints a URL for an explicit-mountPath attachment (the rule ignores mount location)", async () => {
    const storage = makeMockStorage();
    await storage.upload("attachments/xyz/config.yaml", Buffer.from("a: 1"));
    const backend = mockWorkspaceBackend();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "config.yaml",
        storageKey: "attachments/xyz/config.yaml",
        mountPath: "config/app.yaml",
      })],
      storage,
      isLocalMode: false,
    });

    expect(result[0]).toMatchObject({
      path: "config/app.yaml",
      downloadUrl: "mem://attachments/xyz/config.yaml",
    });
  });

  it("carries no URL on extracted ZIP entries — the stored object is the ZIP, not any listed file", async () => {
    const zip = makeZip({ "src/a.txt": "alpha", "src/b.txt": "beta" });
    const storage = makeMockStorage();
    await storage.upload("attachments/xyz/code.zip", zip);
    const backend = mockWorkspaceBackend();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({
        filename: "code.zip",
        storageKey: "attachments/xyz/code.zip",
        extract: true,
      })],
      storage,
      isLocalMode: false,
    });

    expect(result.length).toBeGreaterThan(0);
    for (const file of result) {
      expect(file.downloadUrl).toBeUndefined();
    }
  });

  it("carries no URL for a key-less local file", async () => {
    const localFile = join(tmpdir(), `injector-url-${Date.now()}.txt`);
    await writeFile(localFile, "local only");
    const backend = mockWorkspaceBackend();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({ filename: "local.txt", storageKey: "", localPath: localFile })],
      storage: makeMockStorage(),
      isLocalMode: true,
    });

    expect(result[0].downloadUrl).toBeUndefined();
  });

  it("degrades to no URL when the mint fails — file still injected, no throw", async () => {
    const content = Buffer.from("cloud data");
    const storage = makeMockStorage();
    await storage.upload("attachments/xyz/data.csv", content);
    storage.getDownloadUrl.mockRejectedValueOnce(new Error("presign endpoint unreachable"));
    const backend = mockWorkspaceBackend();

    const result = await injectAttachments({
      backend,
      attachments: [makeAttachment({ filename: "data.csv", storageKey: "attachments/xyz/data.csv" })],
      storage,
      isLocalMode: false,
    });

    expect(result[0].downloadUrl).toBeUndefined();
    expect(backend.writeFileBuffer).toHaveBeenCalledWith(".stigmer/inputs/data.csv", content);
  });
});
