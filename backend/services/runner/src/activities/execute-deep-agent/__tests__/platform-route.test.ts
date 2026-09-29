// Covers the native file tools' read of platform content (skills, attached
// inputs, the approved plan) at `.stigmer/…`, on the backends production
// builds (`createCasCaptureBackend` + `mountPlatformRoute`, parent and
// sub-agents alike). The stock virtual-rooted backend refuses to follow the
// workspace link out of the root; the route mounts the platform dir instead,
// read-only, on the turns the link exists, and an empty route on every other
// turn. What is pinned:
//  - the stock backend's refusal (why the route exists);
//  - reads, listings and search through the route, for the shell-capable and
//    the plan-mode backend, with `execute` kept exactly where it was;
//  - every mutation through the route refused, and a root delete refused
//    before it touches the workspace or the platform dir;
//  - on a turn without the link, `.stigmer/` still the platform's: nothing
//    readable, every write refused and nothing created in the workspace (the
//    write that used to make a real directory there, #1123), and the root
//    listing without it.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBackend, isSandboxBackend } from "deepagents";
import type { AnyBackendProtocol, BackendProtocolV2 } from "deepagents";

import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { PLATFORM_ROUTE_PREFIX, PlatformRoutedBackend, mountPlatformRoute } from "../platform-route.js";
import { LocalWorkspaceBackend } from "../../../shared/workspace/local-backend.js";
import { ensureStigmerSymlink } from "../../../shared/workspace/stigmer-link.js";

const SKILL = ".stigmer/skills/my-skill/SKILL.md";
const PLAN = ".stigmer/inputs/notes_ab12cd34.plan.md";

