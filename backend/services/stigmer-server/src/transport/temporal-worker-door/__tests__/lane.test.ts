/**
 * The Temporal worker lane's own rules, over HTTP/2 with a fake Temporal
 * connection (the integration suite runs the real one):
 *
 *   - what is never served: an unlisted method (UNIMPLEMENTED, uncounted),
 *     HTTP/1, a non-gRPC body, a compressed or malformed frame, a request
 *     with no credential or one that names no sandbox, a namespace other
 *     than the server's, another queue, a sticky queue, a reply without the
 *     caller's receipt;
 *   - what is forwarded is built from checked fields: the server's
 *     namespace, the caller's queue, the sandbox's name as identity, and the
 *     reply's own fields, Temporal's token in place of the receipt;
 *   - Temporal's failures come back exactly, details included; the poll
 *     budget ending first answers Temporal's own empty poll;
 *   - no engine, or no receipt key, is UNAVAILABLE; the held-poll limits
 *     answer RESOURCE_EXHAUSTED; every served call is counted once;
 *   - a caller that leaves, at any point of its call, is let go: nothing
 *     reaches Temporal after it left, its slot is free once it is answered,
 *     and it is counted `abandoned`;
 *   - the poll budget and its margin end inside the shutdown drain.
 */
import {
  connect,
  constants as http2,
  createServer,
  type ClientHttp2Session,
  type Http2Server,
  type Http2ServerResponse,
  type ServerHttp2Stream,
} from "node:http2";
import { request as http1Request, createServer as createHttp1Server } from "node:http";

import proto from "@temporalio/proto";
import type { ConnectionLike } from "@temporalio/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import { recordWorkQueueCall } from "../../../observability/runner-work-queue-metrics.js";
import { SHUTDOWN_DRAIN_TIMEOUT_MS } from "../../constants.js";
import { newHeldPolls, type HeldPolls } from "../capacity.js";
import { frame } from "../frame.js";
import {
  POLL_BUDGET_MS,
  POLL_DRAIN_MARGIN_MS,
  TEMPORAL_WORKFLOW_SERVICE_PATH_PREFIX,
  createTemporalWorkerDoorLane,
  credentialQueueOf,
  currentConnectionOf,
  type TemporalWorkerDoorDeps,
} from "../lane.js";
import { issueReceipt, openReceipt } from "../receipts.js";
import { WORDS } from "../words.js";

vi.mock("../../../observability/runner-work-queue-metrics.js", () => ({ recordWorkQueueCall: vi.fn() }));

const ws = proto.temporal.api.workflowservice.v1;
const counted = vi.mocked(recordWorkQueueCall);
const KEY = Buffer.alloc(32, 9);
const QUEUE = "session:ses_lane";
const TOKEN = "sandbox-token";
const silent = createLogger({ level: "error", pretty: false, write: () => {} });

interface Answer {
  readonly status: number;
  readonly grpcStatus: string | undefined;
  readonly grpcMessage: string | undefined;
  readonly details: string | undefined;
  readonly message: Buffer;
}

/** A fake of the server's connection: each method a mock, deadlines and aborts recorded. */
function fakeConnection() {
  const service = {
    getSystemInfo: vi.fn(async () => ws.GetSystemInfoResponse.create({ serverVersion: "1.2.3" })),
    describeNamespace: vi.fn(async () => ws.DescribeNamespaceResponse.create({})),
    pollActivityTaskQueue: vi.fn(async (_request: unknown) =>
      ws.PollActivityTaskQueueResponse.create({ taskToken: Buffer.from("temporal-token"), activityId: "1" }),
    ),
    respondActivityTaskCompleted: vi.fn(async (_request: unknown) => ws.RespondActivityTaskCompletedResponse.create({})),
    respondActivityTaskFailed: vi.fn(async (_request: unknown) => ws.RespondActivityTaskFailedResponse.create({})),
    respondActivityTaskCanceled: vi.fn(async (_request: unknown) => ws.RespondActivityTaskCanceledResponse.create({})),
    recordActivityTaskHeartbeat: vi.fn(async (_request: unknown) =>
      ws.RecordActivityTaskHeartbeatResponse.create({ cancelRequested: true }),
    ),
  };
  const deadlines: number[] = [];
  const connection = {
    workflowService: service,
    withDeadline: async <R>(deadline: number, fn: () => Promise<R>) => {
      deadlines.push(deadline - Date.now());
      return fn();
    },
    withAbortSignal: async <R>(_signal: AbortSignal, fn: () => Promise<R>) => fn(),
  } as unknown as ConnectionLike;
  return { connection, service, deadlines };
}

