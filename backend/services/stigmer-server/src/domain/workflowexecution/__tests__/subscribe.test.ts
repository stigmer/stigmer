/**
 * Pins the subscribe generator against Go subscribe_test.go case-for-case:
 * the register-before-snapshot gap fix (a broadcast fired at the exact
 * instant of the snapshot read must still be delivered) and the
 * consecutive-duplicate suppression (the at-or-before-snapshot overlap
 * frame is dropped; a distinct terminal frame still arrives). Plus the
 * terminal-set quirk twins: a terminal BROADCAST closes the stream, a
 * TERMINATED broadcast does not (the disclosed Go omission).
 */
import { clone, create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import { createContextValues } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { SubscribeWorkflowExecutionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

import { createLogger } from "../../../boot/logger.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { Store } from "../../../store/interface.js";

import { StreamBroker } from "../stream-broker.js";
import { isWorkflowTerminalPhase, subscribeExecution } from "../subscribe.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function execWithPhase(id: string, phase: ExecutionPhase): WorkflowExecution {
  return create(WorkflowExecutionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "WorkflowExecution",
    metadata: { id, name: id },
    status: { phase },
  });
}

/**
 * A store whose getResource answers the seeded snapshot and fires a
 * one-shot hook at the START of the read — the seam that injects a
 * broadcast "in the gap" (Go getHookStore). subscribeExecution consumes
 * only getResource.
 */
function hookedSnapshotStore(
  snapshot: WorkflowExecution,
  onGet?: () => void,
): Store {
  let fired = false;
  return {
    async getResource() {
      if (!fired && onGet !== undefined) {
        fired = true;
        onGet();
      }
      return clone(WorkflowExecutionSchema, snapshot);
    },
  } as unknown as Store;
}

function handlerContext(signal: AbortSignal): HandlerContext {
  const values = createContextValues();
  values.set(callerIdentityKey, testCallerIdentity());
  return { signal, values } as HandlerContext;
}

/**
 * Runs the generator to completion under a watchdog (Go runSubscribe): if
 * a regression reintroduces the gap, the post-gap terminal frame is
 * dropped, the loop parks forever, and the watchdog aborts so the test
 * fails fast instead of hanging.
 */
async function collectFrames(
  generator: AsyncGenerator<WorkflowExecution>,
  abortController: AbortController,
): Promise<WorkflowExecution[]> {
  const frames: WorkflowExecution[] = [];
  const watchdog = setTimeout(() => abortController.abort(), 5000);
  watchdog.unref();
  try {
    for await (const frame of generator) {
      frames.push(frame);
    }
  } finally {
    clearTimeout(watchdog);
  }
  if (abortController.signal.aborted) {
    throw new Error(
      "subscribe did not reach a terminal phase in time — the post-gap broadcast was likely dropped (register-before-snapshot regression)",
    );
  }
  return frames;
}

describe("subscribe (subscribe_test.go case-for-case)", () => {
  it("delivers an update broadcast during the snapshot read (the gap fix)", async () => {
    const broker = new StreamBroker(silentLogger);
    const id = "wfx-gap";
    const older = execWithPhase(id, ExecutionPhase.EXECUTION_IN_PROGRESS);
    const newer = execWithPhase(id, ExecutionPhase.EXECUTION_COMPLETED);

    // Fire the post-gap broadcast at the instant the snapshot is read.
    const store = hookedSnapshotStore(older, () => broker.broadcast(newer));
    const abortController = new AbortController();

    const frames = await collectFrames(
      subscribeExecution(
        {
          store,
          logger: silentLogger,
          broker,
          authorizer: newPermissiveSingleTeamAuthorizer(),
        },
        create(SubscribeWorkflowExecutionRequestSchema, { executionId: id }),
        handlerContext(abortController.signal),
      ),
      abortController,
    );

    expect(frames).toHaveLength(2);
    expect(frames[0].status?.phase, "first frame is the snapshot").toBe(
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );
    expect(frames[1].status?.phase, "second frame is the post-gap update").toBe(
      ExecutionPhase.EXECUTION_COMPLETED,
    );
  });

  it("suppresses the overlap duplicate but delivers a distinct terminal frame", async () => {
    const broker = new StreamBroker(silentLogger);
    const id = "wfx-dup";
    const snapshot = execWithPhase(id, ExecutionPhase.EXECUTION_IN_PROGRESS);
    const overlap = clone(WorkflowExecutionSchema, snapshot);
    const terminal = execWithPhase(id, ExecutionPhase.EXECUTION_COMPLETED);

    const store = hookedSnapshotStore(snapshot, () => {
      broker.broadcast(overlap);
      broker.broadcast(terminal);
    });
    const abortController = new AbortController();

    const frames = await collectFrames(
      subscribeExecution(
        {
          store,
          logger: silentLogger,
          broker,
          authorizer: newPermissiveSingleTeamAuthorizer(),
        },
        create(SubscribeWorkflowExecutionRequestSchema, { executionId: id }),
        handlerContext(abortController.signal),
      ),
      abortController,
    );

    expect(
      frames,
      "the overlap duplicate is suppressed; snapshot + terminal remain",
    ).toHaveLength(2);
    expect(frames[1].status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("unsubscribes from the broker on every exit path", async () => {
    const broker = new StreamBroker(silentLogger);
    const id = "wfx-cleanup";
    const terminal = execWithPhase(id, ExecutionPhase.EXECUTION_IN_PROGRESS);
    const store = hookedSnapshotStore(terminal, () =>
      broker.broadcast(execWithPhase(id, ExecutionPhase.EXECUTION_CANCELLED)),
    );
    const abortController = new AbortController();
    await collectFrames(
      subscribeExecution(
        {
          store,
          logger: silentLogger,
          broker,
          authorizer: newPermissiveSingleTeamAuthorizer(),
        },
        create(SubscribeWorkflowExecutionRequestSchema, { executionId: id }),
        handlerContext(abortController.signal),
      ),
      abortController,
    );
    expect(broker.getSubscriberCount(id), "the finally unsubscribed").toBe(0);
  });
});

describe("the terminal set (isWorkflowTerminalPhase — the disclosed quirk)", () => {
  it("closes on COMPLETED/FAILED/CANCELLED only; TERMINATED and PAUSED are absent", () => {
    expect(isWorkflowTerminalPhase(ExecutionPhase.EXECUTION_COMPLETED)).toBe(true);
    expect(isWorkflowTerminalPhase(ExecutionPhase.EXECUTION_FAILED)).toBe(true);
    expect(isWorkflowTerminalPhase(ExecutionPhase.EXECUTION_CANCELLED)).toBe(true);
    // The faithful-ported Go omission: a stream over a TERMINATED
    // execution never self-closes (disclosed, both-editions candidate).
    expect(isWorkflowTerminalPhase(ExecutionPhase.EXECUTION_TERMINATED)).toBe(false);
    expect(isWorkflowTerminalPhase(ExecutionPhase.EXECUTION_PAUSED)).toBe(false);
    expect(isWorkflowTerminalPhase(ExecutionPhase.EXECUTION_IN_PROGRESS)).toBe(false);
  });
});
