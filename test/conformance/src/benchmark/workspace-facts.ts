// Reads the working agent's workspace after a quality task's last turn: which
// files differ from the fixture, what the named files hold, and the
// benchmark's own deterministic checks of that end state.
// Domain: conformance benchmark (the quality cells' end-state facts).
//
// These are facts the judge reads beside the agent's replies. They turn "made
// no unrelated edits" and "the fix works" from the judge's opinion into what
// the tree and the test run say.
//
// The comparison is over FILES only, byte for byte. Directories are never
// compared: the Cursor harness restores or deletes the two files it writes
// into a workspace for its own approval hook (runner execute-cursor/
// cursor-capabilities.ts, workspace-setup.ts), but it can leave their empty
// directories behind, and an empty directory is not an edit. Nothing is
// filtered by name. A runner-owned file or link that survives teardown is
// listed like any other (a symbolic link counts as an entry of its own and is
// never followed), because hiding it would hide a teardown regression.
//
// `go_test` runs `go test ./...` in the workspace with `GOWORK=off`: the
// workspace sits outside this repository, and the switch keeps any
// enclosing go.work from capturing it anyway. It runs under a budget, and
// reads `not-run` with the reason when `go` is not on PATH. Never silent.
import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { FileChangeFact, QualityCheck, QualityCheckName } from "./report";

/** How long the `go_test` check may run; the fixture module's suite takes about a second. */
export const GO_TEST_BUDGET_MS = 60_000;

/** How much of a check's output the report and the judge keep: the tail, where Go prints the verdict. */
export const CHECK_OUTPUT_TAIL_LINES = 40;

/** What the checks need from a command runner; `execFile` in production, scripted in the unit arms. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<{ exitCode: number | null; output: string; notFound: boolean }>;

/** The files whose bytes differ between the fixture and the workspace, sorted by path. */
export async function changedFiles(fixtureDir: string, workspaceDir: string): Promise<FileChangeFact[]> {
  const before = await entriesUnder(fixtureDir);
  const after = await entriesUnder(workspaceDir);
  const facts: FileChangeFact[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(path);
    const is = after.get(path);
    if (is === undefined) {
      facts.push({ path, change: "deleted" });
    } else if (was === undefined) {
      facts.push({ path, change: "added" });
    } else if (!(await sameEntry(join(fixtureDir, path), was, join(workspaceDir, path), is))) {
      facts.push({ path, change: "modified" });
    }
  }
  // Code-point order, not the locale's: the report reads the same on every machine.
  return facts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** A named file's content after the task, or `null` when it does not exist. */
export async function readWorkspaceFile(workspaceDir: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(workspaceDir, path), "utf8");
  } catch {
    return null;
  }
}

/** Runs each named check against the workspace, in the order named. */
export async function runChecks(
  names: readonly QualityCheckName[],
  workspaceDir: string,
  run: CommandRunner = runCommand,
): Promise<QualityCheck[]> {
  const checks: QualityCheck[] = [];
  for (const name of names) {
    switch (name) {
      case "go_test":
        checks.push(await goTest(workspaceDir, run));
        break;
      default: {
        const exhaustive: never = name;
        throw new Error(`unknown quality check: ${String(exhaustive)}`);
      }
    }
  }
  return checks;
}

async function goTest(workspaceDir: string, run: CommandRunner): Promise<QualityCheck> {
  const result = await run("go", ["test", "./..."], {
    cwd: workspaceDir,
    env: { ...process.env, GOWORK: "off" },
    timeoutMs: GO_TEST_BUDGET_MS,
  });
  if (result.notFound) return { name: "go_test", outcome: "not-run", detail: "not run: go is not on PATH" };
  const tail = result.output.trimEnd().split("\n").slice(-CHECK_OUTPUT_TAIL_LINES).join("\n");
  const exit = result.exitCode === null ? `killed after ${GO_TEST_BUDGET_MS}ms` : `exit ${result.exitCode}`;
  return { name: "go_test", outcome: result.exitCode === 0 ? "passed" : "failed", detail: `go test ./...: ${exit}\n${tail}` };
}

/** `execFile` as a {@link CommandRunner}: stdout and stderr together, the exit code, and whether the command exists. */
export const runCommand: CommandRunner = (command, args, options) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { cwd: options.cwd, env: options.env, timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        if (error === null) {
          resolve({ exitCode: 0, output, notFound: false });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          resolve({ exitCode: null, output, notFound: true });
          return;
        }
        resolve({ exitCode: typeof code === "number" ? code : error.killed ? null : 1, output, notFound: false });
      },
    );
  });

type EntryKind = "file" | "link";

/** Every regular file and symbolic link beneath `root`, keyed by root-relative `/`-separated path. */
async function entriesUnder(root: string): Promise<Map<string, EntryKind>> {
  const entries = new Map<string, EntryKind>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const key = relative(root, path).split(sep).join("/");
      if (entry.isSymbolicLink()) entries.set(key, "link");
      else if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) entries.set(key, "file");
    }
  };
  await walk(root);
  return entries;
}

async function sameEntry(beforePath: string, before: EntryKind, afterPath: string, after: EntryKind): Promise<boolean> {
  if (before !== after) return false;
  if (before === "link") return (await readlink(beforePath)) === (await readlink(afterPath));
  return (await readFile(beforePath)).equals(await readFile(afterPath));
}
