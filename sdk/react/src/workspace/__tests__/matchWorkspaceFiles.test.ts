import { describe, it, expect } from "vitest";
import { matchWorkspaceFiles } from "../matchWorkspaceFiles";
import type { WorkspaceFileEntry } from "../WorkspaceFileLister";

function file(path: string): WorkspaceFileEntry {
  return { path, isDirectory: false };
}

describe("matchWorkspaceFiles", () => {
  it("returns [] for an empty or whitespace query", () => {
    const files = [file("src/index.ts")];
    expect(matchWorkspaceFiles(files, "")).toEqual([]);
    expect(matchWorkspaceFiles(files, "   ")).toEqual([]);
  });

  it("matches case-insensitively on the full relative path", () => {
    const files = [file("src/Components/Button.tsx")];
    const result = matchWorkspaceFiles(files, "button");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/Components/Button.tsx");
  });

  it("finds files by a cross-segment path substring", () => {
    const files = [file("src/utils/helper.ts"), file("README.md")];
    const result = matchWorkspaceFiles(files, "utils/helper");
    expect(result.map((m) => m.path)).toEqual(["src/utils/helper.ts"]);
  });

  it("excludes directories", () => {
    const files: WorkspaceFileEntry[] = [
      { path: "src", isDirectory: true },
      { path: "src/index.ts", isDirectory: false },
    ];
    const result = matchWorkspaceFiles(files, "src");
    expect(result.map((m) => m.path)).toEqual(["src/index.ts"]);
  });

  it("excludes advisory notice entries even if the query matches the message", () => {
    const files: WorkspaceFileEntry[] = [
      { path: "src/tree.ts", isDirectory: false },
      { path: "... (tree truncated by GitHub — repository has too many files)", isDirectory: false, notice: true },
    ];
    const result = matchWorkspaceFiles(files, "tree");
    expect(result.map((m) => m.path)).toEqual(["src/tree.ts"]);
  });

  it("returns [] when nothing matches", () => {
    expect(matchWorkspaceFiles([file("src/index.ts")], "zzz")).toEqual([]);
  });

  it("reports the contiguous highlight range as code-unit offsets", () => {
    const [m] = matchWorkspaceFiles([file("src/index.ts")], "index");
    expect(m.matchStart).toBe(4);
    expect(m.matchEnd).toBe(9);
    expect("src/index.ts".slice(m.matchStart, m.matchEnd)).toBe("index");
  });

  it("ranks a basename hit above a path-only hit", () => {
    const files = [
      file("app/main.ts"), // "app" is only in the dir segment (path-only)
      file("src/app.ts"), // "app" is the basename
    ];
    const result = matchWorkspaceFiles(files, "app");
    expect(result[0].path).toBe("src/app.ts");
    expect(result[1].path).toBe("app/main.ts");
  });

  it("ranks an earlier match offset first among basename hits", () => {
    const files = [file("src/index.ts"), file("index.ts")];
    const result = matchWorkspaceFiles(files, "index");
    // "index.ts" matches at offset 0; "src/index.ts" at offset 4.
    expect(result.map((m) => m.path)).toEqual(["index.ts", "src/index.ts"]);
  });

  it("breaks ties by shorter path then lexicographically", () => {
    const files = [
      file("b/thing.ts"),
      file("a/thing.ts"),
      file("thing.ts"),
    ];
    const result = matchWorkspaceFiles(files, "thing");
    // "thing.ts" (offset 0) first; the two offset-2 hits tie on length → lexicographic.
    expect(result.map((m) => m.path)).toEqual([
      "thing.ts",
      "a/thing.ts",
      "b/thing.ts",
    ]);
  });

  it("handles unicode paths and slices the range consistently", () => {
    const files = [file("src/café/résumé.ts")];
    const [m] = matchWorkspaceFiles(files, "résumé");
    expect(m).toBeDefined();
    expect("src/café/résumé.ts".slice(m.matchStart, m.matchEnd)).toBe("résumé");
  });

  it("is deterministic regardless of input order", () => {
    const a = [file("z.ts"), file("a.ts"), file("m.ts")];
    const b = [file("a.ts"), file("m.ts"), file("z.ts")];
    const qa = matchWorkspaceFiles(a, ".ts").map((m) => m.path);
    const qb = matchWorkspaceFiles(b, ".ts").map((m) => m.path);
    expect(qa).toEqual(qb);
  });
});
