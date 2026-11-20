// The backend target every tool handler closes over, built from the Config
// and what an embedder passes to run(): the address and the startup key, the
// embedder's token provider, and its shared-disk switch. Its own module so a
// test reads what run() builds without starting a server, and so it stays
// off the package's public surface.

import type { Config } from "./config.js";
import type { BackendTarget } from "./domains/client.js";
import type { RunOptions } from "./index.js";

/** The target run() serves with: `localFiles` set only when the embedder asks for it. */
export function backendTargetOf(cfg: Config, options: RunOptions = {}): BackendTarget {
  return {
    serverAddress: cfg.stigmerServerAddress,
    apiKey: cfg.apiKey,
    ...(options.getAccessToken === undefined ? {} : { getAccessToken: options.getAccessToken }),
    ...(options.localFiles === true ? { localFiles: true as const } : {}),
  };
}
