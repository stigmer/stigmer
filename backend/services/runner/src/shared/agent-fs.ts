/**
 * The file and process operations the turn runtime makes on paths the
 * agent can write: the workspace, the session's platform directory, the
 * agent's own state (#2016).
 *
 * The runtime keeps its decisions; the operations themselves are the
 * agent's. In the runner, the agent host installs an implementation that
 * performs each one in the host process, with the agent's rights
 * (`agent-host/remote-fs.ts`), so the runner never opens, writes, renames or
 * runs anything on a path the agent controls: no planted link, git hook or
 * `core.fsmonitor` acts with the runner's rights. Everywhere else (the host
 * itself, the tests, a process that never starts a host) the local
 * implementation below runs the same operations here.
 *
 * Whatever an operation returns is data the agent wrote, and the runtime
 * treats it as such. `execFile` takes extra environment variables only: the
 * process runs with the environment of the process that performs it, which
 * in the runner's case is the host's, never the runner's own.
 */

import { execFile as execFileCallback } from "node:child_process";
import { promises as fs, type Dirent, type Stats } from "node:fs";

/** What `stat` and `lstat` report: the fields the runtime reads, with `Stats`' predicates. */
export interface AgentStats {
  readonly size: number;
  readonly mode: number;
  readonly mtimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** One entry of a directory listing. `parentPath` is the directory it was found in (a recursive listing's subdirectories included). */
export interface AgentDirEntry {
  readonly name: string;
  readonly parentPath: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface AgentExecOptions {
  readonly cwd?: string;
  /** Added to the environment of the process that performs the operation. */
  readonly env?: Readonly<Record<string, string>>;
  readonly maxBuffer?: number;
  /** Bytes for the process's standard input. */
  readonly input?: Uint8Array;
}

export interface AgentExecResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

/**
 * A process that failed: exited non-zero, was killed, could not start, or
 * overran `maxBuffer`. It carries what `child_process.execFile`'s error
 * carries: `code` (the exit code, or an errno string such as `ENOENT`),
 * `signal`, and the output so far.
 */
export class AgentExecError extends Error {
  constructor(
    message: string,
    readonly code: number | string | null,
    readonly signal: string | null,
    readonly stdout: Buffer,
    readonly stderr: Buffer,
  ) {
    super(message);
    this.name = "AgentExecError";
  }
}

export interface AgentFs {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: string | Uint8Array, options?: { readonly mode?: number }): Promise<void>;
  mkdir(path: string, options?: { readonly recursive?: boolean; readonly mode?: number }): Promise<void>;
  rm(path: string, options?: { readonly recursive?: boolean; readonly force?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  cp(from: string, to: string, options?: { readonly recursive?: boolean }): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  stat(path: string): Promise<AgentStats>;
  lstat(path: string): Promise<AgentStats>;
  readdir(path: string, options?: { readonly recursive?: boolean }): Promise<AgentDirEntry[]>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  realpath(path: string): Promise<string>;
  /** Resolves when `path` exists (following links), rejects with the errno error otherwise. */
  access(path: string): Promise<void>;
  execFile(file: string, args: readonly string[], options?: AgentExecOptions): Promise<AgentExecResult>;
}

/** The default `maxBuffer` of {@link AgentFs.execFile}, as `child_process.execFile`'s. */
export const DEFAULT_EXEC_MAX_BUFFER = 1024 * 1024;

/** The operations, performed by this process. */
export const localAgentFs: AgentFs = {
  readFile: (path) => fs.readFile(path),
  writeFile: (path, data, options) => fs.writeFile(path, data, options?.mode === undefined ? undefined : { mode: options.mode }),
  mkdir: async (path, options) => {
    await fs.mkdir(path, options);
  },
  rm: (path, options) => fs.rm(path, options),
  rmdir: (path) => fs.rmdir(path),
  unlink: (path) => fs.unlink(path),
  rename: (from, to) => fs.rename(from, to),
  cp: (from, to, options) => fs.cp(from, to, options),
  copyFile: (from, to) => fs.copyFile(from, to),
  stat: async (path) => statsOf(await fs.stat(path)),
  lstat: async (path) => statsOf(await fs.lstat(path)),
  readdir: async (path, options) => (await fs.readdir(path, { withFileTypes: true, recursive: options?.recursive ?? false })).map(entryOf),
  readlink: (path) => fs.readlink(path),
  symlink: (target, path) => fs.symlink(target, path),
  realpath: (path) => fs.realpath(path),
  access: (path) => fs.access(path),
  execFile: (file, args, options) => execLocally(file, args, options ?? {}),
};

let installed: AgentFs = localAgentFs;

/** The operations as this process performs them: the agent host's, once a runner has started one. */
export function agentFs(): AgentFs {
  return installed;
}

/** Route every operation through `impl` from now on (`agent-host/hosting.ts`), returning the restore. */
export function installAgentFs(impl: AgentFs): () => void {
  const previous = installed;
  installed = impl;
  return () => {
    installed = previous;
  };
}

/** Whether `path` exists, following links. */
export async function agentPathExists(path: string): Promise<boolean> {
  try {
    await agentFs().access(path);
    return true;
  } catch {
    return false;
  }
}

function statsOf(stats: Stats): AgentStats {
  return statsFrom({ size: stats.size, mode: stats.mode, mtimeMs: stats.mtimeMs, kind: kindOf(stats) });
}

function entryOf(entry: Dirent): AgentDirEntry {
  return entryFrom({ name: entry.name, parentPath: entry.parentPath, kind: kindOf(entry) });
}

/** What a file is, as it crosses between processes. */
export type AgentFileKind = "file" | "directory" | "symlink" | "other";

/** Rebuild an {@link AgentStats} from its plain fields. */
export function statsFrom(plain: { readonly size: number; readonly mode: number; readonly mtimeMs: number; readonly kind: AgentFileKind }): AgentStats {
  return {
    size: plain.size,
    mode: plain.mode,
    mtimeMs: plain.mtimeMs,
    isFile: () => plain.kind === "file",
    isDirectory: () => plain.kind === "directory",
    isSymbolicLink: () => plain.kind === "symlink",
  };
}

/** Rebuild an {@link AgentDirEntry} from its plain fields. */
export function entryFrom(plain: { readonly name: string; readonly parentPath: string; readonly kind: AgentFileKind }): AgentDirEntry {
  return {
    name: plain.name,
    parentPath: plain.parentPath,
    isFile: () => plain.kind === "file",
    isDirectory: () => plain.kind === "directory",
    isSymbolicLink: () => plain.kind === "symlink",
  };
}

/** The kind of a stat or a directory entry, for the wire. */
export function kindOf(item: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): AgentFileKind {
  return item.isFile() ? "file" : item.isDirectory() ? "directory" : item.isSymbolicLink() ? "symlink" : "other";
}

function execLocally(file: string, args: readonly string[], options: AgentExecOptions): Promise<AgentExecResult> {
  return new Promise((resolve, reject) => {
    const child = execFileCallback(
      file,
      [...args],
      {
        cwd: options.cwd,
        env: options.env === undefined ? process.env : { ...process.env, ...options.env },
        maxBuffer: options.maxBuffer ?? DEFAULT_EXEC_MAX_BUFFER,
        encoding: "buffer",
      },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve({ stdout, stderr });
          return;
        }
        const failed = err as NodeJS.ErrnoException & { readonly code?: number | string; readonly signal?: NodeJS.Signals | null };
        reject(new AgentExecError(err.message, failed.code ?? null, failed.signal ?? null, stdout, stderr));
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}
