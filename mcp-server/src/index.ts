// Public, embeddable surface for the Stigmer MCP server.
//
// Mirrors Go pkg/mcpserver: a minimal API — load a Config from the environment,
// then run() the server until the provided AbortSignal fires. The Stigmer CLI
// (and any other host) embeds the server through this module.

import { loadConfigFromEnv, validateConfig, type Config } from "./config.js";
import { configureLogger, log } from "./logger.js";
import {
  isNormalShutdown,
  routedServerFactory,
  serveBoth,
  serveHttp,
  serveStdio,
  stdioServer,
} from "./server.js";
import type { BackendTarget } from "./domains/client.js";

export type { Config, OAuthConfig, Roster, Transport } from "./config.js";
export { loadConfigFromEnv, validateConfig } from "./config.js";
export { createServer, createRecordsServer, RECORDS_ROUTE, SERVER_VERSION } from "./server.js";

/** Returns a Config populated from environment variables (no validation). */
export function defaultConfig(): Config {
  return loadConfigFromEnv();
}

/**
 * Start the MCP server with the given configuration and run until `signal`
 * aborts or a fatal error occurs. The caller owns signal handling:
 *
 * ```ts
 * const ac = new AbortController();
 * process.on("SIGINT", () => ac.abort());
 * await run(defaultConfig(), ac.signal);
 * ```
 *
 * A clean client disconnect resolves normally (see {@link isNormalShutdown}).
 */
export async function run(cfg: Config, signal: AbortSignal): Promise<void> {
  configureLogger({ level: cfg.logLevel, format: cfg.logFormat });
  validateConfig(cfg);

  log.info("mcp-server-stigmer starting", { transport: cfg.transport });

  const target: BackendTarget = {
    serverAddress: cfg.stigmerServerAddress,
    apiKey: cfg.apiKey,
  };

  try {
    switch (cfg.transport) {
      case "stdio":
        await serveStdio(stdioServer(target, cfg), signal);
        break;
      case "http":
        await serveHttp(routedServerFactory(target), cfg, signal);
        break;
      case "both":
        await serveBoth(target, cfg, signal);
        break;
    }
  } catch (err) {
    if (!isNormalShutdown(err)) {
      log.error("mcp-server-stigmer stopped", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  log.info("mcp-server-stigmer stopped");
}
