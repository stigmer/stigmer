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
//    listing without it;
//  - the shared read-only rule (`shared/outputs.ts` `isReadOnlyPlatformPath`),
//    which the Claude engine's gate reads, naming exactly the writes the
//    route refuses;
//  - the outputs folder, `.stigmer/outputs/`, the one writable corner: the
//    file tools write, edit (a loosely quoted edit too), read and delete
//    inside it, while every other
//    path under `.stigmer/` stays read-only, a `..` out of it reaches
//    nothing, a link inside it is not written through, and a delete of `/`,
//    `/.stigmer` or the folder itself removes nothing;
//  - deepagents' offload roots, `/conversation_history/` and
//    `/large_tool_results/`, routed on every turn to the session's offload
//    directory beside the platform dir: written, appended and read there,
//    never in the workspace, a `..` or a link reaching nothing outside it,
//    left out of the root listing, and never deleted whole.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FilesystemBackend, isSandboxBackend } from "deepagents";
import type { AnyBackendProtocol, BackendProtocolV2 } from "deepagents";

import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import {
  DEEPAGENTS_HISTORY_ROOT,
  DEEPAGENTS_OFFLOAD_ROOT,
  OUTPUTS_ROUTE_PREFIX,
  PLATFORM_ROUTE_PREFIX,
  PlatformRoutedBackend,
  mountPlatformRoute,
} from "../platform-route.js";
import { isReadOnlyPlatformPath } from "../../../shared/outputs.js";
import { offloadDirBeside } from "../../../shared/workspace/platform-dir.js";
import { LocalWorkspaceBackend } from "../../../shared/workspace/local-backend.js";
import { ensureStigmerSymlink } from "../../../shared/workspace/stigmer-link.js";

const SKILL = ".stigmer/skills/my-skill/SKILL.md";
const PLAN = ".stigmer/inputs/notes_ab12cd34.plan.md";

