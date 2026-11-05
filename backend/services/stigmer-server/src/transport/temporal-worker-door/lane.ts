/**
 * The Temporal worker lane: the only way a sandboxed runner reaches
 * Temporal. A prefix lane on the unified port
 * (`/temporal.api.workflowservice.v1.WorkflowService/`), which every
 * sandbox already reaches as its backend endpoint; a sandbox is handed no
 * Temporal address and no Temporal credential at all.
 *
 * A sandbox's runner is an activity worker on ONE task queue, its own
 * (`session:<id>` or `mcpconnect:<id>`, sandbox/naming.ts). The lane serves
 * exactly the calls such a worker makes, each checked before it is
 * forwarded on the server's own Temporal connection:
 *
 *   | Method                         | Checked                                    |
 *   |--------------------------------|--------------------------------------------|
 *   | GetSystemInfo                  | the caller is a sandboxed runner           |
 *   | DescribeNamespace              | the server's namespace, by name            |
 *   | PollActivityTaskQueue          | the namespace; the caller's own queue, no  |
 *   |                                | sticky or versioned queue; a held slot     |
 *   | RespondActivityTaskCompleted,  | the namespace; a receipt this server       |
 *   | RespondActivityTaskFailed,     | issued to the caller's own queue           |
 *   | RespondActivityTaskCanceled,   |                                            |
 *   | RecordActivityTaskHeartbeat    |                                            |
 *
 * Every other method answers UNIMPLEMENTED before any lane code runs: the
 * list, history, terminate, signal and start calls a stranger would try,
 * and the SDK's own `ShutdownWorker` and worker heartbeat, which it ignores
 * an UNIMPLEMENTED for (measured on SDK 1.16.2, 2026-11-05).
 *
 * Who the caller is comes from its credential alone (the provider's
 * `temporalTaskQueueOf` capability, runnerauth/runner-credential-provider.ts),
 * never from anything it claims: a person's key, a run credential or an
 * ended sandbox's token is refused. What is forwarded is BUILT from checked
 * fields, never relayed: the server's namespace, the caller's queue, and the
 * sandbox's name as `identity`, so Temporal's history names the sandbox that
 * did the work; version and deployment fields are dropped. Temporal's
 * answers come back whole, its failures exactly (code, message and
 * `grpc-status-details-bin`, from which the SDK decides its retries), with
 * one change: a polled task's token becomes a receipt (receipts.ts).
 *
 * A poll is held for at most `POLL_BUDGET_MS`, forwarded with that deadline,
 * so every held poll ends inside the server's shutdown drain
 * (`SHUTDOWN_DRAIN_TIMEOUT_MS`) with Temporal's own empty answer, which the
 * SDK takes as "no task yet" and polls again.
 *
 * Every refusal is a sentence from words.ts; every served call is counted
 * once (observability/runner-work-queue-metrics.ts), because these calls do
 * not pass the Connect chain that counts every other RPC.
 */
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";

import proto from "@temporalio/proto";
import type { ConnectionLike } from "@temporalio/client";

import type { Logger } from "../../boot/logger.js";
import type { GrpcStatusName } from "../../observability/rpc-metrics.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import { recordWorkQueueCall, type WorkQueueDecision } from "../../observability/runner-work-queue-metrics.js";
import { SANDBOX_QUEUE_PREFIXES, sandboxBaseName } from "../../sandbox/naming.js";
import type { SandboxScope } from "../../sandbox/provisioner.js";
import { MAX_MESSAGE_BYTES } from "../constants.js";
import type { LaneHandler, LaneRequest, LaneResponse } from "../lanes.js";
import { newHeldPolls, type HeldPolls } from "./capacity.js";
import { GrpcCode, grpcTimeoutMs, readUnaryMessage, writeGrpcAnswer, type GrpcAnswer } from "./frame.js";
import { issueReceipt, openReceipt } from "./receipts.js";
import type { ReceiptKeySource } from "./receipt-key.js";
import { WORDS } from "./words.js";

const ws = proto.temporal.api.workflowservice.v1;
const NORMAL_QUEUE = proto.temporal.api.enums.v1.TaskQueueKind.TASK_QUEUE_KIND_NORMAL;
const UNSPECIFIED_QUEUE = proto.temporal.api.enums.v1.TaskQueueKind.TASK_QUEUE_KIND_UNSPECIFIED;

