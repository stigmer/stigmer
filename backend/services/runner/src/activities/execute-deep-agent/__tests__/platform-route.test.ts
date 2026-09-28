// Covers the native file tools' read of platform content (skills, attached
// inputs, the approved plan) at `.stigmer/…`, on the backends production
// builds (`createCasCaptureBackend` + `mountPlatformRoute`, parent and
// sub-agents alike). The stock virtual-rooted backend refuses to follow the
// workspace link out of the root; the route mounts the platform dir instead,
// read-only, on the turns the link exists. What is pinned:
//  - the stock backend's refusal (why the route exists);
//  - reads, listings and search through the route, for the shell-capable and
//    the plan-mode backend, with `execute` kept exactly where it was;
//  - every mutation through the route refused, and a root delete refused
//    before it touches the workspace or the platform dir;
//  - no route on a turn without the link.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("mounts nothing on a turn without the link", async () => {
    const workspace = await createCasCaptureBackend({ rootDir: workspaceDir, observer: observer(), shellEnv: {} });
    expect(await mountPlatformRoute(workspace, { workspaceDir, platformDir })).toBe(workspace);
    expect(await mountPlatformRoute(workspace, { workspaceDir, platformDir: undefined })).toBe(workspace);
  });

  it("mounts nothing when the link points somewhere else", async () => {
    const other = await mkdtemp(join(tmpdir(), "platform-route-other-"));
    try {
      await ensureStigmerSymlink(workspaceDir, other);
      const workspace = await createCasCaptureBackend({ rootDir: workspaceDir, observer: observer() });
      expect(await mountPlatformRoute(workspace, { workspaceDir, platformDir })).toBe(workspace);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
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
