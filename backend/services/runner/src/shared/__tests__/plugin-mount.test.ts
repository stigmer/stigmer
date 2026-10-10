/**
 * Pins the plugin mount (`plugin-mount.ts`) and the archive core it shares
 * with skills (`archive-mount.ts`):
 *  - the archive is cached by digest and trusted only when it hashes to the
 *    installed digest; anything else is fetched again, and a fetch that does
 *    not verify refuses;
 *  - the tree equals the archive, scripts (by extension or `#!`) executable;
 *  - the tamper guard rebuilds the tree after an edit, an added file, a
 *    removed file, a mode change, a file swapped for a link, and a file
 *    replaced together with any marker beside it, because its reference
 *    lives in memory;
 *  - an entry that escapes the mount refuses;
 *  - the eval suite is never mounted: `evals/` always, the directory the
 *    install recorded in `status.evals.dir`, and the archive manifest's own
 *    `experimental.evals` under the library's usability rule (a plain
 *    relative path clear of `skills/` and every declared skill path, so a
 *    skill is never mounted short of its files), each entry
 *    judged by its cleaned root-relative name, so an agent under test
 *    cannot read its cases; the tamper guard holds the tree to the archive
 *    without them, and an archive carrying a suite is never left in the
 *    session's cache, where the shell could unzip it;
 *  - `manifestEvalDir` names the suite directory the library's reader
 *    names, on the table both replay (`@stigmer/plugin-package`
 *    `__tests__/fixtures/eval-dir-parity.json`, found by walking up, since
 *    the runner does not depend on the library).
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { buildZip } from "@stigmer/zip-structure/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StigmerClient } from "../../client/stigmer-client.js";
import { archiveFileMode } from "../archive-mount.js";
import { manifestEvalDir, mountPlugin, PluginMountError, PluginTree, PLUGINS_SUBDIR, withoutEvalSuite } from "../plugin-mount.js";

const FILES = {
  ".claude-plugin/plugin.json": '{"name":"safety"}',
  "hooks/hooks.json": '{"hooks":{}}',
  "hooks/check": "#!/usr/bin/env bash\nexit 0\n",
  "scripts/guard.py": "print('ok')\n",
};

let platformDir: string;
let archive: Uint8Array;
let digest: string;

beforeEach(() => {
  platformDir = mkdtempSync(join(tmpdir(), "plugin-mount-"));
  archive = buildZip(Object.entries(FILES).map(([name, content]) => ({ name, content })));
  digest = createHash("sha256").update(archive).digest("hex");
});
afterEach(() => {
  rmSync(platformDir, { recursive: true, force: true });
});

function pluginRecord(overrides: { digest?: string; key?: string } = {}): Plugin {
  return create(PluginSchema, {
    metadata: { slug: "safety", name: "Safety Rails" },
    status: { digest: overrides.digest ?? digest, artifactStorageKey: overrides.key ?? "plugins/abc.zip" },
  });
}

/** A client whose download lane is absent, so the unary read answers. */
function clientServing(bytes: Uint8Array): StigmerClient & { getPluginArtifact: ReturnType<typeof vi.fn> } {
  return {
    getPluginArtifactDownloadUrl: vi.fn(async () => {
      throw new ConnectError("no lane", Code.Unimplemented);
    }),
    getPluginArtifact: vi.fn(async () => ({ artifact: bytes })),
  } as unknown as StigmerClient & { getPluginArtifact: ReturnType<typeof vi.fn> };
}

