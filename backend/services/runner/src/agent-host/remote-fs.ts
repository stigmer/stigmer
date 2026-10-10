/**
 * The runner's side of the agent's file and process operations
 * (`shared/agent-fs.ts`): an {@link AgentFs} whose every operation is an
 * `fs` or `exec` call the agent host performs (`fs-service.ts`), with the
 * agent's rights. `hosting.ts` installs it when the runner starts its host.
 *
 * Errors come back as the caller expects them: a filesystem error with its
 * errno `code`, a failed process as an {@link AgentExecError}. Bodies larger
 * than one message cross in ranges ({@link FS_CHUNK_BYTES}).
 */

import {
  AgentExecError,
  entryFrom,
  statsFrom,
  type AgentExecResult,
  type AgentFs,
  DEFAULT_EXEC_MAX_BUFFER,
} from "../shared/agent-fs.js";
import { FS_CHUNK_BYTES, type ExecOutputWire, type FsReply, type FsRequest, type FsValue, type HostCalls, type WireDirEntry, type WireStats } from "./protocol.js";

/** What `remoteAgentFs` needs of the host: its two calls. */
export interface FsHost {
  fs(request: FsRequest): Promise<HostCalls["fs"]["result"]>;
  exec(request: HostCalls["exec"]["args"]): Promise<HostCalls["exec"]["result"]>;
}

/** The operations, each performed by the host behind `host`. */
export function remoteAgentFs(host: FsHost): AgentFs {
  const call = async (request: FsRequest): Promise<FsValue> => valueOf(await host.fs(request));
  const read = async (path: string): Promise<Buffer> => {
    const parts: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const range = (await call({ op: "read", path, offset, length: FS_CHUNK_BYTES })) as { readonly data: string; readonly size: number };
      const bytes = Buffer.from(range.data, "base64");
      parts.push(bytes);
      offset += bytes.length;
      if (bytes.length === 0 || offset >= range.size) return Buffer.concat(parts);
    }
  };
  const output = async (wire: ExecOutputWire): Promise<Buffer> => {
    if ("inline" in wire) return Buffer.from(wire.inline, "base64");
    try {
      return await read(wire.spill);
    } finally {
      await call({ op: "rm", path: wire.spill, recursive: false, force: true });
    }
  };

  return {
    readFile: read,
    writeFile: async (path, data, options) => {
      const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
      let offset = 0;
      do {
        const chunk = bytes.subarray(offset, offset + FS_CHUNK_BYTES);
        await call({ op: "write", path, data: chunk.toString("base64"), append: offset > 0, mode: offset > 0 ? null : (options?.mode ?? null) });
        offset += chunk.length;
      } while (offset < bytes.length);
    },
    mkdir: async (path, options) => {
      await call({ op: "mkdir", path, recursive: options?.recursive ?? false, mode: options?.mode ?? null });
    },
    rm: async (path, options) => {
      await call({ op: "rm", path, recursive: options?.recursive ?? false, force: options?.force ?? false });
    },
    rmdir: async (path) => {
      await call({ op: "rmdir", path });
    },
    unlink: async (path) => {
      await call({ op: "unlink", path });
    },
    rename: async (from, to) => {
      await call({ op: "rename", from, to });
    },
    cp: async (from, to, options) => {
      await call({
        op: "cp",
        from,
        to,
        recursive: options?.recursive ?? false,
        errorOnExist: options?.errorOnExist ?? false,
        force: options?.force ?? true,
        verbatimSymlinks: options?.verbatimSymlinks ?? false,
      });
    },
    copyFile: async (from, to) => {
      await call({ op: "copyFile", from, to });
    },
    stat: async (path) => statsFrom((await call({ op: "stat", path })) as WireStats),
    lstat: async (path) => statsFrom((await call({ op: "lstat", path })) as WireStats),
    readdir: async (path, options) => ((await call({ op: "readdir", path, recursive: options?.recursive ?? false })) as readonly WireDirEntry[]).map(entryFrom),
    readlink: async (path) => (await call({ op: "readlink", path })) as string,
    symlink: async (target, path) => {
      await call({ op: "symlink", target, path });
    },
    realpath: async (path) => (await call({ op: "realpath", path })) as string,
    access: async (path) => {
      await call({ op: "access", path });
    },
    execFile: async (file, args, options): Promise<AgentExecResult> => {
      const reply = await host.exec({
        file,
        args,
        cwd: options?.cwd ?? null,
        env: options?.env ?? {},
        maxBuffer: options?.maxBuffer ?? DEFAULT_EXEC_MAX_BUFFER,
        input: options?.input === undefined ? null : Buffer.from(options.input).toString("base64"),
      });
      const stdout = await output(reply.stdout);
      const stderr = await output(reply.stderr);
      if (reply.failure !== null) throw new AgentExecError(reply.failure.message, reply.failure.code, reply.failure.signal, stdout, stderr);
      return { stdout, stderr };
    },
  };
}

function valueOf(reply: FsReply): FsValue {
  if ("ok" in reply) return reply.ok;
  const err = new Error(reply.error.message) as NodeJS.ErrnoException;
  if (reply.error.code !== null) err.code = reply.error.code;
  if (reply.error.syscall !== null) err.syscall = reply.error.syscall;
  if (reply.error.path !== null) err.path = reply.error.path;
  throw err;
}
