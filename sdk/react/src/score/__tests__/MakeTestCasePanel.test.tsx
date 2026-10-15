/**
 * Pins "Make a test case" on a completed run in a thread: the button opens
 * and closes the panel; "Download the case folder" asks the server to
 * build the run's case and downloads the archive as `<case>.zip`, listing
 * what the case leaves out; "Add to eval" adds the case to the eval picked
 * from the organization's evals (the first by default), by id in the run's
 * organization, and says so; the panel says the eval's readers see the
 * conversation, or, with no eval in the organization, how to push one; a
 * refused request is shown as an alert. A run with no request offers no
 * test case.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { EvalSchema, type Eval } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import {
  EvalCaseArchiveSchema,
  type AddEvalCaseFromRunRequest,
  type BuildEvalCaseFromRunRequest,
} from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { RunSchema, type Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreListSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Turn } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { MessageThread } from "../../run/MessageThread";
import { samples } from "../../test/samples";

const download = vi.hoisted(() => ({
  downloadBinaryFile: vi.fn(),
  downloadTextFile: vi.fn(),
}));
vi.mock("../../internal/download.js", () => download);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ARCHIVE = new Uint8Array([80, 75, 5, 6]);

function thread(message = "look over my diff"): { turns: readonly Turn[]; runs: Run[] } {
  const runs = [
    create(RunSchema, {
      metadata: { id: "run_1", org: "org_acme" },
      spec: { message, target: { case: "sessionId", value: "ses_1" } },
      status: { phase: RunPhase.RUN_COMPLETED },
    }),
  ];
  return { turns: samples.fold(samples.turnEvents({ runId: "run_1", message, reply: "Done." })).turns, runs };
}

function anEval(id: string, slug: string): Eval {
  return create(EvalSchema, { metadata: { id, slug, org: "org_acme" } });
}

function client(options: { evals?: Eval[]; refuse?: Error } = {}) {
  const builds: BuildEvalCaseFromRunRequest[] = [];
  const adds: AddEvalCaseFromRunRequest[] = [];
  const mock = {
    score: {
      listBySession: vi.fn(async () => create(ScoreListSchema, { entries: [], nextPageToken: "" })),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    },
    identityAccount: {
      whoAmI: vi.fn(async () => ({ metadata: { id: "ida_me" }, spec: { idpId: "" } })),
    },
    eval: {
      list: vi.fn(async () => ({ entries: options.evals ?? [], nextPageToken: "" })),
      buildCaseFromRun: vi.fn(async (req: BuildEvalCaseFromRunRequest) => {
        builds.push(req);
        if (options.refuse !== undefined) throw options.refuse;
        return create(EvalCaseArchiveSchema, {
          caseName: "look-over-my-diff",
          artifact: ARCHIVE,
          digest: "d".repeat(64),
          notes: ["the tool create_ticket answered differently on a later call; the case keeps the first answer"],
        });
      }),
      addCaseFromRun: vi.fn(async (req: AddEvalCaseFromRunRequest) => {
        adds.push(req);
        if (options.refuse !== undefined) throw options.refuse;
        return anEval(req.eval?.id ?? "", req.eval?.id === "evs_2" ? "billing-evals" : "support-evals");
      }),
    },
  };
  return { mock, builds, adds };
}

function wrap(mock: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={mock as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

async function openPanel(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Make a test case" }));
}

describe("Make a test case", () => {
  it("opens and closes the panel", async () => {
    render(<MessageThread {...thread()} runScores />, { wrapper: wrap(client().mock) });
    await openPanel();
    expect(screen.getByRole("group", { name: "Make a test case" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Make a test case" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Make a test case" }));
    expect(screen.queryByRole("group", { name: "Make a test case" })).toBeNull();
  });

  it("downloads the case the server builds, named after it, and lists what it leaves out", async () => {
    const { mock, builds } = client();
    render(<MessageThread {...thread()} runScores />, { wrapper: wrap(mock) });
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Download the case folder" }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Downloaded look-over-my-diff.zip. Unzip it into an evals/ folder and fill in its rubric.",
    );
    expect(builds.map((req) => req.runId)).toEqual(["run_1"]);
    expect(download.downloadBinaryFile).toHaveBeenCalledWith(ARCHIVE, "look-over-my-diff.zip", "application/zip");
    expect(screen.getByRole("list", { name: "What the case leaves out" }).textContent).toContain(
      "answered differently on a later call",
    );
  });

  it("adds the case to the eval picked, the first by default, by id in the run's organization", async () => {
    const { mock, adds } = client({ evals: [anEval("evs_1", "support-evals"), anEval("evs_2", "billing-evals")] });
    render(<MessageThread {...thread()} runScores />, { wrapper: wrap(mock) });
    await openPanel();
    expect(await screen.findByText("Everyone who can read the eval will see this conversation.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Add to eval" }));
    expect(await screen.findByText("Added to support-evals as a new version.")).toBeDefined();
    fireEvent.change(screen.getByRole("combobox", { name: "Eval" }), { target: { value: "evs_2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to eval" }));
    expect(await screen.findByText("Added to billing-evals as a new version.")).toBeDefined();
    expect(adds.map((req) => [req.runId, req.eval?.kind, req.eval?.org, req.eval?.id])).toEqual([
      ["run_1", ApiResourceKind.eval, "org_acme", "evs_1"],
      ["run_1", ApiResourceKind.eval, "org_acme", "evs_2"],
    ]);
  });

  it("says how to push an eval when the organization has none, and shows a refusal as an alert", async () => {
    const { mock } = client({ refuse: new Error("[failed_precondition] the run has not ended") });
    render(<MessageThread {...thread()} runScores />, { wrapper: wrap(mock) });
    await openPanel();
    expect(await screen.findByText(/No evals in this organization yet/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add to eval" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download the case folder" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "[failed_precondition] the run has not ended");
    expect(download.downloadBinaryFile).not.toHaveBeenCalled();
  });

  it("shows a refusal that is not an Error by its text", async () => {
    const { mock } = client();
    mock.eval.buildCaseFromRun.mockImplementationOnce(() => Promise.reject("offline"));
    render(<MessageThread {...thread()} runScores />, { wrapper: wrap(mock) });
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Download the case folder" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("offline"));
  });

  it("offers no test case for a run with no request", async () => {
    render(<MessageThread {...thread("")} runScores />, { wrapper: wrap(client().mock) });
    await screen.findByRole("button", { name: "Good answer" });
    expect(screen.queryByRole("button", { name: "Make a test case" })).toBeNull();
  });
});
