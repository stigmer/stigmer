/**
 * The agent's file and process operations as the runner makes them
 * (`agent-host/remote-fs.ts`), performed by the host's server
 * (`host.ts`, `fs-service.ts`) over a loopback channel.
 *
 * Pinned:
 *  - every operation the runtime uses round-trips with the local
 *    implementation's results: bytes exact, a body larger than one message
 *    crossing in ranges, links, listings (recursive too), stats; a range
 *    of a file read from an offset, across more than one message and short
 *    at its end, the local implementation's answer exactly; an append
 *    adds to the end and creates the file, a body larger than one message
 *    included;
 *  - a filesystem error comes back with its errno `code`, `syscall` and
 *    `path`, so a caller's `code === "ENOENT"` still holds;
 *  - a process's output comes back as bytes, standard input reaches it, an
 *    output larger than one message crosses through a host-side file the
 *    runner removes, and a failure is an `AgentExecError` with its exit code
 *    and output;
 *  - the request carries only the extra variables the caller named, never
 *    the runner's own environment; with `replaceEnv` those are the
 *    process's whole environment, and a `timeoutMs` kills it.
 */

import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { AgentExecError, localAgentFs } from "../../shared/agent-fs.js";
import { serveExec } from "../fs-service.js";
import { Peer, loopbackChannels } from "../channel.js";
import { serveAgentHost } from "../host.js";
import { FS_CHUNK_BYTES, type ExecRequest, type HostCalls, type HostNotices, type RunnerCalls, type RunnerNotices } from "../protocol.js";
import { remoteAgentFs } from "../remote-fs.js";

function hostedFs() {
  const [runnerEnd, hostEnd] = loopbackChannels();
  serveAgentHost(hostEnd, [
    {
      harness: "deep-agent",
      adapter: {
        name: "probe",
        capabilities: DEEP_AGENT_CAPABILITIES,
        boot: async () => {},
        shutdown: async () => {},
        releaseSession: async () => {},
        runTurn: async () => ({ kind: "completed" }),
      },
    },
  ]);
  const runner = new Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>(runnerEnd, "runner");
  const sent: ExecRequest[] = [];
  const fs = remoteAgentFs({
    fs: (request) => runner.call("fs", request),
    exec: (request) => {
      sent.push(request);
      return runner.call("exec", request);
    },
  });
  return { fs, sent, close: () => runnerEnd.close() };
}

describe("the agent's file operations, performed by the host", () => {
  it("appends to the end of a file, creating it, a body larger than one message included", async () => {
    const { fs, close } = hostedFs();
    const dir = mkdtempSync(join(tmpdir(), "remote-fs-"));
    const big = Buffer.alloc(FS_CHUNK_BYTES + 7, 3);
    await fs.appendFile(join(dir, "grown.bin"), Buffer.from("head:"));
    await fs.appendFile(join(dir, "grown.bin"), big);
    expect(readFileSync(join(dir, "grown.bin")).equals(Buffer.concat([Buffer.from("head:"), big]))).toBe(true);
    close();
  });

  it("reads a range from an offset, across messages and short at the end, as the local implementation does", async () => {
    const { fs, close } = hostedFs();
    const dir = mkdtempSync(join(tmpdir(), "remote-fs-"));
    const big = Buffer.alloc(FS_CHUNK_BYTES * 2 + 11);
    for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
    writeFileSync(join(dir, "big.bin"), big);
    for (const [offset, length] of [[0, 10], [5, FS_CHUNK_BYTES + 3], [FS_CHUNK_BYTES * 2, 100], [big.length, 10], [0, 0]] as const) {
      const remote = await fs.readRange(join(dir, "big.bin"), offset, length);
      const local = await localAgentFs.readRange(join(dir, "big.bin"), offset, length);
      expect(remote.equals(local), `${offset}+${length}`).toBe(true);
      expect(remote.equals(big.subarray(offset, offset + length)), `${offset}+${length}`).toBe(true);
    }
    await expect(fs.readRange(join(dir, "missing.bin"), 0, 1)).rejects.toMatchObject({ code: "ENOENT" });
    close();
  });

  it("round-trips every operation the runtime uses, a body larger than one message included", async () => {
    const { fs, close } = hostedFs();
    const dir = mkdtempSync(join(tmpdir(), "remote-fs-"));

    const big = Buffer.alloc(FS_CHUNK_BYTES * 2 + 123, 7);
    big[FS_CHUNK_BYTES + 5] = 9;
    await fs.mkdir(join(dir, "a", "b"), { recursive: true });
    await fs.writeFile(join(dir, "a", "b", "big.bin"), big, { mode: 0o640 });
    expect(readFileSync(join(dir, "a", "b", "big.bin")).equals(big)).toBe(true);
    expect((await fs.readFile(join(dir, "a", "b", "big.bin"))).equals(big)).toBe(true);
    expect((await fs.stat(join(dir, "a", "b", "big.bin"))).mode & 0o777).toBe(0o640);

    await fs.writeFile(join(dir, "text.txt"), "héllo");
    expect((await fs.readFile(join(dir, "text.txt"))).toString("utf8")).toBe("héllo");
    await fs.writeFile(join(dir, "empty"), "");
    expect((await fs.readFile(join(dir, "empty"))).length).toBe(0);

    await fs.symlink(join(dir, "text.txt"), join(dir, "link"));
    expect(await fs.readlink(join(dir, "link"))).toBe(join(dir, "text.txt"));
    expect((await fs.lstat(join(dir, "link"))).isSymbolicLink()).toBe(true);
    expect((await fs.stat(join(dir, "link"))).isFile()).toBe(true);
    expect(await fs.realpath(join(dir, "link"))).toBe(await fs.realpath(join(dir, "text.txt")));

    const listed = (await fs.readdir(dir, { recursive: true })).map((e) => `${e.parentPath.slice(dir.length)}/${e.name}:${e.isDirectory() ? "d" : e.isSymbolicLink() ? "l" : "f"}`).sort();
    expect(listed).toEqual(["/a/b/big.bin:f", "/a/b:d", "/a:d", "/empty:f", "/link:l", "/text.txt:f"]);

    await fs.rename(join(dir, "text.txt"), join(dir, "moved.txt"));
    await fs.copyFile(join(dir, "moved.txt"), join(dir, "copy.txt"));
    await fs.cp(join(dir, "a"), join(dir, "a2"), { recursive: true });
    expect(existsSync(join(dir, "a2", "b", "big.bin"))).toBe(true);
    await fs.unlink(join(dir, "copy.txt"));
    await fs.rm(join(dir, "a2"), { recursive: true, force: true });
    await fs.mkdir(join(dir, "gone"));
    await fs.rmdir(join(dir, "gone"));
    await fs.access(join(dir, "moved.txt"));
    expect(readdirSync(dir).sort()).toEqual(["a", "empty", "link", "moved.txt"]);
    close();
  });

  it("brings a filesystem error back with its errno code, syscall and path", async () => {
    const { fs, close } = hostedFs();
    const missing = join(tmpdir(), "remote-fs-missing", "nothing");
    await expect(fs.readFile(missing)).rejects.toMatchObject({ code: "ENOENT", path: missing });
    await expect(fs.access(missing)).rejects.toMatchObject({ code: "ENOENT", syscall: "access" });
    await expect(fs.readlink(missing)).rejects.toMatchObject({ code: "ENOENT" });
    close();
  });
});

