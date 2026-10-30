/**
 * Pins one eval run's results view on its own: nothing at all for an empty
 * id; a column group per target, named, when it ran on several; a case not
 * run on one target shows the reason there, and a dash where the case has
 * no result; the cases not run listed with their reasons; a case's notes
 * and MCP servers when it is opened; the reason a partial eval run
 * stopped, in words (a reason this client does not know as "stopped
 * early"); the heading, the plugin and when the eval run started; a
 * refused cancel kept as an alert; a failed read again keeping the last
 * results with a stale notice; and each try a link only where the viewer
 * can open it (every viewer in Stigmer Cloud, only the eval run's creator
 * elsewhere). The tab around it is pinned in EvalRunsTab.plugin.test.tsx
 * and EvalRunsTab.agent.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import {
  EvalRunMockedServerSchema,
  EvalRunPartialReason,
  EvalRunPhase,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { StigmerContext } from "@stigmer/react-core";
import { DeploymentModeContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { EvalRunResults } from "../EvalRunResults";
import { GPT, SONNET, evalStartOf, evalWith } from "./eval-fixture";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function client(
  evalRun: EvalRun,
  cancel: () => Promise<EvalRun> = async () => evalRun,
) {
  return {
    evalrun: {
      get: vi.fn(async () => evalRun),
      cancel: vi.fn(cancel),
    },
  };
}

function wrap(mock: unknown, mode: "cloud" | "local" = "cloud") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <DeploymentModeContext.Provider value={mode}>
          <StigmerContext.Provider value={mock as never}>
            {children}
          </StigmerContext.Provider>
        </DeploymentModeContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

/** The eval's tries, opened: each try's name, and whether it is a link. */
async function triesOf(): Promise<{ readonly links: string[]; readonly texts: string[] }> {
  fireEvent.click(await screen.findByRole("button", { name: "a" }));
  const list = screen.getByRole("list", { name: "Tries on stigmer/claude-sonnet-4-6" });
  return {
    links: within(list)
      .queryAllByRole("button")
      .map((button) => button.textContent ?? ""),
    texts: within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? ""),
  };
}

