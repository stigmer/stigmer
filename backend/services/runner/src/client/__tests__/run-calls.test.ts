import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the run-scoped call the client composes for the control plane: the
 * run's status write, which names the run by `run_id`, the wire field
 * the run rename settled on. The transport and the generated clients are
 * replaced at their module seams, so the request the method builds is
 * observed without a server.
 */

const runUpdateStatus = vi.fn();

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: () => ({}),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect")>();
  return {
    ...actual,
    createClient: (service: { typeName: string }) => {
      switch (service.typeName) {
        case "ai.stigmer.agentic.run.v1.RunCommandController":
          return { updateStatus: runUpdateStatus };
        default:
          return {};
      }
    },
  };
});

import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { StigmerClient } from "../stigmer-client.js";

function newClient(): StigmerClient {
  return new StigmerClient({ endpoint: "localhost:7234", token: null });
}

beforeEach(() => {
  runUpdateStatus.mockReset();
});

describe("StigmerClient.updateStatus", () => {
  it("sends the run's status under run_id and answers the server's response", async () => {
    const response = { signal: 0 };
    runUpdateStatus.mockResolvedValue(response);
    const status = create(RunStatusSchema, {
      phase: RunPhase.RUN_IN_PROGRESS,
    });

    const answered = await newClient().updateStatus("aex_1", status);

    expect(runUpdateStatus).toHaveBeenCalledTimes(1);
    const input = runUpdateStatus.mock.calls[0]![0] as {
      runId: string;
      status: unknown;
    };
    expect(input.runId).toBe("aex_1");
    expect(input.status).toBe(status);
    expect(answered).toBe(response);
  });
});
