// Allocates an ephemeral TCP port by binding to :0 and reading the assignment.
// Domain: conformance harness (server lifecycle).
//
// There is an inherent TOCTOU window between releasing the port here and the
// server binding it, but it is acceptable for ephemeral test servers and is the
// same approach the Go integration harness uses. The port is for a process
// about to bind it, never for an address that must stay dead: once released it
// is free for anyone (server-process.ts, ENGINELESS_TEMPORAL_HOST_PORT).
import { createServer } from "node:net";

export function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("failed to acquire a free port")));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}
