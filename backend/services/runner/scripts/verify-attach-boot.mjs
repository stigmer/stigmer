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
 * runner is started. Needs `npm run build` first; runs in about a second.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/attach/main.js", import.meta.url));
const TIMEOUT_MS = 30_000;

function fail(message) {
  console.error(`verify-attach-boot: FAIL — ${message}`);
  process.exit(1);
}

if (!existsSync(entry)) fail(`${entry} not found — run \`npm run build\` first`);

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

const proc = spawn(process.execPath, [entry], {
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
console.log("verify-attach-boot: PASS — dist/attach/main.js served readiness, refused a foreign push and stopped cleanly");
