// Web-console availability against the server's unified port.
//
// The SERVER serves the console: the static export ships inside
// @stigmer/server-slim and the unified port's lane 4 serves it,
// synthesizing /config.json in-process. The CLI therefore PROBES rather
// than serves — /config.json answers 200 exactly when a console export
// is bundled with the running server (a dev-tree server without the
// export falls through to the RPC adapter's 404), so the daemon's
// component state reports what a browser would actually find.

import { SERVER_PORT } from "../constants.js";

/** Keep the daemon's settle path snappy: a hung probe must not stall `stigmer up`. */
const PROBE_TIMEOUT_MS = 3000;

/**
 * Whether the running server serves a bundled web console. `stop` ends the
 * probe early (the daemon's stop request), answering false.
 */
export async function isWebConsoleAvailable(
  serverPort: number = SERVER_PORT,
  stop?: AbortSignal,
): Promise<boolean> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${serverPort}/config.json`, {
      signal: stop === undefined ? timeout : AbortSignal.any([timeout, stop]),
    });
    return response.ok;
  } catch {
    return false;
  }
}
