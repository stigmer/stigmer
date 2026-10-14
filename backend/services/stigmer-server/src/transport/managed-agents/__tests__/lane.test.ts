/**
 * The Managed Agents lane's failure paths, over fake native services (a
 * router transport, as the composition builds the real one) and a real
 * HTTP server: a native call that faults answers 500 with nothing of the
 * fault on the wire, and the lane logs it; a client that leaves mid-call
 * gets no answer and the request is logged as abandoned; a chunked body
 * past the port's cap is refused unread; and the terminal net answers 500
 * (or closes a stream already answering) when the request itself fails.
 * The happy paths and the guards are lane-composed.test.ts's.
 */
import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";

import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import {
  InterruptSessionResponseSchema,
  SessionEventListSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";

import type { Logger } from "../../../boot/logger.js";
import { MAX_MESSAGE_BYTES } from "../../constants.js";
import type { LaneRequest, LaneResponse } from "../../lanes.js";
import { createManagedAgentsLane } from "../lane.js";

interface LogLine {
  readonly level: string;
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

const lines: LogLine[] = [];
const logger: Logger = {
  debug: (message, fields = {}) => void lines.push({ level: "debug", message, fields }),
  info: (message, fields = {}) => void lines.push({ level: "info", message, fields }),
  warn: (message, fields = {}) => void lines.push({ level: "warn", message, fields }),
  error: (message, fields = {}) => void lines.push({ level: "error", message, fields }),
};

/** Set by the held list call once it is waiting, so the test knows when to leave. */
let listHeld: (() => void) | undefined;

const transport = createRouterTransport((router) => {
  router.service(SessionQueryController, {
    listEvents: async (_request, context) => {
      listHeld?.();
      await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
      return create(SessionEventListSchema, {});
    },
  });
  router.service(SessionCommandController, {
    // Answers without the event it records: the lane's internal fault.
    interrupt: () => create(InterruptSessionResponseSchema, {}),
  });
});

const lane = createManagedAgentsLane({ transport, authenticationRequired: false, logger });
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer(lane);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/sessions/ses_1/events`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const logged = (message: string) => lines.filter((line) => line.message === message);

describe("the lane's failure paths", () => {
  it("answers a native fault as a 500 that says nothing of it, and logs it", async () => {
    const response = await fetch(base, { method: "POST", body: JSON.stringify({ events: [{ type: "user.interrupt" }] }) });
    expect(response.status).toBe(500);
    expect(response.headers.get("x-should-retry")).toBe("false");
    const body = (await response.json()) as { error: { type: string; message: string } };
    expect(body.error).toEqual({ type: "api_error", message: "internal server error" });
    expect(logged("managed agents lane call failed")[0]?.fields["error"]).toBe(
      "the user.interrupt was applied but its recorded event could not be read",
    );
    await vi.waitFor(() => expect(logged("managed agents lane request failed")[0]?.fields["status"]).toBe(500));
  });

  it("answers nobody when the client leaves mid-call, and logs the request as abandoned", async () => {
    const leave = new AbortController();
    const held = new Promise<void>((resolve) => (listHeld = resolve));
    const request = fetch(base, { signal: leave.signal }).catch((error: unknown) => error);
    await held;
    leave.abort();
    await request;
    await vi.waitFor(() =>
      expect(lines.find((line) => line.message === "managed agents lane client error" && line.fields["status"] === 499)).toBeDefined(),
    );
    listHeld = undefined;
  });

  it("refuses a chunked body past the port's cap without reading it whole", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_MESSAGE_BYTES) {
          controller.close();
          return;
        }
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const response = await fetch(base, { method: "POST", body, duplex: "half" } as RequestInit);
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      `the request body exceeds ${MAX_MESSAGE_BYTES} bytes`,
    );
  });
});

/** A response whose header writes fail as told, for the terminal net. */
class FailingResponse extends EventEmitter {
  statusCode = 0;
  headersSent: boolean;
  writableEnded = false;
  ended: string | undefined;
  private failures: number;

  constructor(failures: number, headersSent: boolean) {
    super();
    this.failures = failures;
    this.headersSent = headersSent;
  }

  setHeader(): void {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("the socket is gone");
    }
  }

  end(chunk?: string): void {
    this.writableEnded = true;
    this.ended = chunk ?? "";
  }
}

describe("the lane's terminal net", () => {
  const request = { method: "GET", url: "/v1/sessions/ses_1/nothing", headers: {} } as unknown as LaneRequest;

  it("answers 500 when writing the answer failed before any header went out", async () => {
    const response = new FailingResponse(1, false);
    lane(request, response as unknown as LaneResponse);
    await vi.waitFor(() => expect(response.writableEnded).toBe(true));
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.ended ?? "{}")).toMatchObject({ error: { type: "api_error", message: "internal server error" } });
    expect(logged("managed agents lane handler failed").at(-1)?.fields["error"]).toBe("the socket is gone");
  });

  it("closes the response when it had already begun answering", async () => {
    const response = new FailingResponse(Number.POSITIVE_INFINITY, true);
    lane(request, response as unknown as LaneResponse);
    await vi.waitFor(() => expect(response.writableEnded).toBe(true));
    expect(response.ended).toBe("");
  });
});
