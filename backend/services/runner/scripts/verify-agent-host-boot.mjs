#!/usr/bin/env node

/**
 * Verifies a built runner entry starts as the agent host under real Node:
 * `main.js agent-host`, with a pipe on fd 3, announces itself with the
 * protocol's `hello` on that pipe, and exits cleanly once the pipe closes.
 *
 * Why: the runner starts its agent host from its own entry
 * (`src/agent-host/supervisor.ts`), so a build whose host mode cannot boot
 * — an import-time crash only plain Node shows (the class
 * verify-dist-boot.mjs guards for the runner's other modes), a bundle that
 * dropped the mode, a platform whose extra stdio pipe does not reach the
 * child — boots a runner that can serve no Stigmer turn. vitest's spawned
 * hosts run from source under tsx; this runs the artifact.
 *
 * `--fenced` boots the locked host instead (`src/agent-host/fence.ts`): the
 * same entry under Node's permission model, granted only a read of its
 * install root, as the runner starts it for conversations without a
 * computer. Its hello must report the lock on (no write, no process, no
 * worker, no read of the home folder, exactly the flags given), and it must
 * then boot the Stigmer harness, which loads the engine: a native addon
 * anywhere on that path (Temporal's worker, say) fails the boot with
 * ERR_DLOPEN_DISABLED, so this is the check that cannot drift from what
 * ships. Asked over its pipe to read a file outside its install root and to
 * run a program, Node refuses both. The flags are computed here the way the
 * runner computes them; the runner's own computation has its unit tests
 * (`src/agent-host/__tests__/fence.test.ts`).
 *
 * Usage:
 *   node scripts/verify-agent-host-boot.mjs                    # dist/main.js
 *   node scripts/verify-agent-host-boot.mjs --entry <main.js> [--node <node>] [--fenced]
 *
 * `npm run verify:dist` runs both forms on the compiled build;
 * verify-slim-artifact.mjs runs both against the slim bundle, on every
 * platform the bundle ships to (the desktop's Windows leg included).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BOOT_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 15_000;

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const entry = resolve(option("--entry") ?? fileURLToPath(new URL("../dist/main.js", import.meta.url)));
const nodeBinary = option("--node") ?? process.execPath;
const fenced = process.argv.includes("--fenced");
const label = fenced ? "the locked host" : "the host";

function fail(message) {
  console.error(`verify-agent-host-boot: FAIL — ${message}`);
  process.exit(1);
}

if (!existsSync(entry)) fail(`${entry} not found — build the runner first`);

const home = mkdtempSync(join(tmpdir(), "stigmer-agent-host-boot-"));
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

// The packages the locked host loads besides its entry, found on the entry's
// own lookup chain (`FENCED_HOST_PACKAGES` and `fenceReadRoot` in fence.ts).
const FENCED_HOST_PACKAGES = ["deepagents", "@langchain/core", "@stigmer/apis", "@temporalio/common"];

function fenceReadRoot() {
  const entryDir = realpathSync(dirname(entry));
  const roots = [entryDir];
  for (const name of FENCED_HOST_PACKAGES) {
    for (let dir = entryDir; ; dir = dirname(dir)) {
      const candidate = join(dir, "node_modules", ...name.split("/"));
      if (existsSync(candidate)) {
        roots.push(realpathSync(candidate));
        break;
      }
      if (dirname(dir) === dir) break;
    }
  }
  const { root } = parse(roots[0]);
  let common = roots[0].slice(root.length).split(sep).filter(Boolean);
  for (const path of roots.slice(1)) {
    const segments = path.slice(parse(path).root.length).split(sep).filter(Boolean);
    let n = 0;
    while (n < common.length && n < segments.length && common[n] === segments[n]) n++;
    common = common.slice(0, n);
  }
  return join(root, ...common);
}

function fenceFlags() {
  const flags = process.allowedNodeEnvironmentFlags;
  const permission = flags.has("--permission") ? "--permission" : flags.has("--experimental-permission") ? "--experimental-permission" : null;
  if (permission === null) fail(`${process.version} has no permission model`);
  return [permission, `--allow-fs-read=${fenceReadRoot()}`];
}

const flags = fenced ? fenceFlags() : [];
const env = { ...process.env, HOME: home, USERPROFILE: home };
// The locked host starts without Node's options, so nothing re-grants, and
// with LangSmith's profile named inside its grant (`fencedHostEnvironment`,
// `fencedHostLaunch`).
if (fenced) {
  delete env.NODE_OPTIONS;
  env.LANGSMITH_CONFIG_FILE = join(fenceReadRoot(), ".stigmer-locked-host-no-langsmith-profile.json");
}

const child = spawn(nodeBinary, [...flags, entry, "agent-host"], {
  env,
  // The stdio the runner starts its host with (`spawnHostProcess` in
  // src/agent-host/supervisor.ts says why fd 3 is overlapped).
  stdio: ["ignore", "pipe", "pipe", "overlapped"],
});
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

const pipe = child.stdio[3];
pipe.setEncoding("utf8");
const lines = [];
const lineWaiters = [];
let pipeBuffer = "";
pipe.on("data", (chunk) => {
  pipeBuffer += chunk;
  for (let newline = pipeBuffer.indexOf("\n"); newline !== -1; newline = pipeBuffer.indexOf("\n")) {
    lines.push(pipeBuffer.slice(0, newline));
    pipeBuffer = pipeBuffer.slice(newline + 1);
  }
  while (lines.length > 0 && lineWaiters.length > 0) lineWaiters.shift()(lines.shift());
});

/** The host's next line on its pipe. */
function nextLine(what) {
  return new Promise((resolveLine, rejectLine) => {
    if (lines.length > 0) return resolveLine(lines.shift());
    const timer = setTimeout(() => rejectLine(new Error(`no ${what} within ${BOOT_TIMEOUT_MS}ms`)), BOOT_TIMEOUT_MS);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      rejectLine(new Error(`${label} exited before its ${what} (${signal ?? code})`));
    };
    child.once("exit", onExit);
    lineWaiters.push((line) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolveLine(line);
    });
  });
}

