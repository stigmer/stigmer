import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildWorkspaceFileTree } from "../file-tree.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ft-test-"));
}

describe("buildWorkspaceFileTree", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── Basic tree generation ──────────────────────────────────────────

  it("returns null for empty directory", () => {
    expect(buildWorkspaceFileTree(root)).toBeNull();
  });

  it("lists files in a flat directory", () => {
    writeFileSync(join(root, "README.md"), "hello");
    writeFileSync(join(root, "index.ts"), "code");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).toContain("README.md");
    expect(tree).toContain("index.ts");
  });

  it("lists directories with trailing slash", () => {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "main.ts"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).toContain("src/");
    expect(tree).toContain("  main.ts");
  });

  it("includes Project Structure heading", () => {
    writeFileSync(join(root, "file.txt"), "");
    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).toContain("### Project Structure");
  });

  it("wraps tree in code fences", () => {
    writeFileSync(join(root, "file.txt"), "");
    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).toContain("```\n");
    expect(tree.endsWith("```")).toBe(true);
  });

  // ── Heading level ─────────────────────────────────────────────────

  it("respects custom heading level", () => {
    writeFileSync(join(root, "file.txt"), "");
    const tree = buildWorkspaceFileTree(root, { headingLevel: 2 })!;
    expect(tree).toContain("## Project Structure");
  });

  // ── Default ignores ───────────────────────────────────────────────

  it("ignores node_modules", () => {
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "pkg.js"), "");
    writeFileSync(join(root, "app.ts"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).not.toContain("node_modules");
    expect(tree).toContain("app.ts");
  });

  it("ignores .git directory", () => {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "config"), "");
    writeFileSync(join(root, "src.ts"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).not.toContain(".git");
  });

  it("ignores __pycache__", () => {
    mkdirSync(join(root, "__pycache__"));
    writeFileSync(join(root, "main.py"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).not.toContain("__pycache__");
  });

  it("ignores hidden files (dotfiles) by default", () => {
    writeFileSync(join(root, ".eslintrc"), "");
    writeFileSync(join(root, "visible.ts"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).not.toContain(".eslintrc");
    expect(tree).toContain("visible.ts");
  });

  it("allows .env.example as exception to dotfile rule", () => {
    writeFileSync(join(root, ".env.example"), "");
    writeFileSync(join(root, "app.ts"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).toContain(".env.example");
  });

  // ── .gitignore support ────────────────────────────────────────────

  it("respects .gitignore patterns (file name match)", () => {
    writeFileSync(join(root, ".gitignore"), "coverage\n");
    mkdirSync(join(root, "coverage"));
    writeFileSync(join(root, "coverage", "report.html"), "");
    writeFileSync(join(root, "src.ts"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).not.toContain("coverage");
    expect(tree).toContain("src.ts");
  });

  it("respects .gitignore patterns with trailing slash", () => {
    writeFileSync(join(root, ".gitignore"), "tmp/\n");
    mkdirSync(join(root, "tmp"));
    writeFileSync(join(root, "tmp", "scratch.txt"), "");
    writeFileSync(join(root, "keep.txt"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).not.toContain("tmp");
    expect(tree).toContain("keep.txt");
  });

  it("ignores comments in .gitignore", () => {
    writeFileSync(join(root, ".gitignore"), "# a comment\nignored.txt\n");
    writeFileSync(join(root, "ignored.txt"), "");
    writeFileSync(join(root, "kept.txt"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).not.toContain("ignored.txt");
    expect(tree).toContain("kept.txt");
  });

  // ── Depth limiting ────────────────────────────────────────────────

  it("respects maxDepth option", () => {
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "a", "b"));
    mkdirSync(join(root, "a", "b", "c"));
    writeFileSync(join(root, "a", "b", "c", "deep.txt"), "");

    const shallow = buildWorkspaceFileTree(root, { maxDepth: 1 })!;
    expect(shallow).toContain("a/");
    expect(shallow).toContain("b/");
    expect(shallow).not.toContain("deep.txt");
  });

  // ── Entry limiting / truncation ───────────────────────────────────

  it("truncates when maxEntries is exceeded", () => {
    for (let i = 0; i < 15; i++) {
      writeFileSync(join(root, `file-${String(i).padStart(2, "0")}.txt`), "");
    }

    const tree = buildWorkspaceFileTree(root, { maxEntries: 5 })!;
    expect(tree).toContain("... (truncated)");
  });

  it("does not show truncation when under limit", () => {
    writeFileSync(join(root, "a.txt"), "");
    writeFileSync(join(root, "b.txt"), "");

    const tree = buildWorkspaceFileTree(root, { maxEntries: 10 })!;
    expect(tree).not.toContain("truncated");
  });

  // ── Nested structure ──────────────────────────────────────────────

  it("indents nested entries", () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "src", "utils"));
    writeFileSync(join(root, "src", "utils", "helper.ts"), "");

    const tree = buildWorkspaceFileTree(root)!;
    expect(tree).toContain("src/");
    expect(tree).toContain("  utils/");
    expect(tree).toContain("    helper.ts");
  });

  it("sorts entries alphabetically", () => {
    writeFileSync(join(root, "zebra.txt"), "");
    writeFileSync(join(root, "apple.txt"), "");
    writeFileSync(join(root, "mango.txt"), "");

    const tree = buildWorkspaceFileTree(root)!;
    const lines = tree.split("\n").filter(l => l.includes(".txt"));
    expect(lines[0]).toContain("apple.txt");
    expect(lines[1]).toContain("mango.txt");
    expect(lines[2]).toContain("zebra.txt");
  });

  // ── Non-existent root ─────────────────────────────────────────────

  it("returns null for non-existent directory", () => {
    expect(buildWorkspaceFileTree("/nonexistent/path")).toBeNull();
  });
});
