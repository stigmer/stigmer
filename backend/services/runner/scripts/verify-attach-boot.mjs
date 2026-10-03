#!/usr/bin/env node
/**
 * Verifies the attach entry (dist/attach/main.js) boots under real Node.
 *
 * The same reason as verify-dist-boot.mjs, for the runner's second entry: a
 * module-load crash (an ESM/CJS interop failure, a missing dependency) passes
 * every vitest run and typecheck and then kills `node dist/attach/main.js`
 * in the sandbox before it ever answers. This boots the compiled entry with a
 * free port and a scratch sandbox-name file, then proves it serves: readiness
 * answers 200, a push for a queue that is not this sandbox's is refused with
 * 403 (so the push checks loaded), and SIGTERM ends it with exit code 0. No
 * runner is started. First it loads the entry's module graph in a child Node
 * with a resolve hook and refuses any module of the runner proper or of
 * `@temporalio`: the snapshot holds this process, so it must stay small (the
 * same rule `src/attach/__tests__/import-graph.test.ts` pins on the source).
 * Needs `npm run build` first and a Node with `module.registerHooks` (22.15+ on
 * 22.x, 23.5+ on 23.x; the repository's `.nvmrc` has it);
 * runs in about a second.
 *
 * Two options point the boot at the slim artifact's bundled entry, run by the
 * engine it ships with, exactly as `verify-slim-artifact.mjs` takes them:
 *
 *   --node <path>        the Node binary that boots the entry
 *   --artifact <dir>     the slim artifact directory; its entry is attach/main.js
 *
 * A bundle is one file, so the module-graph check does not apply to it; the
 * bundler holds the bundle's inputs to the same rule at build time
 * (attach-graph-rule.mjs). This script imports only Node built-ins and that
 * rule, so it runs inside an image from a mounted checkout.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { forbiddenAttachModules } from "./attach-graph-rule.mjs";

const { values: options } = parseArgs({
  options: {
    node: { type: "string", default: process.execPath },
    artifact: { type: "string" },
  },
});
const nodeBinary = options.node;
const entry = options.artifact
  ? join(resolve(options.artifact), "attach", "main.js")
  : fileURLToPath(new URL("../dist/attach/main.js", import.meta.url));
const TIMEOUT_MS = 30_000;

function fail(message) {
  console.error(`verify-attach-boot: FAIL — ${message}`);
  process.exit(1);
}

if (!existsSync(entry)) {
  fail(options.artifact ? `${entry} not found` : `${entry} not found — run \`npm run build\` first`);
}

// The module graph, loaded without starting the entry: entry.js exports the
// logic, main.js only calls it. A bundled entry was held to the rule when it
// was built.
let loaded = [];
if (!options.artifact) {
  loaded = compiledModuleGraph();
  const heavy = forbiddenAttachModules(loaded);
  if (heavy.length > 0) fail(`the attach entry loads modules a snapshot must not hold:\n${heavy.join("\n")}`);
}

function compiledModuleGraph() {
  const graphCheck = spawnSync(process.execPath, ["--input-type=module", "-e", `
  import { registerHooks } from "node:module";
  if (typeof registerHooks !== "function") { console.log("NO_HOOKS"); process.exit(0); }
  const seen = [];
  registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); seen.push(r.url); return r; } });
  await import(${JSON.stringify(new URL("../dist/attach/entry.js", import.meta.url).href)});
  console.log(JSON.stringify(seen));
`], { encoding: "utf8" });
  if (graphCheck.status !== 0) fail(`loading the entry's module graph failed:\n${graphCheck.stderr}`);
  if (graphCheck.stdout.trim() === "NO_HOOKS") fail("this Node has no module.registerHooks (it arrived in 22.15 on 22.x and 23.5 on 23.x); run it on the repository's .nvmrc Node");
  return JSON.parse(graphCheck.stdout);
}

const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});

const dir = mkdtempSync(join(tmpdir(), "stigmer-attach-boot-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const nameFile = join(dir, "actor-name");
writeFileSync(nameFile, "sbx-ses-000000000000");

const proc = spawn(nodeBinary, [entry], {
  env: { PATH: process.env.PATH, STIGMER_ATTACH_PORT: String(port), STIGMER_SANDBOX_NAME_FILE: nameFile },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
proc.stdout.on("data", (c) => (output += c));
proc.stderr.on("data", (c) => (output += c));
const exited = new Promise((resolve) => proc.on("exit", (code, signal) => resolve({ code, signal })));
const timer = setTimeout(() => {
  proc.kill("SIGKILL");
  fail(`no readiness within ${TIMEOUT_MS}ms.\n${output.slice(-2000)}`);
}, TIMEOUT_MS);

async function serving() {
  for (;;) {
    if (proc.exitCode !== null) fail(`the entry exited (code ${proc.exitCode}) before serving.\n${output.slice(-2000)}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (res.status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

await serving();
const refused = await fetch(`http://127.0.0.1:${port}/attach`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ taskQueue: "session:not-this-sandbox", secrets: {} }),
});
if (refused.status !== 403) {
  proc.kill("SIGKILL");
  fail(`a push for another sandbox's queue answered ${refused.status}, not 403`);
}
proc.kill("SIGTERM");
const { code, signal } = await exited;
clearTimeout(timer);
if (code !== 0) fail(`SIGTERM ended the entry with code ${code} (signal ${signal}).\n${output.slice(-2000)}`);
const graph = options.artifact
  ? `${entry} (a bundle, its inputs held to the rule at build time)`
  : `dist/attach loads ${loaded.length} modules, none of the runner or @temporalio;`;
console.log(`verify-attach-boot: PASS — ${graph} it served readiness, refused a foreign push and stopped cleanly`);
