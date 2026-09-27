// Unit arms for the end-state readers, over temp directories and a scripted
// command runner.
// Domain: conformance benchmark.
//
// Pinned: the comparison lists added, modified and deleted files, sorted by
// code point,
// ignores an empty directory (what Cursor's teardown can leave), and counts a
// symbolic link as an entry of its own without following it; a named file
// reads as its content or null; `go_test` runs `go test ./...` in the
// workspace with GOWORK=off and reads passed, failed with the exit code and
// the output's tail, or not-run by name when `go` is absent.
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFiles, readWorkspaceFile, runChecks, type CommandRunner } from "../workspace-facts";

let base: string;
let before: string;
let after: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "workspace-facts-"));
  before = join(base, "before");
  after = join(base, "after");
  for (const root of [before, after]) {
    await mkdir(join(root, "duration"), { recursive: true });
    await writeFile(join(root, "README.md"), "# orders-sync\n");
    await writeFile(join(root, "duration", "duration.go"), "package duration\n");
    await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n");
  }
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("changedFiles", () => {
  it("is empty for an untouched copy", async () => {
    expect(await changedFiles(before, after)).toEqual([]);
  });

  it("lists added, modified and deleted files sorted by path, and ignores an empty directory", async () => {
    await writeFile(join(after, "duration", "duration.go"), "package duration\n\nfunc X() {}\n");
    await writeFile(join(after, "NOTES.md"), "notes\n");
    await rm(join(after, "CHANGELOG.md"));
    await mkdir(join(after, ".cursor", "rules"), { recursive: true });
    expect(await changedFiles(before, after)).toEqual([
      { path: "CHANGELOG.md", change: "deleted" },
      { path: "NOTES.md", change: "added" },
      { path: "duration/duration.go", change: "modified" },
    ]);
  });

  it("lists a file left in a runner-owned directory, and a link, without following the link", async () => {
    await mkdir(join(after, ".cursor"), { recursive: true });
    await writeFile(join(after, ".cursor", "hooks.json"), "{}\n");
    await symlink(join(base, "elsewhere"), join(after, ".stigmer"));
    expect(await changedFiles(before, after)).toEqual([
      { path: ".cursor/hooks.json", change: "added" },
      { path: ".stigmer", change: "added" },
    ]);
  });
});

describe("readWorkspaceFile", () => {
  it("reads a file's content, and null for one that does not exist", async () => {
    expect(await readWorkspaceFile(after, "README.md")).toBe("# orders-sync\n");
    expect(await readWorkspaceFile(after, "missing.go")).toBeNull();
  });
});

describe("runChecks go_test", () => {
  function scripted(result: Awaited<ReturnType<CommandRunner>>): { run: CommandRunner; calls: Parameters<CommandRunner>[] } {
    const calls: Parameters<CommandRunner>[] = [];
    return {
      calls,
      run: async (...args) => {
        calls.push(args);
        return result;
      },
    };
  }

  it("runs go test ./... in the workspace with GOWORK=off and reads a pass", async () => {
    const { run, calls } = scripted({ exitCode: 0, output: "ok  example.com/orders-sync/duration\n", notFound: false });
    const [check] = await runChecks(["go_test"], after, run);
    expect(check).toEqual({ name: "go_test", outcome: "passed", detail: "go test ./...: exit 0\nok  example.com/orders-sync/duration" });
    expect(calls[0]?.[0]).toBe("go");
    expect(calls[0]?.[1]).toEqual(["test", "./..."]);
    expect(calls[0]?.[2].cwd).toBe(after);
    expect(calls[0]?.[2].env["GOWORK"]).toBe("off");
  });

  it("reads a failure with the exit code and the output's tail", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    const [check] = await runChecks(["go_test"], after, scripted({ exitCode: 1, output: lines, notFound: false }).run);
    expect(check?.outcome).toBe("failed");
    expect(check?.detail.startsWith("go test ./...: exit 1\n")).toBe(true);
    expect(check?.detail).toContain("line 59");
    expect(check?.detail).not.toContain("line 19\n");
  });

  it("reads not-run, by name, when go is not on PATH", async () => {
    const [check] = await runChecks(["go_test"], after, scripted({ exitCode: null, output: "", notFound: true }).run);
    expect(check).toEqual({ name: "go_test", outcome: "not-run", detail: "not run: go is not on PATH" });
  });
});
