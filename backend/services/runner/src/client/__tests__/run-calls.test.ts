import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the run-scoped calls the client composes for the control plane: the
 * run's status write, which names the run by `run_id`, the wire field
 * the run rename settled on; and the runner's File door (the mount and a
 * turn's outputs), which names the run the same way and authenticates with
 * the scoped token it is handed. The transport and the generated clients are
 * replaced at their module seams, so the request the method builds is
 * observed without a server.
 */

const runUpdateStatus = vi.fn();
const fileMount = vi.fn();
const createOutputUploads = vi.fn();
const registerOutputs = vi.fn();
const claimInput = vi.fn();

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
        case "ai.stigmer.agentic.file.v1.RunFileController":
          return { mount: fileMount, createOutputUploads, registerOutputs };
        case "ai.stigmer.agentic.session.v1.SessionCommandController":
          return { claimInput };
        default:
          return {};
      }
    },
  };
});

import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { StigmerClient } from "../stigmer-client.js";

function newClient(): StigmerClient {
  return new StigmerClient({ endpoint: "localhost:7234", token: null });
}

beforeEach(() => {
  runUpdateStatus.mockReset();
  fileMount.mockReset();
  createOutputUploads.mockReset();
  registerOutputs.mockReset();
  claimInput.mockReset();
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

describe("StigmerClient.mountRunFiles", () => {
  it("names the run, authenticates with the scoped token and answers the mount's entries", async () => {
    const entries = [{ fileId: "file_1", mountPath: "a.txt" }];
    fileMount.mockResolvedValue({ entries });

    const answered = await newClient().mountRunFiles("aex_1", "scoped-tok");

    const [input, options] = fileMount.mock.calls[0]! as [{ runId: string }, { headers: Record<string, string> }];
    expect(input.runId).toBe("aex_1");
    expect(options.headers.authorization).toBe("Bearer scoped-tok");
    expect(answered).toBe(entries);
  });

  it("leaves the credential to the interceptor when no scoped token is handed", async () => {
    fileMount.mockResolvedValue({ entries: [] });
    await newClient().mountRunFiles("aex_1");
    expect(fileMount.mock.calls[0]![1]).toBeUndefined();
  });
});

describe("StigmerClient.claimSessionInput", () => {
  it("names the run, authenticates with the scoped token and answers the messages taken", async () => {
    const events = [{ runId: "aex_1" }];
    claimInput.mockResolvedValue({ events });

    const answered = await newClient().claimSessionInput("aex_1", "scoped-tok");

    const [input, options] = claimInput.mock.calls[0]! as [{ runId: string }, { headers: Record<string, string> }];
    expect(input.runId).toBe("aex_1");
    expect(options.headers.authorization).toBe("Bearer scoped-tok");
    expect(answered).toBe(events);
  });

  it("leaves the credential to the interceptor when no scoped token is handed", async () => {
    claimInput.mockResolvedValue({ events: [] });
    await newClient().claimSessionInput("aex_1");
    expect(claimInput.mock.calls[0]![1]).toBeUndefined();
  });
});

describe("StigmerClient's output calls", () => {
  it("names the run and each output, and authenticates with the scoped token", async () => {
    const uploads = [{ outputPath: "reports/a.md", uploadRef: "fup_1", url: "http://x", ttlSeconds: 60 }];
    createOutputUploads.mockResolvedValue({ entries: uploads });
    const files = [{ metadata: { id: "file_1" } }];
    registerOutputs.mockResolvedValue({ files });
    const client = newClient();

    expect(await client.createOutputUploads("aex_1", [{ outputPath: "reports/a.md", sizeBytes: 12 }], "scoped-tok")).toBe(uploads);
    const [minted, mintOptions] = createOutputUploads.mock.calls[0]! as [
      { runId: string; entries: Array<{ outputPath: string; sizeBytes: bigint }> },
      { headers: Record<string, string> },
    ];
    expect(minted.runId).toBe("aex_1");
    expect(minted.entries.map((entry) => [entry.outputPath, entry.sizeBytes])).toEqual([["reports/a.md", 12n]]);
    expect(mintOptions.headers.authorization).toBe("Bearer scoped-tok");

    const entry = { outputPath: "reports/a.md", uploadRef: "fup_1", contentSha256: "a".repeat(64) };
    expect(await client.registerOutputs("aex_1", [entry], "scoped-tok")).toBe(files);
    const [registered, registerOptions] = registerOutputs.mock.calls[0]! as [
      { runId: string; entries: Array<typeof entry> },
      { headers: Record<string, string> },
    ];
    expect(registered.runId).toBe("aex_1");
    expect(registered.entries.map((e) => ({ outputPath: e.outputPath, uploadRef: e.uploadRef, contentSha256: e.contentSha256 }))).toEqual([entry]);
    expect(registerOptions.headers.authorization).toBe("Bearer scoped-tok");
  });
});
