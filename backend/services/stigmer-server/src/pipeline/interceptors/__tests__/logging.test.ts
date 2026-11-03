/**
 * Pins the logging interceptor's one line per RPC, written when the RPC
 * ends (stigmer/stigmer#2691):
 *
 *   - a server stream logs at its END, not at the handler's return: one
 *     "rpc completed" after its last message with the stream's whole
 *     duration, or one "rpc failed" with the cause chain and the debug
 *     stack line when it throws part-way, and nothing before;
 *   - the departure rule: a request whose signal aborted with a reason
 *     other than DeadlineExceeded logs "rpc cancelled" with the reason's
 *     code, for a stream however it ended and for a unary call that
 *     failed, and a call that threw keeps its error, cause and stack on
 *     that line; a unary call that succeeded after the abort stays
 *     "rpc completed"; a deadline is tiered as a failure, a stream the
 *     consumer stopped under one included;
 *   - health lines are debug, cancelled ones included;
 *   - on the REAL server (createUnifiedPortServer, the real health
 *     service), a client that leaves a Health.watch stream part-way, over
 *     HTTP/2 gRPC and over Connect on HTTP/1.1, writes exactly one
 *     "rpc cancelled" line and no error line: connect aborts the signal
 *     and the handler returns, which only the signal tells apart from a
 *     stream that ran to its end.
 *
 * The stream tiers through the real chain are pinned in
 * ../../__tests__/chain.test.ts.
 */
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import {
  createConnectTransport,
  createGrpcTransport,
} from "@connectrpc/connect-node";
import { Health } from "@stigmer/apis/grpc/health/v1/health_pb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import {
  HealthState,
  registerHealthService,
} from "../../../transport/health.js";
import {
  createUnifiedPortServer,
  type UnifiedPortServer,
} from "../../../transport/server.js";
import { internalError } from "../../errors.js";
import { createLoggingInterceptor } from "../logging.js";

const STREAM_SERVICE = "ai.stigmer.agentic.session.v1.SessionQueryController";
const HEALTH_SERVICE = "grpc.health.v1.Health";

/**
 * The real-server waits: the departure travels a socket close and a
 * handler's return, and the shared Mac runner has timed out 5 s waits
 * under load before.
 */
const REAL_SERVER_WAIT_MS = 10_000;

interface CapturedLine {
  level: string;
  message: string;
  [key: string]: unknown;
}

function capturingLogger() {
  const lines: CapturedLine[] = [];
  const logger = createLogger({
    level: "debug",
    pretty: false,
    write: (line) => lines.push(JSON.parse(line) as CapturedLine),
  });
  return { logger, lines };
}

