/**
 * Pins one eval's results view on its own: nothing at all for an empty id;
 * a column group per target, named, when the eval ran on several; a case
 * not run on one target shows the reason there, and a dash where the case
 * has no result; the cases not run listed with their reasons; a case's
 * notes when it is opened; the reason a partial eval stopped, in words (a
 * reason this client does not know as "stopped early"); the heading, the
 * plugin and when the eval started; a refused cancel kept as an alert; a
 * failed read again keeping the last results with a stale notice; and each
 * try a link only where the viewer can open it (every viewer in Stigmer
 * Cloud, only the eval's creator elsewhere). The tab around it is pinned in
 * PluginEvalsTab.test.tsx.
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
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { PluginEvalResults } from "../PluginEvalResults";
import { GPT, SONNET, evalStartOf, evalWith } from "./eval-fixture";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function client(
  pluginEval: PluginEval,
  cancel: () => Promise<PluginEval> = async () => pluginEval,
) {
  return {
    plugineval: {
      get: vi.fn(async () => pluginEval),
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
  const list = screen.getByRole("list", { name: "Tries on native/claude-sonnet-4-6" });
  return {
    links: within(list)
      .queryAllByRole("button")
      .map((button) => button.textContent ?? ""),
    texts: within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? ""),
  };
}

describe("PluginEvalResults", () => {
  it("renders nothing and asks nothing for an empty id", () => {
    const mock = client(evalWith([]));
    const { container } = render(<PluginEvalResults evalId="" />, {
      wrapper: wrap(mock),
    });
    expect(container.innerHTML).toBe("");
    expect(mock.plugineval.get).not.toHaveBeenCalled();
  });

  it("heads the results with the plugin and when the eval started, never the eval's name", async () => {
    render(<PluginEvalResults evalId="pev_1" pluginName="thermos" />, {
      wrapper: wrap(client(evalWith([{ name: "a", score: 1 }]))),
    });
    expect(
      await screen.findByText(
        `thermos · started ${evalStartOf("pev_1").toLocaleString()}`,
      ),
    ).toBeDefined();
  });

  it("names each target over its column group when the eval ran on several", async () => {
    const pluginEval = evalWith([{ name: "a", score: 1 }], [SONNET, GPT]);
    render(<PluginEvalResults evalId="pev_1" />, {
      wrapper: wrap(client(pluginEval)),
    });
    const table = await screen.findByRole("table");
    for (const label of ["native/claude-sonnet-4-6", "cursor/gpt-5"]) {
      const header = within(table).getByRole("columnheader", { name: label });
      expect(header.getAttribute("colspan")).toBe("4");
    }
  });

  it("shows a case not run on a target with the reason there, and a dash where it has no result", async () => {
    const pluginEval = evalWith(
      [
        { name: "skipped-on-gpt", score: 1 },
        { name: "sonnet-only", score: 1 },
      ],
      [SONNET, GPT],
    );
    const [skipped, sonnetOnly] = pluginEval.status!.cases;
    skipped!.targets[1]!.notRunReason = "not run: needs a Cursor key";
    sonnetOnly!.targets.pop();
    render(<PluginEvalResults evalId="pev_1" />, {
      wrapper: wrap(client(pluginEval)),
    });
    const table = await screen.findByRole("table");
    const skippedRow = within(table).getByRole("row", {
      name: /skipped-on-gpt/,
    });
    expect(
      within(skippedRow).getByText("not run: needs a Cursor key"),
    ).toBeDefined();
    const sonnetRow = within(table).getByRole("row", { name: /sonnet-only/ });
    const cells = within(sonnetRow).getAllByRole("cell");
    expect(cells.at(-1)?.textContent).toBe("—");
    expect(cells.at(-1)?.getAttribute("colspan")).toBe("4");
  });

  it("lists the cases not run with their reasons", async () => {
    const pluginEval = evalWith([{ name: "ran", score: 1 }]);
    pluginEval.status!.cases.push({
      ...pluginEval.status!.cases[0]!,
      caseName: "fixture",
      notRunReason: "not run: context.add_dirs",
    });
    render(<PluginEvalResults evalId="pev_1" />, {
      wrapper: wrap(client(pluginEval)),
    });
    const list = await screen.findByRole("list", { name: "Cases not run" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["fixture: not run: context.add_dirs"]);
  });

  it("shows a case's notes when it is opened", async () => {
    const pluginEval = evalWith([{ name: "a", score: 1 }]);
    pluginEval.status!.cases[0]!.notes = [
      "graded on the files the run wrote",
      "the without arm ran no tools",
    ];
    render(<PluginEvalResults evalId="pev_1" />, {
      wrapper: wrap(client(pluginEval)),
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

  it.each([
    [PluginEvalPartialReason.cost_ceiling, "Partial (cost limit reached) ·"],
    [PluginEvalPartialReason.out_of_credit, "Partial (out of credit) ·"],
    [PluginEvalPartialReason.cancelled, "Partial (cancelled) ·"],
    [PluginEvalPartialReason.unspecified, "Partial ·"],
    [99 as PluginEvalPartialReason, "Partial (stopped early) ·"],
  ])("names why a partial eval stopped (reason %s)", async (reason, start) => {
    const pluginEval = evalWith([{ name: "a", score: 1 }]);
    pluginEval.status!.phase = PluginEvalPhase.partial;
    pluginEval.status!.partialReason = reason;
    render(<PluginEvalResults evalId="pev_1" />, {
      wrapper: wrap(client(pluginEval)),
    });
    const status = await screen.findByRole("status");
    expect(status.textContent?.startsWith(start), status.textContent ?? "").toBe(
      true,
    );
  });

  it("links each try to its run in Stigmer Cloud, where every viewer of the plugin opens it, without asking who the viewer is", async () => {
    const mock = { ...client(evalWith([{ name: "a", score: 1 }])), identityAccount: { whoAmI: vi.fn() } };
    const onNavigateToRun = vi.fn();
    render(<PluginEvalResults evalId="pev_1" onNavigateToRun={onNavigateToRun} />, { wrapper: wrap(mock) });
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
    const pluginEval = evalWith([{ name: "a", score: 1 }]);
    pluginEval.status!.audit!.specAudit!.createdBy = { id: "ida_me" } as never;
    const mock = { ...client(pluginEval), identityAccount: { whoAmI: vi.fn(async () => ({ metadata: { id: viewer } })) } };
    render(<PluginEvalResults evalId="pev_1" onNavigateToRun={vi.fn()} />, { wrapper: wrap(mock, "local") });
    await screen.findByRole("button", { name: "a" });
    await vi.waitFor(() => expect(mock.identityAccount.whoAmI).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const tries = await triesOf();
    expect(tries.links).toEqual(links);
    expect(tries.texts).toContain("with #1: 1.00");
  });

  it("keeps the last results when a read again fails, with a small stale notice", async () => {
    const running = evalWith([{ name: "a", score: 1 }]);
    running.status!.phase = PluginEvalPhase.running;
    const mock = client(running);
    render(<PluginEvalResults evalId="pev_1" canEdit />, { wrapper: wrap(mock) });
    await screen.findByRole("button", { name: "a" });
    mock.plugineval.get.mockRejectedValueOnce(new Error("the server is unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByText("Could not refresh the eval (the server is unavailable); these are the last results read."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "a" })).toBeDefined();
  });

  it("keeps a refused cancel as an alert", async () => {
    const running = evalWith([{ name: "a" }]);
    running.status!.phase = PluginEvalPhase.running;
    const mock = client(running, async () => {
      throw new Error("only the plugin's editors may cancel its evals");
    });
    render(<PluginEvalResults evalId="pev_1" canEdit />, {
      wrapper: wrap(mock),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "only the plugin's editors may cancel its evals",
    );
    expect(mock.plugineval.cancel).toHaveBeenCalledWith("pev_1");
  });
});
