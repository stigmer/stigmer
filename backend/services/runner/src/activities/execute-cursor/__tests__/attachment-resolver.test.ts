/**
 * Tests for the Cursor harness's attachment resolver.
 *
 * The load-bearing behaviors: storage-key attachments materialize under the
 * platform inputs dir (the universal path — every server-created attachment
 * carries a storage key), the workspace `.stigmer` symlink exists even when
 * the agent has no skills, and any attachment that cannot be materialized
 * fails the resolution loudly (the silent-skip regression behind "plan file
 * wasn't found").
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAttachments, AttachmentResolutionError } from "../attachment-resolver.js";
import { getPlatformDir } from "../../../shared/workspace/platform-dir.js";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";
import { CURSOR_VISION_PROFILE, VisionBudget } from "../../../shared/attachment-vision.js";

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
      { filename: "plan.md", relativePath: ".stigmer/inputs/plan.md" },
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
      { filename: "report.pdf", relativePath: ".stigmer/inputs/report.pdf" },
      {
        filename: "report-2.pdf",
        relativePath: ".stigmer/inputs/report-2.pdf",
        renamedFrom: "report.pdf",
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

    expect(result).toEqual([
      { filename: "notes.md", relativePath: ".stigmer/inputs/notes.md" },
      {
        filename: "notes-2.md",
        relativePath: ".stigmer/inputs/notes-2.md",
        renamedFrom: "notes.md",
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
      { filename: "evil.md", relativePath: ".stigmer/inputs/evil.md" },
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