describe("the agent's processes, run by the host", () => {
  it("returns output as bytes, feeds standard input, and spills an output larger than one message", async () => {
    const { fs, close } = hostedFs();
    expect((await fs.execFile("sh", ["-c", "printf 'a\\0b'"])).stdout.equals(Buffer.from("a\0b"))).toBe(true);
    expect((await fs.execFile("cat", [], { input: Buffer.from("fed in") })).stdout.toString()).toBe("fed in");
    const dir = mkdtempSync(join(tmpdir(), "remote-exec-"));
    writeFileSync(join(dir, "marker"), "");
    expect((await fs.execFile("ls", [], { cwd: dir })).stdout.toString()).toBe("marker\n");

    const size = FS_CHUNK_BYTES + 1000;
    const spilled = await fs.execFile("head", ["-c", String(size), "/dev/zero"], { maxBuffer: size * 2 });
    expect(spilled.stdout.length).toBe(size);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith("stigmer-exec-"))).toEqual([]);
    close();
  });

  it("fails as an AgentExecError with the exit code and the output so far", async () => {
    const { fs, close } = hostedFs();
    const failure = await fs.execFile("sh", ["-c", "echo out; echo err >&2; exit 3"]).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AgentExecError);
    expect(failure).toMatchObject({ code: 3 });
    expect((failure as AgentExecError).stdout.toString()).toBe("out\n");
    expect((failure as AgentExecError).stderr.toString()).toBe("err\n");
    await expect(fs.execFile("no-such-binary-anywhere", [])).rejects.toMatchObject({ code: "ENOENT" });
    close();
  });

  it("answers a process that could not be run at all as a failure the runner rebuilds", async () => {
    const reply = await serveExec(
      { file: "anything", args: [], cwd: null, env: {}, replaceEnv: false, timeoutMs: null, maxBuffer: 1024, input: null },
      { ...localAgentFs, execFile: () => Promise.reject(new Error("no such process table")) },
    );
    expect(reply).toEqual({ stdout: { inline: "" }, stderr: { inline: "" }, failure: { message: "no such process table", code: null, signal: null } });
  });

  it("sends only the variables the caller named, and the process sees them", async () => {
    const { fs, sent, close } = hostedFs();
    const out = await fs.execFile("sh", ["-c", "printf %s \"$ONLY_THIS\""], { env: { ONLY_THIS: "named" } });
    expect(out.stdout.toString()).toBe("named");
    expect(sent.map((request) => request.env)).toEqual([{ ONLY_THIS: "named" }]);
    close();
  });

  it("runs with the named variables alone when asked to replace the environment", async () => {
    const { fs, sent, close } = hostedFs();
    process.env["REMOTE_FS_LEAK_CHECK"] = "leaked";
    try {
      const out = await fs.execFile("/bin/sh", ["-c", "printf '%s|%s' \"$ONLY_THIS\" \"${REMOTE_FS_LEAK_CHECK:-absent}\""], {
        env: { ONLY_THIS: "named" },
        replaceEnv: true,
      });
      expect(out.stdout.toString()).toBe("named|absent");
      expect(sent.map((request) => request.replaceEnv)).toEqual([true]);
    } finally {
      delete process.env["REMOTE_FS_LEAK_CHECK"];
    }
    close();
  });

  it("kills a process that runs past its limit, failing with the signal", async () => {
    const { fs, close } = hostedFs();
    const failure = await fs.execFile("sleep", ["5"], { timeoutMs: 50 }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AgentExecError);
    expect(failure).toMatchObject({ signal: "SIGKILL" });
    close();
  });
});
