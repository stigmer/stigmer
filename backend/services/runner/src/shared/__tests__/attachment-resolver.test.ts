/**
 * Tests for the attachment resolver, which the Cursor activity calls today
 * and the turn runtime takes over in S2 M3 (S3 retires the native twin,
 * execute-deep-agent/attachment-injector.ts).
 *
 * The load-bearing behaviors: storage-key attachments materialize under the
 * platform inputs dir (the universal path — every server-created attachment
 * carries a storage key), the workspace `.stigmer` symlink exists even when
 * the agent has no skills, and any attachment that cannot be materialized
 * fails the resolution loudly (the silent-skip regression behind "plan file
 * wasn't found"). Since S3 M1 (Q-S3-14, Q-M1-2) the resolver is the one
 * attachment pipeline for every harness, so it also pins the two behaviors
 * lifted from the native injector: `extract` archives land under their mount
 * directory through the shared #567 guards, and an explicit `mountPath` is
 * honoured inside the `inputs/` namespace and refused outside it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAttachments, AttachmentResolutionError } from "../attachment-resolver.js";
import { AttachmentValidationError } from "../attachment-zip.js";
import { buildZip } from "@stigmer/zip-structure/testing";
import { getPlatformDir } from "../workspace/platform-dir.js";
import { makeInMemoryArtifactStorage } from "../../__test-utils__/fake-artifact-storage.js";
import { CURSOR_VISION_PROFILE, VisionBudget } from "../attachment-vision.js";

function makeAttachment(overrides: Partial<{
  filename: string;
  storageKey: string;
  mountPath: string;
  contentType: string;
  extract: boolean;
  localPath: string;
}> = {}) {
  return {
    filename: overrides.filename ?? "plan.md",
    storageKey: overrides.storageKey ?? "attachments/01ABC/plan.md",
    mountPath: overrides.mountPath ?? "",
    contentType: overrides.contentType ?? "text/markdown",
    extract: overrides.extract ?? false,
    localPath: overrides.localPath ?? "",
    $typeName: "ai.stigmer.agentic.agentexecution.v1.Attachment" as const,
    $unknown: undefined,
  } as any;
}

describe("resolveAttachments", () => {
  let workspaceDir: string;
  let sessionId: string;
  let platformDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), "attach-ws-"));
    sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    platformDir = getPlatformDir(sessionId);
  });

  afterEach(() => {
    rmSync(platformDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  function options(overrides: Partial<Parameters<typeof resolveAttachments>[1]> = {}) {
    return {
      sessionId,
      primaryWorkspaceDir: workspaceDir,
      mode: "local" as const,
      storage: undefined,
      ...overrides,
    };
  }

  it("returns [] and touches nothing for an execution without attachments", async () => {
    const result = await resolveAttachments([], options());

    expect(result).toEqual([]);
    expect(() => lstatSync(join(workspaceDir, ".stigmer"))).toThrow();
  });

  it("downloads a storage-key attachment into .stigmer/inputs (the uploadAttachment path)", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    await storage.upload("attachments/01ABC/plan.md", Buffer.from("# The Plan"), "text/markdown");

    const result = await resolveAttachments([makeAttachment()], options({ storage }));

    expect(result).toEqual([
      {
        filename: "plan.md",
        relativePath: ".stigmer/inputs/plan.md",
        downloadUrl: "mem://attachments/01ABC/plan.md",
      },
    ]);
    expect(readFileSync(join(platformDir, "inputs", "plan.md"), "utf-8")).toBe("# The Plan");
  });

  it("ensures the workspace .stigmer symlink even when the agent has no skills", async () => {
    // The regression this guards: only the skill resolver created the link,
    // so a skill-less agent's attachments were written but unreachable.
    const { storage } = makeInMemoryArtifactStorage();
    await storage.upload("attachments/01ABC/plan.md", Buffer.from("# The Plan"), "text/markdown");

    await resolveAttachments([makeAttachment()], options({ storage }));

    const linkPath = join(workspaceDir, ".stigmer");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe(platformDir);
    // The resolved relative path actually dangles nowhere: it reads through
    // the link to the platform dir.
    expect(readFileSync(join(workspaceDir, ".stigmer", "inputs", "plan.md"), "utf-8")).toBe("# The Plan");
  });

  it("copies a localPath attachment directly in local mode (no storage round-trip)", async () => {
    const srcPath = join(workspaceDir, "src.csv");
    writeFileSync(srcPath, "a,b,c");

    const result = await resolveAttachments(
      [makeAttachment({ filename: "data.csv", storageKey: "", localPath: srcPath })],
      options(),
    );

    expect(result).toEqual([
      { filename: "data.csv", relativePath: ".stigmer/inputs/data.csv" },
    ]);
    expect(readFileSync(join(platformDir, "inputs", "data.csv"), "utf-8")).toBe("a,b,c");
  });

  it("uniquifies duplicate filenames on the storage branch — neither file's bytes are lost (issue #364)", async () => {
    // Before the fix this branch had no collision check and the second write
    // silently overwrote the first.
    const { storage } = makeInMemoryArtifactStorage();
    await storage.upload("attachments/01AAA/report.pdf", Buffer.from("first bytes"), "application/pdf");
    await storage.upload("attachments/01BBB/report.pdf", Buffer.from("second bytes"), "application/pdf");

    const result = await resolveAttachments(
      [
        makeAttachment({ filename: "report.pdf", storageKey: "attachments/01AAA/report.pdf" }),
        makeAttachment({ filename: "report.pdf", storageKey: "attachments/01BBB/report.pdf" }),
      ],
      options({ storage }),
    );

    expect(result).toEqual([
      {
        filename: "report.pdf",
        relativePath: ".stigmer/inputs/report.pdf",
        downloadUrl: "mem://attachments/01AAA/report.pdf",
      },
      {
        filename: "report-2.pdf",
        relativePath: ".stigmer/inputs/report-2.pdf",
        renamedFrom: "report.pdf",
        downloadUrl: "mem://attachments/01BBB/report.pdf",
      },
    ]);
    expect(readFileSync(join(platformDir, "inputs", "report.pdf"), "utf-8")).toBe("first bytes");
    expect(readFileSync(join(platformDir, "inputs", "report-2.pdf"), "utf-8")).toBe("second bytes");
  });

  it("uniquifies duplicate filenames across the local and storage branches (one shared taken-set)", async () => {
    const srcPath = join(workspaceDir, "notes.md");
    writeFileSync(srcPath, "local copy");
    const { storage } = makeInMemoryArtifactStorage();
    await storage.upload("attachments/01ABC/notes.md", Buffer.from("uploaded copy"), "text/markdown");

    const result = await resolveAttachments(
      [
        makeAttachment({ filename: "notes.md", storageKey: "", localPath: srcPath }),
        makeAttachment({ filename: "notes.md", storageKey: "attachments/01ABC/notes.md" }),
      ],
      options({ storage }),
    );

    // The key-less local file lists no URL; the storage twin does — the
    // per-file split the prompt renders.
    expect(result).toEqual([
      { filename: "notes.md", relativePath: ".stigmer/inputs/notes.md" },
      {
        filename: "notes-2.md",
        relativePath: ".stigmer/inputs/notes-2.md",
        renamedFrom: "notes.md",
        downloadUrl: "mem://attachments/01ABC/notes.md",
      },
    ]);
    expect(readFileSync(join(platformDir, "inputs", "notes.md"), "utf-8")).toBe("local copy");
    expect(readFileSync(join(platformDir, "inputs", "notes-2.md"), "utf-8")).toBe("uploaded copy");
  });

  it("ignores localPath in cloud mode and downloads by storage key", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    await storage.upload("attachments/01ABC/plan.md", Buffer.from("from storage"), "text/markdown");

    const result = await resolveAttachments(
      [makeAttachment({ localPath: "/nonexistent/host/path.md" })],
      options({ mode: "cloud", storage }),
    );

    expect(result).toHaveLength(1);
    expect(readFileSync(join(platformDir, "inputs", "plan.md"), "utf-8")).toBe("from storage");
  });

  it("fails loudly when the storage download fails (no silent skip)", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    // Nothing uploaded — the download will throw.

    await expect(
      resolveAttachments([makeAttachment()], options({ storage })),
    ).rejects.toThrow(AttachmentResolutionError);
  });

  it("fails loudly when a storage-backed attachment arrives with no usable storage", async () => {
    await expect(
      resolveAttachments([makeAttachment()], options({ storage: undefined })),
    ).rejects.toThrow(/artifact storage is unavailable/);
  });

  it("fails loudly on an attachment with neither localPath nor storageKey", async () => {
    await expect(
      resolveAttachments(
        [makeAttachment({ storageKey: "", localPath: "" })],
        options(),
      ),
    ).rejects.toThrow(/missing storageKey/);
  });

  it("fails loudly when the local file cannot be read", async () => {
    await expect(
      resolveAttachments(
        [makeAttachment({ storageKey: "", localPath: join(workspaceDir, "missing.md") })],
        options(),
      ),
    ).rejects.toThrow(AttachmentResolutionError);
  });

  it("contains a traversal filename to the inputs dir instead of escaping it", async () => {
    // A hostile filename must not steer the write outside `.stigmer/inputs/`.
    // The resolver takes the basename, so the file lands beside the others.
    const { storage } = makeInMemoryArtifactStorage();
    await storage.upload("attachments/01ABC/x", Buffer.from("contained"), "text/plain");

    const result = await resolveAttachments(
      [makeAttachment({ filename: "../../evil.md", storageKey: "attachments/01ABC/x" })],
      options({ storage }),
    );

    expect(result).toEqual([
      {
        filename: "evil.md",
        relativePath: ".stigmer/inputs/evil.md",
        downloadUrl: "mem://attachments/01ABC/x",
      },
    ]);
    expect(readFileSync(join(platformDir, "inputs", "evil.md"), "utf-8")).toBe("contained");
    // Nothing escaped two levels up (where `../../evil.md` would have landed).
    expect(() => readFileSync(join(platformDir, "..", "..", "evil.md"))).toThrow();
  });

  it("contains a traversal filename on the localPath fast path too", async () => {
    const srcPath = join(workspaceDir, "src.txt");
    writeFileSync(srcPath, "local-contained");

    const result = await resolveAttachments(
      [makeAttachment({ filename: "../../../evil.txt", storageKey: "", localPath: srcPath })],
      options(),
    );

    expect(result).toEqual([
      { filename: "evil.txt", relativePath: ".stigmer/inputs/evil.txt" },
    ]);
    expect(readFileSync(join(platformDir, "inputs", "evil.txt"), "utf-8")).toBe("local-contained");
  });

  // ── Explicit mountPath: honoured inside the inputs namespace, refused outside ──

  describe("mountPath (S3 M1, Q-M1-2)", () => {
    it("places a file at its explicit `inputs/…` path, in every spelling the producers use", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("k/a", Buffer.from("A"), "text/plain");
      await storage.upload("k/b", Buffer.from("B"), "text/plain");
      await storage.upload("k/c", Buffer.from("C"), "text/plain");

      const result = await resolveAttachments(
        [
          makeAttachment({ filename: "a.txt", storageKey: "k/a", mountPath: "inputs/data/a.txt" }),
          makeAttachment({ filename: "b.txt", storageKey: "k/b", mountPath: ".stigmer/inputs/b-renamed.txt" }),
          makeAttachment({ filename: "c.txt", storageKey: "k/c", mountPath: "/inputs/c.txt" }),
        ],
        options({ storage }),
      );

      expect(result.map((r) => r.relativePath)).toEqual([
        ".stigmer/inputs/data/a.txt",
        ".stigmer/inputs/b-renamed.txt",
        ".stigmer/inputs/c.txt",
      ]);
      expect(result.map((r) => r.filename), "the on-disk basename, not the attachment's").toEqual(["a.txt", "b-renamed.txt", "c.txt"]);
      expect(readFileSync(join(platformDir, "inputs", "data", "a.txt"), "utf-8")).toBe("A");
      expect(readFileSync(join(platformDir, "inputs", "b-renamed.txt"), "utf-8")).toBe("B");
    });

    it("a default-named attachment uniquifies around a name an explicit path claims directly under inputs/", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("k/explicit", Buffer.from("explicit"), "text/plain");
      await storage.upload("k/default", Buffer.from("default"), "text/plain");

      const result = await resolveAttachments(
        [
          makeAttachment({ filename: "other.txt", storageKey: "k/explicit", mountPath: "inputs/plan.md" }),
          makeAttachment({ filename: "plan.md", storageKey: "k/default" }),
        ],
        options({ storage }),
      );

      expect(result.map(({ filename, relativePath, renamedFrom }) => ({ filename, relativePath, renamedFrom }))).toEqual([
        { filename: "plan.md", relativePath: ".stigmer/inputs/plan.md", renamedFrom: undefined },
        { filename: "plan-2.md", relativePath: ".stigmer/inputs/plan-2.md", renamedFrom: "plan.md" },
      ]);
      expect(readFileSync(join(platformDir, "inputs", "plan.md"), "utf-8")).toBe("explicit");
      expect(readFileSync(join(platformDir, "inputs", "plan-2.md"), "utf-8")).toBe("default");
    });

    it("refuses two attachments explicitly pinning the same path (a contradiction no rename resolves), before any bytes move", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await expect(
        resolveAttachments(
          [
            makeAttachment({ filename: "a.csv", storageKey: "k/a", mountPath: "inputs/data.csv" }),
            makeAttachment({ filename: "b.csv", storageKey: "k/b", mountPath: "inputs/data.csv" }),
          ],
          options({ storage }),
        ),
      ).rejects.toThrow(/mount path 'inputs\/data\.csv' collides with attachment 'a\.csv'/);
      expect(storage.download).not.toHaveBeenCalled();
    });

    it("refuses a mountPath outside the inputs namespace with the namespace named (a file in the user's tree would ride the write-back commit)", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      const attempt = resolveAttachments(
        [makeAttachment({ filename: "data.yaml", storageKey: "k/d", mountPath: "/workspace/data/data.yaml" })],
        options({ storage }),
      );
      await expect(attempt).rejects.toBeInstanceOf(AttachmentResolutionError);
      await expect(attempt).rejects.toThrow(/outside the attachment namespace.*set mountPath to 'inputs\/<name>'/);
      expect(storage.download).not.toHaveBeenCalled();
    });

    it("refuses a mountPath that climbs out of the namespace, and one that names the inputs directory itself", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await expect(
        resolveAttachments([makeAttachment({ storageKey: "k/e", mountPath: "inputs/../../evil.md" })], options({ storage })),
      ).rejects.toThrow(/escapes the attachment namespace/);
      await expect(
        resolveAttachments([makeAttachment({ storageKey: "k/e", mountPath: "inputs/" })], options({ storage })),
      ).rejects.toThrow(/names the inputs directory itself/);
    });
  });

  // ── Archives: `extract` lands the entries under the mount directory ──────

  describe("extract (S3 M1, Q-S3-14)", () => {
    const archive = () =>
      Buffer.from(
        buildZip([
          { name: "notes/readme.md", content: "# notes" },
          { name: "data.csv", content: "a,b\n1,2" },
        ]),
      );

    it("extracts a storage-backed archive under `inputs/<archive filename>/`, one resolved attachment per entry, with no vision, rename or URL", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("k/bundle", archive(), "application/zip");

      const result = await resolveAttachments(
        [makeAttachment({ filename: "bundle.zip", storageKey: "k/bundle", extract: true, contentType: "application/zip" })],
        options({ storage, visionBudget: new VisionBudget(CURSOR_VISION_PROFILE, { modelVision: true }) }),
      );

      expect(result).toEqual([
        { filename: "data.csv", relativePath: ".stigmer/inputs/bundle.zip/data.csv" },
        { filename: "readme.md", relativePath: ".stigmer/inputs/bundle.zip/notes/readme.md" },
      ]);
      expect(readFileSync(join(platformDir, "inputs", "bundle.zip", "notes", "readme.md"), "utf-8")).toBe("# notes");
      expect(storage.getDownloadUrl, "no URL for entries: the stored object is the ZIP, not any listed file").not.toHaveBeenCalled();
    });

    it("extracts a local archive at the CLI's `inputs/<dirname>/` mount (the directory-attachment shape)", async () => {
      const srcPath = join(workspaceDir, "docs.zip");
      writeFileSync(srcPath, archive());

      const result = await resolveAttachments(
        [makeAttachment({ filename: "docs.zip", storageKey: "", localPath: srcPath, extract: true, mountPath: "inputs/docs/" })],
        options(),
      );

      expect(result.map((r) => r.relativePath)).toEqual([".stigmer/inputs/docs/data.csv", ".stigmer/inputs/docs/notes/readme.md"]);
      expect(readFileSync(join(platformDir, "inputs", "docs", "data.csv"), "utf-8")).toBe("a,b\n1,2");
    });

    it("an archive that fails the shared guards aborts the resolution with the guard's own error", async () => {
      const srcPath = join(workspaceDir, "evil.zip");
      writeFileSync(srcPath, Buffer.from(buildZip([{ name: "../escape.txt", content: "x" }])));

      await expect(
        resolveAttachments([makeAttachment({ filename: "evil.zip", storageKey: "", localPath: srcPath, extract: true })], options()),
      ).rejects.toBeInstanceOf(AttachmentValidationError);
      expect(() => readFileSync(join(platformDir, "inputs", "evil.zip"))).toThrow();
    });
  });

  // ── Download-URL hand-off (issue #532) ───────────────────────────────────
  // The URL is strictly additive (shared/attachment-download-urls.ts): every
  // case below also asserts the file materialized exactly as it would
  // without one.

  describe("download-URL minting during resolution", () => {
    it("degrades to no URL when the mint fails — file still materialized, turn proceeds", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("attachments/01ABC/plan.md", Buffer.from("# The Plan"), "text/markdown");
      storage.getDownloadUrl.mockRejectedValueOnce(new Error("presign endpoint unreachable"));

      const result = await resolveAttachments([makeAttachment()], options({ storage }));

      expect(result).toEqual([
        { filename: "plan.md", relativePath: ".stigmer/inputs/plan.md" },
      ]);
      expect(readFileSync(join(platformDir, "inputs", "plan.md"), "utf-8")).toBe("# The Plan");
    });

    it("mints a URL on the localPath fast path when an uploaded copy also exists", async () => {
      // The fast path skips storage for the BYTES; the mint rule is
      // branch-independent, so the uploaded copy still backs the URL.
      const srcPath = join(workspaceDir, "src.csv");
      writeFileSync(srcPath, "a,b,c");
      const { storage } = makeInMemoryArtifactStorage();

      const result = await resolveAttachments(
        [makeAttachment({ filename: "data.csv", storageKey: "attachments/01ABC/data.csv", localPath: srcPath })],
        options({ storage }),
      );

      expect(result).toEqual([
        {
          filename: "data.csv",
          relativePath: ".stigmer/inputs/data.csv",
          downloadUrl: "mem://attachments/01ABC/data.csv",
        },
      ]);
      // Bytes came off local disk, not storage — the fast path is intact.
      expect(storage.download).not.toHaveBeenCalled();
      expect(readFileSync(join(platformDir, "inputs", "data.csv"), "utf-8")).toBe("a,b,c");
    });
  });

  // ── Vision selection (T04) ────────────────────────────────────────────────
  // Vision is strictly additive: every case below also asserts the file
  // materialized exactly as it would without a budget.

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

  describe("vision selection during resolution", () => {
    it("accepts a storage-key PNG into the vision payload and still writes the file", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("attachments/01ABC/photo.png", PNG_BYTES, "image/png");

      const [resolved] = await resolveAttachments(
        [makeAttachment({ filename: "photo.png", storageKey: "attachments/01ABC/photo.png", contentType: "image/png" })],
        options({ storage, visionBudget: new VisionBudget(CURSOR_VISION_PROFILE) }),
      );

      expect(resolved.vision).toMatchObject({
        filename: "photo.png",
        mimeType: "image/png",
        byteSize: PNG_BYTES.length,
      });
      expect(Buffer.from(resolved.vision!.base64, "base64").equals(PNG_BYTES)).toBe(true);
      expect(resolved.visionDegraded).toBeUndefined();
      expect(readFileSync(join(platformDir, "inputs", "photo.png")).equals(PNG_BYTES)).toBe(true);
    });

    it("carries no vision fields for a non-image attachment (normal file story, no disclosure)", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("attachments/01ABC/doc.pdf", Buffer.from("%PDF-1.7"), "application/pdf");

      const [resolved] = await resolveAttachments(
        [makeAttachment({ filename: "doc.pdf", storageKey: "attachments/01ABC/doc.pdf", contentType: "application/pdf" })],
        options({ storage, visionBudget: new VisionBudget(CURSOR_VISION_PROFILE) }),
      );

      expect(resolved.vision).toBeUndefined();
      expect(resolved.visionDegraded).toBeUndefined();
    });

    it("degrades a declared image whose bytes are not one (type_mismatch), file intact", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("attachments/01ABC/photo.jpg", Buffer.from("actually HEIC"), "image/jpeg");

      const [resolved] = await resolveAttachments(
        [makeAttachment({ filename: "photo.jpg", storageKey: "attachments/01ABC/photo.jpg", contentType: "image/jpeg" })],
        options({ storage, visionBudget: new VisionBudget(CURSOR_VISION_PROFILE) }),
      );

      expect(resolved.vision).toBeUndefined();
      expect(resolved.visionDegraded).toBe("type_mismatch");
      expect(readFileSync(join(platformDir, "inputs", "photo.jpg"), "utf-8")).toBe("actually HEIC");
    });

    it("degrades WebP on the Cursor profile (unsupported_format)", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("attachments/01ABC/sticker.webp", WEBP_BYTES, "image/webp");

      const [resolved] = await resolveAttachments(
        [makeAttachment({ filename: "sticker.webp", storageKey: "attachments/01ABC/sticker.webp", contentType: "image/webp" })],
        options({ storage, visionBudget: new VisionBudget(CURSOR_VISION_PROFILE) }),
      );

      expect(resolved.visionDegraded).toBe("unsupported_format");
    });

    it("accepts a localPath PNG in local mode (the read-instead-of-copy branch)", async () => {
      const srcPath = join(workspaceDir, "shot.png");
      writeFileSync(srcPath, PNG_BYTES);

      const [resolved] = await resolveAttachments(
        [makeAttachment({ filename: "shot.png", storageKey: "", localPath: srcPath, contentType: "image/png" })],
        options({ visionBudget: new VisionBudget(CURSOR_VISION_PROFILE) }),
      );

      expect(resolved.vision?.mimeType).toBe("image/png");
      expect(readFileSync(join(platformDir, "inputs", "shot.png")).equals(PNG_BYTES)).toBe(true);
    });

    it("degrades an oversized localPath image via stat WITHOUT reading it, file copied intact", async () => {
      const srcPath = join(workspaceDir, "big.png");
      writeFileSync(srcPath, PNG_BYTES);

      const [resolved] = await resolveAttachments(
        [makeAttachment({ filename: "big.png", storageKey: "", localPath: srcPath, contentType: "image/png" })],
        options({
          visionBudget: new VisionBudget(CURSOR_VISION_PROFILE, {
            maxImageBytes: PNG_BYTES.length - 1,
          }),
        }),
      );

      expect(resolved.vision).toBeUndefined();
      expect(resolved.visionDegraded).toBe("too_large");
      expect(readFileSync(join(platformDir, "inputs", "big.png")).equals(PNG_BYTES)).toBe(true);
    });

    it("keeps the plain copyFile for a localPath non-candidate even when a budget is present", async () => {
      const srcPath = join(workspaceDir, "notes.txt");
      writeFileSync(srcPath, "plain text");

      const [resolved] = await resolveAttachments(
        [makeAttachment({ filename: "notes.txt", storageKey: "", localPath: srcPath, contentType: "text/plain" })],
        options({ visionBudget: new VisionBudget(CURSOR_VISION_PROFILE) }),
      );

      expect(resolved.vision).toBeUndefined();
      expect(resolved.visionDegraded).toBeUndefined();
      expect(readFileSync(join(platformDir, "inputs", "notes.txt"), "utf-8")).toBe("plain text");
    });

    it("degrades a storage-key image with model_no_vision on a blind model, file intact", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("attachments/01ABC/photo.png", PNG_BYTES, "image/png");

      const [resolved] = await resolveAttachments(
        [makeAttachment({ filename: "photo.png", storageKey: "attachments/01ABC/photo.png", contentType: "image/png" })],
        options({
          storage,
          visionBudget: new VisionBudget(CURSOR_VISION_PROFILE, { modelVision: false }),
        }),
      );

      expect(resolved.vision).toBeUndefined();
      expect(resolved.visionDegraded).toBe("model_no_vision");
      expect(readFileSync(join(platformDir, "inputs", "photo.png")).equals(PNG_BYTES)).toBe(true);
    });

    it("reports model_no_vision (never too_large) for an oversized localPath image on a blind model", async () => {
      // The blind check must pre-empt the stat-based oversize fast path:
      // too_large's "resend smaller" advice would be wrong for a model that
      // cannot see any image.
      const srcPath = join(workspaceDir, "big.png");
      writeFileSync(srcPath, PNG_BYTES);

      const [resolved] = await resolveAttachments(
        [makeAttachment({ filename: "big.png", storageKey: "", localPath: srcPath, contentType: "image/png" })],
        options({
          visionBudget: new VisionBudget(CURSOR_VISION_PROFILE, {
            maxImageBytes: PNG_BYTES.length - 1,
            modelVision: false,
          }),
        }),
      );

      expect(resolved.vision).toBeUndefined();
      expect(resolved.visionDegraded).toBe("model_no_vision");
      expect(readFileSync(join(platformDir, "inputs", "big.png")).equals(PNG_BYTES)).toBe(true);
    });

    it("selects greedily in attachment order when the total budget cuts off", async () => {
      const { storage } = makeInMemoryArtifactStorage();
      await storage.upload("attachments/01A/a.png", PNG_BYTES, "image/png");
      await storage.upload("attachments/01B/b.png", PNG_BYTES, "image/png");

      const results = await resolveAttachments(
        [
          makeAttachment({ filename: "a.png", storageKey: "attachments/01A/a.png", contentType: "image/png" }),
          makeAttachment({ filename: "b.png", storageKey: "attachments/01B/b.png", contentType: "image/png" }),
        ],
        options({
          storage,
          visionBudget: new VisionBudget(CURSOR_VISION_PROFILE, {
            maxImageBytes: PNG_BYTES.length,
            maxTotalBytes: PNG_BYTES.length,
          }),
        }),
      );

      expect(results[0].vision).toBeDefined();
      expect(results[1].vision).toBeUndefined();
      expect(results[1].visionDegraded).toBe("budget_exhausted");
    });
  });
});
