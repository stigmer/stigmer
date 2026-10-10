/**
 * Pins the eval's workflow port (workflows.ts): a start names the suite
 * workflow's type, its deterministic id, the queue and the `{ evalId }`
 * input, and counts an already-started workflow as success; a cancel asks
 * the workflow under the eval's id and answers "not-found" when none runs;
 * no engine connection is the port's typed error on both; any other
 * failure, the connection's deadline included, is thrown as it came.
 */
import type { Client } from "@temporalio/client";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";

import {
  RUN_PLUGIN_EVAL_WORKFLOW_TYPE,
  runPluginEvalWorkflowId,
} from "../../../temporal/evals/names.js";
import {
  PluginEvalEngineUnavailableError,
  newTemporalPluginEvalWorkflows,
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
    const port = newTemporalPluginEvalWorkflows({ client: () => client, taskQueue: "grading_stigmer" });
    await port.start("pev_1");
    expect(start).toHaveBeenCalledWith(RUN_PLUGIN_EVAL_WORKFLOW_TYPE, expect.objectContaining({
      workflowId: runPluginEvalWorkflowId("pev_1"),
      taskQueue: "grading_stigmer",
      workflowIdReusePolicy: "REJECT_DUPLICATE",
      args: [{ evalId: "pev_1" }],
    }));

    const again = engine({
      start: () =>
        Promise.reject(
          new WorkflowExecutionAlreadyStartedError("already", runPluginEvalWorkflowId("pev_1"), RUN_PLUGIN_EVAL_WORKFLOW_TYPE),
        ),
    });
    await expect(
      newTemporalPluginEvalWorkflows({ client: () => again.client, taskQueue: "q" }).start("pev_1"),
    ).resolves.toBeUndefined();
  });

  it("throws a refused or late start as it came", async () => {
    const refused = engine({ start: () => Promise.reject(new Error("namespace not found")) });
    await expect(
      newTemporalPluginEvalWorkflows({ client: () => refused.client, taskQueue: "q" }).start("pev_1"),
    ).rejects.toThrow("namespace not found");
    const late = engine({ start: () => new Promise(() => undefined) });
    await expect(
      newTemporalPluginEvalWorkflows({ client: () => late.client, taskQueue: "q", deadlineMs: 5 }).start("pev_1"),
    ).rejects.toThrow("DEADLINE_EXCEEDED");
  });

  it("cancels the workflow under the eval's id, and answers not-found when none runs", async () => {
    const { client, getHandle, cancel } = engine({});
    const port = newTemporalPluginEvalWorkflows({ client: () => client, taskQueue: "q" });
    expect(await port.cancel("pev_1")).toBe("requested");
    expect(getHandle).toHaveBeenCalledWith(runPluginEvalWorkflowId("pev_1"));
    expect(cancel).toHaveBeenCalledOnce();

    const gone = engine({
      cancel: () => Promise.reject(new WorkflowNotFoundError("gone", runPluginEvalWorkflowId("pev_1"), undefined)),
    });
    expect(
      await newTemporalPluginEvalWorkflows({ client: () => gone.client, taskQueue: "q" }).cancel("pev_1"),
    ).toBe("not-found");
    const broken = engine({ cancel: () => Promise.reject(new Error("transport closed")) });
    await expect(
      newTemporalPluginEvalWorkflows({ client: () => broken.client, taskQueue: "q" }).cancel("pev_1"),
    ).rejects.toThrow("transport closed");
  });

  it("is the port's typed error with no engine connection", async () => {
    const port = newTemporalPluginEvalWorkflows({ client: () => undefined, taskQueue: "q" });
    await expect(port.start("pev_1")).rejects.toBeInstanceOf(PluginEvalEngineUnavailableError);
    await expect(port.cancel("pev_1")).rejects.toBeInstanceOf(PluginEvalEngineUnavailableError);
  });
});
