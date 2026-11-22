/**
 * The turn's reader of its skill and plugin files (`../archive-reader.ts`):
 * it answers only for the turn's own sources, serves a skill's SKILL.md
 * from its spec, checks every byte against the listing's SHA-256 before it
 * caches or returns it, keys its cache by the run's organization, and
 * counts what a turn read.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { PluginFileListSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { SkillFileListSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/io_pb";

import {
  ArchiveFileNotFoundError,
  NO_TURN_ARCHIVES,
  archiveReadLine,
  newArchiveCache,
  newTurnArchives,
  type ArchiveFileClient,
  type ArchiveSource,
} from "../archive-reader.js";

const sha = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (data: Uint8Array): string => new TextDecoder().decode(data);

/** A store of files per (kind, id, version), counting what it is asked; `serve` may lie about a file's bytes. */
function storeClient(files: Record<string, Record<string, string>>, serve: (key: string, path: string, real: string) => string = (_k, _p, real) => real) {
  const calls: string[] = [];
  const listing = (key: string) =>
    Object.entries(files[key] ?? {}).map(([path, content]) => ({ path, sizeBytes: BigInt(bytes(content).length), sha256: sha(content), executable: false }));
  const client: ArchiveFileClient = {
    listSkillFiles: async (id, version) => {
      calls.push(`list skill ${id}@${version}`);
      return create(SkillFileListSchema, { files: listing(`skill:${id}:${version}`) });
    },
    readSkillFile: async (id, version, path) => {
      calls.push(`read skill ${id}@${version} ${path}`);
      const key = `skill:${id}:${version}`;
      return bytes(serve(key, path, files[key]![path]!));
    },
    listPluginFiles: async (id, digest) => {
      calls.push(`list plugin ${id}@${digest}`);
      return create(PluginFileListSchema, { files: listing(`plugin:${id}:${digest}`) });
    },
    readPluginFile: async (id, digest, path) => {
      calls.push(`read plugin ${id}@${digest} ${path}`);
      const key = `plugin:${id}:${digest}`;
      return bytes(serve(key, path, files[key]![path]!));
    },
  };
  return { client, calls };
}

const notes = (id: string, skillMd: string): Extract<ArchiveSource, { kind: "skill" }> => ({ kind: "skill", dir: "skills/notes", id, version: "v1", hasArchive: true, skillMd });
const kit: ArchiveSource = { kind: "plugin", dir: `plugins/${"d".repeat(64)}`, id: "plg_kit", digest: "d".repeat(64) };