describe("mountPlugin", () => {
  it("mounts the verified archive as a tree, scripts executable, and caches the archive", async () => {
    const client = clientServing(archive);
    const mounted = await mountPlugin(client, pluginRecord(), platformDir);
    expect(mounted).toMatchObject({ slug: "safety", name: "Safety Rails" });
    expect(mounted.root).toBe(join(platformDir, PLUGINS_SUBDIR, digest));
    expect(readFileSync(join(mounted.root, "hooks/hooks.json"), "utf-8")).toBe(FILES["hooks/hooks.json"]);
    expect(statSync(join(mounted.root, "hooks/check")).mode & 0o100).toBe(0o100);
    expect(statSync(join(mounted.root, "hooks/hooks.json")).mode & 0o100).toBe(0);
    expect(existsSync(mounted.data)).toBe(true);
    expect(existsSync(join(platformDir, PLUGINS_SUBDIR, `${digest}.zip`))).toBe(true);

    await mountPlugin(client, pluginRecord(), platformDir);
    expect(client.getPluginArtifact).toHaveBeenCalledTimes(1);
  });

  it("fetches again when the cached archive no longer hashes to the digest", async () => {
    const client = clientServing(archive);
    await mountPlugin(client, pluginRecord(), platformDir);
    writeFileSync(join(platformDir, PLUGINS_SUBDIR, `${digest}.zip`), "tampered");
    const mounted = await mountPlugin(client, pluginRecord(), platformDir);
    expect(client.getPluginArtifact).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(mounted.root, "hooks/check"), "utf-8")).toBe(FILES["hooks/check"]);
  });

  it("refuses an archive that does not match the installed digest", async () => {
    await expect(mountPlugin(clientServing(archive), pluginRecord({ digest: "0".repeat(64) }), platformDir)).rejects.toThrow(
      "the plugin 'safety' could not be mounted: the fetched archive does not match the installed version's digest",
    );
  });

  it("refuses a plugin with no installed archive, or a server with no bytes", async () => {
    await expect(mountPlugin(clientServing(archive), pluginRecord({ key: "" }), platformDir)).rejects.toBeInstanceOf(PluginMountError);
    await expect(mountPlugin(clientServing(new Uint8Array()), pluginRecord(), platformDir)).rejects.toThrow("the server holds no archive");
  });

  it("refuses when the archive cannot be fetched", async () => {
    const client = {
      getPluginArtifactDownloadUrl: vi.fn(async () => {
        throw new ConnectError("denied", Code.PermissionDenied);
      }),
    } as unknown as StigmerClient;
    await expect(mountPlugin(client, pluginRecord(), platformDir)).rejects.toThrow("its archive could not be fetched");
  });

  it("refuses an archive holding no files", async () => {
    const empty = buildZip([]);
    const emptyDigest = createHash("sha256").update(empty).digest("hex");
    await expect(mountPlugin(clientServing(empty), pluginRecord({ digest: emptyDigest }), platformDir)).rejects.toThrow("holds no files");
  });
});

describe("the tamper guard", () => {
  let tree: PluginTree;
  const entries = () => Object.entries(FILES).map(([path, text]) => ({ path, content: new TextEncoder().encode(text) }));

  beforeEach(async () => {
    tree = new PluginTree(join(platformDir, "tree"), entries());
    await tree.verify();
  });

  const read = (path: string) => readFileSync(join(tree.root, path), "utf-8");

  it("rebuilds an edited file, even at the same size", async () => {
    writeFileSync(join(tree.root, "hooks/check"), "#!/usr/bin/env bash\nexit 7\n");
    await tree.verify();
    expect(read("hooks/check")).toBe(FILES["hooks/check"]);
  });

  it("removes an added file and restores a removed one", async () => {
    writeFileSync(join(tree.root, "hooks/extra.sh"), "echo injected");
    unlinkSync(join(tree.root, "scripts/guard.py"));
    await tree.verify();
    expect(existsSync(join(tree.root, "hooks/extra.sh"))).toBe(false);
    expect(read("scripts/guard.py")).toBe(FILES["scripts/guard.py"]);
  });

  it("replaces a file the shell swapped for a link", async () => {
    unlinkSync(join(tree.root, "hooks/check"));
    symlinkSync("/bin/sh", join(tree.root, "hooks/check"));
    await tree.verify();
    expect(lstatSync(join(tree.root, "hooks/check")).isFile()).toBe(true);
    expect(read("hooks/check")).toBe(FILES["hooks/check"]);
  });

  it("restores the executable bit a shell took away", async () => {
    chmodSync(join(tree.root, "hooks/check"), 0o644);
    await tree.verify();
    expect(statSync(join(tree.root, "hooks/check")).mode & 0o100).toBe(0o100);
  });

  it("rebuilds whatever a marker beside the tree claims, since the reference is in memory", async () => {
    writeFileSync(join(tree.root, ".stigmer-mount.json"), JSON.stringify({ versionHash: "forged" }));
    writeFileSync(join(tree.root, "hooks/hooks.json"), '{"hooks":{"PreToolUse":[]}}');
    await tree.verify();
    expect(read("hooks/hooks.json")).toBe(FILES["hooks/hooks.json"]);
    expect(existsSync(join(tree.root, ".stigmer-mount.json"))).toBe(false);
  });

  it("rebuilds a tree removed whole", async () => {
    rmSync(tree.root, { recursive: true, force: true });
    await tree.verify();
    expect(read("hooks/check")).toBe(FILES["hooks/check"]);
  });

  it("leaves an untouched tree alone, and shares one check between concurrent callers", async () => {
    const before = statSync(join(tree.root, "hooks/check")).ino;
    await Promise.all([tree.verify(), tree.verify(), tree.verify()]);
    expect(statSync(join(tree.root, "hooks/check")).ino).toBe(before);
  });

  it("refuses an entry that escapes the mount", () => {
    expect(() => new PluginTree(join(platformDir, "tree2"), [{ path: "../outside", content: new Uint8Array([1]) }])).toThrow(
      "plugin archive entry escapes its mount directory",
    );
  });
});

