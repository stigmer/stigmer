/**
 * Pins the eval's workflow port (workflows.ts): a start names the suite
 * workflow's type, its deterministic id, the queue and the `{ evalId }`
 * input, and counts an already-started workflow as success; a cancel asks
 * the workflow under the eval's id and answers "not-found" when none runs;
 * no engine connection is the port's typed error on both; any other
 * failure, the connection's deadline included, is thrown as it came. The
 * type `stigmer/evals/eval-run` and the id `eval-run/<eval run id>` are
 * pinned byte for byte.
 */
import type { Client } from "@temporalio/client";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";

import {
  RUN_EVAL_RUN_WORKFLOW_TYPE,
  runEvalRunWorkflowId,
} from "../../../temporal/evals/names.js";
import {
  EvalRunEngineUnavailableError,
  newTemporalEvalRunWorkflows,
} from "../workflows.js";

function engine(answers: {
  start?: () => Promise<unknown>;
  cancel?: () => Promise<unknown>;
}) {
  const start = vi.fn(answers.start ?? (() => Promise.resolve({})));
  const cancel = vi.fn(answers.cancel ?? (() => Promise.resolve()));
  const getHandle = vi.fn(() => ({ cancel }));
  const client = {
    connection: {
      withDeadline: <R>(deadline: number | Date, fn: () => Promise<R>): Promise<R> => {
        const ms = Number(deadline) - Date.now();
        return Promise.race([
          fn(),
          new Promise<R>((_, reject) =>
            setTimeout(() => reject(new Error("DEADLINE_EXCEEDED")), Math.max(ms, 0)),
          ),
        ]);
      },
    },
    workflow: { start, getHandle },
  };
  return { client: client as unknown as Client, start, getHandle, cancel };
}

describe("the eval's workflow port", () => {
  it("starts the suite workflow under the eval's id with its input, and counts a second start as success", async () => {
    const { client, start } = engine({});
    const port = newTemporalEvalRunWorkflows({ client: () => client, taskQueue: "grading_stigmer" });
    await port.start("evr_1");
    expect(start).toHaveBeenCalledWith(RUN_EVAL_RUN_WORKFLOW_TYPE, expect.objectContaining({
      workflowId: runEvalRunWorkflowId("evr_1"),
      taskQueue: "grading_stigmer",
      workflowIdReusePolicy: "REJECT_DUPLICATE",
      args: [{ evalId: "evr_1" }],
    }));

    const again = engine({
      start: () =>
        Promise.reject(
          new WorkflowExecutionAlreadyStartedError("already", runEvalRunWorkflowId("evr_1"), RUN_EVAL_RUN_WORKFLOW_TYPE),
        ),
    });
    await expect(
      newTemporalEvalRunWorkflows({ client: () => again.client, taskQueue: "q" }).start("evr_1"),
    ).resolves.toBeUndefined();
  });

  it("throws a refused or late start as it came", async () => {
    const refused = engine({ start: () => Promise.reject(new Error("namespace not found")) });
    await expect(
      newTemporalEvalRunWorkflows({ client: () => refused.client, taskQueue: "q" }).start("evr_1"),
    ).rejects.toThrow("namespace not found");
    const late = engine({ start: () => new Promise(() => undefined) });
    await expect(
      newTemporalEvalRunWorkflows({ client: () => late.client, taskQueue: "q", deadlineMs: 5 }).start("evr_1"),
    ).rejects.toThrow("DEADLINE_EXCEEDED");
  });

  it("cancels the workflow under the eval's id, and answers not-found when none runs", async () => {
    const { client, getHandle, cancel } = engine({});
    const port = newTemporalEvalRunWorkflows({ client: () => client, taskQueue: "q" });
    expect(await port.cancel("evr_1")).toBe("requested");
    expect(getHandle).toHaveBeenCalledWith(runEvalRunWorkflowId("evr_1"));
    expect(cancel).toHaveBeenCalledOnce();

    const gone = engine({
      cancel: () => Promise.reject(new WorkflowNotFoundError("gone", runEvalRunWorkflowId("evr_1"), undefined)),
    });
    expect(
      await newTemporalEvalRunWorkflows({ client: () => gone.client, taskQueue: "q" }).cancel("evr_1"),
    ).toBe("not-found");
    const broken = engine({ cancel: () => Promise.reject(new Error("transport closed")) });
    await expect(
      newTemporalEvalRunWorkflows({ client: () => broken.client, taskQueue: "q" }).cancel("evr_1"),
    ).rejects.toThrow("transport closed");
  });

  it("starts and cancels under the pinned type and id", async () => {
    expect(RUN_EVAL_RUN_WORKFLOW_TYPE).toBe("stigmer/evals/eval-run");
    expect(runEvalRunWorkflowId("evr_1")).toBe("eval-run/evr_1");
    const { client, start, getHandle } = engine({});
    const port = newTemporalEvalRunWorkflows({ client: () => client, taskQueue: "q" });
    await port.start("evr_1");
    expect(start).toHaveBeenCalledWith(
      "stigmer/evals/eval-run",
      expect.objectContaining({ workflowId: "eval-run/evr_1", args: [{ evalId: "evr_1" }] }),
    );
    expect(await port.cancel("evr_1")).toBe("requested");
    expect(getHandle).toHaveBeenCalledWith("eval-run/evr_1");
  });

  it("is the port's typed error with no engine connection", async () => {
    const port = newTemporalEvalRunWorkflows({ client: () => undefined, taskQueue: "q" });
    await expect(port.start("evr_1")).rejects.toBeInstanceOf(EvalRunEngineUnavailableError);
    await expect(port.cancel("evr_1")).rejects.toBeInstanceOf(EvalRunEngineUnavailableError);
  });
});
