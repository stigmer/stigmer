/**
 * Process entry for stigmer-server-ts. The CLI's daemon launches this the
 * way it launches the runner: a node binary + bundled entry path, with the
 * env contract from daemon/env.ts (GRPC_PORT et al.) and a TCP readiness
 * probe on the bound port.
 *
 * SIGTERM/SIGINT run the composed shutdown (NOT_SERVING → drain → exit) —
 * the daemon stops components with signals, and in-flight requests get the
 * drain budget rather than a mid-write connection reset.
 */
import { loadConfig } from "./boot/config.js";
import { composeServer } from "./boot/compose.js";
import { createLogger } from "./boot/logger.js";

const config = loadConfig();
const logger = createLogger({
  level: config.logLevel,
  pretty: config.env === "local",
});
const server = composeServer({ config, logger });

let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info("shutting down", { signal });
  server
    .shutdown()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error("shutdown failed", { error: String(error) });
      process.exit(1);
    });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.start().catch((error: unknown) => {
  logger.error("boot failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