function fakeClock() {
  let at = 1_000;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

function fakeRequest(
  signal: AbortSignal,
  options: { service?: string; stream?: boolean } = {},
) {
  return {
    service: { typeName: options.service ?? STREAM_SERVICE },
    method: { name: options.stream === false ? "get" : "streamEvents" },
    stream: options.stream ?? true,
    signal,
  } as never;
}

/** Runs the interceptor over a stream handler and returns its iterator. */
async function interceptStream(
  messages: AsyncIterable<string>,
  logger: ReturnType<typeof capturingLogger>["logger"],
  clock: ReturnType<typeof fakeClock>,
  request: never,
): Promise<AsyncIterator<string>> {
  const interceptor = createLoggingInterceptor(logger, clock.now);
  const next = async () => ({ stream: true, message: messages }) as never;
  const response = (await interceptor(next)(request)) as {
    message: AsyncIterable<string>;
  };
  return response.message[Symbol.asyncIterator]();
}

function rpcLines(lines: CapturedLine[]): CapturedLine[] {
  return lines.filter((line) => line.message.startsWith("rpc"));
}

describe("the logging interceptor on a server stream", () => {
  it("logs one info 'rpc completed' after the last message, with the stream's whole duration", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const controller = new AbortController();
    const it = await interceptStream(
      (async function* () {
        yield "m1";
        clock.advance(40);
        yield "m2";
        clock.advance(2);
      })(),
      logger,
      clock,
      fakeRequest(controller.signal),
    );

    await it.next();
    await it.next();
    expect(rpcLines(lines), "nothing is logged while the stream runs").toEqual(
      [],
    );
    expect((await it.next()).done).toBe(true);

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({
        level: "info",
        message: "rpc completed",
        procedure: `/${STREAM_SERVICE}/streamEvents`,
        durationMs: 42,
      }),
    ]);
  });

  it("logs one error 'rpc failed' with the cause chain and the stack when the stream throws part-way", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const controller = new AbortController();
    const it = await interceptStream(
      (async function* () {
        yield "m1";
        clock.advance(9);
        throw internalError(
          new Error("load failed", { cause: new Error("database is locked") }),
          "failed to stream session events",
        );
      })(),
      logger,
      clock,
      fakeRequest(controller.signal),
    );

    await it.next();
    expect(rpcLines(lines)).toEqual([]);
    await expect(it.next()).rejects.toThrow("failed to stream session events");

    const logged = rpcLines(lines);
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({
      level: "error",
      message: "rpc failed",
      code: "Internal",
      durationMs: 9,
      error: "[internal] failed to stream session events",
      cause: "Error: load failed <- Error: database is locked",
    });
    expect(logged[1]).toMatchObject({
      level: "debug",
      message: "rpc failure stack",
    });
    expect(String(logged[1]?.["stack"])).toContain("database is locked");
  });

  it("logs one info 'rpc cancelled' when the handler returns on the caller's abort", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const controller = new AbortController();
    const it = await interceptStream(
      (async function* () {
        yield "m1";
        clock.advance(3_600_000);
        controller.abort();
      })(),
      logger,
      clock,
      fakeRequest(controller.signal),
    );

    await it.next();
    expect((await it.next()).done).toBe(true);

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({
        level: "info",
        message: "rpc cancelled",
        code: "Canceled",
        durationMs: 3_600_000,
      }),
    ]);
  });

  it("logs 'rpc cancelled', never an error, when a write fails after the caller left", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const controller = new AbortController();
    const it = await interceptStream(
      (async function* () {
        yield "m1";
        yield "m2";
      })(),
      logger,
      clock,
      fakeRequest(controller.signal),
    );

    await it.next();
    // The socket's reset got there first (connect-node maps it to
    // Aborted); then the writer throws its raw error into the iterable.
    controller.abort(new ConnectError("socket hang up", Code.Aborted));
    await expect(it.throw?.(new Error("write after close"))).rejects.toThrow(
      "write after close",
    );

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({
        level: "info",
        message: "rpc cancelled",
        code: "Aborted",
        error: "write after close",
      }),
    ]);
  });

  it("reads Unknown when the failed write itself aborted the signal", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const controller = new AbortController();
    const it = await interceptStream(
      (async function* () {
        yield "m1";
        yield "m2";
      })(),
      logger,
      clock,
      fakeRequest(controller.signal),
    );

    await it.next();
    // connect's handler wrapper: context.abort(e) with the raw write
    // error, then the same error thrown into the iterable.
    const writeError = new Error("write EPIPE");
    controller.abort(writeError);
    await expect(it.throw?.(writeError)).rejects.toThrow("write EPIPE");

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({
        level: "info",
        message: "rpc cancelled",
        code: "Unknown",
        error: "write EPIPE",
      }),
    ]);
  });

  it("logs 'rpc cancelled' when the consumer stops the stream early", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const it = await interceptStream(
      (async function* () {
        yield "m1";
        yield "never-pulled";
      })(),
      logger,
      clock,
      fakeRequest(new AbortController().signal),
    );

    await it.next();
    await it.return?.();

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({
        level: "info",
        message: "rpc cancelled",
        code: "Canceled",
      }),
    ]);
  });

  it("tiers a throw after a deadline as a failure, not a departure", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const controller = new AbortController();
    const it = await interceptStream(
      (async function* () {
        yield "m1";
        controller.abort(
          new ConnectError("the operation timed out", Code.DeadlineExceeded),
        );
        throw new ConnectError("store read timed out", Code.DeadlineExceeded);
      })(),
      logger,
      clock,
      fakeRequest(controller.signal),
    );

    await it.next();
    await expect(it.next()).rejects.toThrow("store read timed out");

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({
        level: "error",
        message: "rpc failed",
        code: "DeadlineExceeded",
      }),
    ]);
  });

  it("tiers a stream the consumer stopped under a deadline as a failure", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const controller = new AbortController();
    const it = await interceptStream(
      (async function* () {
        yield "m1";
        yield "never-pulled";
      })(),
      logger,
      clock,
      fakeRequest(controller.signal),
    );

    await it.next();
    controller.abort(
      new ConnectError("the operation timed out", Code.DeadlineExceeded),
    );
    await it.return?.();

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({
        level: "error",
        message: "rpc failed",
        code: "DeadlineExceeded",
      }),
    ]);
  });

  it("tiers a stream that returned on its deadline as a failure", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const controller = new AbortController();
    const it = await interceptStream(
      (async function* () {
        yield "m1";
        controller.abort(
          new ConnectError("the operation timed out", Code.DeadlineExceeded),
        );
      })(),
      logger,
      clock,
      fakeRequest(controller.signal),
    );

    await it.next();
    expect((await it.next()).done).toBe(true);

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({
        level: "error",
        message: "rpc failed",
        code: "DeadlineExceeded",
        error: "[deadline_exceeded] the operation timed out",
      }),
    ]);
  });

  it("logs a health stream's completion and departure at debug", async () => {
    const { logger, lines } = capturingLogger();
    const clock = fakeClock();
    const completed = await interceptStream(
      (async function* () {
        yield "SERVING";
      })(),
      logger,
      clock,
      fakeRequest(new AbortController().signal, { service: HEALTH_SERVICE }),
    );
    await completed.next();
    await completed.next();

    const controller = new AbortController();
    const departed = await interceptStream(
      (async function* () {
        yield "SERVING";
        controller.abort();
      })(),
      logger,
      clock,
      fakeRequest(controller.signal, { service: HEALTH_SERVICE }),
    );
    await departed.next();
    await departed.next();

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({ level: "debug", message: "rpc completed" }),
      expect.objectContaining({ level: "debug", message: "rpc cancelled" }),
    ]);
  });
});