describe("platform route", () => {
  let workspaceDir: string;
  let platformDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "platform-route-ws-"));
    // A session's platform dir, inside a session dir of its own: the route
    // keeps deepagents' offloads beside it (`platform-dir.ts`).
    platformDir = join(await mkdtemp(join(tmpdir(), "platform-route-session-")), "platform");
    await mkdir(platformDir);
    // The same physical writes the skill writer and the attachment resolver
    // perform, through the platform-routing workspace backend.
    const writer = new LocalWorkspaceBackend(workspaceDir, platformDir);
    await writer.writeFile(SKILL, "# My Skill\n\nDo skillful things.\n");
    await writer.writeFile(PLAN, "# The Approved Plan\n\nStep 1: do the thing.\n");
    await writeFile(join(workspaceDir, "main.go"), "package main\n");
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(dirname(platformDir), { recursive: true, force: true });
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

  describe.each(["shell", "plan"] as const)("the %s backend's outputs folder", (mode) => {
    const outputsDir = () => join(platformDir, "outputs");

    beforeEach(async () => {
      await mkdir(outputsDir(), { recursive: true });
      await ensureStigmerSymlink(workspaceDir, platformDir);
    });

    it("writes, edits, reads and deletes inside it, in subfolders too", async () => {
      const backend = v2(await productionBackend(mode));
      expect((await backend.write(`${OUTPUTS_ROUTE_PREFIX}reports/q3.md`, "# Q3\n")).error).toBeUndefined();
      expect(await readFile(join(outputsDir(), "reports/q3.md"), "utf8")).toBe("# Q3\n");
      expect((await backend.edit(`${OUTPUTS_ROUTE_PREFIX}reports/q3.md`, "Q3", "Q3 variance")).error).toBeUndefined();
      expect((await backend.read(`${OUTPUTS_ROUTE_PREFIX}reports/q3.md`)).content).toContain("Q3 variance");
      expect((await backend.delete!(`${OUTPUTS_ROUTE_PREFIX}reports/q3.md`)).error).toBeUndefined();
      await expect(access(join(outputsDir(), "reports/q3.md"))).rejects.toThrow();
    });

    it("lands an edit quoted loosely, while platform content still refuses every edit", async () => {
      await writeFile(join(outputsDir(), "notes.md"), "# It\u2019s \u201Cdone\u201D\r\nstatus: draft\r\n");
      const backend = v2(await productionBackend(mode));
      const result = await backend.edit(`${OUTPUTS_ROUTE_PREFIX}notes.md`, '# It\'s "done"\nstatus: draft', '# It\'s "done"\nstatus: final');
      expect(result.error).toBeUndefined();
      expect(await readFile(join(outputsDir(), "notes.md"), "utf8")).toBe("# It\u2019s \u201Cdone\u201D\r\nstatus: final\r\n");
      expect((await backend.edit(`/${SKILL}`, "My  Skill", "Your Skill")).error).toMatch(/read-only/);
    });

    it("keeps every other path under .stigmer/ read-only", async () => {
      const backend = v2(await productionBackend(mode));
      expect((await backend.write(`/${SKILL}`, "x")).error).toMatch(/read-only/);
      expect((await backend.write(`${PLATFORM_ROUTE_PREFIX}uploads/a.txt`, "x")).error).toMatch(/read-only/);
      expect((await backend.write(`${PLATFORM_ROUTE_PREFIX}outputs.md`, "x")).error, "a sibling named like the folder").toMatch(/read-only/);
      expect((await backend.write(`${PLATFORM_ROUTE_PREFIX}new.md`, "x")).error).toMatch(/outputs/);
      expect(await readFile(join(platformDir, "skills/my-skill/SKILL.md"), "utf8")).toContain("My Skill");
    });

    it("refuses exactly the writes the shared read-only rule names, the rule every engine's gate reads", async () => {
      const backend = v2(await productionBackend(mode));
      const paths = [`/${SKILL}`, `${PLATFORM_ROUTE_PREFIX}uploads/a.txt`, `${PLATFORM_ROUTE_PREFIX}outputs.md`, `${OUTPUTS_ROUTE_PREFIX}pinned.md`, `${OUTPUTS_ROUTE_PREFIX}nested/pinned.md`];
      for (const path of paths) {
        const refused = (await backend.write(path, "x")).error !== undefined;
        expect(refused, path).toBe(isReadOnlyPlatformPath(path));
      }
    });

    it("reaches nothing outside it through `..` or through a link inside it", async () => {
      const backend = v2(await productionBackend(mode));
      expect((await backend.write(`${OUTPUTS_ROUTE_PREFIX}../skills/my-skill/SKILL.md`, "hijacked")).error).toBeDefined();
      await symlink(join(platformDir, "skills"), join(outputsDir(), "skills-link"));
      expect((await backend.write(`${OUTPUTS_ROUTE_PREFIX}skills-link/my-skill/SKILL.md`, "hijacked")).error).toBeDefined();
      expect(await readFile(join(platformDir, "skills/my-skill/SKILL.md"), "utf8")).toContain("My Skill");
    });

    it("removes nothing on a delete of /, /.stigmer or the folder itself", async () => {
      await writeFile(join(outputsDir(), "keep.md"), "kept\n");
      const backend = v2(await productionBackend(mode));
      for (const target of ["/", "/.stigmer", PLATFORM_ROUTE_PREFIX, OUTPUTS_ROUTE_PREFIX.slice(0, -1), OUTPUTS_ROUTE_PREFIX]) {
        expect((await backend.delete!(target)).error, target).toBeDefined();
      }
      expect(await readdir(outputsDir())).toEqual(["keep.md"]);
      expect(await readFile(join(workspaceDir, "main.go"), "utf8")).toBe("package main\n");
      expect(await readFile(join(platformDir, "skills/my-skill/SKILL.md"), "utf8")).toContain("My Skill");
    });
  });

  describe.each([
    ["shell", "with the link"],
    ["plan", "without the link"],
  ] as const)("the %s backend's offload roots, %s", (mode, link) => {
    const offloadDir = () => offloadDirBeside(platformDir);

    beforeEach(async () => {
      if (link === "with the link") await ensureStigmerSymlink(workspaceDir, platformDir);
    });

    it("writes, appends and reads each root in the session's offload directory, never in the workspace", async () => {
      const backend = v2(await productionBackend(mode));
      const history = `${DEEPAGENTS_HISTORY_ROOT}session_0a1b.md`;
      expect((await backend.write(history, "## Summarized\n")).error).toBeUndefined();
      const [upload] = await backend.uploadFiles!([[history, new TextEncoder().encode("## Summarized\n## Again\n")]]);
      expect(upload?.error ?? undefined).toBeUndefined();
      expect((await backend.write(`${DEEPAGENTS_OFFLOAD_ROOT}call_1`, "a large result")).error).toBeUndefined();
      expect((await backend.read(history)).content).toContain("## Again");
      expect(await readFile(join(offloadDir(), "conversation_history", "session_0a1b.md"), "utf8")).toBe("## Summarized\n## Again\n");
      expect(await readFile(join(offloadDir(), "large_tool_results", "call_1"), "utf8")).toBe("a large result");
      await expect(access(join(workspaceDir, "conversation_history"))).rejects.toThrow();
      await expect(access(join(workspaceDir, "large_tool_results"))).rejects.toThrow();
    });

    it("leaves both roots out of the root listing", async () => {
      const backend = v2(await productionBackend(mode));
      const root = ((await backend.ls("/")).files ?? []).map((f) => f.path);
      expect(root).not.toContain(DEEPAGENTS_HISTORY_ROOT);
      expect(root).not.toContain(DEEPAGENTS_OFFLOAD_ROOT);
      expect(root).toContain("/main.go");
    });

    it("reaches nothing outside the offload directory through `..` or a link inside it", async () => {
      const backend = v2(await productionBackend(mode));
      expect((await backend.read(`${DEEPAGENTS_OFFLOAD_ROOT}../../main.go`)).content ?? "").not.toContain("package main");
      await symlink(join(workspaceDir, "main.go"), join(offloadDir(), "large_tool_results", "leak"));
      expect((await backend.read(`${DEEPAGENTS_OFFLOAD_ROOT}leak`)).content ?? "").not.toContain("package main");
    });

    it("removes nothing on a delete of either root, and a file inside one as asked", async () => {
      const backend = v2(await productionBackend(mode));
      await backend.write(`${DEEPAGENTS_HISTORY_ROOT}kept.md`, "kept");
      await backend.write(`${DEEPAGENTS_OFFLOAD_ROOT}gone`, "gone");
      expect((await backend.delete!(`${DEEPAGENTS_OFFLOAD_ROOT}gone`)).error).toBeUndefined();
      expect(await readdir(join(offloadDir(), "large_tool_results"))).toEqual([]);
      for (const target of [DEEPAGENTS_HISTORY_ROOT, DEEPAGENTS_OFFLOAD_ROOT]) {
        expect((await backend.delete!(target)).error, target).toMatch(/stays/);
      }
      expect(await readdir(join(offloadDir(), "conversation_history"))).toEqual(["kept.md"]);
    });
  });

  it("refuses an outputs write on a turn without the link, and creates nothing", async () => {
    const backend = v2(await productionBackend("shell"));
    expect((await backend.write(`${OUTPUTS_ROUTE_PREFIX}report.md`, "x")).error).toMatch(/read-only/);
    await expect(lstat(join(workspaceDir, ".stigmer"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(platformDir, "outputs/report.md"))).rejects.toThrow();
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