let current = fakeConnection();
let deps: TemporalWorkerDoorDeps;
let server: Http2Server;
let session: ClientHttp2Session;
let origin = "";

function lane(overrides: Partial<TemporalWorkerDoorDeps> = {}) {
  deps = {
    logger: silent,
    namespace: "default",
    connection: () => current.connection,
    queueOf: async (token) => (token === TOKEN ? QUEUE : token === "odd" ? "not-a-sandbox-queue" : undefined),
    receiptKey: async () => KEY,
    ...overrides,
  };
  return createTemporalWorkerDoorLane(deps);
}

let handler = lane();

beforeAll(async () => {
  server = createServer((request, response) => handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  session = connect(origin);
});

afterAll(async () => {
  session.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  current = fakeConnection();
  handler = lane();
  vi.restoreAllMocks();
  counted.mockClear();
});

function call(
  method: string,
  body: Uint8Array | Buffer,
  headers: Record<string, string> = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const stream = session.request({
      ":method": "POST",
      ":path": `${TEMPORAL_WORKFLOW_SERVICE_PATH_PREFIX}${method}`,
      "content-type": "application/grpc",
      authorization: `Bearer ${TOKEN}`,
      ...headers,
    });
    const chunks: Buffer[] = [];
    let status = 0;
    let trailers: Record<string, string | string[] | undefined> = {};
    stream.on("response", (head) => {
      status = Number(head[":status"]);
      if (head["grpc-status"] !== undefined) trailers = head;
    });
    stream.on("trailers", (t) => {
      trailers = t;
    });
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      const all = Buffer.concat(chunks);
      resolve({
        status,
        grpcStatus: trailers["grpc-status"] as string | undefined,
        grpcMessage: trailers["grpc-message"] as string | undefined,
        details: trailers["grpc-status-details-bin"] as string | undefined,
        message: all.length >= 5 ? all.subarray(5) : all,
      });
    });
    stream.on("error", reject);
    stream.end(Buffer.from(body));
  });
}

/**
 * A call whose caller leaves: the request is sent whole, and once `left` is
 * awaited the client resets its stream (RST_STREAM CANCEL) and the server
 * has seen the stream close. The lane is then let go on.
 */
function leavingCall(method: string, body: Uint8Array | Buffer) {
  let serverStream: ServerHttp2Stream | undefined;
  const inner = handler;
  handler = (request, response) => {
    serverStream = (response as Http2ServerResponse).stream;
    inner(request, response);
  };
  const stream = session.request({
    ":method": "POST",
    ":path": `${TEMPORAL_WORKFLOW_SERVICE_PATH_PREFIX}${method}`,
    "content-type": "application/grpc",
    authorization: `Bearer ${TOKEN}`,
  });
  stream.on("error", () => {});
  stream.end(Buffer.from(body));
  return {
    async leave(): Promise<void> {
      await vi.waitFor(() => expect(serverStream).toBeDefined());
      const closed = new Promise<void>((resolve) =>
        serverStream!.closed ? resolve() : serverStream!.once("close", () => resolve()),
      );
      stream.close(http2.NGHTTP2_CANCEL);
      await closed;
    },
  };
}

/** A gate a dependency waits on: `entered` resolves when it is reached, `open` lets it on. */
function gate() {
  let open: () => void = () => {};
  let reached: () => void = () => {};
  const entered = new Promise<void>((resolve) => (reached = resolve));
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { entered, open: () => open(), pass: async () => (reached(), await opened) };
}