/** The path prefix of Temporal's WorkflowService, the lane's whole surface. */
export const TEMPORAL_WORKFLOW_SERVICE_PATH_PREFIX = "/temporal.api.workflowservice.v1.WorkflowService/";

/**
 * The longest a poll is held. It and its margin must end inside the
 * server's 10 s shutdown drain (a test pins the sum), so a rollout never
 * cuts a poll that holds a task.
 */
export const POLL_BUDGET_MS = 7_000;

/** Room between the poll budget and the drain, for Temporal's answer to arrive and be relayed. */
export const POLL_DRAIN_MARGIN_MS = 2_000;

export interface TemporalWorkerDoorDeps {
  readonly logger: Logger;
  /** The server's Temporal namespace, the only one served. */
  readonly namespace: string;
  /** The server's current Temporal connection; undefined while it has none. */
  readonly connection: () => ConnectionLike | undefined;
  /**
   * The one task queue the bearer's sandbox serves, or undefined to refuse
   * (the provider's capability, wrapped so a throw is a logged refusal).
   */
  readonly queueOf: (rawToken: string) => Promise<string | undefined>;
  readonly receiptKey: ReceiptKeySource;
  readonly heldPolls?: HeldPolls;
  /** Overrides POLL_BUDGET_MS (tests). */
  readonly pollBudgetMs?: number;
}

/** One call's outcome, answered and counted together. */
interface Outcome {
  readonly answer: GrpcAnswer;
  readonly decision: WorkQueueDecision;
  readonly check: string;
}

interface CallContext {
  readonly deps: TemporalWorkerDoorDeps;
  readonly connection: ConnectionLike;
  readonly queue: string;
  readonly identity: string;
  readonly message: Uint8Array;
  readonly signal: AbortSignal;
  readonly callerDeadlineMs: number | undefined;
  readonly heldPolls: HeldPolls;
}

type Handler = (call: CallContext) => Promise<Outcome>;

