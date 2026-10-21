// Unit arms for the TCP front (tcp-front.ts): new connections alternate
// between live backends, an open connection stays on its backend after that
// backend is removed (the rolling update's overlap), a connection that
// arrives with no backend waits for the next one added, and closing the
// front ends what passes through it.
// Real loopback listeners on ports bound with listen(0), per this package's
// ports law. No target.
// Domain: test support (stack spawns).
import * as net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startTcpFront, type TcpFront } from "../tcp-front.ts";

const servers: net.Server[] = [];
const fronts: TcpFront[] = [];

// A backend that answers each line with its own name, then the line.
function backend(name: string): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on("data", (chunk) => socket.write(`${name}:${chunk.toString()}`));
      socket.on("error", () => socket.destroy());
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
}

async function front(): Promise<TcpFront> {
  const started = await startTcpFront();
  fronts.push(started);
  return started;
}

// One connection through the front, and a way to ask it a line.
function connect(port: number): { ask(line: string): Promise<string>; closed: Promise<void>; end(): void } {
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.on("error", () => undefined);
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  return {
    ask: (line) =>
      new Promise((resolve) => {
        socket.once("data", (chunk) => resolve(chunk.toString()));
        socket.write(line);
      }),
    closed,
    end: () => socket.destroy(),
  };
}

afterEach(async () => {
  await Promise.all(fronts.splice(0).map((f) => f.close()));
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => (s.listening ? s.close(() => resolve()) : resolve()))),
  );
});

describe("the TCP front", () => {
  it("alternates new connections between the backends that serve", async () => {
    const f = await front();
    f.add(await backend("a"));
    f.add(await backend("b"));
    const answers = [];
    for (let i = 0; i < 4; i++) {
      const c = connect(f.port);
      answers.push(await c.ask("hi"));
      c.end();
    }
    expect(answers).toEqual(["a:hi", "b:hi", "a:hi", "b:hi"]);
    expect(f.baseUrl).toBe(`http://127.0.0.1:${f.port}`);
  });

  it("keeps an open connection on its backend after that backend is removed; new ones go to the rest", async () => {
    const f = await front();
    const a = await backend("a");
    f.add(a);
    const held = connect(f.port);
    expect(await held.ask("one")).toBe("a:one");
    f.add(await backend("b"));
    f.remove(a);
    expect(f.backends()).toHaveLength(1);
    const fresh = connect(f.port);
    expect(await fresh.ask("two")).toBe("b:two");
    expect(await held.ask("three"), "the outgoing backend still serves its connection").toBe("a:three");
    held.end();
    fresh.end();
  });

  it("holds a connection that arrives with no backend until one is added", async () => {
    const f = await front();
    const waiting = connect(f.port);
    const answer = waiting.ask("late");
    await new Promise((resolve) => setTimeout(resolve, 50));
    f.add(await backend("c"));
    expect(await answer).toBe("c:late");
    waiting.end();
  });

  it("closing the front ends the connections through it", async () => {
    const f = await front();
    f.add(await backend("a"));
    const c = connect(f.port);
    await c.ask("x");
    await f.close();
    fronts.splice(0);
    await c.closed;
  });
});
