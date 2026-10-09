/**
 * The agent host's channel and peer (`agent-host/channel.ts`).
 *
 * Pinned:
 *  - a stream carries whole lines however its bytes are chunked, and a line
 *    past the size cap closes the channel instead of being buffered;
 *  - a call is answered by exactly its result, a handler's rejection is the
 *    caller's error, and every pending call rejects when the channel closes;
 *  - a peer that sends a line that is not JSON, or of an unknown kind, is
 *    disconnected;
 *  - a `hello` is kept for whoever asks, before or after it arrived, and a
 *    peer that never sends one is given up on;
 *  - the loopback holds a line sent before the far end listens, as a pipe's
 *    buffer does.
 */

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { Peer, loopbackChannels, streamChannel, type LineChannel } from "../channel.js";
import { MAX_MESSAGE_BYTES } from "../protocol.js";

interface EchoCalls {
  readonly echo: { readonly args: { readonly text: string }; readonly result: string };
  readonly fail: { readonly args: Record<string, never>; readonly result: null };
}
interface Notices {
  readonly ping: { readonly n: number };
}

function pair(): readonly [Peer<EchoCalls, EchoCalls, Notices, Notices>, Peer<EchoCalls, EchoCalls, Notices, Notices>, LineChannel] {
  const [a, b] = loopbackChannels();
  return [new Peer(a, "a"), new Peer(b, "b"), a];
}

