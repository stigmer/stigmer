/**
 * The agent host's message channel: newline-delimited JSON over a pair of
 * streams, and the call/result/notice peer both processes speak through it
 * (`protocol.ts` has the envelopes and why they are shaped so).
 *
 * Two transports, one peer. Production is a pipe on the host's fd 3
 * ({@link streamChannel}); the tests run the host in the runner's own
 * process over {@link loopbackChannels}, which still encodes and decodes
 * every message as the pipe would, while a test double (`vi.mock` of the
 * model client) still reaches the adapter on the far side. The loopback
 * delivers each line as a microtask: the serialization is the pipe's, the
 * latency is not. A hermetic golden pins a transcript against a scripted
 * model that answers at once, and a hop that took a turn of the event loop
 * would let that model run a step ahead of the adapter's loop, which a real
 * model's latency never does (`hermetic-activity.ts` `ExecutionRecord.
 * whenToolCallsSettled` has the whole reason). A real pipe's asynchrony is
 * the spawned host's tests' to show.
 *
 * A line longer than `MAX_MESSAGE_BYTES` is the peer misbehaving: the
 * reader closes the channel rather than buffer without bound. A message
 * too large to send is refused by the sender: a call rejects, a result
 * becomes an error result, a notice is dropped with one log line.
 *
 * Closing is final and idempotent. Every pending call rejects with the
 * close's reason, so a turn waiting on a host that died settles at once
 * (`remote-adapter.ts`).
 */

import type { Readable, Writable } from "node:stream";

import { MAX_MESSAGE_BYTES, fromWireError, toWireError, type ResultEnvelope, type WireError } from "./protocol.js";

/** A bidirectional line transport. */
export interface LineChannel {
  send(line: string): void;
  onLine(listener: (line: string) => void): void;
  /** Called once, when either side closes or the transport fails. */
  onClose(listener: (reason: Error) => void): void;
  close(reason?: Error): void;
}

/**
 * A channel over a readable and a writable stream: the host's fd 3 in both
 * processes. Bytes are held as they arrive and only the new chunk is scanned
 * for the newline, so a message costs time in proportion to its size; the
 * cap counts bytes, and a line is decoded whole, so a character split
 * between chunks arrives intact.
 */
export function streamChannel(input: Readable, output: Writable, maxMessageBytes: number = MAX_MESSAGE_BYTES): LineChannel {
  const lineListeners: ((line: string) => void)[] = [];
  const closeListeners: ((reason: Error) => void)[] = [];
  let closed = false;
  let pending: Buffer[] = [];
  let pendingBytes = 0;

  const close = (reason: Error = new Error("agent host channel closed")): void => {
    if (closed) return;
    closed = true;
    input.removeAllListeners("data");
    input.destroy();
    output.destroy();
    for (const listener of closeListeners) listener(reason);
  };
  const tooLarge = (): void => close(new Error(`agent host channel: a message exceeded ${maxMessageBytes} bytes`));

  input.on("data", (chunk: Buffer) => {
    let start = 0;
    let newline = chunk.indexOf(0x0a);
    while (newline !== -1) {
      if (pendingBytes + newline - start > maxMessageBytes) return tooLarge();
      const piece = chunk.subarray(start, newline);
      const line = (pending.length === 0 ? piece : Buffer.concat([...pending, piece])).toString("utf8");
      pending = [];
      pendingBytes = 0;
      start = newline + 1;
      if (line.length > 0) for (const listener of lineListeners) listener(line);
      if (closed) return;
      newline = chunk.indexOf(0x0a, start);
    }
    if (start < chunk.length) {
      pending.push(chunk.subarray(start));
      pendingBytes += chunk.length - start;
    }
    if (pendingBytes > maxMessageBytes) tooLarge();
  });
  input.on("end", () => close());
  input.on("error", (err) => close(err));
  output.on("error", (err) => close(err));

  return {
    send(line) {
      if (!closed) output.write(`${line}\n`);
    },
    onLine(listener) {
      lineListeners.push(listener);
    },
    onClose(listener) {
      closeListeners.push(listener);
    },
    close,
  };
}