describe("EvalRunResults", () => {
  it("renders nothing and asks nothing for an empty id", () => {
    const mock = client(evalWith([]));
    const { container } = render(<EvalRunResults evalRunId="" />, {
      wrapper: wrap(mock),
    });
    expect(container.innerHTML).toBe("");
    expect(mock.evalrun.get).not.toHaveBeenCalled();
  });

  it("heads the results with the plugin and when the eval run started, never its name", async () => {
    render(<EvalRunResults evalRunId="evr_1" subjectSlug="thermos" />, {
      wrapper: wrap(client(evalWith([{ name: "a", score: 1 }]))),
    });
    expect(
      await screen.findByText(
        `thermos · started ${evalStartOf("evr_1").toLocaleString()}`,
      ),
    ).toBeDefined();
  });

  it("names each target over its column group when the eval ran on several", async () => {
    const evalRun = evalWith([{ name: "a", score: 1 }], [SONNET, GPT]);
    render(<EvalRunResults evalRunId="evr_1" />, {
      wrapper: wrap(client(evalRun)),
    });
    const table = await screen.findByRole("table");
    for (const label of ["stigmer/claude-sonnet-4-6", "stigmer/gpt-5"]) {
      const header = within(table).getByRole("columnheader", { name: label });
      expect(header.getAttribute("colspan")).toBe("4");
    }
  });

  it("shows a case not run on a target with the reason there, and a dash where it has no result", async () => {
    const evalRun = evalWith(
      [
        { name: "skipped-on-gpt", score: 1 },
        { name: "sonnet-only", score: 1 },
      ],
      [SONNET, GPT],
    );
    const [skipped, sonnetOnly] = evalRun.status!.plugins[0]!.cases;
    skipped!.targets[1]!.notRunReason = "not run: needs an OpenAI key";
    sonnetOnly!.targets.pop();
    render(<EvalRunResults evalRunId="evr_1" />, {
      wrapper: wrap(client(evalRun)),
    });
    const table = await screen.findByRole("table");
    const skippedRow = within(table).getByRole("row", {
      name: /skipped-on-gpt/,
    });
    expect(
      within(skippedRow).getByText("not run: needs an OpenAI key"),
    ).toBeDefined();
    const sonnetRow = within(table).getByRole("row", { name: /sonnet-only/ });
    const cells = within(sonnetRow).getAllByRole("cell");
    expect(cells.at(-1)?.textContent).toBe("—");
    expect(cells.at(-1)?.getAttribute("colspan")).toBe("4");
  });

  it("lists the cases not run with their reasons", async () => {
    const evalRun = evalWith([{ name: "ran", score: 1 }]);
    evalRun.status!.plugins[0]!.cases.push({
      ...evalRun.status!.plugins[0]!.cases[0]!,
      caseName: "fixture",
      notRunReason: "not run: plugins",
    });
    render(<EvalRunResults evalRunId="evr_1" />, {
      wrapper: wrap(client(evalRun)),
    });
    const list = await screen.findByRole("list", { name: "Cases not run" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["fixture: not run: plugins"]);
  });

  it("shows a case's notes when it is opened", async () => {
    const evalRun = evalWith([{ name: "a", score: 1 }]);
    evalRun.status!.plugins[0]!.cases[0]!.notes = [
      "graded on the files the run wrote",
      "the without arm ran no tools",
    ];
    render(<EvalRunResults evalRunId="evr_1" />, {
      wrapper: wrap(client(evalRun)),
    });
    expect(screen.queryByRole("list", { name: "Notes on a" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "a" }));
    const notes = screen.getByRole("list", { name: "Notes on a" });
    expect(
      within(notes)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "graded on the files the run wrote",
      "the without arm ran no tools",
    ]);
  });

  it("shows a case's MCP servers, as its tries saw them, when it is opened", async () => {
    const evalRun = evalWith([{ name: "a", score: 1 }]);
    evalRun.status!.plugins[0]!.cases[0]!.mockedServers = [
      create(EvalRunMockedServerSchema, {
        name: "plugin_kit_tracker",
        tools: ["create_issue"],
      }),
      create(EvalRunMockedServerSchema, {
        name: "plugin_kit_wiki",
        notStartedReason: "not started: no mock",
      }),
    ];
    render(<EvalRunResults evalRunId="evr_1" />, {
      wrapper: wrap(client(evalRun)),
    });
    fireEvent.click(await screen.findByRole("button", { name: "a" }));
    const servers = screen.getByRole("list", { name: "MCP servers of a" });
    expect(
      within(servers)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "plugin_kit_tracker mocked: create_issue",
      "plugin_kit_wiki not started: no mock",
    ]);
  });

  it.each([
    [EvalRunPartialReason.cost_ceiling, "Partial (cost limit reached) ·"],
    [EvalRunPartialReason.cancelled, "Partial (cancelled) ·"],
    [EvalRunPartialReason.unspecified, "Partial ·"],
    [99 as EvalRunPartialReason, "Partial (stopped early) ·"],
  ])("names why a partial eval stopped (reason %s)", async (reason, start) => {
    const evalRun = evalWith([{ name: "a", score: 1 }]);
    evalRun.status!.phase = EvalRunPhase.partial;
    evalRun.status!.partialReason = reason;
    render(<EvalRunResults evalRunId="evr_1" />, {
      wrapper: wrap(client(evalRun)),
    });
    const status = await screen.findByRole("status");
    expect(status.textContent?.startsWith(start), status.textContent ?? "").toBe(
      true,
    );
  });

  it("links each try to its run in Stigmer Cloud, where every viewer of the plugin opens it, without asking who the viewer is", async () => {
    const mock = { ...client(evalWith([{ name: "a", score: 1 }])), identityAccount: { whoAmI: vi.fn() } };
    const onNavigateToRun = vi.fn();
    render(<EvalRunResults evalRunId="evr_1" onNavigateToRun={onNavigateToRun} />, { wrapper: wrap(mock) });
    const tries = await triesOf();
    expect(tries.links).toEqual(["with #1: 1.00", "without #1: running"]);
    fireEvent.click(screen.getByRole("button", { name: "with #1: 1.00" }));
    expect(onNavigateToRun).toHaveBeenCalledWith("run_a_1");
    expect(mock.identityAccount.whoAmI).not.toHaveBeenCalled();
  });

  it.each([
    ["the eval's creator", "ida_me", ["with #1: 1.00", "without #1: running"]],
    ["another viewer", "ida_other", []],
  ])("links the tries elsewhere only for the eval's creator: %s", async (_who, viewer, links) => {
    const evalRun = evalWith([{ name: "a", score: 1 }]);
    evalRun.status!.audit!.specAudit!.createdBy = { id: "ida_me" } as never;
    const mock = { ...client(evalRun), identityAccount: { whoAmI: vi.fn(async () => ({ metadata: { id: viewer } })) } };
    render(<EvalRunResults evalRunId="evr_1" onNavigateToRun={vi.fn()} />, { wrapper: wrap(mock, "local") });
    await screen.findByRole("button", { name: "a" });
    await vi.waitFor(() => expect(mock.identityAccount.whoAmI).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const tries = await triesOf();
    expect(tries.links).toEqual(links);
    expect(tries.texts).toContain("with #1: 1.00");
  });

  it("keeps the last results when a read again fails, with a small stale notice", async () => {
    const running = evalWith([{ name: "a", score: 1 }]);
    running.status!.phase = EvalRunPhase.running;
    const mock = client(running);
    render(<EvalRunResults evalRunId="evr_1" canEdit />, { wrapper: wrap(mock) });
    await screen.findByRole("button", { name: "a" });
    mock.evalrun.get.mockRejectedValueOnce(new Error("the server is unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByText("Could not refresh the eval run (the server is unavailable); these are the last results read."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "a" })).toBeDefined();
  });

  it("keeps a refused cancel as an alert", async () => {
    const running = evalWith([{ name: "a" }]);
    running.status!.phase = EvalRunPhase.running;
    const mock = client(running, async () => {
      throw new Error("only the plugin's editors may cancel its evals");
    });
    render(<EvalRunResults evalRunId="evr_1" canEdit />, {
      wrapper: wrap(mock),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "only the plugin's editors may cancel its evals",
    );
    expect(mock.evalrun.cancel).toHaveBeenCalledWith("evr_1");
  });
});
