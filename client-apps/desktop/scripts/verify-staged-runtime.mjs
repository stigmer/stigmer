#!/usr/bin/env node
// Proves the Node runtime a desktop build carries can run the runner it carries.
//
// Run BY the staged engine, not by the build's Node, so every check exercises
// the bytes that ship:
//
//   src-tauri/resources/runtime/node scripts/verify-staged-runtime.mjs
//
// stage-runner-slim.sh runs it last, after both halves are staged and (on a
// signed macOS build) signed, so it fails the build instead of the user's
// first session. On the Windows and Linux release legs it is the proof that
// the installer's engine loads the installer's runner.
//
// The checks, in order, each a way the pair has failed or could:
//
//   1. This process IS the staged engine, at the pinned version
//      (node-runtime.json), not whatever `node` the caller had on PATH.
//   2. node:sqlite loads and opens a database: the runner's durable
//      checkpointer imports it at boot (backend/services/runner/src/preflight.ts).
//   3. A WebAssembly module compiles and runs: executable memory, the grant the
//      hardened runtime withholds unless the engine carries allow-jit
//      (macos-entitlements/node-runtime.plist). jq-wasm is the runner's user.
//   4. Every native module (*.node) in the staged runner loads into this
//      engine. On a signed macOS build that is library validation: each module
//      must carry this engine's signing identity, which is why the engine needs
//      no disable-library-validation grant.
//   5. The staged runner boots on this engine: the runner's own slim-artifact
//      gate (backend/services/runner/scripts/verify-slim-artifact.mjs) runs its
//      size budget and authenticated boot guard with --node set to this
//      process. With --temporal it runs the full ready → sessionAdded →
//      shutdownComplete lifecycle too, which needs a reachable Temporal server
//      (TEMPORAL_SERVICE_ADDRESS, default localhost:7233).
//
// Usage:
//   <engine> scripts/verify-staged-runtime.mjs [--resources <dir>] [--temporal]
//
// --resources points at a resources directory other than this checkout's
// src-tauri/resources, e.g. the one inside an installed or unpacked bundle.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = dirname(SCRIPT_DIR);
const REPO_ROOT = resolve(DESKTOP_DIR, "../..");

const { values: options } = parseArgs({
  options: {
    resources: { type: "string", default: join(DESKTOP_DIR, "src-tauri", "resources") },
    temporal: { type: "boolean", default: false },
  },
});

const resourcesDir = resolve(options.resources);
const runnerDir = join(resourcesDir, "runner");
const engineName = process.platform === "win32" ? "node.exe" : "node";
const enginePath = join(resourcesDir, "runtime", engineName);

function fail(message) {
  console.error(`verify-staged-runtime: FAIL — ${message}`);
  process.exit(1);
}

function ok(label, message) {
  console.log(`[${label}]`.padEnd(10) + `OK: ${message}`);
}

// ─── 1. The staged engine, at the pinned version ────────────────────────────

const pin = JSON.parse(readFileSync(join(DESKTOP_DIR, "node-runtime.json"), "utf8"));
let stagedEngine;
try {
  stagedEngine = realpathSync(enginePath);
} catch {
  fail(`no staged engine at ${enginePath}; run scripts/stage-node-runtime.sh`);
}
// Windows paths compare case-insensitively (a drive letter's case varies by caller).
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
if (!samePath(realpathSync(process.execPath), stagedEngine)) {
  fail(`run this with the staged engine (${enginePath}), not ${process.execPath}`);
}
if (process.version !== `v${pin.version}`) {
  fail(`the staged engine is ${process.version}, node-runtime.json pins v${pin.version}`);
}
ok("engine", `${process.version} (${process.platform}-${process.arch}) at ${enginePath}`);

// ─── 2. node:sqlite ──────────────────────────────────────────────────────────

const sqlite = process.getBuiltinModule?.("node:sqlite");
if (!sqlite) fail("this engine has no node:sqlite; the runner's checkpointer cannot load");
try {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (42)");
  const row = db.prepare("SELECT x FROM t").get();
  db.close();
  if (row?.x !== 42) fail("node:sqlite returned the wrong row");
} catch (err) {
  fail(`node:sqlite failed: ${err.message}`);
}
ok("sqlite", "node:sqlite opened an in-memory database");

// ─── 3. WebAssembly (executable memory) ─────────────────────────────────────

// (module (func (export "add") (param i32 i32) (result i32)
//   local.get 0 local.get 1 i32.add))
const ADD_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
  0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
  0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);
try {
  const { instance } = await WebAssembly.instantiate(ADD_WASM);
  if (instance.exports.add(40, 2) !== 42) fail("a WebAssembly add returned the wrong sum");
} catch (err) {
  fail(`WebAssembly failed: ${err.message}`);
}
ok("wasm", "a WebAssembly module compiled and ran");

// ─── 4. Every native module loads ───────────────────────────────────────────

function nativeModules(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...nativeModules(path));
    else if (entry.endsWith(".node")) found.push(path);
  }
  return found;
}

const modules = nativeModules(runnerDir);
if (modules.length === 0) {
  // The runner always carries native code (Temporal's core bridge at least);
  // none means staging broke, and a check over nothing proves nothing.
  fail(`no native modules under ${runnerDir}`);
}
for (const path of modules) {
  try {
    process.dlopen({ exports: {} }, path);
  } catch (err) {
    fail(`native module ${path} did not load: ${err.message}`);
  }
}
ok("natives", `${modules.length} native module(s) loaded from ${runnerDir}`);

// ─── 5. The staged runner boots on this engine ──────────────────────────────

const gate = join(REPO_ROOT, "backend", "services", "runner", "scripts", "verify-slim-artifact.mjs");
const gateArgs = [gate, "--node", process.execPath, "--artifact", runnerDir, "--entry", join("dist", "main.js")];
if (!options.temporal) gateArgs.push("--no-temporal");
const boot = spawnSync(process.execPath, gateArgs, { stdio: "inherit" });
if (boot.status !== 0) fail(`the staged runner did not boot on the staged engine (exit ${boot.status})`);
ok("boot", options.temporal ? "full runner lifecycle against Temporal" : "runner boot guard passed");

console.log("verify-staged-runtime: PASS");
