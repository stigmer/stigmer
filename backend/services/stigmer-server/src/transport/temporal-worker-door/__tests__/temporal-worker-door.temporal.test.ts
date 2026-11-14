/**
 * A sandbox speaks to Temporal only as itself.
 *
 * Two sandboxes, A and B, each hold what a sandbox is handed: the lane its
 * runner dials for work (the Stigmer server's own address, where the
 * unified port serves the Temporal worker lane) and its own credential.
 * Every call outside B's own queue is refused: listing runs, reading A's
 * history, ending or signalling A's run, starting a workflow on the
 * server's queue, polling A's queue, and answering A's task. A's own
 * runner, the SDK's real worker on the real native connection, runs its
 * turns end to end through the lane, a pause (cancellation through the
 * heartbeat's answer) included; a receipt is good for A alone, and a poll
 * held across a server stop ends inside the drain. A worker shaped as the
 * runner behind the server (two activity polls, its API key renewed while
 * it polls) never holds more than two of A's slots and is never refused
 * one (stigmer#2982).
 *
 * Runs on the SDK's test Temporal (`@temporalio/testing`); without one the
 * suite is skipped with the reason printed, like the other Temporal suites.
 */
import { fileURLToPath } from "node:url";

import { Connection } from "@temporalio/client";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import type { NativeConnection, Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import { SHUTDOWN_DRAIN_TIMEOUT_MS } from "../../constants.js";
import { createUnifiedPortServer, type UnifiedPortServer } from "../../server.js";
import { newHeldPolls, type HeldPolls } from "../capacity.js";
import { createTemporalWorkerDoorLane } from "../lane.js";
import { newReceiptKeySource } from "../receipt-key.js";

const SERVER_QUEUE = "agent_execution_stigmer";
const QUEUE_A = "session:ses_door_a";
const QUEUE_B = "session:ses_door_b";
const TOKEN_A = "token-of-sandbox-a";
const TOKEN_B = "token-of-sandbox-b";
const NAMESPACE = "default";
const WORKFLOWS = fileURLToPath(new URL("./__fixtures__/workflows.ts", import.meta.url));

/**
 * The runner's poller behind the server (runner src/worker.ts): two activity
 * polls, stated as the poller behaviour, the one poll option the SDK reads.
 */
const RUNNER_ACTIVITY_POLLERS = { type: "simple-maximum", maximum: 2 } as const;

/** The gRPC codes a refusal may carry: the method is not served, or not for this caller. */
const REFUSED = new Set([12, 7]);

const silent = createLogger({ level: "error", pretty: false, write: () => {} });

let env: TestWorkflowEnvironment | undefined;
let serverWorker: Worker | undefined;
let serverWorkerRun: Promise<void> | undefined;
let server: UnifiedPortServer | undefined;
let serverAddress = "";
let ready = false;

/** What a sandbox is handed: the address its runner dials for work, and its own credential. */
interface SandboxLane {
  readonly address: string;
  readonly apiKey: string | undefined;
}

/** The lane a sandbox is handed: the Stigmer server's own address, and its sandbox token. */
function laneFor(sandbox: "a" | "b"): SandboxLane {
  return { address: serverAddress, apiKey: sandbox === "a" ? TOKEN_A : TOKEN_B };
}

async function connect(lane: SandboxLane): Promise<Connection> {
  return Connection.connect({
    address: lane.address,
    ...(lane.apiKey === undefined ? {} : { apiKey: lane.apiKey, tls: false }),
  });
}

async function refusal(attempt: () => Promise<unknown>): Promise<number | "allowed"> {
  try {
    await attempt();
    return "allowed";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "number" ? code : -1;
  }
}

/** A raw poll on `queue` through `connection`, held at most `ms`. */
function poll(connection: Connection, queue: string, ms = 15_000) {
  return connection.withDeadline(Date.now() + ms, () =>
    connection.workflowService.pollActivityTaskQueue({
      namespace: NAMESPACE,
      taskQueue: { name: queue },
      identity: "test",
    }),
  );
}

/** The lane's held polls, recording how many were taken, refused, and held at most at once. */
function recordingHeldPolls(): HeldPolls & { taken(): number; refused(): number; mostHeld(): number } {
  const inner = newHeldPolls();
  let held = 0;
  let most = 0;
  let taken = 0;
  let refused = 0;
  return {
    taken: () => taken,
    refused: () => refused,
    mostHeld: () => most,
    hold(queue) {
      const slot = inner.hold(queue);
      if ("refused" in slot) {
        refused += 1;
        return slot;
      }
      taken += 1;
      held += 1;
      most = Math.max(most, held);
      let released = false;
      return {
        release: () => {
          if (!released) {
            released = true;
            held -= 1;
          }
          slot.release();
        },
      };
    },
  };
}

async function stopServer(): Promise<void> {
  if (server !== undefined) {
    const stopping = server;
    server = undefined;
    await stopping.shutdown();
  }
}

describe("a sandbox reaches Temporal only as itself", () => {
  beforeAll(async () => {
    try {
      const { TestWorkflowEnvironment: TWE } = await import("@temporalio/testing");
      const { Worker: W } = await import("@temporalio/worker");
      env = await TWE.createLocal();
      serverWorker = await W.create({
        connection: env.nativeConnection,
        taskQueue: SERVER_QUEUE,
        workflowsPath: WORKFLOWS,
      });
      serverWorkerRun = serverWorker.run();
      const stored = new Map<string, string>();
      const temporal = env.connection;
      server = createUnifiedPortServer({
        logger: silent,
        routes: () => {},
        interceptors: [],
        modelRegistryLane: (_request, response) => {
          response.statusCode = 404;
          response.end();
        },
        temporalWorkerDoorLane: createTemporalWorkerDoorLane({
          logger: silent,
          namespace: NAMESPACE,
          connection: () => temporal,
          queueOf: async (token) =>
            token === TOKEN_A ? QUEUE_A : token === TOKEN_B ? QUEUE_B : undefined,
          receiptKey: newReceiptKeySource({
            claim: async (key, value) => {
              if (!stored.has(key)) stored.set(key, value);
              return stored.get(key) ?? "";
            },
          }),
        }),
      });
      const port = await server.listen(0, "127.0.0.1");
      serverAddress = `127.0.0.1:${port}`;
      ready = true;
    } catch (error) {
      console.warn(
        `Temporal test server unavailable (tests will be skipped): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, 120_000);

  afterAll(async () => {
    await stopServer();
    serverWorker?.shutdown();
    await serverWorkerRun?.catch(() => {});
    await env?.teardown();
  });

  it("refuses every one of B's attempts on A", async (ctx) => {
    if (!ready || env === undefined) ctx.skip();
    const client = env!.client;
    // A's turn: an activity waiting on A's queue, and a run that waits.
    const turnA = await client.workflow.start("turn", {
      taskQueue: SERVER_QUEUE,
      workflowId: `door-turn-a-${Date.now()}`,
      args: [QUEUE_A, "a's input"],
    });
    const waitingA = await client.workflow.start("waiting", {
      taskQueue: SERVER_QUEUE,
      workflowId: `door-waiting-a-${Date.now()}`,
    });

    const b = await connect(laneFor("b"));
    const service = b.workflowService;
    const outcomes: Record<string, number | "allowed"> = {};
    outcomes.list = await refusal(() =>
      service.listWorkflowExecutions({ namespace: NAMESPACE, pageSize: 100 }),
    );
    outcomes.history = await refusal(() =>
      service.getWorkflowExecutionHistory({
        namespace: NAMESPACE,
        execution: { workflowId: turnA.workflowId },
      }),
    );
    outcomes.signal = await refusal(() =>
      service.signalWorkflowExecution({
        namespace: NAMESPACE,
        workflowExecution: { workflowId: waitingA.workflowId },
        signalName: "poke",
      }),
    );
    outcomes.startOnServerQueue = await refusal(() =>
      service.startWorkflowExecution({
        namespace: NAMESPACE,
        workflowId: `door-forged-${Date.now()}`,
        workflowType: { name: "waiting" },
        taskQueue: { name: SERVER_QUEUE },
        requestId: `forged-${Date.now()}`,
      }),
    );
    let stolenToken: Uint8Array | undefined;
    outcomes.pollA = await refusal(async () => {
      const task = await b.withDeadline(Date.now() + 15_000, () =>
        service.pollActivityTaskQueue({
          namespace: NAMESPACE,
          taskQueue: { name: QUEUE_A },
          identity: "sandbox-b",
        }),
      );
      if (task.taskToken !== undefined && task.taskToken !== null && task.taskToken.length > 0) {
        stolenToken = task.taskToken;
      }
    });
    outcomes.replyWithAsToken = await refusal(() =>
      service.respondActivityTaskCompleted({
        namespace: NAMESPACE,
        taskToken: stolenToken ?? new Uint8Array([1, 2, 3]),
        identity: "sandbox-b",
      }),
    );
    outcomes.terminate = await refusal(() =>
      service.terminateWorkflowExecution({
        namespace: NAMESPACE,
        workflowExecution: { workflowId: waitingA.workflowId },
        reason: "from another tenant's sandbox",
      }),
    );
    b.close();

    const verdicts = Object.fromEntries(
      Object.entries(outcomes).map(([attempt, outcome]) => [
        attempt,
        outcome !== "allowed" && REFUSED.has(outcome) ? "refused" : `answered ${String(outcome)}`,
      ]),
    );
    expect(verdicts).toEqual({
      list: "refused",
      history: "refused",
      signal: "refused",
      startOnServerQueue: "refused",
      pollA: "refused",
      replyWithAsToken: "refused",
      terminate: "refused",
    });
    expect(stolenToken, "B took a task from A's queue").toBeUndefined();
    await client.workflow.getHandle(waitingA.workflowId).terminate("test over").catch(() => {});
    await client.workflow.getHandle(turnA.workflowId).terminate("test over").catch(() => {});
  }, 60_000);

  it("hands A a receipt that is A's alone, and refuses one the server did not issue", async (ctx) => {
    if (!ready || env === undefined) ctx.skip();
    const turn = await env!.client.workflow.start("turn", {
      taskQueue: SERVER_QUEUE,
      workflowId: `door-receipt-${Date.now()}`,
      args: [QUEUE_A, "receipt"],
    });
    const a = await connect(laneFor("a"));
    const b = await connect(laneFor("b"));
    const task = await poll(a, QUEUE_A);
    const receipt = task.taskToken ?? new Uint8Array();
    expect(receipt.length).toBeGreaterThan(0);

    const forged = Uint8Array.from(receipt);
    forged[forged.length - 1] = (forged[forged.length - 1] ?? 0) ^ 1;
    const complete = (connection: Connection, taskToken: Uint8Array) =>
      connection.workflowService.respondActivityTaskCompleted({
        namespace: NAMESPACE,
        taskToken,
        identity: "test",
        result: {
          payloads: [
            { metadata: { encoding: Buffer.from("json/plain") }, data: Buffer.from(JSON.stringify("ok")) },
          ],
        },
      });
    expect(await refusal(() => complete(b, receipt))).toBe(7);
    expect(await refusal(() => complete(a, forged))).toBe(7);
    expect(await refusal(() => complete(a, receipt))).toBe("allowed");
    await expect(turn.result()).resolves.toBe("ok");

    // Temporal's history names the sandbox that did the work.
    const history = await turn.fetchHistory();
    const started = history.events?.find((event) => event.activityTaskStartedEventAttributes);
    expect(started?.activityTaskStartedEventAttributes?.identity).toMatch(/^sbx-ses-[0-9a-f]{12}$/);
    a.close();
    b.close();
  }, 60_000);

  it("runs A's turns end to end on the SDK's own worker, a pause included", async (ctx) => {
    if (!ready || env === undefined) ctx.skip();
    const { NativeConnection: Native, Worker: W } = await import("@temporalio/worker");
    const { Context } = await import("@temporalio/activity");
    let connection: NativeConnection | undefined;
    let worker: Worker | undefined;
    let run: Promise<void> | undefined;
    try {
      connection = await Native.connect({ address: serverAddress, apiKey: TOKEN_A, tls: false });
      worker = await W.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: QUEUE_A,
        activityTaskPollerBehavior: RUNNER_ACTIVITY_POLLERS,
        activities: {
          async Turn(input: string): Promise<string> {
            if (input === "long") {
              for (;;) {
                Context.current().heartbeat("working");
                await Context.current().sleep(300);
              }
            }
            Context.current().heartbeat("started");
            return `done: ${input}`;
          },
        },
      });
      run = worker.run();
      const done = await env!.client.workflow.execute("turn", {
        taskQueue: SERVER_QUEUE,
        workflowId: `door-worker-${Date.now()}`,
        args: [QUEUE_A, "hello"],
      });
      expect(done).toBe("done: hello");
      const paused = await env!.client.workflow.execute("cancelledTurn", {
        taskQueue: SERVER_QUEUE,
        workflowId: `door-pause-${Date.now()}`,
        args: [QUEUE_A],
      });
      expect(paused).toBe("cancelled");
    } finally {
      worker?.shutdown();
      await run?.catch(() => {});
      await connection?.close();
    }
  }, 90_000);

  it("holds at most two of A's slots for a runner-shaped worker, and refuses it none", async (ctx) => {
    if (!ready || env === undefined) ctx.skip();
    const { NativeConnection: Native, Worker: W } = await import("@temporalio/worker");
    // Its own lane, with a recorder and a short budget, so polls cycle many
    // times in seconds; Temporal refuses a poll deadline under two seconds.
    const slots = recordingHeldPolls();
    const temporal = env!.connection;
    const stored = new Map<string, string>();
    const own = createUnifiedPortServer({
      logger: silent,
      routes: () => {},
      interceptors: [],
      modelRegistryLane: (_request, response) => {
        response.statusCode = 404;
        response.end();
      },
      temporalWorkerDoorLane: createTemporalWorkerDoorLane({
        logger: silent,
        namespace: NAMESPACE,
        connection: () => temporal,
        queueOf: async (token) => (token === TOKEN_A ? QUEUE_A : undefined),
        receiptKey: newReceiptKeySource({
          claim: async (key, value) => {
            if (!stored.has(key)) stored.set(key, value);
            return stored.get(key) ?? "";
          },
        }),
        heldPolls: slots,
        pollBudgetMs: 2_500,
      }),
    });
    const port = await own.listen(0, "127.0.0.1");
    let connection: NativeConnection | undefined;
    let worker: Worker | undefined;
    let run: Promise<void> | undefined;
    try {
      connection = await Native.connect({ address: `127.0.0.1:${port}`, apiKey: TOKEN_A, tls: false });
      worker = await W.create({
        connection,
        namespace: NAMESPACE,
        taskQueue: QUEUE_A,
        activityTaskPollerBehavior: RUNNER_ACTIVITY_POLLERS,
        activities: {
          async Turn(input: string): Promise<string> {
            return `done: ${input}`;
          },
        },
      });
      run = worker.run();
      // The runner hands its renewed token to the connection while it polls.
      await connection.setApiKey(TOKEN_A);
      for (const input of ["one", "two", "three"]) {
        const done = await env!.client.workflow.execute("turn", {
          taskQueue: SERVER_QUEUE,
          workflowId: `door-bound-${input}-${Date.now()}`,
          args: [QUEUE_A, input],
        });
        expect(done).toBe(`done: ${input}`);
      }
      // Idle: each poll ends on the budget and is replaced, several times over.
      await new Promise((resolve) => setTimeout(resolve, 6_000));
    } finally {
      worker?.shutdown();
      await run?.catch(() => {});
      await connection?.close();
      await own.shutdown();
    }
    expect(slots.taken()).toBeGreaterThanOrEqual(6);
    expect({ refused: slots.refused(), mostHeld: slots.mostHeld() }).toEqual({ refused: 0, mostHeld: 2 });
  }, 90_000);

  it("ends a held poll inside the shutdown drain", async (ctx) => {
    if (!ready || env === undefined) ctx.skip();
    const a = await connect(laneFor("a"));
    const held = poll(a, QUEUE_A, 60_000).then(
      (task) => ({ ok: true as const, empty: (task.taskToken?.length ?? 0) === 0 }),
      (error: unknown) => ({ ok: false as const, code: (error as { code?: unknown }).code }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const startedAt = Date.now();
    await stopServer();
    const tookMs = Date.now() - startedAt;
    expect(tookMs).toBeLessThan(SHUTDOWN_DRAIN_TIMEOUT_MS);
    expect(await held).toEqual({ ok: true, empty: true });
    a.close();
  }, 30_000);
});
