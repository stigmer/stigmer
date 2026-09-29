import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, rename, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `rename` passes through to the real one; the cross-filesystem case rejects
// it once with EXDEV, as a move from a cloud workspace volume to `$HOME` does.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

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
 * moves a real entry out of the workspace and never deletes one, refuses a
 * `.stigmer` that holds the platform dir, and remove is symlink-only); the
 * convergence tests pin the physics:
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

    it("removes an empty real .stigmer directory, then links", async () => {
      await mkdir(linkPath());

      await ensureStigmerSymlink(workspaceDir, platformDir);

      expect(await readlink(linkPath())).toBe(platformDir);
    });
  });

  // ── A real `.stigmer` in the link's place (#1123, #1424) ─────────

  describe("ensureStigmerSymlink over a real .stigmer", () => {
    // The platform dir sits in a session tree here, as `getPlatformDir` lays
    // it out, so the displaced dir lands beside it and not in the shared tmp.
    let sessionDir: string;
    let sessionPlatformDir: string;

    beforeEach(async () => {
      sessionDir = await mkdtemp(join(tmpdir(), "stigmer-link-session-"));
      sessionPlatformDir = join(sessionDir, "platform");
      await mkdir(sessionPlatformDir);
    });

    afterEach(async () => {
      await rm(sessionDir, { recursive: true, force: true });
    });

    /** The one entry under the session's `displaced/` dir. */
    async function displacedEntry(): Promise<string> {
      const entries = await readdir(join(sessionDir, "displaced"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatch(/^\d{8}T\d{9}Z$/);
      return join(sessionDir, "displaced", entries[0]);
    }

    it("moves a non-empty directory to the session's displaced dir, then links", async () => {
      // An agent write on a turn with no link, or an older runner's leftover:
      // kept, never deleted.
      await mkdir(join(linkPath(), "notes"), { recursive: true });
      await writeFile(join(linkPath(), "notes", "draft.md"), "the agent's draft");

      await ensureStigmerSymlink(workspaceDir, sessionPlatformDir);

      expect(await readlink(linkPath())).toBe(sessionPlatformDir);
      expect(await readFile(join(await displacedEntry(), "notes", "draft.md"), "utf-8")).toBe("the agent's draft");
      expect(await readdir(workspaceDir), "nothing else is left in the workspace").toEqual([STIGMER_LOCAL_STATE_DIR]);
    });

    it("moves a real .stigmer file the same way", async () => {
      await writeFile(linkPath(), "not a directory");

      await ensureStigmerSymlink(workspaceDir, sessionPlatformDir);

      expect(await readlink(linkPath())).toBe(sessionPlatformDir);
      expect(await readFile(await displacedEntry(), "utf-8")).toBe("not a directory");
    });

    it("copies then removes when the session dir is on another filesystem (EXDEV)", async () => {
      await mkdir(join(linkPath(), "notes"), { recursive: true });
      await writeFile(join(linkPath(), "notes", "draft.md"), "across mounts");
      vi.mocked(rename).mockRejectedValueOnce(
        Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" }),
      );

      await ensureStigmerSymlink(workspaceDir, sessionPlatformDir);

      expect(vi.mocked(rename)).toHaveBeenCalled();
      expect(await readlink(linkPath())).toBe(sessionPlatformDir);
      expect(await readFile(join(await displacedEntry(), "notes", "draft.md"), "utf-8")).toBe("across mounts");
    });

    it("refuses a .stigmer that holds the platform dir, touching nothing (a workspace at the home directory)", async () => {
      // The workspace IS the home: its `.stigmer` is the Stigmer home, where
      // the CLI's config and every session live, this one's platform dir too.
      const home = await mkdtemp(join(tmpdir(), "stigmer-link-home-"));
      try {
        const stigmerHome = join(home, STIGMER_LOCAL_STATE_DIR);
        const homePlatformDir = join(stigmerHome, "sessions", "s1", "platform");
        await mkdir(homePlatformDir, { recursive: true });
        await writeFile(join(stigmerHome, "config.yaml"), "context: local\n");

        await expect(ensureStigmerSymlink(home, homePlatformDir)).rejects.toThrow(/is the Stigmer home/);

        expect((await lstat(stigmerHome)).isDirectory(), "still the real directory").toBe(true);
        expect(await readFile(join(stigmerHome, "config.yaml"), "utf-8")).toBe("context: local\n");
        expect((await lstat(homePlatformDir)).isDirectory()).toBe(true);
        await expect(lstat(join(stigmerHome, "sessions", "s1", "displaced"))).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });

    it("refuses when the platform dir is the .stigmer itself", async () => {
      await mkdir(linkPath());
      await writeFile(join(linkPath(), "keep.txt"), "keep");

      await expect(ensureStigmerSymlink(workspaceDir, linkPath())).rejects.toThrow(/is the Stigmer home/);

      expect(await readFile(join(linkPath(), "keep.txt"), "utf-8")).toBe("keep");
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
