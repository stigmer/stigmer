/**
 * Pins resolveWorkflowTaskQueue against Go's dispatch_test.go: the two
 * routing modes, the wfexec:{id} format, and the UNSPECIFIED-target
 * resolution through the config's single rule.
 */
import { describe, expect, it } from "vitest";

import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  WORKFLOW_DEFAULT_EXECUTION_TARGET_CLOUD,
  WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL,
  WORKFLOW_ROUTING_EXECUTION,
  WORKFLOW_ROUTING_GLOBAL,
  WorkflowExecutionTemporalConfig,
} from "../../../domain/workflowexecution/temporal/config.js";
import { resolveWorkflowTaskQueue } from "../dispatch.js";
import { formatWfExecTaskQueue } from "../names.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function config(
  routing: string,
  defaultTarget = WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL,
): WorkflowExecutionTemporalConfig {
  return new WorkflowExecutionTemporalConfig(
    "workflow_execution_stigmer",
    "stigmer_runner",
    routing,
    defaultTarget,
  );
}

describe("resolveWorkflowTaskQueue", () => {
  it("routes to the global runner queue in global mode", () => {
    const result = resolveWorkflowTaskQueue(
      "wfe-1",
      ExecutionTarget.LOCAL,
      config(WORKFLOW_ROUTING_GLOBAL),
      silentLogger,
    );
    expect(result.taskQueue).toBe("stigmer_runner");
    expect(result.executionTarget).toBe(ExecutionTarget.LOCAL);
  });

  it("derives wfexec:{id} in execution mode regardless of target", () => {
    for (const target of [
      ExecutionTarget.LOCAL,
      ExecutionTarget.CLOUD,
      ExecutionTarget.UNSPECIFIED,
    ]) {
      const result = resolveWorkflowTaskQueue(
        "wfe-42",
        target,
        config(WORKFLOW_ROUTING_EXECUTION),
        silentLogger,
      );
      expect(result.taskQueue).toBe("wfexec:wfe-42");
    }
  });

  it("resolves UNSPECIFIED to the configured default target", () => {
    const local = resolveWorkflowTaskQueue(
      "wfe-1",
      ExecutionTarget.UNSPECIFIED,
      config(WORKFLOW_ROUTING_GLOBAL, WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL),
      silentLogger,
    );
    expect(local.executionTarget).toBe(ExecutionTarget.LOCAL);

    const cloud = resolveWorkflowTaskQueue(
      "wfe-1",
      ExecutionTarget.UNSPECIFIED,
      config(WORKFLOW_ROUTING_GLOBAL, WORKFLOW_DEFAULT_EXECUTION_TARGET_CLOUD),
      silentLogger,
    );
    expect(cloud.executionTarget).toBe(ExecutionTarget.CLOUD);
  });

  it("passes explicit targets through unchanged", () => {
    const result = resolveWorkflowTaskQueue(
      "wfe-1",
      ExecutionTarget.CLOUD,
      config(WORKFLOW_ROUTING_GLOBAL, WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL),
      silentLogger,
    );
    expect(result.executionTarget).toBe(ExecutionTarget.CLOUD);
  });

  it("formatWfExecTaskQueue matches Go's format", () => {
    expect(formatWfExecTaskQueue("abc")).toBe("wfexec:abc");
  });
});
