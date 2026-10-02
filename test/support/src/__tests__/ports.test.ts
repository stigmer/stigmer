// Unit arms for the port helpers a harness uses on a port it hands from one
// run to the next: a live listener is reachable and a closed one is not; the
// wait for a refusal resolves at once on a free port, resolves when the
// listener closes inside the budget, and rejects naming the port when it
// never does (stigmer#1594).
// Real loopback listeners on ports bound with listen(0), per this package's
// ports law. No target.
// Domain: test support (stack spawns).
import * as net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { isPortReachable, waitForPortRefusal } from "../ports.ts";

const servers: net.Server[] = [];

function listen(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.destroy());
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as net.AddressInfo).port }));
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).filter((s) => s.listening).map(close));
});

describe("isPortReachable", () => {
  it("sees a listener, and no longer once it closes", async () => {
    const { server, port } = await listen();
    expect(await isPortReachable(port)).toBe(true);
    await close(server);
    expect(await isPortReachable(port)).toBe(false);
  });
});

describe("waitForPortRefusal", () => {
  it("resolves at once when nothing listens", async () => {
    const { server, port } = await listen();
    await close(server);
    expect(await waitForPortRefusal(port, { timeoutMs: 1_000 })).toBeLessThan(500);
  });

  it("resolves once the listener closes inside the budget", async () => {
    const { server, port } = await listen();
    setTimeout(() => void close(server), 300);
    const waited = await waitForPortRefusal(port, { timeoutMs: 5_000, intervalMs: 50 });
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(5_000);
  });

  it("rejects, naming the port, when the listener outlives the budget", async () => {
    const { port } = await listen();
    await expect(waitForPortRefusal(port, { timeoutMs: 400, intervalMs: 50 })).rejects.toThrow(
      `127.0.0.1:${port} still accepts connections after 400 ms`,
    );
  });
});