/** What a message of a known kind is missing, as the sentence a closed channel gives; `null` when it is whole. */
function malformedEnvelope(message: { kind?: unknown; id?: unknown; method?: unknown; ok?: unknown; error?: unknown }): string | null {
  switch (message.kind) {
    case "call":
      return typeof message.id === "number" && typeof message.method === "string" ? null : "a call without a numeric id and a method";
    case "result": {
      if (typeof message.id !== "number" || typeof message.ok !== "boolean") return "a result without a numeric id and an ok flag";
      const error = message.error as { message?: unknown } | null | undefined;
      return message.ok || (typeof error === "object" && error !== null && typeof error.message === "string") ? null : "a failed result without an error message";
    }
    case "notify":
      return typeof message.method === "string" ? null : "a notice without a method";
    default:
      return null;
  }
}

/**
 * Two connected in-process channels. Each line is delivered as a microtask
 * (the header says why), in order; a line sent before the far end listens
 * waits for its first listener, as a pipe's bytes wait in its buffer.
 * Closing either end closes both.
 */
export function loopbackChannels(): readonly [LineChannel, LineChannel] {
  type End = { lines: ((line: string) => void)[]; closes: ((reason: Error) => void)[]; waiting: string[] };
  const a: End = { lines: [], closes: [], waiting: [] };
  const b: End = { lines: [], closes: [], waiting: [] };
  let closed = false;
  const closeBoth = (reason: Error = new Error("agent host channel closed")): void => {
    if (closed) return;
    closed = true;
    for (const listener of [...a.closes, ...b.closes]) listener(reason);
  };
  const deliver = (to: End, line: string): void => {
    queueMicrotask(() => {
      if (!closed) for (const listener of to.lines) listener(line);
    });
  };
  const end = (self: End, peer: End): LineChannel => ({
    send(line) {
      if (closed) return;
      if (peer.lines.length === 0) peer.waiting.push(line);
      else deliver(peer, line);
    },
    onLine(listener) {
      self.lines.push(listener);
      for (const line of self.waiting.splice(0)) deliver(self, line);
    },
    onClose(listener) {
      self.closes.push(listener);
    },
    close: closeBoth,
  });
  return [end(a, b), end(b, a)];
}

type Handler = (args: never) => Promise<unknown>;
type NoticeListener = (args: never) => void;

/** A table of calls: each method's arguments and result (`protocol.ts` `HostCalls`, `RunnerCalls`). */
export type CallMap<T> = { readonly [M in keyof T]: { readonly args: unknown; readonly result: unknown } };

/**
 * One side of the protocol over a {@link LineChannel}: makes `Out` calls,
 * answers `In` calls, sends `OutNotices` and receives `InNotices`.
 */
export class Peer<Out extends CallMap<Out>, In extends CallMap<In>, OutNotices, InNotices> {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private readonly handlers = new Map<string, Handler>();
  private readonly noticeListeners = new Map<string, NoticeListener>();
  private closeReason: Error | undefined;
  private readonly closeListeners: ((reason: Error) => void)[] = [];
  private helloVersion: unknown;
  private helloWaiter: ((version: unknown) => void) | undefined;

  constructor(
    private readonly channel: LineChannel,
    private readonly label: string,
  ) {
    channel.onLine((line) => this.receive(line));
    channel.onClose((reason) => {
      this.closeReason = reason;
      for (const { reject } of this.pending.values()) reject(reason);
      this.pending.clear();
      for (const listener of this.closeListeners) listener(reason);
    });
  }

  /** True once the channel has closed; every later call rejects at once. */
  get closed(): boolean {
    return this.closeReason !== undefined;
  }

  onClose(listener: (reason: Error) => void): void {
    if (this.closeReason) listener(this.closeReason);
    else this.closeListeners.push(listener);
  }

