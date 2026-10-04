import { describe, it, expect, vi } from "vitest";

/**
 * Pins the client's read of the agent version a turn recorded:
 * `getAgentVersion(agentId, versionHash)` is AgentQueryController.getVersion
 * with the two values as given, its entry answered unchanged. The transport
 * and the generated clients are replaced at their module seams, so the call
 * the client composes is observed without a server.
 */

const getVersion = vi.fn();

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: () => ({}),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect")>();
  return {
    ...actual,
    createClient: (service: { typeName: string }) =>
      service.typeName === "ai.stigmer.agentic.agent.v1.AgentQueryController" ? { getVersion } : {},
  };
});

import { StigmerClient } from "../stigmer-client.js";

describe("StigmerClient.getAgentVersion", () => {
  it("asks getVersion for the agent and hash as given and answers its entry", async () => {
    const entry = { versionHash: "f".repeat(64), specSnapshot: { instructions: "Recorded." } };
    getVersion.mockResolvedValue(entry);
    const client = new StigmerClient({ endpoint: "localhost:7234", token: null });

    const answered = await client.getAgentVersion("agt_1", "f".repeat(64));

    expect(getVersion).toHaveBeenCalledWith({ agentId: "agt_1", versionHash: "f".repeat(64) });
    expect(answered).toBe(entry);
  });
});
