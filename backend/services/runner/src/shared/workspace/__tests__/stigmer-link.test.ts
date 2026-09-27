import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureStigmerSymlink,
  removeStigmerSymlink,
  stigmerSymlinkPointsAt,
  STIGMER_LOCAL_STATE_DIR,
} from "../stigmer-link.js";
import { LocalWorkspaceBackend } from "../local-backend.js";

/**
 * The `.stigmer` symlink is the bridge that makes platform-mounted content
 * (approved plan, skills, attachment inputs) readable at `.stigmer/…` by
 * whatever reads from the workspace: the Cursor SDK and shell commands on
 * both harnesses. The lifecycle tests pin the ownership contract (ensure
 * replaces, remove is symlink-only); the convergence tests pin the physics:
 * content written through the platform-routing LocalWorkspaceBackend is
 * readable at the same `.stigmer/…` path from inside the workspace once the
 * link exists, and not before (the "plan file doesn't exist" bug).
 *
 * The native harness's FILE tools do not read through the link — their
 * virtual-rooted backend refuses a path whose real location leaves the
 * workspace — so their side of the convergence is pinned on the production
 * backends in `activities/execute-deep-agent/__tests__/platform-route.test.ts`.
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

  describe("stigmerSymlinkPointsAt", () => {
    it("is true only while the link points at this platform dir", async () => {
      expect(await stigmerSymlinkPointsAt(workspaceDir, platformDir), "no link yet").toBe(false);
      await ensureStigmerSymlink(workspaceDir, platformDir);
      expect(await stigmerSymlinkPointsAt(workspaceDir, platformDir)).toBe(true);
      expect(await stigmerSymlinkPointsAt(workspaceDir, join(platformDir, "elsewhere")), "another dir").toBe(false);
      await removeStigmerSymlink(workspaceDir);
      expect(await stigmerSymlinkPointsAt(workspaceDir, platformDir), "removed at turn end").toBe(false);
    });

    it("is false for a real .stigmer directory", async () => {
      await mkdir(linkPath());
      expect(await stigmerSymlinkPointsAt(workspaceDir, platformDir)).toBe(false);
    });
  });

  // ── Write/read convergence (the link, pinned) ─────────

  describe("platform write / agent read convergence", () => {
    /** Read the way a process in the workspace does (the shell, the Cursor SDK): a path relative to its CWD. */
    async function agentRead(path: string): Promise<{ content?: string; error?: string }> {
      try {
        return { content: await readFile(join(workspaceDir, path), "utf8") };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    it("an approved plan mounted under .stigmer/inputs is readable from the workspace once the link exists", async () => {
      const planFileName = "notes_ab12cd34.plan.md";
      const planText = "# The Approved Plan\n\nStep 1: do the thing.\n";

      // Write path: the attachment lands in the platform dir at the mount
      // path the implement-plan directive tells the model to read — here
      // through the platform-routing backend, the same physical write
      // `shared/attachment-resolver.ts` performs (it ensures the link itself,
      // which is why the link's absence is staged by hand below).
      const workspaceBackend = new LocalWorkspaceBackend(workspaceDir, platformDir);
      await workspaceBackend.writeFile(`.stigmer/inputs/${planFileName}`, planText);

      // Without the symlink nothing in the workspace can see the plan — the
      // bug this module fixes. Pinned so the link stays load-bearing in
      // reviewers' and agents' mental models.
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
