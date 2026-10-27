import { describe, it, expect, vi } from "vitest";

/**
 * Pins the client's Eval reads, what a try reads an Eval's case from:
 * `getRunEvalCaseArchiveDownloadUrl` on the run's own door
 * (RunEvalCaseController.getArchiveDownloadUrl), naming only the run and
 * presenting the scoped credential it is given; and, for a server that
 * predates the door, `getEvalDownloadUrl` and `downloadEval` on
 * EvalQueryController's `getDownloadUrl` and `download`, each with the
 * reference as given (the Eval's id and its digest as the version, so the
 * server asks can_view of the run's caller at that version). Each answer
 * comes back unchanged. The transport and the generated clients are
 * replaced at their module seams.
 */

const getDownloadUrl = vi.fn();
const download = vi.fn();
const getArchiveDownloadUrl = vi.fn();

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: () => ({}),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect")>();
  return {
    ...actual,
    createClient: (service: { typeName: string }) =>
      service.typeName === "ai.stigmer.agentic.eval.v1.EvalQueryController"
        ? { getDownloadUrl, download }
        : service.typeName === "ai.stigmer.agentic.eval.v1.RunEvalCaseController"
          ? { getArchiveDownloadUrl }
          : {},
  };
});

import { StigmerClient } from "../stigmer-client.js";

describe("StigmerClient Eval reads", () => {
  const client = new StigmerClient({ endpoint: "localhost:7234", token: null });
  const ref = { org: "", slug: "", id: "evs_1", kind: 66, version: "a".repeat(64) };

  it("reads an Eval's version by a download URL or inline, by its reference", async () => {
    getDownloadUrl.mockResolvedValue({ url: "http://x/evals/a.zip", sizeBytes: 1n, digest: "a".repeat(64) });
    download.mockResolvedValue({ artifact: new Uint8Array([1]), digest: "a".repeat(64) });

    expect(await client.getEvalDownloadUrl(ref as never)).toEqual({ url: "http://x/evals/a.zip", sizeBytes: 1n, digest: "a".repeat(64) });
    expect(getDownloadUrl).toHaveBeenCalledWith(ref);
    expect(await client.downloadEval(ref as never)).toEqual({ artifact: new Uint8Array([1]), digest: "a".repeat(64) });
    expect(download).toHaveBeenCalledWith(ref);
  });

  it("asks the run's door by the run alone, under the scoped credential it is given", async () => {
    const link = { url: "http://x/evals/a.zip", sizeBytes: 1n, digest: "a".repeat(64) };
    getArchiveDownloadUrl.mockResolvedValue(link);

    expect(await client.getRunEvalCaseArchiveDownloadUrl("run_1", "scoped")).toEqual(link);
    expect(getArchiveDownloadUrl).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_1" }), {
      headers: { authorization: "Bearer scoped" },
    });
  });
});
