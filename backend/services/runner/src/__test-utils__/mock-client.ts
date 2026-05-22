/**
 * Shared mock factory for StigmerClient used across test suites.
 *
 * StigmerClient is a class (not an interface), so mocks use
 * `as unknown as StigmerClient` — matching the established pattern
 * in grpc-retry.test.ts and connect-backfill.test.ts.
 */

import { vi } from "vitest";
import { ExecutionControlSignal } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { StigmerClient } from "../client/stigmer-client.js";

type MockMethods = {
  [K in keyof StigmerClient]?: StigmerClient[K];
};

export function mockStigmerClient(overrides: MockMethods = {}): StigmerClient {
  return {
    updateStatus: vi.fn().mockResolvedValue({
      signal: ExecutionControlSignal.UNSPECIFIED,
    }),
    getExecution: vi.fn().mockResolvedValue({}),
    getExecutionContextByExecutionId: vi.fn().mockResolvedValue({}),
    getSession: vi.fn().mockResolvedValue({}),
    updateSession: vi.fn().mockResolvedValue({}),
    updateSessionMemory: vi.fn().mockResolvedValue({}),
    getAgent: vi.fn().mockResolvedValue({}),
    getAgentInstance: vi.fn().mockResolvedValue({}),
    getMcpServer: vi.fn().mockResolvedValue({}),
    getMcpServerByReference: vi.fn().mockResolvedValue({}),
    connectMcpServer: vi.fn().mockResolvedValue({}),
    getSkill: vi.fn().mockResolvedValue({}),
    getSkillByReference: vi.fn().mockResolvedValue({}),
    getSkillArtifact: vi.fn().mockResolvedValue({}),
    recordLlmCallUsage: vi.fn().mockResolvedValue({}),
    getWorkflowExecution: vi.fn().mockResolvedValue({}),
    getWorkflow: vi.fn().mockResolvedValue({}),
    getWorkflowInstance: vi.fn().mockResolvedValue({}),
    updateWorkflowExecutionStatus: vi.fn().mockResolvedValue({}),
    getAgentByReference: vi.fn().mockResolvedValue({}),
    createSession: vi.fn().mockResolvedValue({}),
    createAgentExecution: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as StigmerClient;
}
