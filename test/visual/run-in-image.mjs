#!/usr/bin/env node

/**
 * Runs the visual suite on this machine with every picture drawn by the
 * pinned image's browser (playwright-image.json), the browser CI's `visual`
 * job runs in, so a screenshot minted here is the one CI compares.
 *
 * Only the drawing happens in the image: it serves its browser
 * (`playwright run-server`) on a loopback port, and the suite runs here, on
 * this machine's own install, through Playwright's
 * `PW_TEST_CONNECT_WS_ENDPOINT` and `PW_TEST_CONNECT_EXPOSE_NETWORK`
 * (`<loopback>` routes the remote browser's `localhost` back here, to the
 * gallery the config serves). No `node_modules` crosses into Linux.
 *
 * The image is the arm64 one, which an Apple-silicon Mac and GitHub's
 * arm64 runner both run natively; an x64 machine runs it under emulation,
 * slower and with the same pixels.
 *
 * Usage (from the repository root, as `make test-visual` runs it):
 *   node test/visual/run-in-image.mjs [<playwright test arguments>...]
 * `--update-snapshots` mints the screenshots again. Exit: the suite's.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { image, platform } = JSON.parse(readFileSync(`${here}/playwright-image.json`, "utf8"));
const version = /playwright:v([0-9]+\.[0-9]+\.[0-9]+)-/.exec(image)?.[1];
if (!version) throw new Error(`run-in-image: ${image} names no Playwright version`);

const name = `stigmer-visual-${process.pid}`;
const LISTENING = /Listening on ws:\/\//;
const READY_MS = 120_000;

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...options }).trim();
}

function stop() {
  spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
}

async function main(args) {
  docker([
    "run", "--detach", "--rm", "--init",
    "--name", name,
    "--platform", platform,
    "--publish", "127.0.0.1::3000",
    "--user", "pwuser",
    "--workdir", "/home/pwuser",
    image,
    "/bin/sh", "-c", `npx -y playwright@${version} run-server --port 3000 --host 0.0.0.0`,
  ]);
  const deadline = Date.now() + READY_MS;
  while (!LISTENING.test(docker(["logs", name], { stdio: ["ignore", "pipe", "pipe"] }))) {
    if (Date.now() > deadline) throw new Error(`run-in-image: the browser server in ${image} did not start within ${READY_MS / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const endpoint = `ws://${docker(["port", name, "3000/tcp"]).split("\n")[0]}/`;
  console.error(`run-in-image: drawing in ${image} at ${endpoint}`);
  const suite = spawn("npx", ["playwright", "test", ...args], {
    cwd: here,
    stdio: "inherit",
    env: { ...process.env, PW_TEST_CONNECT_WS_ENDPOINT: endpoint, PW_TEST_CONNECT_EXPOSE_NETWORK: "<loopback>" },
  });
  return await new Promise((resolve) => suite.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stop();
    process.exit(130);
  });
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
} finally {
  stop();
}
