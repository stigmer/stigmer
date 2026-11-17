/**
 * Test stub for the connected execution engine: every operation resolves
 * as a no-op unless overridden (and every workflow reads as open, so no
 * run is ended as one whose workflow is gone), so a test asserts exactly the seam calls
 * it cares about (temporal/agentexecution/engine-client.ts is the real
 * implementation).
 */
import type { ConnectedExecutionEngine } from "../engine.js";

export function stubConnectedEngine(
  overrides: Partial<ConnectedExecutionEngine> = {},
): ConnectedExecutionEngine {
  return {
    signalApprovalGateResolved: async () => {},
    startInvokeWorkflow: async () => {},
    signalPause: async () => {},
    signalResume: async () => {},
    cancelWorkflow: async () => {},
    terminateWorkflow: async () => {},
    workflowLiveness: async () => "open",
    ...overrides,
  };
}