describe("the departure rule on a unary call", () => {
  it("logs 'rpc cancelled' for a call that fails after its caller left", async () => {
    const { logger, lines } = capturingLogger();
    const controller = new AbortController();
    const interceptor = createLoggingInterceptor(logger);
    const next = async () => {
      controller.abort();
      throw new Error("connection terminated");
    };

    await expect(
      interceptor(next as never)(
        fakeRequest(controller.signal, { stream: false }),
      ),
    ).rejects.toThrow("connection terminated");

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({
        level: "info",
        message: "rpc cancelled",
        code: "Canceled",
        error: "connection terminated",
      }),
    ]);
  });

  it("keeps the cause chain and the stack of a fault thrown after the caller left", async () => {
    const { logger, lines } = capturingLogger();
    const controller = new AbortController();
    const interceptor = createLoggingInterceptor(logger);
    const next = async () => {
      controller.abort();
      throw internalError(
        new Error("load failed", { cause: new Error("database is locked") }),
        "failed to get agent",
      );
    };

    await expect(
      interceptor(next as never)(
        fakeRequest(controller.signal, { stream: false }),
      ),
    ).rejects.toThrow("failed to get agent");

    const logged = rpcLines(lines);
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({
      level: "info",
      message: "rpc cancelled",
      code: "Canceled",
      error: "[internal] failed to get agent",
      cause: "Error: load failed <- Error: database is locked",
    });
    expect(logged[1]).toMatchObject({
      level: "debug",
      message: "rpc failure stack",
    });
    expect(String(logged[1]?.["stack"])).toContain("database is locked");
  });

  it("logs 'rpc completed' for a call that succeeded after its caller left", async () => {
    const { logger, lines } = capturingLogger();
    const controller = new AbortController();
    const interceptor = createLoggingInterceptor(logger);
    const next = async () => {
      controller.abort();
      return { stream: false, message: {} } as never;
    };

    await interceptor(next)(fakeRequest(controller.signal, { stream: false }));

    expect(rpcLines(lines)).toEqual([
      expect.objectContaining({ level: "info", message: "rpc completed" }),
    ]);
  });
});

describe("the logging interceptor on the real server", () => {
  const { logger, lines } = capturingLogger();
  let server: UnifiedPortServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = createUnifiedPortServer({
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      routes: (router) => registerHealthService(router, new HealthState()),
      interceptors: [createLoggingInterceptor(logger)],
      modelRegistryLane: (_request, response) => {
        response.end("{}");
      },
    });
    const port = await server.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.shutdown();
  });

  async function leaveWatchPartWay(transport: Transport): Promise<void> {
    const controller = new AbortController();
    const watch = createClient(Health, transport).watch(
      {},
      { signal: controller.signal },
    );
    const left = (async () => {
      for await (const _status of watch) {
        controller.abort();
      }
    })();
    await expect(left).rejects.toMatchObject({ code: Code.Canceled });
  }

  async function expectOneCancelledLine(from: number): Promise<void> {
    const watchLines = () =>
      rpcLines(lines.slice(from)).filter(
        (line) => line["procedure"] === "/grpc.health.v1.Health/Watch",
      );
    await vi.waitFor(() => expect(watchLines().length).toBeGreaterThan(0), {
      timeout: REAL_SERVER_WAIT_MS,
      interval: 20,
    });
    expect(watchLines()).toEqual([
      expect.objectContaining({
        level: "debug",
        message: "rpc cancelled",
        code: "Canceled",
      }),
    ]);
    expect(lines.slice(from).filter((line) => line.level === "error")).toEqual(
      [],
    );
  }

  it("writes one 'rpc cancelled' line when a gRPC (HTTP/2) client leaves Health.watch", async () => {
    const from = lines.length;
    await leaveWatchPartWay(createGrpcTransport({ baseUrl }));
    await expectOneCancelledLine(from);
  });

  it("writes one 'rpc cancelled' line when a Connect (HTTP/1.1) client leaves Health.watch", async () => {
    const from = lines.length;
    await leaveWatchPartWay(
      createConnectTransport({ baseUrl, httpVersion: "1.1" }),
    );
    await expectOneCancelledLine(from);
  });
});