describe("newTurnArchives", () => {
  it("lists the turn's files under the paths its prompt names, a skill's SKILL.md from its spec", async () => {
    const { client } = storeClient({
      "skill:skl_a:v1": { "SKILL.md": "zip copy", "refs/a.md": "A" },
      [`plugin:plg_kit:${"d".repeat(64)}`]: { "skills/review/SKILL.md": "review" },
    });
    const archives = newTurnArchives(client, "org_a", [notes("skl_a", "# Notes"), kit], newArchiveCache(1 << 20));
    expect(archives.folders).toEqual(["skills", "plugins"]);
    expect((await archives.list()).map((file) => file.path)).toEqual([
      "skills/notes/SKILL.md",
      "skills/notes/refs/a.md",
      `plugins/${"d".repeat(64)}/skills/review/SKILL.md`,
    ]);
    expect(text(await archives.read("skills/notes/SKILL.md"))).toBe("# Notes");
    expect(text(await archives.read("skills/notes/refs/a.md"))).toBe("A");
    expect(text(await archives.read(`plugins/${"d".repeat(64)}/skills/review/SKILL.md`)), "a plugin's skill file, read like any other").toBe("review");
  });

  it("answers only for the turn's own sources, whatever the server holds", async () => {
    const { client, calls } = storeClient({ "skill:skl_a:v1": { "refs/a.md": "A" }, "skill:skl_other:v1": { "secret.md": "s" } });
    const archives = newTurnArchives(client, "org_a", [notes("skl_a", "# Notes")], newArchiveCache(1 << 20));
    for (const path of ["skills/other/secret.md", "skills/notes/secret.md", "plugins/x/y", "skills", "../skills/notes/refs/a.md"]) {
      await expect(archives.read(path), path).rejects.toBeInstanceOf(ArchiveFileNotFoundError);
    }
    expect(calls.some((call) => call.includes("skl_other"))).toBe(false);
  });

  it("refuses bytes that do not match the listing's SHA-256, and caches nothing of them", async () => {
    let lie = true;
    const { client } = storeClient({ "skill:skl_a:v1": { "refs/a.md": "A" } }, (_k, _p, real) => (lie ? "forged" : real));
    const cache = newArchiveCache(1 << 20);
    const archives = newTurnArchives(client, "org_a", [notes("skl_a", "# Notes")], cache);
    await expect(archives.read("skills/notes/refs/a.md")).rejects.toThrow(/does not match its listed SHA-256/);
    lie = false;
    expect(text(await archives.read("skills/notes/refs/a.md"))).toBe("A");
  });

  it("serves a file once per organization from the cache, never another organization's entry", async () => {
    const files = { "skill:skl_a:v1": { "refs/a.md": "same bytes" }, "skill:skl_b:v1": { "refs/a.md": "same bytes" } };
    const { client, calls } = storeClient(files);
    const cache = newArchiveCache(1 << 20);
    const first = newTurnArchives(client, "org_a", [notes("skl_a", "# A")], cache);
    await first.read("skills/notes/refs/a.md");
    const again = newTurnArchives(client, "org_a", [notes("skl_a", "# A")], cache);
    await again.read("skills/notes/refs/a.md");
    expect(again.report()).toEqual({ filesRead: 0, bytesReceived: 0, cacheHits: 1 });

    const other = newTurnArchives(client, "org_b", [notes("skl_b", "# B")], cache);
    await other.read("skills/notes/refs/a.md");
    expect(other.report()).toEqual({ filesRead: 1, bytesReceived: "same bytes".length, cacheHits: 0 });
    expect(calls.filter((call) => call.startsWith("read"))).toEqual(["read skill skl_a@v1 refs/a.md", "read skill skl_b@v1 refs/a.md"]);
  });

  it("costs a source whose listing fails that source alone: a skill keeps its SKILL.md, the others still answer, and the next turn asks again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let down = true;
    const { client, calls } = storeClient({ "skill:skl_ok:v1": { "refs/ok.md": "fine" } });
    const flaky: ArchiveFileClient = {
      ...client,
      listSkillFiles: async (id, version) => {
        if (id === "skl_gone" && down) throw new Error("skill archive not found: gone");
        return client.listSkillFiles(id, version);
      },
      listPluginFiles: async () => Promise.reject(new Error("unavailable")),
    };
    const sources: ArchiveSource[] = [
      { ...notes("skl_gone", "# Gone"), dir: "skills/gone" },
      { ...notes("skl_ok", "# Ok"), dir: "skills/ok" },
      kit,
    ];
    const cache = newArchiveCache(1 << 20);
    const archives = newTurnArchives(flaky, "org_a", sources, cache);
    expect((await archives.list()).map((file) => file.path)).toEqual(["skills/gone/SKILL.md", "skills/ok/SKILL.md", "skills/ok/refs/ok.md"]);
    expect(text(await archives.read("skills/gone/SKILL.md"))).toBe("# Gone");
    expect(text(await archives.read("skills/ok/refs/ok.md"))).toBe("fine");
    expect(warn.mock.calls.flat().join(" ")).toContain("the files of skill skl_gone are not listed this turn (its SKILL.md still is)");
    await archives.list();
    expect(calls.filter((call) => call === "list skill skl_ok@v1"), "asked once per turn").toHaveLength(1);

    down = false;
    const next = newTurnArchives(flaky, "org_a", sources, cache);
    await next.list();
    warn.mockRestore();
  });

  it("serves a skill without an archive as its SKILL.md alone, asking the server nothing", async () => {
    const { client, calls } = storeClient({});
    const archives = newTurnArchives(client, "org_a", [{ ...notes("skl_a", "# Only"), hasArchive: false }], newArchiveCache(1 << 20));
    expect((await archives.list()).map((file) => file.path)).toEqual(["skills/notes/SKILL.md"]);
    expect(calls).toEqual([]);
  });

  it("re-lists a head read by an empty version every turn, since it may move", async () => {
    const { client, calls } = storeClient({ "skill:skl_a:": { "refs/a.md": "A" } });
    const cache = newArchiveCache(1 << 20);
    for (let turn = 0; turn < 2; turn += 1) {
      await newTurnArchives(client, "org_a", [{ ...notes("skl_a", "# A"), version: "" }], cache).list();
    }
    expect(calls).toEqual(["list skill skl_a@", "list skill skl_a@"]);
  });

  it("has an empty reader for a turn with no skills or plugins: nothing listed, every file not found", async () => {
    expect(NO_TURN_ARCHIVES.folders).toEqual([]);
    expect(await NO_TURN_ARCHIVES.list()).toEqual([]);
    await expect(NO_TURN_ARCHIVES.read("skills/notes/SKILL.md")).rejects.toBeInstanceOf(ArchiveFileNotFoundError);
  });

  it("logs one line of what the turn read", () => {
    expect(archiveReadLine("run_1", { filesRead: 2, bytesReceived: 4096, cacheHits: 1 })).toBe(
      "[archive-reader] execution=run_1 filesRead=2 bytesReceived=4096 cacheHits=1",
    );
  });
});
