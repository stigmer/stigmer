import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  assertCreateRequirements,
  assertReferenceRequirements,
} from "../../client/server-contracts.js";

/**
 * Contract compliance tests for the CallAgent activity.
 *
 * Unlike call-agent.test.ts (which verifies behavior with mocked client),
 * these tests verify that the proto messages CONSTRUCTED by callAgentAction
 * satisfy the server's pipeline requirements. This catches the exact class
 * of bug where mocked tests pass but real gRPC calls fail because the
 * server enforces business rules not expressed in the proto schema.
 */

let capturedGetByRef: any;
let capturedCreateSession: any;
let capturedCreateExecution: any;

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      info: {
        taskToken: new Uint8Array([1, 2, 3, 4]),
      },
    }),
  },
  CompleteAsyncError: class CompleteAsyncError extends Error {
    constructor() {
      super("CompleteAsyncError");
      this.name = "CompleteAsyncError";
    }
  },
}));

vi.mock("../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({
    getAgentByReference: (ref: any) => {
      capturedGetByRef = ref;
      return Promise.resolve({
        metadata: { id: "agt_contract_test" },
        status: { defaultInstanceId: "ain_contract_test" },
      });
    },
    createSession: (session: any) => {
      capturedCreateSession = session;
      return Promise.resolve({ metadata: { id: "ses_contract_test" } });
    },
    createAgentExecution: (exec: any) => {
      capturedCreateExecution = exec;
      return Promise.resolve({ metadata: { id: "aex_contract_test" } });
    },
  })),
}));

vi.mock("../../config.js", () => ({
  loadConfig: () => ({
    stigmerBackendEndpoint: "http://localhost:7234",
    stigmerToken: "test-token",
  }),
}));

vi.mock("../../shared/heartbeat.js", () => ({
  startHeartbeat: () => ({ stop: vi.fn() }),
}));

import { callAgentAction } from "../call-agent.js";

describe("CallAgent server contract compliance", () => {
  beforeEach(() => {
    capturedGetByRef = undefined;
    capturedCreateSession = undefined;
    capturedCreateExecution = undefined;
  });

  async function exerciseCallAgent(config = {}) {
    try {
      await callAgentAction(
        { agent: "notification-analyst", message: "Analyze cohort data", ...config },
        { __stigmer_org_id: "tt-demo" },
        "wfl_parent_123",
      );
    } catch (e: any) {
      if (e.name !== "CompleteAsyncError") throw e;
    }
  }

  describe("ApiResourceReference (getAgentByReference)", () => {
    it("satisfies reference requirements for simple slug", async () => {
      await exerciseCallAgent();
      expect(() => assertReferenceRequirements(capturedGetByRef, "Agent", "test"))
        .not.toThrow();
    });

    it("sets slug from agent config", async () => {
      await exerciseCallAgent();
      expect(capturedGetByRef.slug).toBe("notification-analyst");
      expect(capturedGetByRef.org).toBe("tt-demo");
      expect(capturedGetByRef.kind).toBe(ApiResourceKind.agent);
    });

    it("satisfies reference requirements for org-prefixed slug", async () => {
      await exerciseCallAgent({ agent: "acme/code-reviewer" });
      expect(() => assertReferenceRequirements(capturedGetByRef, "Agent", "test"))
        .not.toThrow();
      expect(capturedGetByRef.org).toBe("acme");
      expect(capturedGetByRef.slug).toBe("code-reviewer");
    });
  });

  describe("Session create payload", () => {
    it("satisfies server create requirements", async () => {
      await exerciseCallAgent();
      expect(() => assertCreateRequirements(capturedCreateSession, "Session", "test"))
        .not.toThrow();
    });

    it("has metadata.name matching expected pattern", async () => {
      await exerciseCallAgent();
      expect(capturedCreateSession.metadata.name).toMatch(/^wf-notification-analyst-\d+$/);
    });

    it("has metadata.org from runtime environment", async () => {
      await exerciseCallAgent();
      expect(capturedCreateSession.metadata.org).toBe("tt-demo");
    });
  });

  describe("AgentExecution create payload", () => {
    it("satisfies server create requirements", async () => {
      await exerciseCallAgent();
      expect(() => assertCreateRequirements(capturedCreateExecution, "AgentExecution", "test"))
        .not.toThrow();
    });

    it("has metadata.name matching expected pattern", async () => {
      await exerciseCallAgent();
      expect(capturedCreateExecution.metadata.name).toMatch(/^aex-wf-notification-analyst-\d+$/);
    });

    it("has metadata.org set", async () => {
      await exerciseCallAgent();
      expect(capturedCreateExecution.metadata.org).toBe("tt-demo");
    });

    it("has required spec fields for server pipeline", async () => {
      await exerciseCallAgent();
      expect(capturedCreateExecution.spec.sessionId).toBe("ses_contract_test");
      expect(capturedCreateExecution.spec.agentId).toBe("agt_contract_test");
      expect(capturedCreateExecution.spec.message).toBe("Analyze cohort data");
      expect(capturedCreateExecution.spec.callbackToken).toBeDefined();
      expect(capturedCreateExecution.spec.parentWorkflowId).toBe("wfl_parent_123");
    });

    it("would have been rejected by server without the name fix", async () => {
      await exerciseCallAgent();
      const withoutName = {
        ...capturedCreateExecution,
        metadata: { org: capturedCreateExecution.metadata.org },
      };
      expect(() => assertCreateRequirements(withoutName, "AgentExecution", "test"))
        .toThrow(/metadata.name or metadata.slug/);
    });
  });
});