const HANDLERS: Readonly<Record<string, Handler>> = {
  GetSystemInfo: async (call) =>
    forward(call, async (service) =>
      ws.GetSystemInfoResponse.encode(await service.getSystemInfo({})).finish(),
    ),
  DescribeNamespace: async (call) => {
    const request = decode(ws.DescribeNamespaceRequest, call.message);
    if (request === undefined) {
      return malformed();
    }
    if (request.namespace !== call.deps.namespace || request.id !== "") {
      return refused(GrpcCode.PERMISSION_DENIED, WORDS.wrongNamespace(request.namespace || request.id), "namespace");
    }
    return forward(call, async (service) =>
      ws.DescribeNamespaceResponse.encode(
        await service.describeNamespace({ namespace: call.deps.namespace }),
      ).finish(),
    );
  },
  PollActivityTaskQueue: async (call) => {
    const request = decode(ws.PollActivityTaskQueueRequest, call.message);
    if (request === undefined) {
      return malformed();
    }
    if (request.namespace !== call.deps.namespace) {
      return refused(GrpcCode.PERMISSION_DENIED, WORDS.wrongNamespace(request.namespace), "namespace");
    }
    const taskQueue = request.taskQueue;
    if (taskQueue?.name !== call.queue) {
      return refused(GrpcCode.PERMISSION_DENIED, WORDS.wrongQueue, "queue");
    }
    const kind = taskQueue.kind ?? UNSPECIFIED_QUEUE;
    if ((kind !== NORMAL_QUEUE && kind !== UNSPECIFIED_QUEUE) || (taskQueue.normalName ?? "") !== "") {
      return refused(GrpcCode.PERMISSION_DENIED, WORDS.stickyQueue, "queue_kind");
    }
    const slot = call.heldPolls.hold(call.queue);
    if ("refused" in slot) {
      return slot.refused === "per-sandbox"
        ? refused(GrpcCode.RESOURCE_EXHAUSTED, WORDS.tooManyForSandbox, "held_per_sandbox")
        : refused(GrpcCode.RESOURCE_EXHAUSTED, WORDS.tooManyForServer, "held_in_all");
    }
    try {
      let key: Buffer;
      try {
        key = await call.deps.receiptKey();
      } catch {
        return failed(GrpcCode.UNAVAILABLE, WORDS.receiptKeyUnavailable, "receipt_key");
      }
      const budget = call.deps.pollBudgetMs ?? POLL_BUDGET_MS;
      const ownDeadline = call.callerDeadlineMs === undefined || budget <= call.callerDeadlineMs;
      return await forward(
        call,
        async (service) => {
          const task = await service.pollActivityTaskQueue({
            namespace: call.deps.namespace,
            taskQueue: { name: call.queue, kind: NORMAL_QUEUE },
            identity: call.identity,
          });
          if (task.taskToken !== null && task.taskToken !== undefined && task.taskToken.length > 0) {
            task.taskToken = issueReceipt(key, call.queue, task.taskToken);
          }
          return ws.PollActivityTaskQueueResponse.encode(task).finish();
        },
        {
          deadlineMs: Math.min(budget, call.callerDeadlineMs ?? budget),
          // The budget ending first is "no task yet", Temporal's own empty answer.
          ...(ownDeadline
            ? { onDeadline: () => ws.PollActivityTaskQueueResponse.encode({}).finish() }
            : {}),
        },
      );
    } finally {
      slot.release();
    }
  },
  RespondActivityTaskCompleted: async (call) => {
    const request = decode(ws.RespondActivityTaskCompletedRequest, call.message);
    if (request === undefined) {
      return malformed();
    }
    return withReceipt(call, request.namespace, request.taskToken, (taskToken) => async (service) =>
      ws.RespondActivityTaskCompletedResponse.encode(
        await service.respondActivityTaskCompleted({
          namespace: call.deps.namespace,
          taskToken,
          identity: call.identity,
          result: request.result,
        }),
      ).finish(),
    );
  },
  RespondActivityTaskFailed: async (call) => {
    const request = decode(ws.RespondActivityTaskFailedRequest, call.message);
    if (request === undefined) {
      return malformed();
    }
    return withReceipt(call, request.namespace, request.taskToken, (taskToken) => async (service) =>
      ws.RespondActivityTaskFailedResponse.encode(
        await service.respondActivityTaskFailed({
          namespace: call.deps.namespace,
          taskToken,
          identity: call.identity,
          failure: request.failure,
          lastHeartbeatDetails: request.lastHeartbeatDetails,
        }),
      ).finish(),
    );
  },
  RespondActivityTaskCanceled: async (call) => {
    const request = decode(ws.RespondActivityTaskCanceledRequest, call.message);
    if (request === undefined) {
      return malformed();
    }
    return withReceipt(call, request.namespace, request.taskToken, (taskToken) => async (service) =>
      ws.RespondActivityTaskCanceledResponse.encode(
        await service.respondActivityTaskCanceled({
          namespace: call.deps.namespace,
          taskToken,
          identity: call.identity,
          details: request.details,
        }),
      ).finish(),
    );
  },
  RecordActivityTaskHeartbeat: async (call) => {
    const request = decode(ws.RecordActivityTaskHeartbeatRequest, call.message);
    if (request === undefined) {
      return malformed();
    }
    return withReceipt(call, request.namespace, request.taskToken, (taskToken) => async (service) =>
      ws.RecordActivityTaskHeartbeatResponse.encode(
        await service.recordActivityTaskHeartbeat({
          namespace: call.deps.namespace,
          taskToken,
          identity: call.identity,
          details: request.details,
        }),
      ).finish(),
    );
  },
};

/**
 * The lane's `queueOf` over a runner-credential provider: its
 * `temporalTaskQueueOf` capability, a provider without it refusing every
 * caller, and a throw a logged refusal (a composition fault, never a
 * crash of the call).
 */
