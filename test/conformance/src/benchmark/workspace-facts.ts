// Reads which files of the working agent's workspace differ from the
// fixture after a session: what the benchmark-readers smoke checks the
// working agent's turns wrote.
// Domain: conformance benchmark (the working agent's end-state facts).
//
// The comparison is over FILES only, byte for byte. Directories are never
// compared: an empty directory a harness leaves behind is not an edit. Nothing is
// filtered by name. A runner-owned file or link that survives teardown is
// listed like any other (a symbolic link counts as an entry of its own and is
// never followed), because hiding it would hide a teardown regression.
import { readdir, readFile, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** A file whose bytes differ from the fixture's after a session. */
export interface FileChangeFact {
  path: string;
  change: "added" | "modified" | "deleted";
}

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
