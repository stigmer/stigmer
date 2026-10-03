/**
 * One server process, start to signal: read the config, make the logger,
 * install the operator identity, compose the given units, start, print the
 * ready line, and on SIGTERM or SIGINT run the composed shutdown (NOT_SERVING
 * → drain → exit). The CLI's daemon, the container image and the test
 * harnesses all start a process this way.
 *
 * Two entries call it with different units, so the two cannot drift in how
 * a process boots:
 *
 *   - main.ts, the shipped entry: the open-source edition's unit
 *     (editions/open-source.ts), so the server holds one organization;
 *   - the test harness's library entry (test/support/src/library-server.mjs):
 *     no unit, the library as a composition sees it, holding any number of
 *     organizations, which the suites that prove isolation between
 *     organizations run on.
 *
 * Not on the package barrel: no composition outside this repository needs
 * a process body, and the Cloud's entry boots differently on purpose.
 *
 * The process itself is a port (`ProcessHost`), so a test drives the whole
 * body in-process: the real process registers signal handlers, exits and
 * writes stdout; a test records them.
 */
import { loadConfig } from "./config.js";
import { composeServer } from "./compose.js";
import { createLogger } from "./logger.js";
import { announceReady } from "./ready-line.js";
import type { ServerExtension } from "../extensions/registry.js";
import { setOperatorIdentity } from "../pipeline/steps/defaults.js";

/** What a server process needs from its host process. */
export interface ProcessHost {
  onSignal(signal: "SIGTERM" | "SIGINT", handler: () => void): void;
  exit(code: number): void;
  writeStdout(text: string): void;
}

/** The host a real process is. */
export const nodeProcessHost: ProcessHost = {
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  exit: (code) => process.exit(code),
  writeStdout: (text) => {
    process.stdout.write(text);
  },
};

export interface RunServerOptions {
  /** The composed units, in order. */
  readonly extensions: ReadonlyArray<ServerExtension>;
  readonly host?: ProcessHost;
}

/**
 * Boots the server. Rejects when the config or the composition fails,
 * before any logger is sure to exist (the caller reports it on stderr);
 * a failed start is logged and exits 1.
 */
export async function runServer(options: RunServerOptions): Promise<void> {
  const host = options.host ?? nodeProcessHost;
  const config = loadConfig();
  const logger = createLogger({
    level: config.logLevel,
    pretty: config.env === "local",
  });
  // Once per process, before any writer exists (#400) — the one-shot guard
  // makes a duplicate install a loud boot bug.
  setOperatorIdentity(config.operatorEmail, config.operatorName);
  const server = await composeServer({
    config,
    logger,
    extensions: options.extensions,
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });
    server
      .shutdown()
      .then(() => host.exit(0))
      .catch((error: unknown) => {
        logger.error("shutdown failed", { error: String(error) });
        host.exit(1);
      });
  };
  host.onSignal("SIGTERM", () => shutdown("SIGTERM"));
  host.onSignal("SIGINT", () => shutdown("SIGINT"));

  try {
    await server.start();
  } catch (error) {
    logger.error("boot failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    host.exit(1);
    return;
  }
  announceReady(config.readyLine, server.boundPorts(), (line) =>
    host.writeStdout(line),
  );
}
