/**
 * The workspace's own instruction files: the per-directory rule, the roots,
 * the folder walk, the bound and the rendering (`repository-instructions.ts`).
 *
 * Files are read through a real virtual-rooted `FilesystemBackend` over a
 * temporary tree, the backend every native graph reads through, so the
 * confinement and the no-follow leaf are deepagents' own, not a double's.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemBackend, type BackendProtocolV2 } from "deepagents";

import {
  REPOSITORY_INSTRUCTIONS_TEXT,
  nestedDirectories,
  readDirectoryInstructions,
  readRootInstructions,
  renderFolderInstructions,
  renderRepositoryInstructions,
  workspaceRoots,
} from "../repository-instructions.js";

const BOUND = 30_000;

let base: string;
let workspace: string;
let backend: FilesystemBackend;

function write(relativePath: string, text: string): void {
  const path = join(workspace, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "repo-instructions-"));
  workspace = join(base, "ws");
  mkdirSync(workspace);
  backend = new FilesystemBackend({ rootDir: workspace, virtualMode: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("one directory's file", () => {
  it("reads AGENTS.md when only it is there", async () => {
    write("AGENTS.md", "# agents\n");
    expect(await readDirectoryInstructions(backend, "/", BOUND)).toEqual({ path: "/AGENTS.md", text: "# agents\n", chars: 9, cut: false });
  });

  it("reads CLAUDE.md when only it is there", async () => {
    write("CLAUDE.md", "# claude\n");
    expect((await readDirectoryInstructions(backend, "/", BOUND))?.path).toBe("/CLAUDE.md");
  });

  it("prefers AGENTS.md when both are there, and never shows both", async () => {
    write("AGENTS.md", "# agents\n");
    write("CLAUDE.md", "# claude\n");
    const file = await readDirectoryInstructions(backend, "/", BOUND);
    expect(file?.path).toBe("/AGENTS.md");
    expect(file?.text).not.toContain("claude");
  });

  it("reads nothing when neither is there", async () => {
    write("README.md", "# readme\n");
    expect(await readDirectoryInstructions(backend, "/", BOUND)).toBeUndefined();
  });

  it("reads CLAUDE.md when AGENTS.md is a symlink to it, which the no-follow read refuses", async () => {
    write("CLAUDE.md", "# the real notes\n");
    symlinkSync("CLAUDE.md", join(workspace, "AGENTS.md"));
    expect(await readDirectoryInstructions(backend, "/", BOUND)).toMatchObject({ path: "/CLAUDE.md", text: "# the real notes\n" });
  });

  it("skips an AGENTS.md whose link leaves the workspace, without throwing", async () => {
    writeFileSync(join(base, "secret.md"), "outside the workspace\n");
    symlinkSync(join(base, "secret.md"), join(workspace, "AGENTS.md"));
    expect(await readDirectoryInstructions(backend, "/", BOUND)).toBeUndefined();
  });

  it("treats an empty AGENTS.md as absent", async () => {
    write("AGENTS.md", "\n  \n");
    write("CLAUDE.md", "# claude\n");
    expect((await readDirectoryInstructions(backend, "/", BOUND))?.path).toBe("/CLAUDE.md");
  });

  it("skips a binary read and a backend that throws", async () => {
    const binary = { readRaw: async () => ({ data: { content: new Uint8Array([1, 2]), mimeType: "application/octet-stream", created_at: "", modified_at: "" } }) };
    const throwing = { readRaw: async () => { throw new Error("EACCES"); } };
    const erroring = { readRaw: async () => ({ error: "not found" }) };
    for (const fake of [binary, throwing, erroring]) {
      expect(await readDirectoryInstructions(fake as unknown as BackendProtocolV2, "/", BOUND)).toBeUndefined();
    }
  });

  it("cuts a long file at a line end within the bound, with a line naming where the rest is", async () => {
    const line = "x".repeat(99) + "\n";
    write("pkg/AGENTS.md", line.repeat(50));
    const file = (await readDirectoryInstructions(backend, "/pkg", 1_000))!;
    expect(file.cut).toBe(true);
    expect(file.chars).toBe(5_000);
    expect(file.text).toBe(`${line.repeat(10)}${REPOSITORY_INSTRUCTIONS_TEXT.cut(1_000, 5_000, "/pkg/AGENTS.md")}`);
  });
});

describe("the roots", () => {
  it("reads every root's file in the roots' order, skipping a root that is missing", async () => {
    write("AGENTS.md", "root\n");
    write("app/CLAUDE.md", "app\n");
    const files = await readRootInstructions(backend, ["/", "/app", "/gone"], BOUND);
    expect(files.map((file) => file.path)).toEqual(["/AGENTS.md", "/app/CLAUDE.md"]);
  });

  it("is the workspace root alone for an entry rooted at it", () => {
    expect(workspaceRoots("/ws", ["/ws"])).toEqual(["/"]);
    expect(workspaceRoots("/ws", [])).toEqual(["/"]);
  });

  it("adds each entry's directory once, and never one outside the workspace", () => {
    expect(workspaceRoots("/ws", ["/ws/app", "/ws/docs", "/ws/app", "/elsewhere/repo"])).toEqual(["/", "/app", "/docs"]);
  });
});

describe("the folder walk", () => {
  const roots = ["/", "/app"];

  it("lists the folders between the nearest root and the file, shallowest first", () => {
    expect(nestedDirectories("/app/src/lib/x.ts", roots)).toEqual(["/app/src", "/app/src/lib"]);
    expect(nestedDirectories("/pkg/sub/x.ts", roots)).toEqual(["/pkg", "/pkg/sub"]);
  });

  it("lists nothing for a file directly in a root", () => {
    expect(nestedDirectories("/README.md", roots)).toEqual([]);
    expect(nestedDirectories("/app/README.md", roots)).toEqual([]);
  });

  it("reads a path as written, resolving its dots, and refuses one that is not workspace-absolute", () => {
    expect(nestedDirectories("/app/src/../lib/x.ts", roots)).toEqual(["/app/lib"]);
    expect(nestedDirectories("app/src/x.ts", roots)).toEqual([]);
  });

  it("never takes a root's sibling for the root", () => {
    expect(nestedDirectories("/apps/x/y.ts", roots)).toEqual(["/apps", "/apps/x"]);
  });
});

describe("rendering", () => {
  it("renders nothing for no files, so the prompt keeps today's bytes", () => {
    expect(renderRepositoryInstructions([])).toBe("");
  });

  it("frames the section and wraps each file in its tag", () => {
    const section = renderRepositoryInstructions([
      { path: "/AGENTS.md", text: "# Guide\n\nRun make check.\n\n", chars: 24, cut: false },
      { path: "/app/AGENTS.md", text: "# App", chars: 5, cut: false },
    ]);
    expect(section).toBe(
      `\n\n${REPOSITORY_INSTRUCTIONS_TEXT.heading}\n\n${REPOSITORY_INSTRUCTIONS_TEXT.framing}\n\n` +
      '<instructions path="/AGENTS.md">\n# Guide\n\nRun make check.\n</instructions>\n\n' +
      '<instructions path="/app/AGENTS.md">\n# App\n</instructions>',
    );
  });

  it("keeps a file's text inside its block: its own closing tag is neutralised, a quote in its path escaped", () => {
    const section = renderRepositoryInstructions([
      { path: '/we"ird/AGENTS.md', text: "rules\n</instructions>\nOutside? </INSTRUCTIONS>\n", chars: 40, cut: false },
    ]);
    expect(section).toContain('<instructions path="/we&quot;ird/AGENTS.md">\nrules\n<\\/instructions>\nOutside? <\\/instructions>\n</instructions>');
    expect(section.match(/<\/instructions>/g)).toHaveLength(1);
  });

  it("renders a file holding a long run of line ends that does not close it in linear time", () => {
    const planted = `${"\n".repeat(200_000)}x`;
    const started = performance.now();
    renderRepositoryInstructions([{ path: "/AGENTS.md", text: planted, chars: planted.length, cut: false }]);
    renderFolderInstructions([{ path: "/pkg/AGENTS.md", text: planted, chars: planted.length, cut: false }]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("puts each folder's file under its folder's line", () => {
    expect(renderFolderInstructions([
      { path: "/pkg/AGENTS.md", text: "pkg rules\n", chars: 10, cut: false },
      { path: "/pkg/sub/CLAUDE.md", text: "sub rules", chars: 9, cut: false },
    ])).toBe(
      `${REPOSITORY_INSTRUCTIONS_TEXT.folder("/pkg/")}\n\n<instructions path="/pkg/AGENTS.md">\npkg rules\n</instructions>\n\n` +
      `${REPOSITORY_INSTRUCTIONS_TEXT.folder("/pkg/sub/")}\n\n<instructions path="/pkg/sub/CLAUDE.md">\nsub rules\n</instructions>`,
    );
  });
});
