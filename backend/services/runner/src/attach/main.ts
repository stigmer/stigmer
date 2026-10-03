/**
 * Entry point of a sandbox that waits to be attached: `node <dist>/attach/main.js`.
 *
 * It starts the attach waiter (`waiter.ts`, whose header says why a sandbox
 * snapshot holds a waiter and never a runner) and nothing else: it imports
 * none of the runner's modules, so the snapshot holds a small idle process.
 * The runner it starts is the package's own entry, `../main.js`, run by the
 * same Node.
 *
 * Configuration, read from the sandbox's environment:
 *
 *   - `STIGMER_ATTACH_PORT`: the listener's port, 80 by default, the port a
 *     Substrate router reaches without a `CONNECT` tunnel.
 *   - `STIGMER_SANDBOX_NAME_FILE`: the file holding this sandbox's name, read
 *     on every push because a clone has its own; `/run/ate/actor-name` by
 *     default, where a template's actor-metadata volume projects it.
 *
 * Every other variable is passed to the runner unchanged; these two are not.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startAttachWaiter } from "./waiter.js";

const DEFAULT_PORT = 80;
const DEFAULT_SANDBOX_NAME_FILE = "/run/ate/actor-name";

function portFrom(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`STIGMER_ATTACH_PORT must be a port number; got ${value}`);
  }
  return port;
}

async function main(): Promise<void> {
  const nameFile = process.env.STIGMER_SANDBOX_NAME_FILE || DEFAULT_SANDBOX_NAME_FILE;
  const waiter = await startAttachWaiter({
    port: portFrom(process.env.STIGMER_ATTACH_PORT),
    readSandboxName: () => readFileSync(nameFile, "utf8").trim(),
    runnerEntry: join(dirname(fileURLToPath(import.meta.url)), "..", "main.js"),
    baseEnv: process.env,
  });
  console.warn(`[attach] waiting for a push on port ${waiter.port}`);

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.warn(`[attach] received ${signal}; stopping the runner`);
    void waiter.close().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error("[attach] stop failed:", err);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("[attach] fatal:", err);
  process.exit(1);
});