  call<M extends keyof Out & string>(method: M, args: Out[M]["args"]): Promise<Out[M]["result"]> {
    if (this.closeReason) return Promise.reject(this.closeReason);
    const id = this.nextId++;
    const line = JSON.stringify({ kind: "call", id, method, args });
    if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) {
      return Promise.reject(new Error(`${this.label}: the ${method} call exceeds ${MAX_MESSAGE_BYTES} bytes`));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.channel.send(line);
    });
  }

  notify<M extends keyof OutNotices & string>(method: M, args: OutNotices[M]): void {
    if (this.closeReason) return;
    const line = JSON.stringify({ kind: "notify", method, args });
    if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) {
      console.warn(`${this.label}: dropped a ${method} notice larger than ${MAX_MESSAGE_BYTES} bytes`);
      return;
    }
    this.channel.send(line);
  }

  /** Answer `method` calls. One handler per method; its rejection is the caller's error. */
  handle<M extends keyof In & string>(method: M, handler: (args: In[M]["args"]) => Promise<In[M]["result"]>): void {
    this.handlers.set(method, handler as Handler);
  }

  onNotice<M extends keyof InNotices & string>(method: M, listener: (args: InNotices[M]) => void): void {
    this.noticeListeners.set(method, listener as NoticeListener);
  }

  /** Announce this side: the host's `hello` (`protocol.ts`). */
  sendHello(protocolVersion: number): void {
    if (!this.closeReason) this.channel.send(JSON.stringify({ kind: "hello", protocolVersion }));
  }

  /**
   * The protocol version the far side announced in its `hello`, once it
   * has; rejects when the channel closes first or `timeoutMs` passes.
   */
  receivedHello(timeoutMs: number): Promise<unknown> {
    if (this.helloVersion !== undefined) return Promise.resolve(this.helloVersion);
    if (this.closeReason) return Promise.reject(this.closeReason);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: the peer did not announce itself within ${timeoutMs}ms`)), timeoutMs);
      this.helloWaiter = (version) => {
        clearTimeout(timer);
        resolve(version);
      };
      this.onClose((reason) => {
        clearTimeout(timer);
        reject(reason);
      });
    });
  }

  close(reason?: Error): void {
    this.channel.close(reason);
  }

  private receive(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.channel.close(new Error(`${this.label}: the peer sent a line that is not JSON`));
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.channel.close(new Error(`${this.label}: the peer sent a message that is not an object`));
      return;
    }
    const message = parsed as { kind?: unknown; id?: unknown; method?: unknown; args?: unknown; ok?: unknown; value?: unknown; error?: unknown };
    const malformed = malformedEnvelope(message);
    if (malformed !== null) {
      this.channel.close(new Error(`${this.label}: the peer sent ${malformed}`));
      return;
    }
    switch (message.kind) {
      case "call":
        void this.answer(message.id as number, String(message.method), message.args);
        return;
      case "result": {
        const result = message as ResultEnvelope;
        const waiter = this.pending.get(result.id);
        if (!waiter) return;
        this.pending.delete(result.id);
        if (result.ok) waiter.resolve(result.value);
        else waiter.reject(fromWireError(result.error));
        return;
      }
      case "notify": {
        const listener = this.noticeListeners.get(String(message.method));
        if (!listener) return;
        try {
          (listener as (args: unknown) => void)(message.args);
        } catch (err) {
          console.error(`${this.label}: the ${String(message.method)} notice handler threw: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      case "hello":
        this.helloVersion ??= (message as { protocolVersion?: unknown }).protocolVersion ?? null;
        this.helloWaiter?.(this.helloVersion);
        this.helloWaiter = undefined;
        return;
      default:
        this.channel.close(new Error(`${this.label}: the peer sent a message of unknown kind`));
    }
  }

  private async answer(id: number, method: string, args: unknown): Promise<void> {
    const handler = this.handlers.get(method);
    let envelope: ResultEnvelope;
    if (!handler) {
      envelope = { kind: "result", id, ok: false, error: { name: "Error", message: `${this.label}: no handler for ${method}` } };
    } else {
      try {
        envelope = { kind: "result", id, ok: true, value: (await (handler as (a: unknown) => Promise<unknown>)(args)) ?? null };
      } catch (err) {
        envelope = { kind: "result", id, ok: false, error: toWireError(err) };
      }
    }
    let line = JSON.stringify(envelope);
    if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) {
      const error: WireError = { name: "Error", message: `${this.label}: the ${method} result exceeds ${MAX_MESSAGE_BYTES} bytes` };
      line = JSON.stringify({ kind: "result", id, ok: false, error } satisfies ResultEnvelope);
    }
    this.channel.send(line);
  }
}