export function credentialQueueOf(
  provider: Pick<RunnerCredentialProvider, "temporalTaskQueueOf">,
  logger: Logger,
): (rawToken: string) => Promise<string | undefined> {
  return async (rawToken) => {
    if (provider.temporalTaskQueueOf === undefined) {
      return undefined;
    }
    try {
      return await provider.temporalTaskQueueOf(rawToken);
    } catch (error) {
      logger.warn("Runner credential's Temporal queue could not be read; refusing", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };
}

/** The server's CURRENT Temporal connection, read per call so a reconnect reaches the lane (manager.ts). */
export function currentConnectionOf(manager: {
  getClient(): { readonly connection: ConnectionLike } | undefined;
}): () => ConnectionLike | undefined {
  return () => manager.getClient()?.connection;
}

/** The lane handler compose wires on the unified port (transport/server.ts). */
export function createTemporalWorkerDoorLane(deps: TemporalWorkerDoorDeps): LaneHandler {
  const heldPolls = deps.heldPolls ?? newHeldPolls();
  return (request: LaneRequest, response: LaneResponse) => {
    if (request.httpVersionMajor !== 2) {
      response.statusCode = 505;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(WORDS.notHttp2);
      return;
    }
    void serve(deps, heldPolls, request as Http2ServerRequest, response as Http2ServerResponse).catch(
      (error: unknown) => {
        deps.logger.warn("Temporal worker lane failed a call", {
          error: error instanceof Error ? error.message : String(error),
        });
        writeGrpcAnswer(response as Http2ServerResponse, { code: GrpcCode.INTERNAL, text: WORDS.malformed });
      },
    );
  };
}

async function serve(
  deps: TemporalWorkerDoorDeps,
  heldPolls: HeldPolls,
  request: Http2ServerRequest,
  response: Http2ServerResponse,
): Promise<void> {
  const path = (request.url ?? "").split("?", 1)[0] ?? "";
  const method = path.slice(TEMPORAL_WORKFLOW_SERVICE_PATH_PREFIX.length);
  const handler = Object.hasOwn(HANDLERS, method) ? HANDLERS[method] : undefined;
  if (handler === undefined) {
    writeGrpcAnswer(response, { code: GrpcCode.UNIMPLEMENTED, text: WORDS.notServed(method) });
    return;
  }
  const outcome = await decide(deps, heldPolls, handler, request, response);
  writeGrpcAnswer(response, outcome.answer);
  recordWorkQueueCall({
    method,
    decision: outcome.decision,
    status: STATUS_NAMES[outcome.answer.code] ?? "UNKNOWN",
    check: outcome.check,
  });
  if (outcome.decision === "refused") {
    deps.logger.debug("Temporal worker lane refused a call", { method, check: outcome.check });
  }
}

async function decide(
  deps: TemporalWorkerDoorDeps,
  heldPolls: HeldPolls,
  handler: Handler,
  request: Http2ServerRequest,
  response: Http2ServerResponse,
): Promise<Outcome> {
  const contentType = request.headers["content-type"] ?? "";
  if (contentType !== "application/grpc" && !contentType.startsWith("application/grpc+proto")) {
    return refused(GrpcCode.UNIMPLEMENTED, WORDS.notGrpc, "content_type");
  }
  const token = bearerOf(request.headers.authorization);
  if (token === undefined) {
    return refused(GrpcCode.UNAUTHENTICATED, WORDS.noCredential, "credential");
  }
  const read = await readUnaryMessage(request, MAX_MESSAGE_BYTES);
  if (!read.ok) {
    return failed(read.code, WORDS[read.reason], "frame");
  }
  const queue = await deps.queueOf(token);
  if (queue === undefined) {
    return refused(GrpcCode.PERMISSION_DENIED, WORDS.notASandbox, "credential");
  }
  const connection = deps.connection();
  if (connection === undefined) {
    return failed(GrpcCode.UNAVAILABLE, WORDS.engineUnavailable, "engine");
  }
  const aborted = new AbortController();
  const onClose = (): void => aborted.abort();
  response.once("close", onClose);
  try {
    return await handler({
      deps,
      connection,
      queue,
      identity: identityOf(queue),
      message: read.message,
      signal: aborted.signal,
      callerDeadlineMs: grpcTimeoutMs(request.headers["grpc-timeout"]),
      heldPolls,
    });
  } finally {
    response.off("close", onClose);
  }
}

type WorkflowService = ConnectionLike["workflowService"];

interface ForwardOptions {
  readonly deadlineMs?: number;
  /** Answers in place of DEADLINE_EXCEEDED when the lane's own deadline ended the call. */
  readonly onDeadline?: () => Uint8Array;
}

/** Forwards on the server's connection; relays Temporal's failure exactly. */
async function forward(
  call: CallContext,
  run: (service: WorkflowService) => Promise<Uint8Array>,
  options: ForwardOptions = {},
): Promise<Outcome> {
  const deadlineMs = options.deadlineMs ?? call.callerDeadlineMs;
  const scoped = (): Promise<Uint8Array> =>
    deadlineMs === undefined
      ? run(call.connection.workflowService)
      : call.connection.withDeadline(Date.now() + deadlineMs, () => run(call.connection.workflowService));
  try {
    const message = await call.connection.withAbortSignal(call.signal, scoped);
    return { answer: { code: GrpcCode.OK, message }, decision: "allowed", check: "none" };
  } catch (error) {
    const relayed = temporalFailureOf(error);
    if (relayed === undefined) {
      throw error;
    }
    if (relayed.code === GrpcCode.DEADLINE_EXCEEDED && options.onDeadline !== undefined) {
      return { answer: { code: GrpcCode.OK, message: options.onDeadline() }, decision: "allowed", check: "none" };
    }
    return { answer: relayed, decision: "temporal_failed", check: "none" };
  }
}

/** Opens the reply's receipt and forwards with Temporal's own token, or refuses. */
async function withReceipt(
  call: CallContext,
  namespace: string,
  receipt: Uint8Array | null | undefined,
  build: (taskToken: Uint8Array) => (service: WorkflowService) => Promise<Uint8Array>,
): Promise<Outcome> {
  if (namespace !== call.deps.namespace) {
    return refused(GrpcCode.PERMISSION_DENIED, WORDS.wrongNamespace(namespace), "namespace");
  }
  let key: Buffer;
  try {
    key = await call.deps.receiptKey();
  } catch {
    return failed(GrpcCode.UNAVAILABLE, WORDS.receiptKeyUnavailable, "receipt_key");
  }
  const opened = receipt === null || receipt === undefined ? undefined : openReceipt(key, receipt);
  if (opened === undefined || opened.queue !== call.queue) {
    return refused(GrpcCode.PERMISSION_DENIED, WORDS.notYourReceipt, "receipt");
  }
  return forward(call, build(opened.token));
}

/** A grpc-js ServiceError's status, message and details, or undefined for anything else. */
function temporalFailureOf(error: unknown): GrpcAnswer | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const { code, details, metadata } = error as {
    code?: unknown;
    details?: unknown;
    metadata?: { get?: (name: string) => unknown[] };
  };
  if (typeof code !== "number") {
    return undefined;
  }
  const detailsBin = metadata?.get?.("grpc-status-details-bin")?.[0];
  return {
    code,
    text: typeof details === "string" ? details : "",
    ...(detailsBin instanceof Uint8Array ? { details: detailsBin } : {}),
  };
}

/** A request message, or undefined for bytes that are not one. */
function decode<T>(type: { decode(bytes: Uint8Array): T }, bytes: Uint8Array): T | undefined {
  try {
    return type.decode(bytes);
  } catch {
    return undefined;
  }
}

function malformed(): Outcome {
  return failed(GrpcCode.INTERNAL, WORDS.malformed, "decode");
}

function refused(code: number, text: string, check: string): Outcome {
  return { answer: { code, text }, decision: "refused", check };
}

function failed(code: number, text: string, check: string): Outcome {
  return { answer: { code, text }, decision: "failed", check };
}

function bearerOf(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  return match?.[1];
}

/** The sandbox's name, from its own (already authorized) queue: Temporal's history names it. */
function identityOf(queue: string): string {
  const scope = (Object.keys(SANDBOX_QUEUE_PREFIXES) as SandboxScope[]).find((candidate) =>
    queue.startsWith(SANDBOX_QUEUE_PREFIXES[candidate]),
  );
  return scope === undefined ? queue : sandboxBaseName(scope, queue.slice(SANDBOX_QUEUE_PREFIXES[scope].length));
}

const STATUS_NAMES: Readonly<Record<number, GrpcStatusName>> = {
  0: "OK",
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  6: "ALREADY_EXISTS",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  11: "OUT_OF_RANGE",
  12: "UNIMPLEMENTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  15: "DATA_LOSS",
  16: "UNAUTHENTICATED",
};
