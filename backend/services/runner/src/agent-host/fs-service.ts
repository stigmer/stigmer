/**
 * The host's side of the agent's file and process operations
 * (`shared/agent-fs.ts`): each `fs` or `exec` call the runner makes is
 * performed here, by the host process, so with the agent's rights. The
 * runner's side is `remote-fs.ts`.
 *
 * A failure is an answer, not a failed call: a filesystem error comes back
 * with its errno code, and a process that exits non-zero comes back with
 * its code and output, so the runner rebuilds the error its caller expects.
 * A process output larger than one message is left in a file of the host's
 * own, which the runner reads by range and removes.
 */

import { randomBytes } from "node:crypto";
import { appendFile, open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentExecError, kindOf, localAgentFs, type AgentFs } from "../shared/agent-fs.js";
import { FS_CHUNK_BYTES, type ExecOutputWire, type ExecReply, type ExecRequest, type FsReply, type FsRequest, type FsValue } from "./protocol.js";

/** Perform one file operation here. */
export async function serveFs(request: FsRequest, fs: AgentFs = localAgentFs): Promise<FsReply> {
  try {
    return { ok: await perform(request, fs) };
  } catch (err) {
    const failed = err as NodeJS.ErrnoException;
    return {
      error: {
        message: failed.message ?? String(err),
        code: typeof failed.code === "string" ? failed.code : null,
        syscall: failed.syscall ?? null,
        path: failed.path ?? null,
      },
    };
  }
}

async function perform(request: FsRequest, fs: AgentFs): Promise<FsValue> {
  switch (request.op) {
    case "read":
      return readRange(request.path, request.offset, Math.min(request.length, FS_CHUNK_BYTES));
    case "write": {
      const data = Buffer.from(request.data, "base64");
      if (request.append) await appendFile(request.path, data);
      else await fs.writeFile(request.path, data, request.mode === null ? undefined : { mode: request.mode });
      return null;
    }
    case "mkdir":
      await fs.mkdir(request.path, { recursive: request.recursive, ...(request.mode === null ? {} : { mode: request.mode }) });
      return null;
    case "rm":
      await fs.rm(request.path, { recursive: request.recursive, force: request.force });
      return null;
    case "rmdir":
      await fs.rmdir(request.path);
      return null;
    case "unlink":
      await fs.unlink(request.path);
      return null;
    case "access":
      await fs.access(request.path);
      return null;
    case "readlink":
      return fs.readlink(request.path);
    case "realpath":
      return fs.realpath(request.path);
    case "stat":
    case "lstat": {
      const stats = request.op === "stat" ? await fs.stat(request.path) : await fs.lstat(request.path);
      return { size: stats.size, mode: stats.mode, mtimeMs: stats.mtimeMs, kind: kindOf(stats) };
    }
    case "rename":
      await fs.rename(request.from, request.to);
      return null;
    case "copyFile":
      await fs.copyFile(request.from, request.to);
      return null;
    case "cp":
      await fs.cp(request.from, request.to, { recursive: request.recursive });
      return null;
    case "readdir":
      return (await fs.readdir(request.path, { recursive: request.recursive })).map((entry) => ({ name: entry.name, parentPath: entry.parentPath, kind: kindOf(entry) }));
    case "symlink":
      await fs.symlink(request.target, request.path);
      return null;
  }
}

/** `length` bytes of `path` from `offset`, and the file's whole size: one open, so the range and the size agree. */
async function readRange(path: string, offset: number, length: number): Promise<{ readonly data: string; readonly size: number }> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return { data: buffer.subarray(0, bytesRead).toString("base64"), size };
  } finally {
    await handle.close();
  }
}

/** Run one process here, with this process's environment plus the request's. */
export async function serveExec(request: ExecRequest, fs: AgentFs = localAgentFs): Promise<ExecReply> {
  const options = {
    ...(request.cwd === null ? {} : { cwd: request.cwd }),
    env: request.env,
    maxBuffer: request.maxBuffer,
    ...(request.input === null ? {} : { input: Buffer.from(request.input, "base64") }),
  };
  try {
    const { stdout, stderr } = await fs.execFile(request.file, request.args, options);
    return { stdout: await outputWire(stdout), stderr: await outputWire(stderr), failure: null };
  } catch (err) {
    if (err instanceof AgentExecError) {
      return {
        stdout: await outputWire(err.stdout),
        stderr: await outputWire(err.stderr),
        failure: { message: err.message, code: err.code, signal: err.signal },
      };
    }
    return { stdout: { inline: "" }, stderr: { inline: "" }, failure: { message: err instanceof Error ? err.message : String(err), code: null, signal: null } };
  }
}

async function outputWire(output: Buffer): Promise<ExecOutputWire> {
  if (output.length <= FS_CHUNK_BYTES) return { inline: output.toString("base64") };
  const spill = join(tmpdir(), `stigmer-exec-${randomBytes(12).toString("hex")}`);
  await writeFile(spill, output, { mode: 0o600 });
  return { spill, size: output.length };
}
