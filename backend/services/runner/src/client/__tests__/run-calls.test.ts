import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the run-scoped calls the client composes for the control plane: the
 * agent run's status write and create, the workflow run's status write with
 * its pending-merge flags, and the event-log high-water mark that follows the
 * log's cursor across pages. Each request names the run by `run_id`, the
 * wire field the run-model rename settled on. The transport and the generated
 * clients are replaced at their module seams, so the request each method
 * builds is observed without a server.
 */

const agentRunUpdateStatus = vi.fn();
const agentRunCreate = vi.fn();
const workflowRunUpdateStatus = vi.fn();
const workflowRunGetEventLog = vi.fn();

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: () => ({}),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect")>();
  return {
    ...actual,
    createClient: (service: { typeName: string }) => {
      switch (service.typeName) {
        case "ai.stigmer.agentic.agentrun.v1.AgentRunCommandController":
          return { updateStatus: agentRunUpdateStatus, create: agentRunCreate };
        case "ai.stigmer.agentic.workflowrun.v1.WorkflowRunCommandController":
          return { updateStatus: workflowRunUpdateStatus };
        case "ai.stigmer.agentic.workflowrun.v1.WorkflowRunQueryController":
          return { getEventLog: workflowRunGetEventLog };
        default:
          return {};
      }
    },
  };
});

import { create } from "@bufbuild/protobuf";
import {
  AgentRunSchema,
  AgentRunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { WorkflowRunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { RunPhase as WorkflowRunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";

import { StigmerClient } from "../stigmer-client.js";
import { ServerContractError } from "../server-contracts.js";

function newClient(): StigmerClient {
  return new StigmerClient({ endpoint: "localhost:7234", token: null });
}

beforeEach(() => {
  agentRunUpdateStatus.mockReset();
  agentRunCreate.mockReset();
  workflowRunUpdateStatus.mockReset();
  workflowRunGetEventLog.mockReset();
});

describe("StigmerClient.updateStatus", () => {
  it("sends the agent run's status under run_id and answers the server's response", async () => {
    const response = { signal: 0 };
    agentRunUpdateStatus.mockResolvedValue(response);
    const status = create(AgentRunStatusSchema, {
      phase: RunPhase.RUN_IN_PROGRESS,
    });

    const answered = await newClient().updateStatus("aex_1", status);

    expect(agentRunUpdateStatus).toHaveBeenCalledTimes(1);
    const input = agentRunUpdateStatus.mock.calls[0]![0] as {
      runId: string;
      status: unknown;
    };
    expect(input.runId).toBe("aex_1");
    expect(input.status).toBe(status);
    expect(answered).toBe(response);
  });
});

describe("StigmerClient.createAgentExecution", () => {
  it("creates a well-formed agent run through the command controller", async () => {
    const run = create(AgentRunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentRun",
      metadata: { name: "agentrun-child-1", org: "acme" },
    });
    agentRunCreate.mockResolvedValue(run);

    const answered = await newClient().createAgentExecution(run);

    expect(agentRunCreate).toHaveBeenCalledWith(run);
    expect(answered).toBe(run);
  });

  it("refuses a run missing its kind before any call, naming the method", async () => {
    const run = create(AgentRunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: { name: "agentrun-child-1", org: "acme" },
    });

    await expect(newClient().createAgentExecution(run)).rejects.toThrow(
      ServerContractError,
    );
    await expect(newClient().createAgentExecution(run)).rejects.toThrow(
      /createAgentExecution.*kind must be "AgentRun"/,
    );
    expect(agentRunCreate).not.toHaveBeenCalled();
  });
});

describe("StigmerClient.updateWorkflowExecutionStatus", () => {
  it("defaults both pending-merge flags off and the child target empty", async () => {
    workflowRunUpdateStatus.mockResolvedValue({});
    const status = create(WorkflowRunStatusSchema, {
      phase: WorkflowRunPhase.RUN_IN_PROGRESS,
    });

    await newClient().updateWorkflowExecutionStatus("wex_1", status);

    const input = workflowRunUpdateStatus.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(input.runId).toBe("wex_1");
    expect(input.status).toBe(status);
    expect(input.updatePendingApprovals).toBe(false);
    expect(input.updatePendingFileReviews).toBe(false);
    expect(input.pendingUpdateChildAgentRunId).toBe("");
  });

  it("carries a per-child merge's flags and its child run id", async () => {
    const answered = { metadata: { id: "wex_1" } };
    workflowRunUpdateStatus.mockResolvedValue(answered);

    const result = await newClient().updateWorkflowExecutionStatus(
      "wex_1",
      create(WorkflowRunStatusSchema),
      {
        updatePendingApprovals: true,
        updatePendingFileReviews: true,
        pendingUpdateChildAgentExecutionId: "aex_child",
      },
    );

    const input = workflowRunUpdateStatus.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(input.updatePendingApprovals).toBe(true);
    expect(input.updatePendingFileReviews).toBe(true);
    expect(input.pendingUpdateChildAgentRunId).toBe("aex_child");
    expect(result).toBe(answered);
  });
});

describe("StigmerClient.getEventLogHighWaterMark", () => {
  it("answers 0 for a run with no persisted events", async () => {
    workflowRunGetEventLog.mockResolvedValue({
      latestSequence: BigInt(0),
      hasMore: false,
    });

    await expect(newClient().getEventLogHighWaterMark("wex_1")).resolves.toBe(
      BigInt(0),
    );
    const request = workflowRunGetEventLog.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(request.runId).toBe("wex_1");
    expect(request.afterSequence).toBe(BigInt(0));
    expect(request.pageSize).toBe(500);
  });

  it("follows the cursor across pages and answers the last page's latest sequence", async () => {
    workflowRunGetEventLog
      .mockResolvedValueOnce({ latestSequence: BigInt(500), hasMore: true })
      .mockResolvedValueOnce({ latestSequence: BigInt(742), hasMore: false });

    await expect(newClient().getEventLogHighWaterMark("wex_1")).resolves.toBe(
      BigInt(742),
    );
    expect(workflowRunGetEventLog).toHaveBeenCalledTimes(2);
    const second = workflowRunGetEventLog.mock.calls[1]![0] as Record<
      string,
      unknown
    >;
    expect(second.runId).toBe("wex_1");
    expect(second.afterSequence).toBe(BigInt(500));
  });
});