describe("archiveFileMode", () => {
  it("makes a script executable by extension or by its #! line", () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(archiveFileMode("hooks/run.sh", text(""))).toBe(0o755);
    expect(archiveFileMode("hooks/check", text("#!/bin/sh\n"))).toBe(0o755);
    expect(archiveFileMode("README", text("# readme"))).toBe(0o644);
    expect(archiveFileMode("x", new Uint8Array([0x23]))).toBe(0o644);
  });
});

describe("the eval suite is not mounted", () => {
  const suiteFiles = {
    ...FILES,
    "evals/first-case/prompt.md": "Write me a commit message.",
    "evals/first-case/graders/criteria.md": "---\ntype: llm\n---\nPASS if it is imperative.",
    "quality/evals/other/prompt.md": "Say hello.",
    "quality/notes.md": "kept",
    "evalsbook/readme.md": "kept: only the directory itself is skipped",
  };

  function suitePlugin(bytes: Uint8Array, evalsDir: string | undefined): Plugin {
    return create(PluginSchema, {
      metadata: { slug: "safety", name: "Safety Rails" },
      status: {
        digest: createHash("sha256").update(bytes).digest("hex"),
        artifactStorageKey: "plugins/abc.zip",
        ...(evalsDir !== undefined && { evals: { dir: evalsDir } }),
      },
    });
  }

  it("leaves evals/ and a configured quality/evals out of the tree, and keeps it so across checks", async () => {
    const bytes = buildZip(Object.entries(suiteFiles).map(([name, content]) => ({ name, content })));
    const mounted = await mountPlugin(clientServing(bytes), suitePlugin(bytes, "quality/evals"), platformDir);
    expect(existsSync(join(mounted.root, "evals"))).toBe(false);
    expect(existsSync(join(mounted.root, "quality/evals"))).toBe(false);
    expect(readFileSync(join(mounted.root, "quality/notes.md"), "utf-8")).toBe("kept");
    expect(existsSync(join(mounted.root, "evalsbook/readme.md"))).toBe(true);
    expect(readFileSync(join(mounted.root, "hooks/hooks.json"), "utf-8")).toBe(FILES["hooks/hooks.json"]);

    // The guard's reference is the tree without the suite: an intact tree is
    // not rebuilt, and a suite file planted into it is removed.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await mounted.verify();
    expect(warn).not.toHaveBeenCalled();
    writeFileSync(join(mounted.root, "hooks/planted.md"), "x");
    await mounted.verify();
    expect(existsSync(join(mounted.root, "hooks/planted.md"))).toBe(false);
    warn.mockRestore();
  });

  it("skips evals/ even when the install recorded no suite, and mounts a directory no manifest moved the suite to", async () => {
    const bytes = buildZip(Object.entries(suiteFiles).map(([name, content]) => ({ name, content })));
    const mounted = await mountPlugin(clientServing(bytes), suitePlugin(bytes, undefined), platformDir);
    expect(existsSync(join(mounted.root, "evals"))).toBe(false);
    expect(existsSync(join(mounted.root, "quality/evals/other/prompt.md"))).toBe(true);
  });

  it("reads the manifest's experimental.evals itself for a plugin whose install recorded no suite directory", async () => {
    for (const manifest of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
      const files = { ...suiteFiles, ".claude-plugin/plugin.json": '{"name":"safety"}', [manifest]: '{"name":"safety","experimental":{"evals":"quality/evals"}}' };
      const bytes = buildZip(Object.entries(files).map(([name, content]) => ({ name, content })));
      const root = join(platformDir, manifest.slice(1, 7));
      const mounted = await mountPlugin(clientServing(bytes), suitePlugin(bytes, undefined), root);
      expect(existsSync(join(mounted.root, "quality/evals")), manifest).toBe(false);
      expect(existsSync(join(mounted.root, "evals")), manifest).toBe(false);
      expect(readFileSync(join(mounted.root, "quality/notes.md"), "utf-8"), manifest).toBe("kept");
    }
  });

  it("falls back to evals/ alone when the manifest's experimental.evals is unusable, as the library does", async () => {
    const unusable = ["../outside", "/abs", "quality//evals", "./quality/evals", 7, "quality\\evals"];
    for (const value of unusable) {
      const files = { ...suiteFiles, ".claude-plugin/plugin.json": JSON.stringify({ name: "safety", experimental: { evals: value } }) };
      const bytes = buildZip(Object.entries(files).map(([name, content]) => ({ name, content })));
      const root = join(platformDir, `u${unusable.indexOf(value)}`);
      const mounted = await mountPlugin(clientServing(bytes), suitePlugin(bytes, undefined), root);
      expect(existsSync(join(mounted.root, "evals")), String(value)).toBe(false);
      expect(existsSync(join(mounted.root, "quality/evals/other/prompt.md")), String(value)).toBe(true);
    }
  });

  it("mounts every skill whole when the manifest's experimental.evals overlaps the skills, as the library refuses it", async () => {
    const skillFiles = {
      ...suiteFiles,
      "skills/alpha/SKILL.md": "---\nname: alpha\n---\nbody",
      "skills/alpha/references/REF.md": "ref",
      "extra/one/SKILL.md": "---\nname: one\n---\nbody",
    };
    const cases: [string, Record<string, string>][] = [
      ["skills", { ".claude-plugin/plugin.json": '{"name":"safety","experimental":{"evals":"skills"}}' }],
      ["skills/alpha/references", { ".claude-plugin/plugin.json": '{"name":"safety","experimental":{"evals":"skills/alpha/references"}}' }],
      ["extra (claude)", { ".claude-plugin/plugin.json": '{"name":"safety","skills":"./extra/","experimental":{"evals":"extra"}}' }],
      [
        "extra/one (cursor declares)",
        {
          ".claude-plugin/plugin.json": '{"name":"safety","experimental":{"evals":"extra/one"}}',
          ".cursor-plugin/plugin.json": '{"name":"safety","skills":["./docs", "./extra"]}',
        },
      ],
      ["ancestor (codex declares)", { ".codex-plugin/plugin.json": '{"name":"safety","skills":["./extra/one"],"experimental":{"evals":"extra"}}' }],
    ];
    for (const [label, manifests] of cases) {
      const files = { ...skillFiles, ".claude-plugin/plugin.json": '{"name":"safety"}', ...manifests };
      const bytes = buildZip(Object.entries(files).map(([name, content]) => ({ name, content })));
      const root = join(platformDir, createHash("sha256").update(label).digest("hex").slice(0, 8));
      const mounted = await mountPlugin(clientServing(bytes), suitePlugin(bytes, "evals"), root);
      expect(existsSync(join(mounted.root, "skills/alpha/SKILL.md")), label).toBe(true);
      expect(existsSync(join(mounted.root, "skills/alpha/references/REF.md")), label).toBe(true);
      expect(existsSync(join(mounted.root, "extra/one/SKILL.md")), label).toBe(true);
      expect(existsSync(join(mounted.root, "evals")), label).toBe(false);
    }
  });

  it("moves the suite beside the skills, and inside a plugin declared as one root skill", async () => {
    const cases: [string, string][] = [
      ["skills-tests", '{"name":"safety","skills":"./x/../","experimental":{"evals":"skills-tests"}}'],
      ["quality/evals", '{"name":"safety","skills":["./"],"experimental":{"evals":"quality/evals"}}'],
      ["quality/evals", '{"name":"safety","skills":".","experimental":{"evals":"quality/evals"}}'],
      ["quality/evals", '{"name":"safety","skills":[".//", "./quality*", "quality"],"experimental":{"evals":"quality/evals"}}'],
      ["quality/evals", '{"name":"safety","skills":["./quality", 3],"experimental":{"evals":"quality/evals"}}'],
      ["quality/evals", '{"name":"safety","skills":{"a":"./quality"},"experimental":{"evals":"quality/evals"}}'],
    ];
    for (const [dir, manifest] of cases) {
      const files = { ...suiteFiles, "skills-tests/c/prompt.md": "Hi.", ".claude-plugin/plugin.json": manifest };
      const bytes = buildZip(Object.entries(files).map(([name, content]) => ({ name, content })));
      const root = join(platformDir, createHash("sha256").update(manifest).digest("hex").slice(0, 8));
      const mounted = await mountPlugin(clientServing(bytes), suitePlugin(bytes, undefined), root);
      expect(existsSync(join(mounted.root, dir)), manifest).toBe(false);
    }
  });

  it("mounts everything but evals/ when the manifest cannot be read or carries no evals key", async () => {
    for (const text of ["{not json", '["a list"]', '{"name":"safety","experimental":"x"}', '{"name":"safety","experimental":{}}']) {
      const files = { ...suiteFiles, ".claude-plugin/plugin.json": text };
      const bytes = buildZip(Object.entries(files).map(([name, content]) => ({ name, content })));
      const root = join(platformDir, createHash("sha256").update(text).digest("hex").slice(0, 8));
      const mounted = await mountPlugin(clientServing(bytes), suitePlugin(bytes, undefined), root);
      expect(existsSync(join(mounted.root, "evals")), text).toBe(false);
      expect(existsSync(join(mounted.root, "quality/evals/other/prompt.md")), text).toBe(true);
    }
  });

  it("reads a declared skill path of a long slash run in linear time", () => {
    const skills = `./${"/".repeat(40_000)}x`;
    const manifest = JSON.stringify({ name: "safety", skills, experimental: { evals: "quality/evals" } });
    const entries = [{ path: ".claude-plugin/plugin.json", content: new TextEncoder().encode(manifest) }];
    const started = performance.now();
    expect(manifestEvalDir(entries)).toBe("quality/evals");
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("skips a suite entry by its cleaned, root-relative path, as the server's reader names it", () => {
    const names = ["./evals/c/prompt.md", "x/../evals/c/prompt.md", "evals\\c\\prompt.md", "./qa/c.md", "a/./../qa/d.md", "evals/../kept.md"];
    const entries = names.map((path) => ({ path, content: new Uint8Array() }));
    expect(withoutEvalSuite(entries, "qa").map((e) => e.path)).toEqual(["evals/../kept.md"]);
  });

  it("never caches an archive carrying a suite, and removes a cached copy an earlier runner left", async () => {
    const bytes = buildZip(Object.entries(suiteFiles).map(([name, content]) => ({ name, content })));
    const plugin = suitePlugin(bytes, undefined);
    const cachePath = join(platformDir, PLUGINS_SUBDIR, `${plugin.status?.digest ?? ""}.zip`);
    await mountPlugin(clientServing(bytes), plugin, platformDir);
    expect(existsSync(cachePath)).toBe(false);

    writeFileSync(cachePath, bytes);
    await mountPlugin(clientServing(bytes), plugin, platformDir);
    expect(existsSync(cachePath)).toBe(false);
  });

  it("filters by directory, never by name prefix", () => {
    const entries = ["evals/a.md", "evals", "evalsx/b.md", "qa/c.md", "qa-more/d.md"].map((path) => ({ path, content: new Uint8Array() }));
    expect(withoutEvalSuite(entries, "qa").map((e) => e.path)).toEqual(["evals", "evalsx/b.md", "qa-more/d.md"]);
  });
});

interface ParityCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly dir: string;
}

/** The library's eval-dir table, found by walking up from this file to the repository's libs. */
function parityTable(): readonly ParityCase[] {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "backend", "libs", "ts", "plugin-package", "src", "__tests__", "fixtures", "eval-dir-parity.json");
    if (existsSync(candidate)) return (JSON.parse(readFileSync(candidate, "utf8")) as { cases: readonly ParityCase[] }).cases;
    dir = dirname(dir);
  }
  throw new Error("could not locate the plugin-package eval-dir parity table");
}

describe("manifestEvalDir, on the table the library's reader also replays", () => {
  it.each(parityTable().map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const entries = Object.entries(c.files).map(([path, content]) => ({ path, content: new TextEncoder().encode(content) }));
    expect(manifestEvalDir(entries) ?? "evals").toBe(c.dir);
  });
});