describe("platform route", () => {
  let workspaceDir: string;
  let platformDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "platform-route-ws-"));
    platformDir = await mkdtemp(join(tmpdir(), "platform-route-platform-"));
    // The same physical writes the skill writer and the attachment resolver
    // perform, through the platform-routing workspace backend.
    const writer = new LocalWorkspaceBackend(workspaceDir, platformDir);
    await writer.writeFile(SKILL, "# My Skill\n\nDo skillful things.\n");
    await writer.writeFile(PLAN, "# The Approved Plan\n\nStep 1: do the thing.\n");
    await writeFile(join(workspaceDir, "main.go"), "package main\n");
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(platformDir, { recursive: true, force: true });
  });

  const observer = () => new CasCaptureObserver({ rootDir: workspaceDir, isIgnored: async () => true });

  /** The parent's backend as `turn-setup.ts` builds it: shell-capable, or plan mode's filesystem-only one. */
  async function productionBackend(mode: "shell" | "plan"): Promise<AnyBackendProtocol> {
    const workspace = await createCasCaptureBackend({
      rootDir: workspaceDir,
      observer: observer(),
      ...(mode === "shell" ? { shellEnv: {} } : {}),
    });
    return mountPlatformRoute(workspace, { workspaceDir, platformDir });
  }

  function v2(backend: AnyBackendProtocol): BackendProtocolV2 {
    return backend as BackendProtocolV2;
  }

  it("the stock virtual-rooted backend refuses a path through the link (why the route exists)", async () => {
    await ensureStigmerSymlink(workspaceDir, platformDir);
    const stock = new FilesystemBackend({ rootDir: workspaceDir, virtualMode: true });
    const result = await stock.read(`/${SKILL}`);
    expect(result.content).toBeUndefined();
    expect(result.error).toMatch(/outside root/i);
  });

  describe.each(["shell", "plan"] as const)("the %s backend with the link", (mode) => {
    beforeEach(async () => {
      await ensureStigmerSymlink(workspaceDir, platformDir);
    });

    it("reads a skill and the approved plan at the paths the prompts name", async () => {
      const backend = v2(await productionBackend(mode));
      expect(backend).toBeInstanceOf(PlatformRoutedBackend);
      expect((await backend.read(`/${SKILL}`)).content).toContain("My Skill");
      expect((await backend.read(`/${PLAN}`)).content).toContain("The Approved Plan");
      expect((await backend.read("/main.go")).content, "the workspace is still the default").toContain("package main");
    });

    it("lists the platform once at the root, and its contents inside the route", async () => {
      const backend = v2(await productionBackend(mode));
      const root = (await backend.ls("/")).files ?? [];
      expect(root.filter((f) => f.path === PLATFORM_ROUTE_PREFIX), "one entry, not two").toHaveLength(1);
      expect(root.map((f) => f.path)).toContain("/main.go");
      const inside = (await backend.ls(PLATFORM_ROUTE_PREFIX)).files ?? [];
      expect(inside.map((f) => f.path).sort()).toEqual(["/.stigmer/inputs/", "/.stigmer/skills/"]);
    });

    it("finds a skill by glob from the root", async () => {
      const backend = v2(await productionBackend(mode));
      const found = (await backend.glob("**/SKILL.md", "/")).files ?? [];
      expect(found.map((f) => f.path)).toContain(`/${SKILL}`);
    });

    it("keeps `execute` exactly where the workspace backend had it", async () => {
      const backend = await productionBackend(mode);
      expect(isSandboxBackend(backend)).toBe(mode === "shell");
    });

    it("refuses every mutation of platform content", async () => {
      const backend = v2(await productionBackend(mode));
      expect((await backend.write(`${PLATFORM_ROUTE_PREFIX}new.md`, "x")).error).toMatch(/read-only/);
      expect((await backend.edit(`/${SKILL}`, "My Skill", "Your Skill")).error).toMatch(/read-only/);
      expect((await backend.delete!(`${PLATFORM_ROUTE_PREFIX}skills`)).error).toMatch(/read-only/);
      expect(await readFile(join(platformDir, "skills/my-skill/SKILL.md"), "utf8")).toContain("My Skill");
    });

    it("refuses a root delete before it touches the workspace or the platform dir", async () => {
      const backend = v2(await productionBackend(mode));
      expect((await backend.delete!("/")).error).toBeDefined();
      expect(await readFile(join(workspaceDir, "main.go"), "utf8")).toBe("package main\n");
      expect(await readFile(join(platformDir, "skills/my-skill/SKILL.md"), "utf8")).toContain("My Skill");
    });
  });

  describe.each(["shell", "plan"] as const)("the %s backend on a turn without the link", (mode) => {
    it("refuses every write under .stigmer/ and creates nothing in the workspace", async () => {
      const backend = v2(await productionBackend(mode));
      expect(backend).toBeInstanceOf(PlatformRoutedBackend);
      expect((await backend.write(`${PLATFORM_ROUTE_PREFIX}notes/draft.md`, "x")).error).toMatch(/read-only/);
      expect((await backend.edit(`/${SKILL}`, "My Skill", "Your Skill")).error).toMatch(/read-only/);
      const uploads = (await backend.uploadFiles!([[`${PLATFORM_ROUTE_PREFIX}up.bin`, new Uint8Array([1])]])) ?? [];
      expect(uploads.map((u) => u.error)).toEqual(["permission_denied"]);
      await expect(lstat(join(workspaceDir, ".stigmer")), "no real directory in the user's tree").rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("exposes nothing of the platform dir, which still holds earlier turns' content", async () => {
      const backend = v2(await productionBackend(mode));
      expect((await backend.read(`/${SKILL}`)).error).toMatch(/no platform content/);
      expect((await backend.ls(PLATFORM_ROUTE_PREFIX)).error).toMatch(/no platform content/);
      const found = (await backend.glob("**/SKILL.md", "/")).files ?? [];
      expect(found).toEqual([]);
    });

    it("lists the workspace at the root without .stigmer/", async () => {
      const backend = v2(await productionBackend(mode));
      const root = ((await backend.ls("/")).files ?? []).map((f) => f.path);
      expect(root).toContain("/main.go");
      expect(root).not.toContain(PLATFORM_ROUTE_PREFIX);
    });

    it("keeps `execute` exactly where the workspace backend had it", async () => {
      const backend = await productionBackend(mode);
      expect(isSandboxBackend(backend)).toBe(mode === "shell");
    });
  });

  it("exposes nothing when the link points somewhere else", async () => {
    const other = await mkdtemp(join(tmpdir(), "platform-route-other-"));
    try {
      await ensureStigmerSymlink(workspaceDir, other);
      const backend = v2(await productionBackend("plan"));
      expect((await backend.read(`/${SKILL}`)).error).toMatch(/no platform content/);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("mounts nothing for a session without a platform dir", async () => {
    const workspace = await createCasCaptureBackend({ rootDir: workspaceDir, observer: observer(), shellEnv: {} });
    expect(await mountPlatformRoute(workspace, { workspaceDir, platformDir: undefined })).toBe(workspace);
  });

  it("a workspace entry of its own is untouched by the route", async () => {
    await mkdir(join(workspaceDir, "src"));
    await writeFile(join(workspaceDir, "src/a.ts"), "export {};\n");
    await ensureStigmerSymlink(workspaceDir, platformDir);
    const backend = v2(await productionBackend("shell"));
    expect((await backend.write("/src/b.ts", "export const b = 1;\n")).error).toBeUndefined();
    expect(await readFile(join(workspaceDir, "src/b.ts"), "utf8")).toBe("export const b = 1;\n");
  });
});
