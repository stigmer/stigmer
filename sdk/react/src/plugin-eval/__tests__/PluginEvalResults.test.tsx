/**
 * Pins one eval's results view on its own: nothing at all for an empty id;
 * a column group per target, named, when the eval ran on several; a case
 * not run on one target shows the reason there, and a dash where the case
 * has no result; the cases not run listed with their reasons; a case's
 * notes when it is opened; the reason a partial eval stopped, in words (a
 * reason this client does not know by its number); and a refused cancel
 * kept as an alert. The tab around it is pinned in PluginEvalsTab.test.tsx.
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
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { PluginEvalResults } from "../PluginEvalResults";
import { GPT, SONNET, evalWith } from "./eval-fixture";

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

function wrap(mock: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={mock as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
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
    [99 as PluginEvalPartialReason, "Partial (99) ·"],
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