/** Held polls that also say how many are held now. */
function countingHeldPolls(): HeldPolls & { held(): number } {
  const inner = newHeldPolls();
  let held = 0;
  return {
    held: () => held,
    hold(queue) {
      const slot = inner.hold(queue);
      if ("refused" in slot) return slot;
      held += 1;
      return {
        release: () => {
          held -= 1;
          slot.release();
        },
      };
    },
  };
}

const encode = <T>(type: { encode(m: T): { finish(): Uint8Array } }, message: T) => frame(type.encode(message).finish());

const pollRequest = (overrides: Record<string, unknown> = {}) =>
  encode(ws.PollActivityTaskQueueRequest, {
    namespace: "default",
    taskQueue: { name: QUEUE },
    identity: "runner@pod",
    ...overrides,
  });

describe("what the lane never serves", () => {
  it("answers an unlisted method UNIMPLEMENTED, counted under one bounded name", async () => {
    counted.mockClear();
    const methods = ["ListWorkflowExecutions", "TerminateWorkflowExecution", "ShutdownWorker", "constructor"];
    for (const method of methods) {
      const answer = await call(method, frame(new Uint8Array()));
      expect(answer.grpcStatus, method).toBe("12");
      expect(decodeURIComponent(answer.grpcMessage ?? "")).toBe(WORDS.notServed(method));
    }
    expect(counted.mock.calls.map(([c]) => c)).toEqual(
      methods.map(() => ({ method: "unserved", decision: "refused", status: "UNIMPLEMENTED", check: "method" })),
    );
  });

  it("answers HTTP/1 with a sentence, not gRPC", async () => {
    const plain = createHttp1Server((request, response) => handler(request, response));
    await new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", () => resolve()));
    const port = (plain.address() as { port: number }).port;
    const answer = await new Promise<{ status: number; body: string }>((resolve) => {
      const request = http1Request({ port, method: "POST", path: `${TEMPORAL_WORKFLOW_SERVICE_PATH_PREFIX}GetSystemInfo` }, (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk.toString()));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      });
      request.end();
    });
    plain.close();
    expect(answer).toEqual({ status: 505, body: WORDS.notHttp2 });
  });

  it("refuses a body that is not gRPC, compressed, malformed or undecodable", async () => {
    expect((await call("GetSystemInfo", frame(new Uint8Array()), { "content-type": "application/grpc-web" })).grpcStatus).toBe("12");
    const compressed = frame(new Uint8Array([1]));
    compressed[0] = 1;
    expect((await call("GetSystemInfo", compressed)).grpcStatus).toBe("12");
    expect((await call("GetSystemInfo", Buffer.from([0, 0, 0]))).grpcStatus).toBe("13");
    expect((await call("GetSystemInfo", Buffer.from([0, 0, 0, 0, 9, 1]))).grpcStatus).toBe("13");
    for (const method of [
      "DescribeNamespace",
      "PollActivityTaskQueue",
      "RespondActivityTaskCompleted",
      "RespondActivityTaskFailed",
      "RespondActivityTaskCanceled",
      "RecordActivityTaskHeartbeat",
    ]) {
      expect((await call(method, frame(Buffer.from([0x0a, 0xff])))).grpcStatus, method).toBe("13");
    }
    expect(current.service.pollActivityTaskQueue).not.toHaveBeenCalled();
  });

  it("refuses a request with no credential, or one that names no sandbox", async () => {
    const none = await call("GetSystemInfo", frame(new Uint8Array()), { authorization: "" });
    expect(none.grpcStatus).toBe("16");
    const person = await call("GetSystemInfo", frame(new Uint8Array()), { authorization: "Bearer a-person's-key" });
    expect(person.grpcStatus).toBe("7");
    expect(decodeURIComponent(person.grpcMessage ?? "")).toBe(WORDS.notASandbox);
    expect(current.service.getSystemInfo).not.toHaveBeenCalled();
  });

  it("refuses another namespace, another queue, and a sticky or versioned queue", async () => {
    const describe = await call("DescribeNamespace", encode(ws.DescribeNamespaceRequest, { namespace: "tenant-b" }));
    expect(describe.grpcStatus).toBe("7");
    expect((await call("DescribeNamespace", encode(ws.DescribeNamespaceRequest, { id: "ns-id" }))).grpcStatus).toBe("7");
    expect((await call("PollActivityTaskQueue", pollRequest({ namespace: "other" }))).grpcStatus).toBe("7");
    const other = await call("PollActivityTaskQueue", pollRequest({ taskQueue: { name: "session:ses_other" } }));
    expect(decodeURIComponent(other.grpcMessage ?? "")).toBe(WORDS.wrongQueue);
    const sticky = await call(
      "PollActivityTaskQueue",
      pollRequest({ taskQueue: { name: QUEUE, kind: 2, normalName: QUEUE } }),
    );
    expect(decodeURIComponent(sticky.grpcMessage ?? "")).toBe(WORDS.stickyQueue);
    expect((await call("PollActivityTaskQueue", pollRequest({ taskQueue: { name: QUEUE, normalName: "x" } }))).grpcStatus).toBe("7");
    expect(current.service.pollActivityTaskQueue).not.toHaveBeenCalled();
    expect(current.service.describeNamespace).not.toHaveBeenCalled();
  });

  it("refuses a reply without this sandbox's receipt, or in another namespace", async () => {
    const foreign = issueReceipt(KEY, "session:ses_other", Buffer.from("t"));
    for (const taskToken of [Buffer.from("temporal-token"), foreign, Buffer.alloc(0)]) {
      const answer = await call("RespondActivityTaskCompleted", encode(ws.RespondActivityTaskCompletedRequest, { namespace: "default", taskToken }));
      expect(answer.grpcStatus).toBe("7");
      expect(decodeURIComponent(answer.grpcMessage ?? "")).toBe(WORDS.notYourReceipt);
    }
    const mine = issueReceipt(KEY, QUEUE, Buffer.from("t"));
    expect(
      (await call("RecordActivityTaskHeartbeat", encode(ws.RecordActivityTaskHeartbeatRequest, { namespace: "other", taskToken: mine }))).grpcStatus,
    ).toBe("7");
    expect(current.service.respondActivityTaskCompleted).not.toHaveBeenCalled();
  });
});

