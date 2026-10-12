/**
 * Pins the report at the top of the agent's Quality tab, rendered through
 * the tab itself so the grading settings below it are proven to stay:
 * a loading region while the report is read; "No graded runs in the last
 * N days" for an agent with none, the window picker asking again for 7
 * days; a refusal showing the server's message while the flagged list
 * still loads; the tiles with each rate beside its count and the judge's
 * per-rubric rates at its current rules; the version table labelled by
 * tag and "unversioned", with each version's latest finished eval linking
 * through onOpenEval and "no eval" where there is none; and the flagged
 * list naming what failed (never a reason or a comment) with links that
 * call onNavigateToRun.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentQualityReport } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { agentEvalWith } from "../../agent-eval/__tests__/agent-eval-fixture";
import { AgentQualityTab } from "../../agent/AgentQualityTab";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";
import { VERSION_HASH, emptyReport, flaggedScore, qualityReport } from "./quality-fixture";

vi.mock("../../models/ModelSelector.js", () => ({
  ModelSelector: () => <span>model picker</span>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const agent = create(AgentSchema, {
  metadata: { id: "agt_1", org: ACME_ID, slug: "triage", name: "triage" },
});

function client(
  report: () => Promise<AgentQualityReport>,
  opts: { readonly evals?: ReturnType<typeof agentEvalWith>[] } = {},
) {
  return {
    score: {
      getAgentQualityReport: vi.fn(report),
      listFlaggedByAgent: vi.fn(async () => ({
        totalCount: 2,
        items: [
          flaggedScore("s1", "run-health", "run_health_1", ["loop"]),
          flaggedScore("s2", "feedback", "run_thumbs_1", [], ""),
        ],
        nextPageToken: "",
      })),
    },
    agent: {
      listVersions: vi.fn(async () => ({
        versions: [{ versionHash: VERSION_HASH, tag: "v2", isCurrent: true }],
      })),
    },
    agenteval: {
      listByAgent: vi.fn(async () => ({ totalCount: 0, items: opts.evals ?? [] })),
    },
    evaluator: {
      getByAgent: vi.fn(async () => {
        throw new StigmerError("not-found", "no evaluator", Code.NotFound);
      }),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("AgentQualityReportView in the Quality tab", () => {
  it("shows a loading region while the report is read, and the settings below", async () => {
    render(<AgentQualityTab agent={agent} />, {
      wrapper: orgWrapper(client(() => new Promise<AgentQualityReport>(() => {}))),
    });
    expect(await screen.findByText("Loading how this agent's runs went")).toBeDefined();
    expect(
      screen.getByText("Loading how this agent's runs went").parentElement?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(await screen.findByRole("switch")).toBeDefined();
  });

  it("says plainly when no run was graded, and asks again for another window", async () => {
    const mock = client(async () => emptyReport());
    render(<AgentQualityTab agent={agent} />, { wrapper: orgWrapper(mock) });
    expect(await screen.findByText("No graded runs in the last 30 days.")).toBeDefined();
    expect(mock.score.getAgentQualityReport).toHaveBeenCalledWith(
      expect.objectContaining({ org: ACME_ID, agentId: "agt_1", days: 30 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(await screen.findByText("No graded runs in the last 7 days.")).toBeDefined();
    expect(mock.score.getAgentQualityReport).toHaveBeenCalledWith(expect.objectContaining({ days: 7 }));
    expect(screen.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a refusal's message, and still lists the flagged runs", async () => {
    render(<AgentQualityTab agent={agent} />, {
      wrapper: orgWrapper(
        client(async () => {
          throw new StigmerError(
            "failed-precondition",
            "too many grades to count at once: pick fewer days",
            Code.FailedPrecondition,
          );
        }),
      ),
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("too many grades to count at once: pick fewer days");
    expect(await screen.findByRole("list", { name: "Flagged runs" })).toBeDefined();
  });

  it("shows a permission refusal in the SDK's error pattern", async () => {
    render(<AgentQualityTab agent={agent} />, {
      wrapper: orgWrapper(
        client(async () => {
          throw new StigmerError("permission-denied", "you cannot view this organization", Code.PermissionDenied);
        }),
      ),
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Access denied");
    expect(alert.textContent).toContain("you cannot view this organization");
  });

  it("shows each rate beside its count, the judge per rubric at its current rules", async () => {
    render(<AgentQualityTab agent={agent} />, { wrapper: orgWrapper(client(async () => qualityReport())) });
    const runs = await screen.findByRole("region", { name: "Runs graded" });
    expect(within(runs).getByText("12")).toBeDefined();
    const health = screen.getByRole("region", { name: "Run health" });
    expect(within(health).getByText("83% passed")).toBeDefined();
    expect(within(health).getByText("of 12 runs checked")).toBeDefined();
    const task = screen.getByRole("region", { name: "AI judge: task" });
    expect(within(task).getByText("50% passed")).toBeDefined();
    expect(within(task).getByText("of 6 runs graded")).toBeDefined();
    const honest = screen.getByRole("region", { name: "AI judge: honest" });
    expect(within(honest).getByText("of 5 runs graded")).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Thumbs" })).getByText("3 up · 1 down")).toBeDefined();
    expect(screen.getByText(/The AI judge's rules changed in these days/)).toBeDefined();
    expect(screen.getByRole("img", { name: "AI judge, task, daily pass rate" })).toBeDefined();
    // The settings form still follows the report.
    expect(await screen.findByRole("switch")).toBeDefined();
  });

  it("tables each version with its latest finished eval, or no eval", async () => {
    const onOpenEval = vi.fn();
    const evals = [
      agentEvalWith(
        [{ slug: "p", cases: [{ name: "a", score: 1 }, { name: "b", score: 1 }, { name: "c", score: 0 }, { name: "d", score: 1 }] }],
        { id: "aev_new", version: VERSION_HASH },
      ),
      agentEvalWith([{ slug: "p", cases: [{ name: "a", score: 0 }] }], { id: "aev_old", version: VERSION_HASH }),
    ];
    render(<AgentQualityTab agent={agent} onOpenEval={onOpenEval} />, {
      wrapper: orgWrapper(client(async () => qualityReport(), { evals })),
    });
    const table = await screen.findByRole("table", { name: "By agent version" });
    const tagged = await within(table).findByRole("row", { name: /^v2 / });
    expect(within(tagged).getByText("83% of 6")).toBeDefined();
    expect(within(tagged).getByText("3 up · 1 down")).toBeDefined();
    const evalLink = await within(tagged).findByRole("button", { name: "75% of 4 cases" });
    fireEvent.click(evalLink);
    expect(onOpenEval).toHaveBeenCalledWith("aev_new");
    const unversioned = within(table).getByRole("row", { name: /^unversioned / });
    expect(within(unversioned).getByText("no eval")).toBeDefined();
    // The judge's current rules never graded the unversioned day.
    expect(within(unversioned).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("lists flagged runs by what failed, and opens one through onNavigateToRun", async () => {
    const onNavigateToRun = vi.fn();
    render(<AgentQualityTab agent={agent} onNavigateToRun={onNavigateToRun} />, {
      wrapper: orgWrapper(client(async () => qualityReport())),
    });
    const list = await screen.findByRole("list", { name: "Flagged runs" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(within(list).getByText("Run health: loop")).toBeDefined();
    expect(within(list).getByText("thumbs down")).toBeDefined();
    expect(within(list).getByText("unversioned")).toBeDefined();
    expect(list.textContent).not.toContain("private");
    fireEvent.click(within(list).getByRole("button", { name: /^Open run: Run health: loop/ }));
    expect(onNavigateToRun).toHaveBeenCalledWith("run_health_1");
  });

  it("lists flagged runs without links when the host gives no route", async () => {
    render(<AgentQualityTab agent={agent} />, { wrapper: orgWrapper(client(async () => qualityReport())) });
    const list = await screen.findByRole("list", { name: "Flagged runs" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(within(list).queryByRole("button")).toBeNull();
  });

  it("asks for an organization when none is active", async () => {
    render(<AgentQualityTab agent={agent} />, {
      wrapper: orgWrapper(client(async () => qualityReport()), []),
    });
    expect(
      await screen.findByText("Pick an organization to see how this agent's runs went in it."),
    ).toBeDefined();
  });

  it("shows the flagged list's own refusal in the SDK's error pattern", async () => {
    const mock = client(async () => qualityReport());
    mock.score.listFlaggedByAgent.mockRejectedValue(
      new StigmerError("unavailable", "the flagged list is unavailable", Code.Unavailable),
    );
    render(<AgentQualityTab agent={agent} />, { wrapper: orgWrapper(mock) });
    await waitFor(() =>
      expect(
        screen.getAllByRole("alert").some((alert) =>
          (alert.textContent ?? "").includes("the flagged list is unavailable"),
        ),
      ).toBe(true),
    );
  });
});
