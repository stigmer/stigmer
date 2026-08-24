/**
 * Test stub for the connected execution engine: every operation resolves
 * as a no-op unless overridden, so a test asserts exactly the seam calls
 * it cares about (#18 provides the real implementation).
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
    ...overrides,
  };
}
