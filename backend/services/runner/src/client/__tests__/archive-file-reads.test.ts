import { describe, it, expect, vi } from "vitest";

/**
 * Pins the client's four file reads, what the turn's reader of skill and
 * plugin files calls (`shared/archive-reader.ts`): `listFiles` and
 * `readFile` on SkillQueryController and PluginQueryController, each with the
 * values as given, a listing answered unchanged and a read answered as its
 * bytes. The transport and the generated clients are replaced at their
 * module seams.
 */

const skillListFiles = vi.fn();
const skillReadFile = vi.fn();
const pluginListFiles = vi.fn();
const pluginReadFile = vi.fn();

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: () => ({}),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect")>();
  return {
    ...actual,
    createClient: (service: { typeName: string }) =>
      service.typeName === "ai.stigmer.agentic.skill.v1.SkillQueryController"
        ? { listFiles: skillListFiles, readFile: skillReadFile }
        : service.typeName === "ai.stigmer.agentic.plugin.v1.PluginQueryController"
          ? { listFiles: pluginListFiles, readFile: pluginReadFile }
          : {},
  };
});

import { StigmerClient } from "../stigmer-client.js";

describe("StigmerClient file reads", () => {
  const client = new StigmerClient({ endpoint: "localhost:7234", token: null });
  const bytes = new TextEncoder().encode("the file");

  it("lists and reads a skill's files at a version", async () => {
    skillListFiles.mockResolvedValue({ files: [{ path: "SKILL.md" }] });
    skillReadFile.mockResolvedValue({ content: bytes });

    expect(await client.listSkillFiles("skl_1", "v1")).toEqual({ files: [{ path: "SKILL.md" }] });
    expect(skillListFiles).toHaveBeenCalledWith({ skillId: "skl_1", versionHash: "v1" });
    expect(await client.readSkillFile("skl_1", "v1", "refs/a.md")).toBe(bytes);
    expect(skillReadFile).toHaveBeenCalledWith({ skillId: "skl_1", versionHash: "v1", path: "refs/a.md" });
  });

  it("lists and reads a plugin's files at a digest", async () => {
    pluginListFiles.mockResolvedValue({ files: [{ path: "hooks/check" }] });
    pluginReadFile.mockResolvedValue({ content: bytes });

    expect(await client.listPluginFiles("plg_1", "d1")).toEqual({ files: [{ path: "hooks/check" }] });
    expect(pluginListFiles).toHaveBeenCalledWith({ pluginId: "plg_1", digest: "d1" });
    expect(await client.readPluginFile("plg_1", "d1", "skills/a/SKILL.md")).toBe(bytes);
    expect(pluginReadFile).toHaveBeenCalledWith({ pluginId: "plg_1", digest: "d1", path: "skills/a/SKILL.md" });
  });
});
