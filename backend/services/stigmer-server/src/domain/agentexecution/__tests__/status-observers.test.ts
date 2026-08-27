/**
 * Pins the status-hook consumption contract (O4, 20260827.07; DD-006 §3):
 * the Q4 firing rule (phase change only), observer ordering and isolation
 * (a throwing/rejecting observer is logged and never fails the caller),
 * and the decorator clone-commit posture (a throwing decorator degrades
 * exactly ITS contribution — earlier contributions survive, the RPC never
 * fails). The per-site wiring is pinned by the lifecycle/approval/
 * composition suites; this file pins the shared notifier itself.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { UpdateStatusResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

import type { Logger } from "../../../boot/logger.js";
import type { AgentExecutionStatusTransition } from "../../../extensions/status-hooks.js";
import {
  applyResponseDecorators,
  notifyStatusObservers,
} from "../status-observers.js";

function silentLoggerWithCapture(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: (msg: string) => {
      warnings.push(msg);
    },
    error: () => {},
  } as unknown as Logger;
  return { logger, warnings };
}

function execution(id: string) {
  return create(AgentExecutionSchema, { metadata: { id, name: id } });
}

describe("notifyStatusObservers", () => {
  it("fires only when the phase actually changed (ruling Q4)", async () => {
    const seen: AgentExecutionStatusTransition[] = [];
    const { logger } = silentLoggerWithCapture();
    const deps = {
      statusObservers: [
        (t: AgentExecutionStatusTransition) => void seen.push(t),
      ],
      logger,
    };

    await notifyStatusObservers(
      deps,
      execution("aexec_same"),
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );
    expect(seen).toHaveLength(0);

    await notifyStatusObservers(
      deps,
      execution("aexec_changed"),
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.oldPhase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(seen[0]?.newPhase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(seen[0]?.execution.metadata?.id).toBe("aexec_changed");
  });

  it("runs observers in registration order, awaiting each", async () => {
    const order: string[] = [];
    const { logger } = silentLoggerWithCapture();
    await notifyStatusObservers(
      {
        statusObservers: [
          async () => {
            // A microtask delay: were observers not awaited in order, the
            // second (synchronous) observer would record first.
            await Promise.resolve();
            order.push("first");
          },
          () => void order.push("second"),
        ],
        logger,
      },
      execution("aexec_order"),
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_FAILED,
    );
    expect(order).toEqual(["first", "second"]);
  });

  it("logs a throwing or rejecting observer and keeps going — never a failed transition", async () => {
    const seen: string[] = [];
    const { logger, warnings } = silentLoggerWithCapture();
    await expect(
      notifyStatusObservers(
        {
          statusObservers: [
            () => {
              throw new Error("sync extension bug");
            },
            () => Promise.reject(new Error("async extension bug")),
            () => void seen.push("healthy"),
          ],
          logger,
        },
        execution("aexec_faulty"),
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        ExecutionPhase.EXECUTION_CANCELLED,
      ),
    ).resolves.toBeUndefined();
    expect(seen).toEqual(["healthy"]);
    expect(warnings).toHaveLength(2);
  });
});

describe("applyResponseDecorators", () => {
  it("commits each successful decorator's contribution to the reply", async () => {
    const { logger } = silentLoggerWithCapture();
    const decorated = await applyResponseDecorators(
      [
        (_execution, response) => {
          response.signal = ExecutionControlSignal.STOP;
        },
      ],
      logger,
      execution("aexec_dec"),
      create(UpdateStatusResponseSchema, {
        signal: ExecutionControlSignal.UNSPECIFIED,
      }),
    );
    expect(decorated.signal).toBe(ExecutionControlSignal.STOP);
  });

  it("degrades exactly the throwing decorator's contribution, keeping earlier ones", async () => {
    const { logger, warnings } = silentLoggerWithCapture();
    const decorated = await applyResponseDecorators(
      [
        (_execution, response) => {
          response.signal = ExecutionControlSignal.STOP;
        },
        (_execution, response) => {
          // Writes before throwing — the clone-commit posture must
          // discard this partial write, not ship it.
          response.signal = ExecutionControlSignal.UNSPECIFIED;
          throw new Error("decorator bug");
        },
      ],
      logger,
      execution("aexec_partial"),
      create(UpdateStatusResponseSchema, {
        signal: ExecutionControlSignal.UNSPECIFIED,
      }),
    );
    expect(decorated.signal).toBe(ExecutionControlSignal.STOP);
    expect(warnings).toHaveLength(1);
  });
});
