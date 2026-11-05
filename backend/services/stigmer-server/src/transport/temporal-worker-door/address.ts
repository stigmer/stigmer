/**
 * The Temporal address a sandbox's runner is handed: the Stigmer server's
 * own host and port, as the backend endpoint names them, where the
 * server's Temporal worker lane serves a sandboxed runner its own queue
 * (transport/temporal-worker-door/lane.ts). The runner knows the lane by
 * exactly this equality (runner src/temporal-lane.ts) and presents its
 * sandbox token there, so the endpoint is read the way the runner reads it:
 * no scheme is `http://`, or `https://` on port 443, and a scheme's default
 * port is filled in.
 */
export function temporalAddressThroughServer(backendEndpoint: string): string {
  const withScheme = /^https?:\/\//.test(backendEndpoint)
    ? backendEndpoint
    : backendEndpoint.endsWith(":443")
      ? `https://${backendEndpoint}`
      : `http://${backendEndpoint}`;
  const url = new URL(withScheme);
  const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
  return `${url.hostname}:${port}`;
}
