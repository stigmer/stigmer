#!/usr/bin/env node

/**
 * Boots a compiled server entry with plain `node` and verifies the full
 * lifecycle: bind → "listening" log → SIGTERM → clean exit 0.
 *
 * Why this gate exists (the runner's #399 lesson): vitest/tsx module
 * interop tolerates ESM/CJS import shapes that Node's real loader rejects,
 * so an import-time boot crash can pass typecheck AND the whole test suite.
 * This is the only gate that executes the artifact the way the CLI daemon
 * will.
 *
 * Usage: node scripts/verify-boot.mjs <entry-relative-to-package>
 *        (e.g. dist/main.js or dist-slim/main.js)
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = process.argv[2];
if (entry === undefined) {
  console.error("verify-boot: missing entry argument (e.g. dist/main.js)");
  process.exit(1);
}

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const BOOT_TIMEOUT_MS = 15_000;

const child = spawn(process.execPath, [join(serverRoot, entry)], {
  env: { ...process.env, GRPC_PORT: "0", LOG_LEVEL: "info", ENV: "ci" },
  stdio: ["ignore", "inherit", "pipe"],
});

let stderr = "";
let sawListening = false;

const timer = setTimeout(() => {
  console.error(
    `verify-boot: no "listening" log within ${BOOT_TIMEOUT_MS}ms\n${stderr}`,
  );
  child.kill("SIGKILL");
  process.exit(1);
}, BOOT_TIMEOUT_MS);

child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
  if (!sawListening && stderr.includes("listening")) {
    sawListening = true;
    clearTimeout(timer);
    child.kill("SIGTERM");
  }
});

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (sawListening && code === 0) {
    console.log(`verify-boot: ${entry} booted, served, and shut down cleanly`);
    process.exit(0);
  }
  console.error(
    `verify-boot: ${entry} failed (listening=${sawListening}, code=${code}, signal=${signal})\n${stderr}`,
  );
  process.exit(1);
});
