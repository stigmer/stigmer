// Web-console availability against the server's unified port.
//
// Since DD-012 (oss sub-project console-serving) the SERVER serves the
// console: the static export ships inside @stigmer/server-slim and the
// unified port's lane 4 serves it, synthesizing /config.json in-process.
// The CLI therefore PROBES rather than serves — /config.json answers 200
// exactly when a console export is bundled with the running server (a
// dev-tree server without the export falls through to the RPC adapter's
// 404), so the daemon's component state reports what a browser would
// actually find. The Go-era embedded console (go:embed on :8234) and the
// T05/T06 stub this file used to be are both retired by that design.

import { SERVER_PORT } from "../constants.js";

/** Keep the daemon's settle path snappy: a hung probe must not stall `stigmer up`. */
const PROBE_TIMEOUT_MS = 3000;

/** Whether the running server serves a bundled web console. */
export async function isWebConsoleAvailable(
  serverPort: number = SERVER_PORT,
): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${serverPort}/config.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
