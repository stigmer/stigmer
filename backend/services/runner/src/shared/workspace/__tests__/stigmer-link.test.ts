import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBackend } from "deepagents";

import {
  ensureStigmerSymlink,
  removeStigmerSymlink,
  STIGMER_LOCAL_STATE_DIR,
} from "../stigmer-link.js";
import { LocalWorkspaceBackend } from "../local-backend.js";
import { injectAttachments } from "../../../activities/execute-deep-agent/attachment-injector.js";

/**
 * The `.stigmer` symlink is the bridge that makes platform-mounted content
 * (approved plan, skills, attachment inputs) readable by the agent's file
 * tools in BOTH harnesses. The lifecycle tests pin the ownership contract
 * (ensure replaces, remove is symlink-only); the convergence tests pin the
 * end-to-end physics the native harness depends on: content written through
 * the platform-routing LocalWorkspaceBackend must be readable at the same
 * `.stigmer/…` path through a stock deepagents FilesystemBackend rooted at
 * the workspace — which is exactly what broke when the native harness had no
 * symlink (the "plan file doesn't exist" bug).
 */
describe("stigmer-link", () => {
  let workspaceDir: string;
  let platformDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "stigmer-link-ws-"));
    platformDir = await mkdtemp(join(tmpdir(), "stigmer-link-platform-"));
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(platformDir, { recursive: true, force: true });
  });

  const linkPath = () => join(workspaceDir, STIGMER_LOCAL_STATE_DIR);

  describe("ensureStigmerSymlink", () => {
    it("creates the workspace symlink pointing at the platform dir", async () => {
      await ensureStigmerSymlink(workspaceDir, platformDir);

      expect((await lstat(linkPath())).isSymbolicLink()).toBe(true);
      expect(await readlink(linkPath())).toBe(platformDir);
    });

    it("is idempotent for a correct existing link", async () => {
      await ensureStigmerSymlink(workspaceDir, platformDir);
      await ensureStigmerSymlink(workspaceDir, platformDir);

      expect(await readlink(linkPath())).toBe(platformDir);
    });

    it("re-points a stale link at the current platform dir", async () => {
      const stalePlatform = await mkdtemp(join(tmpdir(), "stigmer-link-stale-"));
      try {
        await ensureStigmerSymlink(workspaceDir, stalePlatform);
        await ensureStigmerSymlink(workspaceDir, platformDir);

        expect(await readlink(linkPath())).toBe(platformDir);
      } finally {
        await rm(stalePlatform, { recursive: true, force: true });
      }
    });

    it("replaces a real .stigmer directory (platform owns the name)", async () => {
      // The ownership sharp edge, pinned deliberately: a non-symlink
      // `.stigmer` (left behind by an older runner) must never shadow the
      // platform mount. See the module header for why this is safe.
      await mkdir(join(linkPath(), "old"), { recursive: true });
      await writeFile(join(linkPath(), "old", "stale.txt"), "stale");

      await ensureStigmerSymlink(workspaceDir, platformDir);

      expect((await lstat(linkPath())).isSymbolicLink()).toBe(true);
      expect(await readlink(linkPath())).toBe(platformDir);
    });
  });

  describe("removeStigmerSymlink", () => {
    it("removes the symlink and leaves the platform dir intact", async () => {
      await writeFile(join(platformDir, "keep.txt"), "keep");
      await ensureStigmerSymlink(workspaceDir, platformDir);

      await removeStigmerSymlink(workspaceDir);

      await expect(lstat(linkPath())).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(platformDir, "keep.txt"), "utf-8")).toBe("keep");
    });

    it("leaves a real .stigmer directory untouched (symlink-only removal)", async () => {
      await mkdir(linkPath(), { recursive: true });
      await writeFile(join(linkPath(), "user-owned.txt"), "mine");

      await removeStigmerSymlink(workspaceDir);

      expect(await readFile(join(linkPath(), "user-owned.txt"), "utf-8")).toBe("mine");
    });

    it("is a no-op when no link exists", async () => {
      await expect(removeStigmerSymlink(workspaceDir)).resolves.toBeUndefined();
    });
  });

  // ── Write/read convergence (the native-harness bug, pinned) ─────────

  describe("platform write / agent read convergence", () => {
    /** Read through the agent's actual file-tool backend. */
    function agentRead(path: string): Promise<{ content?: string; error?: string }> {
      const agentBackend = new FilesystemBackend({ rootDir: workspaceDir });
      return agentBackend.read(path) as Promise<{ content?: string; error?: string }>;
    }

    it("approved plan injected via injectAttachments is readable by the deepagents backend", async () => {
      const planFileName = "notes_ab12cd34.plan.md";
      const planText = "# The Approved Plan\n\nStep 1: do the thing.\n";
      const uploadPath = join(platformDir, "upload-src.md");
      await writeFile(uploadPath, planText);

      // Write path: exactly what the build turn does — the attachment is
      // materialized through the platform-routing backend at the mount path
      // the implement-plan directive will tell the model to read.
      const workspaceBackend = new LocalWorkspaceBackend(workspaceDir, platformDir);
      const injected = await injectAttachments({
        backend: workspaceBackend,
        attachments: [{
          filename: planFileName,
          storageKey: "",
          mountPath: `.stigmer/inputs/${planFileName}`,
          contentType: "text/markdown",
          extract: false,
          localPath: uploadPath,
          $typeName: "ai.stigmer.agentic.agentexecution.v1.Attachment",
        } as any],
        storage: undefined,
        isLocalMode: true,
      });
      expect(injected.map((f) => f.path)).toEqual([`.stigmer/inputs/${planFileName}`]);

      // Without the symlink the agent cannot see the plan — the bug this
      // module fixes for the native harness. Pinned so the link stays
      // load-bearing in reviewers' and agents' mental models.
      const before = await agentRead(`.stigmer/inputs/${planFileName}`);
      expect(before.content ?? "").not.toContain("The Approved Plan");

      await ensureStigmerSymlink(workspaceDir, platformDir);

      const after = await agentRead(`.stigmer/inputs/${planFileName}`);
      expect(after.error).toBeUndefined();
      expect(after.content).toContain("The Approved Plan");
    });

    it("skill written through the platform-routing backend is readable at its prompt location", async () => {
      // Same physical write the skill-writer performs for
      // `.stigmer/skills/{name}/SKILL.md` — the path the system prompt tells
      // the model to read to activate the skill.
      const workspaceBackend = new LocalWorkspaceBackend(workspaceDir, platformDir);
      await workspaceBackend.writeFile(
        ".stigmer/skills/my-skill/SKILL.md",
        "# My Skill\n\nDo skillful things.\n",
      );

      await ensureStigmerSymlink(workspaceDir, platformDir);

      const result = await agentRead(".stigmer/skills/my-skill/SKILL.md");
      expect(result.error).toBeUndefined();
      expect(result.content).toContain("My Skill");
    });
  });
});
