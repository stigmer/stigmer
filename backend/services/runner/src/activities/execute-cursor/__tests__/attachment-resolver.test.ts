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
});
