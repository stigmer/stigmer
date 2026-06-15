// Embedded web-console availability.
//
// The Go CLI embeds the console's static assets via go:embed and serves them on
// :8234. There is no TS equivalent bundled in T05, so the daemon detects the
// console as unavailable and skips it cleanly (recording a "stopped" state),
// exactly as the Go daemon does when built without assets. Real serving — and
// the asset-bundling decision behind it — is deferred to T06.

/** Whether an embedded web console is available to serve. Always false until
 * T06 wires asset bundling + an HTTP handler. */
export function isWebConsoleAvailable(): boolean {
  return false;
}
