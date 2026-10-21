// A TCP front for spawned servers: the stand-in for the Kubernetes Service a
// deployment's clients dial, so a server can be replaced under them.
// Domain: test support (stack spawns).
//
// Each spawned server binds its own ephemeral port (server-process.ts), so a
// client pointed at one server could never follow a replacement. The front
// listens on one port of its own (bound with 0, as ports.ts requires) and
// pipes each NEW connection to one of its live backends, alternating while
// two serve, as a Service balances connections across ready endpoints. An
// existing connection stays on the backend it was given until either side
// closes it, as it does through a Service: that is what lets a long-lived
// client (the runner) keep writing through an outgoing server while a new
// watcher lands on the incoming one, the rolling update's overlap. A
// backend removed from the front takes no new connections; the ones it has
// end when it exits.
//
// A connection that arrives while no backend is live waits for the next one
// added (a plain stop-then-start), and is dropped when the front closes.
import * as net from "node:net";

export interface TcpFront {
  // The port clients dial, and the matching base URL.
  readonly port: number;
  readonly baseUrl: string;
  // Starts sending new connections to a backend listening on this port.
  add(backendPort: number): void;
  // Stops sending new connections to a backend; its open ones stay.
  remove(backendPort: number): void;
  // The backends that take new connections, in the order they were added.
  backends(): readonly number[];
  // Stops listening and ends every connection through the front.
  close(): Promise<void>;
}

const HOST = "127.0.0.1";

export async function startTcpFront(): Promise<TcpFront> {
  const backends: number[] = [];
  const waiting: net.Socket[] = [];
  const open = new Set<net.Socket>();
  let next = 0;

  const pipeTo = (client: net.Socket, backendPort: number): void => {
    const upstream = net.connect({ host: HOST, port: backendPort });
    open.add(upstream);
    upstream.on("close", () => open.delete(upstream));
    // Either side ending or failing ends the pair, as a proxied connection does.
    const endBoth = (): void => {
      client.destroy();
      upstream.destroy();
    };
    upstream.on("error", endBoth);
    client.on("error", endBoth);
    upstream.on("close", endBoth);
    client.on("close", endBoth);
    client.pipe(upstream);
    upstream.pipe(client);
  };

  const route = (client: net.Socket): void => {
    if (backends.length === 0) {
      waiting.push(client);
      return;
    }
    const backendPort = backends[next % backends.length]!;
    next += 1;
    pipeTo(client, backendPort);
  };

  const server = net.createServer((client) => {
    open.add(client);
    client.on("close", () => {
      open.delete(client);
      const index = waiting.indexOf(client);
      if (index !== -1) waiting.splice(index, 1);
    });
    client.on("error", () => client.destroy());
    route(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("the TCP front bound no port");
  }
  const port = address.port;

  return {
    port,
    baseUrl: `http://${HOST}:${port}`,
    add(backendPort) {
      if (!backends.includes(backendPort)) backends.push(backendPort);
      for (const client of waiting.splice(0)) route(client);
    },
    remove(backendPort) {
      const index = backends.indexOf(backendPort);
      if (index !== -1) backends.splice(index, 1);
    },
    backends: () => [...backends],
    async close() {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of open) socket.destroy();
      waiting.length = 0;
      await closed;
    },
  };
}