describe("the stream channel", () => {
  it("reassembles lines across chunks and splits several in one chunk", () => {
    const input = new PassThrough();
    const channel = streamChannel(input, new PassThrough());
    const lines: string[] = [];
    channel.onLine((line) => lines.push(line));

    input.write('{"a":');
    input.write('1}\n{"b":2}\n{"c"');
    input.write(":3}\n");

    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("closes rather than buffer a line past the cap", () => {
    const input = new PassThrough();
    const channel = streamChannel(input, new PassThrough());
    const reasons: Error[] = [];
    channel.onClose((reason) => reasons.push(reason));

    input.write("x".repeat(MAX_MESSAGE_BYTES + 1));

    expect(reasons.map((r) => r.message)).toEqual([`agent host channel: a message exceeded ${MAX_MESSAGE_BYTES} bytes`]);
  });
});

describe("the stream channel's failures", () => {
  it("stops reading the lines of a chunk once a listener closed the channel", () => {
    const input = new PassThrough();
    const channel = streamChannel(input, new PassThrough());
    const lines: string[] = [];
    channel.onLine((line) => {
      lines.push(line);
      channel.close(new Error("enough"));
    });

    input.write("one\ntwo\n");
    expect(lines).toEqual(["one"]);
  });

  it("closes once, with the error, when either stream fails", () => {
    for (const failing of ["input", "output"] as const) {
      const input = new PassThrough();
      const output = new PassThrough();
      const channel = streamChannel(input, output);
      const reasons: string[] = [];
      channel.onClose((reason) => reasons.push(reason.message));

      (failing === "input" ? input : output).emit("error", new Error(`${failing} broke`));
      channel.close();
      expect(reasons, failing).toEqual([`${failing} broke`]);
    }
  });

  it("writes nothing once closed", () => {
    const output = new PassThrough();
    const channel = streamChannel(new PassThrough(), output);
    channel.close();
    channel.send("late");
    expect(output.read()).toBeNull();
  });
});

describe("the peer", () => {
  it("answers a call with its result and a handler's rejection with its error", async () => {
    const [caller, answerer] = pair();
    answerer.handle("echo", async ({ text }) => `echo: ${text}`);
    answerer.handle("fail", async () => {
      throw new TypeError("no such thing");
    });

    expect(await caller.call("echo", { text: "hi" })).toBe("echo: hi");
    const failure = await caller.call("fail", {}).catch((err: Error) => err);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe("TypeError");
    expect((failure as Error).message).toBe("no such thing");
  });

  it("rejects every pending call, and every later one, when the channel closes", async () => {
    const [caller, answerer, channel] = pair();
    answerer.handle("echo", () => new Promise(() => {}));
    const pending = caller.call("echo", { text: "never answered" });

    channel.close(new Error("the host went away"));

    await expect(pending).rejects.toThrow("the host went away");
    await expect(caller.call("echo", { text: "after" })).rejects.toThrow("the host went away");
  });

  it("delivers notices, and a throwing listener breaks nothing", async () => {
    const [sender, receiver] = pair();
    const seen: number[] = [];
    receiver.onNotice("ping", ({ n }) => {
      seen.push(n);
      if (n === 1) throw new Error("listener bug");
    });
    receiver.handle("echo", async ({ text }) => text);

    sender.notify("ping", { n: 1 });
    sender.notify("ping", { n: 2 });
    expect(await sender.call("echo", { text: "still talking" })).toBe("still talking");
    expect(seen).toEqual([1, 2]);
  });

  it("disconnects a peer that sends a line that is not JSON, or of an unknown kind", async () => {
    for (const line of ["not json", JSON.stringify({ kind: "exfiltrate" })]) {
      const [a, b] = loopbackChannels();
      const peer = new Peer<EchoCalls, EchoCalls, Notices, Notices>(a, "runner");
      const closed = new Promise<Error>((resolve) => peer.onClose(resolve));
      b.send(line);
      expect((await closed).message).toMatch(/^runner: the peer sent /);
    }
  });

  it("keeps a hello for whoever asks, before or after it arrives, and gives up on one that never comes", async () => {
    const [a, b] = pair();
    b.sendHello(7);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await a.receivedHello(1_000), "asked after it arrived").toBe(7);

    const [c, d] = pair();
    const asked = c.receivedHello(1_000);
    d.sendHello(8);
    expect(await asked, "asked before it arrived").toBe(8);

    const [silent] = pair();
    await expect(silent.receivedHello(20)).rejects.toThrow("a: the peer did not announce itself within 20ms");
  });
});

describe("the peer's edges", () => {
  it("refuses to send a call, a notice or a result past the size cap", async () => {
    const [caller, answerer] = pair();
    const big = "x".repeat(MAX_MESSAGE_BYTES);
    await expect(caller.call("echo", { text: big })).rejects.toThrow(`a: the echo call exceeds ${MAX_MESSAGE_BYTES} bytes`);

    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => void warned.push(message);
    try {
      caller.notify("ping", { n: Number.NaN, pad: big } as unknown as { n: number });
    } finally {
      console.warn = warn;
    }
    expect(warned).toEqual([`a: dropped a ping notice larger than ${MAX_MESSAGE_BYTES} bytes`]);

    answerer.handle("echo", async () => big);
    await expect(caller.call("echo", { text: "make it big" })).rejects.toThrow(`b: the echo result exceeds ${MAX_MESSAGE_BYTES} bytes`);
  });

  it("answers a call no handler serves with an error, and ignores a result for no call", async () => {
    const [caller, , channel] = pair();
    await expect(caller.call("echo", { text: "anyone?" })).rejects.toThrow("b: no handler for echo");
    channel.send(JSON.stringify({ kind: "result", id: 9_999, ok: true, value: null }));
    channel.send(JSON.stringify({ kind: "notify", method: "unheard", args: {} }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(caller.closed).toBe(false);
  });

  it("tells a late close listener the reason at once, and sends nothing once closed", async () => {
    const [a, b, channel] = pair();
    const heard: number[] = [];
    b.onNotice("ping", ({ n }) => void heard.push(n));
    channel.close(new Error("gone"));
    const reasons: string[] = [];
    a.onClose((reason) => reasons.push(reason.message));
    a.notify("ping", { n: 1 });
    channel.send("ignored");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reasons).toEqual(["gone"]);
    expect(heard).toEqual([]);
    await expect(a.receivedHello(10)).rejects.toThrow("gone");
  });
});

describe("the loopback", () => {
  it("holds a line sent before the far end listens", async () => {
    const [a, b] = loopbackChannels();
    a.send("early");
    const lines: string[] = [];
    b.onLine((line) => lines.push(line));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lines).toEqual(["early"]);
  });
});
