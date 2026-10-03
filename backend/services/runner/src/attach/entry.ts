/**
 * The attach entry's logic, kept apart from `main.ts` (the process boundary)
 * so it is tested: the configuration read from the sandbox's environment, the
 * waiter it starts (`waiter.ts`), and how a signal stops it.
 *
 * Configuration:
 *
 *   - `STIGMER_ATTACH_PORT`: the listener's port, 80 by default, the port a
 *     Substrate router reaches without a `CONNECT` tunnel.
 *   - `STIGMER_SANDBOX_NAME_FILE`: the file holding this sandbox's name, read
 *     on every push because a clone has its own; `/run/ate/actor-name` by
 *     default, where a template's actor-metadata volume projects it.
 *
 * The runner it starts is the package's own entry, `../main.js` beside this
 * module, run by the same Node. Every other variable is passed to the runner
 * unchanged; these two are not (`WAITER_ENV_KEYS`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startAttachWaiter, type AttachWaiter, type AttachWaiterOptions } from "./waiter.js";

const DEFAULT_PORT = 80;
const DEFAULT_SANDBOX_NAME_FILE = "/run/ate/actor-name";

export interface AttachEntryConfig {
  readonly port: number;
  readonly sandboxNameFile: string;
  readonly runnerEntry: string;
}

/** The entry's configuration from the sandbox's environment. Throws on an unusable port. */
export function attachEntryConfig(env: NodeJS.ProcessEnv): AttachEntryConfig {
  const rawPort = env.STIGMER_ATTACH_PORT;
  let port = DEFAULT_PORT;
  if (rawPort !== undefined && rawPort !== "") {
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`STIGMER_ATTACH_PORT must be a port number; got ${rawPort}`);
    }
  }
  return {
    port,
    sandboxNameFile: env.STIGMER_SANDBOX_NAME_FILE || DEFAULT_SANDBOX_NAME_FILE,
    runnerEntry: join(dirname(fileURLToPath(import.meta.url)), "..", "main.js"),
  };
}

/** What the entry needs from its process; `main.ts` passes the real ones. */
export interface AttachEntryHost {
  onSignal(signal: "SIGTERM" | "SIGINT", handler: () => void): void;
  exit(code: number): void;
  log(message: string): void;
}

/**
 * Start the waiter for this sandbox and stop it on SIGTERM or SIGINT: the
 * runner first, waiting for its graceful shutdown, then the process.
 */
export async function runAttachEntry(
  env: NodeJS.ProcessEnv,
  host: AttachEntryHost,
  start: (options: AttachWaiterOptions) => Promise<AttachWaiter> = startAttachWaiter,
): Promise<AttachWaiter> {
  const config = attachEntryConfig(env);
  const waiter = await start({
    port: config.port,
    readSandboxName: () => readFileSync(config.sandboxNameFile, "utf8").trim(),
    runnerEntry: config.runnerEntry,
    baseEnv: env,
    log: host.log,
  });
  host.log(`[attach] waiting for a push on port ${waiter.port}`);

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    host.log(`[attach] received ${signal}; stopping the runner`);
    waiter.close().then(
      () => host.exit(0),
      (err: unknown) => {
        host.log(`[attach] stop failed: ${err instanceof Error ? err.message : String(err)}`);
        host.exit(1);
      },
    );
  };
  host.onSignal("SIGTERM", () => stop("SIGTERM"));
  host.onSignal("SIGINT", () => stop("SIGINT"));
  return waiter;
}
