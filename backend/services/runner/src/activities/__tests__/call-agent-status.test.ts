import { describe, it, expect, beforeEach, vi } from "vitest";
import { FileChangeSetStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Unit tests for the call-agent-status activities that surface a child agent's
 * HITL state on the parent workflow. They verify the runner sends the correct
 * per-child SCOPED writes; the actual per-child merge (never clobbering a
 * sibling) is enforced and tested in the Go + Java backend handlers.
 */

interface CapturedUpdate {
  executionId: string;
  status: any;
  options: any;
}

let capturedUpdates: CapturedUpdate[];
let mockGetExecutionResult: any;

vi.mock("../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({
    updateWorkflowExecutionStatus: (executionId: string, status: any, options: any) => {
      capturedUpdates.push({ executionId, status, options });
      return Promise.resolve({});
    },
    getExecution: (_id: string) => Promise.resolve(mockGetExecutionResult),
  })),
}));

vi.mock("../../config.js", () => ({
  loadConfig: () => ({ stigmerBackendEndpoint: "http://localhost:7234", stigmerToken: "t" }),
}));

import {
  updateWorkflowFileReviewStatus,
  getAwaitingFileReviewChangeSetIds,
  updateWorkflowTaskApprovalStatus,
  clearWorkflowApprovalStatus,
} from "../call-agent-status.js";

describe("call-agent-status file-review activities", () => {
  beforeEach(() => {
    capturedUpdates = [];
    mockGetExecutionResult = undefined;
  });

  describe("updateWorkflowFileReviewStatus", () => {
    it("writes a single per-child reference scoped to the child", async () => {
      await updateWorkflowFileReviewStatus("wfx_1", "aex_child", ["fcs_1", "fcs_2"]);

      expect(capturedUpdates).toHaveLength(1);
      const { executionId, status, options } = capturedUpdates[0];
      expect(executionId).toBe("wfx_1");
      expect(options.updatePendingFileReviews).toBe(true);
      expect(options.pendingUpdateChildAgentExecutionId).toBe("aex_child");
      expect(status.pendingFileReviews).toHaveLength(1);
      expect(status.pendingFileReviews[0].childAgentExecutionId).toBe("aex_child");
      expect(status.pendingFileReviews[0].changeSetId).toEqual(["fcs_1", "fcs_2"]);
    });

    it("empty changeSetIds writes an empty list (scoped clear for the child)", async () => {
      await updateWorkflowFileReviewStatus("wfx_1", "aex_child", []);

      expect(capturedUpdates).toHaveLength(1);
      const { status, options } = capturedUpdates[0];
      expect(options.updatePendingFileReviews).toBe(true);
      expect(options.pendingUpdateChildAgentExecutionId).toBe("aex_child");
      expect(status.pendingFileReviews).toHaveLength(0);
    });

    it("is a no-op when executionId or childExecutionId is missing", async () => {
      await updateWorkflowFileReviewStatus("", "aex_child", ["fcs_1"]);
      await updateWorkflowFileReviewStatus("wfx_1", "", ["fcs_1"]);
      expect(capturedUpdates).toHaveLength(0);
    });
  });

  describe("getAwaitingFileReviewChangeSetIds", () => {
    it("returns only the ids of change sets that are AWAITING_REVIEW", async () => {
      mockGetExecutionResult = {
        status: {
          fileChangeSets: [
            { id: "fcs_await1", status: FileChangeSetStatus.AWAITING_REVIEW },
            { id: "fcs_capturing", status: FileChangeSetStatus.CAPTURING },
            { id: "fcs_decided", status: FileChangeSetStatus.DECIDED },
            { id: "fcs_await2", status: FileChangeSetStatus.AWAITING_REVIEW },
          ],
        },
      };

      const ids = await getAwaitingFileReviewChangeSetIds("aex_child");
      expect(ids).toEqual(["fcs_await1", "fcs_await2"]);
    });

    it("returns empty when the child has no file change sets", async () => {
      mockGetExecutionResult = { status: {} };
      expect(await getAwaitingFileReviewChangeSetIds("aex_child")).toEqual([]);
    });

    it("returns empty (non-fatal) on a missing child id", async () => {
      expect(await getAwaitingFileReviewChangeSetIds("")).toEqual([]);
      expect(capturedUpdates).toHaveLength(0);
    });
  });

  describe("approval activities are scoped per-child (unify)", () => {
    it("updateWorkflowTaskApprovalStatus scopes the write to the notifying child", async () => {
      await updateWorkflowTaskApprovalStatus("wfx_1", "task_a", {
        executionId: "aex_child",
        pendingApprovals: [{ toolCallId: "tc_1", toolName: "deploy" } as any],
      } as any);

      expect(capturedUpdates).toHaveLength(1);
      const { status, options } = capturedUpdates[0];
      expect(options.updatePendingApprovals).toBe(true);
      expect(options.pendingUpdateChildAgentExecutionId).toBe("aex_child");
      expect(status.pendingApprovals[0].childAgentExecutionId).toBe("aex_child");
    });

    it("clearWorkflowApprovalStatus scopes the clear to the given child", async () => {
      await clearWorkflowApprovalStatus("wfx_1", "aex_child");

      expect(capturedUpdates).toHaveLength(1);
      const { status, options } = capturedUpdates[0];
      expect(options.updatePendingApprovals).toBe(true);
      expect(options.pendingUpdateChildAgentExecutionId).toBe("aex_child");
      expect(status.pendingApprovals).toHaveLength(0);
    });

    it("clearWorkflowApprovalStatus is a no-op without a child id", async () => {
      await clearWorkflowApprovalStatus("wfx_1", "");
      expect(capturedUpdates).toHaveLength(0);
    });
  });
});