/** One call on the host's pipe, and its result envelope. */
async function call(id, method, args) {
  pipe.write(`${JSON.stringify({ kind: "call", id, method, args })}\n`);
  for (;;) {
    const line = await nextLine(`${method} result`).catch((err) => fail(`${err.message}\n${output.slice(-2000)}`));
    const reply = JSON.parse(line);
    if (reply.kind === "result" && reply.id === id) return reply;
  }
}

/** A file every platform has outside the install root, and a program that does nothing. */
const OUTSIDE_FILE = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/hosts";
const NOTHING_PROGRAM = process.platform === "win32" ? "cmd.exe" : "true";

const hello = await nextLine("hello").catch((err) => fail(`${err.message}\n${output.slice(-2000)}`));

let message;
try {
  message = JSON.parse(hello);
} catch {
  fail(`the host's first line is not JSON: ${hello.slice(0, 200)}`);
}
if (message.kind !== "hello" || !Number.isInteger(message.protocolVersion)) {
  fail(`the host's first line is not its hello: ${hello.slice(0, 200)}`);
}

if (fenced) {
  const fence = message.fence ?? {};
  if (fence.permission !== true) fail(`the locked host reports no permission model: ${JSON.stringify(fence)}`);
  for (const scope of ["fsReadHome", "fsWrite", "childProcess", "worker"]) {
    if (fence[scope] !== false) fail(`the locked host's ${scope} is not refused: ${JSON.stringify(fence)}`);
  }
  if (JSON.stringify(fence.execArgv) !== JSON.stringify(flags)) {
    fail(`the locked host started with ${JSON.stringify(fence.execArgv)}, not ${JSON.stringify(flags)}`);
  }
  // Boot the Stigmer harness, which loads the engine, under the lock.
  const config = {
    mode: "local",
    workspaceRootDir: join(home, "workspaces"),
    primaryModel: "gpt-4.1",
    maxConcurrentActivities: 1,
    checkpointerType: "sqlite",
    mcpBridgeEndpoint: null,
    mcpPublicEndpoint: null,
    cursorStreamStallTimeoutMs: 120_000,
    openOperationMaxMs: 600_000,
    shellTimeoutMaxSeconds: 600,
    shellBackgroundEnabled: false,
    workspaceLockTimeoutMs: 30_000,
    proxyEndpoint: "http://127.0.0.1:9",
    token: "verify-agent-host-boot",
    platformProxied: false,
    telemetry: { traces: { enabled: false, protocol: "http/protobuf" }, metrics: { enabled: false, protocol: "http/protobuf" }, content: false, batchSize: null },
  };
  const booted = await call(1, "boot", { harness: "stigmer", config });
  if (!booted.ok) fail(`the locked host failed to boot the Stigmer harness: ${JSON.stringify(booted.error).slice(0, 1500)}\n${output.slice(-2000)}`);

  // The locked host is never handed a file or process operation; asked for
  // one anyway, Node refuses it. A file outside the install root, and a
  // program that does nothing.
  const read = await call(2, "fs", { op: "read", path: OUTSIDE_FILE, offset: 0, length: 64 });
  if (!read.ok || read.value?.error?.code !== "ERR_ACCESS_DENIED") {
    fail(`the locked host read ${OUTSIDE_FILE}: ${JSON.stringify(read).slice(0, 500)}`);
  }
  const ran = await call(3, "exec", { file: NOTHING_PROGRAM, args: [], cwd: null, env: {}, replaceEnv: false, timeoutMs: 10_000, maxBuffer: 1024, input: null });
  if (!ran.ok || ran.value?.failure === null || !/ERR_ACCESS_DENIED|restricted/i.test(ran.value?.failure?.message ?? "")) {
    fail(`the locked host ran ${NOTHING_PROGRAM}: ${JSON.stringify(ran).slice(0, 500)}`);
  }
}

const exited = new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit(signal ?? code)));
pipe.end();
const how = await Promise.race([exited, new Promise((resolveTimeout) => setTimeout(() => resolveTimeout("timeout"), EXIT_TIMEOUT_MS))]);
if (how === "timeout") {
  child.kill("SIGKILL");
  fail(`${label} did not exit within ${EXIT_TIMEOUT_MS}ms of its pipe closing\n${output.slice(-2000)}`);
}
if (how !== 0) fail(`${label} exited with ${how} after its pipe closed\n${output.slice(-2000)}`);

console.log(
  fenced
    ? `verify-agent-host-boot: OK — ${entry} started locked (${flags.join(" ")}), reported its lock, booted the Stigmer harness, was refused a read and a process, and exited cleanly when its pipe closed`
    : `verify-agent-host-boot: OK — ${entry} announced protocol ${message.protocolVersion} and exited cleanly when its pipe closed`,
);