describe("what the lane forwards", () => {
  it("answers GetSystemInfo and the server's own DescribeNamespace", async () => {
    const info = await call("GetSystemInfo", frame(new Uint8Array()));
    expect(info.grpcStatus).toBe("0");
    expect(ws.GetSystemInfoResponse.decode(info.message).serverVersion).toBe("1.2.3");
    expect((await call("DescribeNamespace", encode(ws.DescribeNamespaceRequest, { namespace: "default" }))).grpcStatus).toBe("0");
    expect(current.service.describeNamespace).toHaveBeenCalledWith({ namespace: "default" });
  });

  it("polls the caller's own queue as the sandbox, under the budget, and hands back a receipt", async () => {
    const answer = await call("PollActivityTaskQueue", pollRequest({ identity: "forged", workerVersionCapabilities: { buildId: "x" } }));
    expect(answer.grpcStatus).toBe("0");
    expect(current.service.pollActivityTaskQueue).toHaveBeenCalledWith({
      namespace: "default",
      taskQueue: { name: QUEUE, kind: 1 },
      identity: expect.stringMatching(/^sbx-ses-[0-9a-f]{12}$/),
    });
    expect(current.deadlines[0]).toBeLessThanOrEqual(POLL_BUDGET_MS);
    const task = ws.PollActivityTaskQueueResponse.decode(answer.message);
    expect(task.activityId).toBe("1");
    expect(openReceipt(KEY, task.taskToken)).toEqual({ queue: QUEUE, token: new Uint8Array(Buffer.from("temporal-token")) });
  });

  it("keeps a shorter caller deadline, and an empty poll stays empty", async () => {
    current.service.pollActivityTaskQueue.mockResolvedValueOnce(ws.PollActivityTaskQueueResponse.create({}));
    const answer = await call("PollActivityTaskQueue", pollRequest(), { "grpc-timeout": "2S" });
    expect(answer.grpcStatus).toBe("0");
    expect(current.deadlines[0]).toBeLessThanOrEqual(2_000);
    expect(ws.PollActivityTaskQueueResponse.decode(answer.message).taskToken).toHaveLength(0);
  });

  it("forwards each reply with Temporal's own token and only the reply's fields", async () => {
    const receipt = issueReceipt(KEY, QUEUE, Buffer.from("temporal-token"));
    const token = new Uint8Array(Buffer.from("temporal-token"));
    const payloads = { payloads: [{ data: Buffer.from("x") }] };
    const identity = expect.stringMatching(/^sbx-ses-/);
    await call("RespondActivityTaskCompleted", encode(ws.RespondActivityTaskCompletedRequest, { namespace: "default", taskToken: receipt, result: payloads, identity: "forged", workerVersion: { buildId: "b" } }));
    expect(current.service.respondActivityTaskCompleted).toHaveBeenCalledWith({ namespace: "default", taskToken: token, identity, result: expect.objectContaining({ payloads: [expect.anything()] }) });
    await call("RespondActivityTaskFailed", encode(ws.RespondActivityTaskFailedRequest, { namespace: "default", taskToken: receipt, failure: { message: "boom" } }));
    expect(current.service.respondActivityTaskFailed).toHaveBeenCalledWith(
      expect.objectContaining({ taskToken: token, identity, failure: expect.objectContaining({ message: "boom" }) }),
    );
    await call("RespondActivityTaskCanceled", encode(ws.RespondActivityTaskCanceledRequest, { namespace: "default", taskToken: receipt }));
    expect(current.service.respondActivityTaskCanceled).toHaveBeenCalledWith(expect.objectContaining({ taskToken: token, identity }));
    const beat = await call("RecordActivityTaskHeartbeat", encode(ws.RecordActivityTaskHeartbeatRequest, { namespace: "default", taskToken: receipt }));
    expect(ws.RecordActivityTaskHeartbeatResponse.decode(beat.message).cancelRequested).toBe(true);
  });

  it("names a queue that is no sandbox's by the queue itself", async () => {
    await call("PollActivityTaskQueue", pollRequest({ taskQueue: { name: "not-a-sandbox-queue" } }), { authorization: "Bearer odd" });
    expect(current.service.pollActivityTaskQueue).toHaveBeenCalledWith(expect.objectContaining({ identity: "not-a-sandbox-queue" }));
  });
});

