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
 * child — boots a runner that can serve no native turn. vitest's spawned
 * hosts run from source under tsx; this runs the artifact.
 *
 * Usage:
 *   node scripts/verify-agent-host-boot.mjs                    # dist/main.js
 *   node scripts/verify-agent-host-boot.mjs --entry <main.js> [--node <node>]
 *
 * verify-slim-artifact.mjs runs it against the slim bundle, on every
 * platform the bundle ships to (the desktop's Windows leg included).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BOOT_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 15_000;

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const entry = resolve(option("--entry") ?? fileURLToPath(new URL("../dist/main.js", import.meta.url)));
const nodeBinary = option("--node") ?? process.execPath;

function fail(message) {
  console.error(`verify-agent-host-boot: FAIL — ${message}`);
  process.exit(1);
}

if (!existsSync(entry)) fail(`${entry} not found — build the runner first`);

const home = mkdtempSync(join(tmpdir(), "stigmer-agent-host-boot-"));
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

const child = spawn(nodeBinary, [entry, "agent-host"], {
  env: { ...process.env, HOME: home, USERPROFILE: home },
  stdio: ["ignore", "pipe", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

const pipe = child.stdio[3];
const hello = await new Promise((resolveHello, rejectHello) => {
  let buffered = "";
  const timer = setTimeout(() => rejectHello(new Error(`no hello within ${BOOT_TIMEOUT_MS}ms`)), BOOT_TIMEOUT_MS);
  pipe.setEncoding("utf8");
  pipe.on("data", (chunk) => {
    buffered += chunk;
    const newline = buffered.indexOf("\n");
    if (newline === -1) return;
    clearTimeout(timer);
    resolveHello(buffered.slice(0, newline));
  });
  child.once("exit", (code, signal) => {
    clearTimeout(timer);
    rejectHello(new Error(`the host exited before announcing itself (${signal ?? code})`));
  });
}).catch((err) => fail(`${err.message}\n${output.slice(-2000)}`));

let message;
try {
  message = JSON.parse(hello);
} catch {
  fail(`the host's first line is not JSON: ${hello.slice(0, 200)}`);
}
if (message.kind !== "hello" || !Number.isInteger(message.protocolVersion)) {
  fail(`the host's first line is not its hello: ${hello.slice(0, 200)}`);
}

const exited = new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit(signal ?? code)));
pipe.end();
const how = await Promise.race([exited, new Promise((resolveTimeout) => setTimeout(() => resolveTimeout("timeout"), EXIT_TIMEOUT_MS))]);
if (how === "timeout") {
  child.kill("SIGKILL");
  fail(`the host did not exit within ${EXIT_TIMEOUT_MS}ms of its pipe closing\n${output.slice(-2000)}`);
}
if (how !== 0) fail(`the host exited with ${how} after its pipe closed\n${output.slice(-2000)}`);

console.log(`verify-agent-host-boot: OK — ${entry} announced protocol ${message.protocolVersion} and exited cleanly when its pipe closed`);