describe("failures and limits", () => {
  it("relays Temporal's failure exactly, details included", async () => {
    const details = Buffer.from([8, 5, 18, 3, 1, 2, 3]);
    current.service.respondActivityTaskCompleted.mockRejectedValueOnce(
      Object.assign(new Error("not found"), {
        code: 5,
        details: "workflow execution already completed",
        metadata: { get: (name: string) => (name === "grpc-status-details-bin" ? [details] : []) },
      }),
    );
    const answer = await call("RespondActivityTaskCompleted", encode(ws.RespondActivityTaskCompletedRequest, { namespace: "default", taskToken: issueReceipt(KEY, QUEUE, Buffer.from("t")) }));
    expect(answer.grpcStatus).toBe("5");
    expect(decodeURIComponent(answer.grpcMessage ?? "")).toBe("workflow execution already completed");
    expect(Buffer.from(answer.details ?? "", "base64")).toEqual(details);
  });

  it("answers Temporal's empty poll when the lane's own budget ends the call", async () => {
    current.service.pollActivityTaskQueue.mockRejectedValueOnce(Object.assign(new Error("deadline"), { code: 4, details: "" }));
    const answer = await call("PollActivityTaskQueue", pollRequest());
    expect(answer.grpcStatus).toBe("0");
    // A caller's own shorter deadline ending is the caller's failure, relayed.
    current.service.pollActivityTaskQueue.mockRejectedValueOnce(Object.assign(new Error("deadline"), { code: 4, details: "deadline" }));
    expect((await call("PollActivityTaskQueue", pollRequest(), { "grpc-timeout": "100m" })).grpcStatus).toBe("4");
  });

  it("is INTERNAL for a failure that is not Temporal's, counted as a failure", async () => {
    const warn = vi.spyOn(silent, "warn");
    counted.mockClear();
    current.service.getSystemInfo.mockRejectedValueOnce(new Error("bug"));
    expect((await call("GetSystemInfo", frame(new Uint8Array()))).grpcStatus).toBe("13");
    expect(warn).toHaveBeenCalled();
    expect(counted).toHaveBeenCalledWith({ method: "GetSystemInfo", decision: "failed", status: "INTERNAL", check: "fault" });
  });

  it("is INTERNAL for a rejection that is no error at all", async () => {
    current.service.getSystemInfo.mockRejectedValueOnce("not an error");
    vi.spyOn(silent, "warn");
    expect((await call("GetSystemInfo", frame(new Uint8Array()))).grpcStatus).toBe("13");
  });

  it("is UNAVAILABLE with no engine or no receipt key", async () => {
    handler = lane({ connection: () => undefined });
    expect((await call("GetSystemInfo", frame(new Uint8Array()))).grpcStatus).toBe("14");
    handler = lane({ receiptKey: async () => Promise.reject(new Error("store down")) });
    expect((await call("PollActivityTaskQueue", pollRequest())).grpcStatus).toBe("14");
    expect(
      (await call("RespondActivityTaskCompleted", encode(ws.RespondActivityTaskCompletedRequest, { namespace: "default", taskToken: Buffer.from("x") }))).grpcStatus,
    ).toBe("14");
    expect(current.service.pollActivityTaskQueue).not.toHaveBeenCalled();
  });

  it("refuses a poll past either held-poll limit, and frees the slot when it ends", async () => {
    handler = lane({ heldPolls: newHeldPolls(1, 10) });
    let release: () => void = () => {};
    current.service.pollActivityTaskQueue.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(ws.PollActivityTaskQueueResponse.create({})))),
    );
    const first = call("PollActivityTaskQueue", pollRequest());
    await vi.waitFor(() => expect(current.service.pollActivityTaskQueue).toHaveBeenCalledTimes(1));
    const second = await call("PollActivityTaskQueue", pollRequest());
    expect(second.grpcStatus).toBe("8");
    expect(decodeURIComponent(second.grpcMessage ?? "")).toBe(WORDS.tooManyForSandbox);
    release();
    expect((await first).grpcStatus).toBe("0");
    expect((await call("PollActivityTaskQueue", pollRequest())).grpcStatus).toBe("0");

    handler = lane({ heldPolls: newHeldPolls(4, 0) });
    const full = await call("PollActivityTaskQueue", pollRequest());
    expect(decodeURIComponent(full.grpcMessage ?? "")).toBe(WORDS.tooManyForServer);
  });

  it("counts each served call once, by method, decision, status and check", async () => {
    counted.mockClear();
    await call("GetSystemInfo", frame(new Uint8Array()), { authorization: "Bearer nobody" });
    await call("GetSystemInfo", frame(new Uint8Array()));
    expect(counted.mock.calls.map(([c]) => c)).toEqual([
      { method: "GetSystemInfo", decision: "refused", status: "PERMISSION_DENIED", check: "credential" },
      { method: "GetSystemInfo", decision: "allowed", status: "OK", check: "none" },
    ]);
  });

  it("lets a caller that left while its credential was read go, reaching Temporal for nothing", async () => {
    const reading = gate();
    const heldPolls = countingHeldPolls();
    handler = lane({
      heldPolls,
      queueOf: async (token) => (await reading.pass(), token === TOKEN ? QUEUE : undefined),
    });
    counted.mockClear();
    const leaving = leavingCall("PollActivityTaskQueue", pollRequest());
    await reading.entered;
    await leaving.leave();
    reading.open();
    await vi.waitFor(() => expect(counted).toHaveBeenCalledTimes(1));
    expect(counted.mock.calls[0]![0]).toEqual({
      method: "PollActivityTaskQueue",
      decision: "abandoned",
      status: "CANCELLED",
      check: "none",
    });
    expect(current.service.pollActivityTaskQueue).not.toHaveBeenCalled();
    expect(heldPolls.held()).toBe(0);
  });

  it("lets a poll or a reply whose caller left while the receipt key was read go, its slot free", async () => {
    const cases = [
      { method: "PollActivityTaskQueue", body: pollRequest(), forwarded: () => current.service.pollActivityTaskQueue },
      {
        method: "RespondActivityTaskCompleted",
        body: encode(ws.RespondActivityTaskCompletedRequest, {
          namespace: "default",
          taskToken: issueReceipt(KEY, QUEUE, Buffer.from("temporal-token")),
        }),
        forwarded: () => current.service.respondActivityTaskCompleted,
      },
    ];
    for (const { method, body, forwarded } of cases) {
      const reading = gate();
      const heldPolls = countingHeldPolls();
      handler = lane({ heldPolls, receiptKey: async () => (await reading.pass(), KEY) });
      counted.mockClear();
      const leaving = leavingCall(method, body);
      await reading.entered;
      expect(heldPolls.held(), method).toBe(method === "PollActivityTaskQueue" ? 1 : 0);
      await leaving.leave();
      reading.open();
      await vi.waitFor(() => expect(counted).toHaveBeenCalledTimes(1));
      expect(counted.mock.calls[0]![0], method).toEqual({ method, decision: "abandoned", status: "CANCELLED", check: "none" });
      expect(forwarded(), method).not.toHaveBeenCalled();
      expect(heldPolls.held(), method).toBe(0);
    }
  });

  it("counts a caller that left while Temporal answered as abandoned, not by Temporal's answer", async () => {
    const answering = gate();
    handler = lane();
    current.service.pollActivityTaskQueue.mockImplementationOnce(async () => {
      await answering.pass();
      return ws.PollActivityTaskQueueResponse.create({});
    });
    counted.mockClear();
    const leaving = leavingCall("PollActivityTaskQueue", pollRequest());
    await answering.entered;
    await leaving.leave();
    answering.open();
    await vi.waitFor(() => expect(counted).toHaveBeenCalledTimes(1));
    expect(counted.mock.calls[0]![0]).toEqual({
      method: "PollActivityTaskQueue",
      decision: "abandoned",
      status: "CANCELLED",
      check: "none",
    });
  });

  it("ends every held poll, with its margin, inside the shutdown drain", () => {
    expect(POLL_BUDGET_MS + POLL_DRAIN_MARGIN_MS).toBeLessThanOrEqual(SHUTDOWN_DRAIN_TIMEOUT_MS);
  });
});

describe("credentialQueueOf", () => {
  it("asks the provider's capability, refuses without one, and logs a throw as a refusal", async () => {
    expect(await credentialQueueOf({ temporalTaskQueueOf: async () => "session:s" }, silent)("t")).toBe("session:s");
    expect(await credentialQueueOf({}, silent)("t")).toBeUndefined();
    const warn = vi.spyOn(silent, "warn");
    const throwing = credentialQueueOf({ temporalTaskQueueOf: async () => Promise.reject(new Error("down")) }, silent);
    expect(await throwing("t")).toBeUndefined();
    const odd = credentialQueueOf({ temporalTaskQueueOf: async () => Promise.reject("odd") }, silent);
    expect(await odd("t")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("currentConnectionOf", () => {
  it("reads the manager's current client on every call", () => {
    let client: { connection: ConnectionLike } | undefined;
    const connection = currentConnectionOf({ getClient: () => client });
    expect(connection()).toBeUndefined();
    client = { connection: current.connection };
    expect(connection()).toBe(current.connection);
  });
});
