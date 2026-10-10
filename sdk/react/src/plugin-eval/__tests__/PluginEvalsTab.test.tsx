/**
 * Pins the plugin's Evals tab: the suite summary (cases, tags, findings,
 * the cases not run yet with their feature) or the sentence for a plugin
 * with no cases; the Run evals form only for the plugin's editors (asked
 * as `can_edit` on the plugin, and shown only once the check answers yes:
 * neither it nor Cancel shows while the check is pending or after it
 * failed, nor to a non-editor), whose start sends the plugin's id,
 * organization and the form's settings, no name, and opens the new eval
 * (by default no models and 0 tries, so each case's own model and runs
 * apply, and a cleared tries field sends 0 again), each eval labelled by
 * the plugin and when it started, its targets added once the case's own
 * model is switched off, switched to another engine (which drops the model
 * picked) and removed; a past eval opened from the list;
 * an eval's view with a row per case, WITH, W/OUT and a provisional Δ, and
 * its tries as links to their runs; Cancel for an editor while the eval
 * runs; and Compare, case by case, with a changed case marked, a
 * request for two different evals when both pickers name one, and each
 * read's error when one fails.
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
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { PluginEvalsTab } from "../PluginEvalsTab";
import { evalStartOf, evalWith } from "./eval-fixture";

/** How the tab labels the fixture's eval `id` of thermos. */
function labelOf(id: string): string {
  return `thermos · started ${evalStartOf(id).toLocaleString()}`;
}

vi.mock("../../models/ModelSelector.js", () => ({
  ModelSelector: ({
    onValueChange,
    onHarnessChange,
  }: {
    onValueChange: (modelId: string) => void;
    onHarnessChange: (harness: "cursor") => void;
  }) => (
    <>
      <button type="button" onClick={() => onValueChange("claude-haiku-4-5")}>
        pick a model
      </button>
      <button type="button" onClick={() => onHarnessChange("cursor")}>
        use cursor
      </button>
    </>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const plugin = create(PluginSchema, {
  metadata: { id: "plg_1", org: "org_acme", name: "thermos", slug: "thermos" },
  status: {
    evals: {
      dir: "evals",
      caseCount: 2,
      caseTags: ["smoke"],
      cases: [
        { caseName: "review-fires", path: "evals/review-fires" },
        {
          caseName: "needs-fixture",
          path: "evals/needs-fixture",
          unsupported: "context.scaffold_script",
        },
      ],
      findings: [
        {
          kind: "eval-case-invalid",
          message: "unknown key 'foo' in prompt.md",
          path: "evals/bad/prompt.md",
        },
      ],
    },
  },
});

function client(
  evals: PluginEval[],
  opts: {
    canEdit?: boolean;
    started?: PluginEval;
    /** The `can_edit` check never answers, or fails. */
    check?: "pending" | "fails";
  } = {},
) {
  const byId = new Map(
    evals.map((pluginEval) => [pluginEval.metadata?.id ?? "", pluginEval]),
  );
  if (opts.started) byId.set(opts.started.metadata?.id ?? "", opts.started);
  return {
    plugineval: {
      listByPlugin: vi.fn(async () => ({
        totalCount: evals.length,
        items: evals,
      })),
      get: vi.fn(async (id: string) => byId.get(id)),
      create: vi.fn(async () => opts.started),
      cancel: vi.fn(async (id: string) => byId.get(id)),
    },
    iamPolicy: {
      checkMyPermission: vi.fn(() =>
        opts.check === "pending"
          ? new Promise<never>(() => undefined)
          : opts.check === "fails"
            ? Promise.reject(new Error("authorization is unavailable"))
            : Promise.resolve({ isAuthorized: opts.canEdit ?? true }),
      ),
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

describe("PluginEvalsTab", () => {
  it("summarises the suite: cases, tags, findings, and the cases not run yet", async () => {
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(client([])) });
    expect(screen.getByText(/2 cases in/)).toBeDefined();
    expect(screen.getByText(/tags: smoke/)).toBeDefined();
    const notRun = screen.getByRole("list", { name: "Cases not run yet" });
    expect(
      within(notRun).getByText(/not run yet: context.scaffold_script/),
    ).toBeDefined();
    expect(screen.getByText("unknown key 'foo' in prompt.md")).toBeDefined();
    expect(await screen.findByText("No evals have run yet.")).toBeDefined();
  });

  it("says so for a plugin with no evals/ cases, and offers no form", async () => {
    const bare = create(PluginSchema, {
      metadata: { id: "plg_2", org: "org_acme", name: "bare" },
    });
    render(<PluginEvalsTab plugin={bare} />, { wrapper: wrap(client([])) });
    expect(screen.getByText(/This plugin has no evals\/ cases/)).toBeDefined();
    await screen.findByText("No evals have run yet.");
    expect(screen.queryByRole("button", { name: "Run evals" })).toBeNull();
  });

  it("hides Run evals from someone who cannot edit the plugin", async () => {
    const mock = client([], { canEdit: false });
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(mock) });
    await screen.findByText("No evals have run yet.");
    await vi.waitFor(() =>
      expect(mock.iamPolicy.checkMyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({ kind: "plugin", id: "plg_1" }),
          relation: "can_edit",
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Run evals" })).toBeNull(),
    );
  });

  it("starts an eval for the plugin with the form's settings and opens it", async () => {
    const started = evalWith(
      [{ name: "review-fires", score: 1, delta: 0.67 }],
      undefined,
      "pev_new",
    );
    const mock = client([], { started });
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(mock) });
    fireEvent.click(
      await screen.findByRole("switch", { name: "Use each case's own model" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "pick a model" }));
    fireEvent.change(screen.getByLabelText("Tries per case"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Cost limit (USD)"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("switch", { name: /without the plugin/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    await vi.waitFor(() => expect(mock.plugineval.create).toHaveBeenCalled());
    expect(mock.plugineval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "org_acme",
        pluginId: "plg_1",
        name: "",
        targets: [{ harness: Harness.NATIVE, modelName: "claude-haiku-4-5" }],
        runs: 5,
        ablation: PluginEvalAblation.none,
        maxCostUsd: 2,
        concurrency: 1,
      }),
    );
    expect(await screen.findByText(labelOf("pev_new"))).toBeDefined();
  });

  it("sends no models and no tries by default, so each case's own model and runs apply", async () => {
    const started = evalWith([], undefined, "pev_new");
    const mock = client([], { started });
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(mock) });
    const own = await screen.findByRole("switch", {
      name: "Use each case's own model",
    });
    expect(own.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "pick a model" })).toBeNull();
    expect(
      (screen.getByLabelText("Tries per case") as HTMLInputElement).value,
    ).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    await vi.waitFor(() => expect(mock.plugineval.create).toHaveBeenCalled());
    expect(mock.plugineval.create).toHaveBeenCalledWith(
      expect.objectContaining({ targets: [], runs: 0 }),
    );
  });

  it("sends 0 tries again once the tries field is cleared", async () => {
    const started = evalWith([], undefined, "pev_new");
    const mock = client([], { started });
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(mock) });
    const runs = await screen.findByLabelText("Tries per case");
    fireEvent.change(runs, { target: { value: "4" } });
    fireEvent.change(runs, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    await vi.waitFor(() => expect(mock.plugineval.create).toHaveBeenCalled());
    expect(mock.plugineval.create).toHaveBeenCalledWith(
      expect.objectContaining({ runs: 0 }),
    );
  });

  it("builds the targets from the form: adds a model, switches an engine (dropping its model), removes one, and sets tries at once", async () => {
    const started = evalWith([], undefined, "pev_new");
    const mock = client([], { started });
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(mock) });
    fireEvent.click(
      await screen.findByRole("switch", { name: "Use each case's own model" }),
    );
    expect(screen.queryByRole("button", { name: /^Remove model/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a model" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "pick a model" })[1]!,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "use cursor" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Remove model 1" }));
    expect(
      screen.getAllByRole("button", { name: "pick a model" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Remove model/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tries at once"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    await vi.waitFor(() => expect(mock.plugineval.create).toHaveBeenCalled());
    expect(mock.plugineval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [{ harness: Harness.CURSOR }],
        concurrency: 4,
      }),
    );
  });

  it("refuses to start with a cost limit the API refuses", async () => {
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(client([])) });
    fireEvent.change(await screen.findByLabelText("Cost limit (USD)"), {
      target: { value: "0" },
    });
    expect(screen.getByText(/more than \$0/)).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Run evals" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows the newest eval case by case, a provisional Δ, and its tries as links to their runs", async () => {
    const latest = evalWith([{ name: "review-fires", score: 1, delta: 0.67 }]);
    latest.status!.provisionalDelta = true;
    const onNavigateToRun = vi.fn();
    render(
      <PluginEvalsTab plugin={plugin} onNavigateToRun={onNavigateToRun} />,
      { wrapper: wrap(client([latest])) },
    );
    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("columnheader", {
        name: /Difference.*provisional/,
      }),
    ).toBeDefined();
    const row = within(table).getByRole("row", { name: /review-fires/ });
    expect(within(row).getByText("1.00")).toBeDefined();
    expect(within(row).getByText("0.33")).toBeDefined();
    expect(within(row).getByText("+0.67")).toBeDefined();
    expect(screen.getByText(/Δ is provisional/)).toBeDefined();
    fireEvent.click(within(row).getByRole("button", { name: "review-fires" }));
    fireEvent.click(screen.getByRole("button", { name: "with #1: 1.00" }));
    expect(onNavigateToRun).toHaveBeenCalledWith("run_review-fires_1");
    expect(
      screen.getByText("with #2: not graded: platform busy"),
    ).toBeDefined();
  });

  it("opens a past eval picked from the list", async () => {
    const newer = evalWith([{ name: "a", score: 1 }], undefined, "pev_2");
    const older = evalWith([{ name: "a", score: 0.5 }], undefined, "pev_1");
    render(<PluginEvalsTab plugin={plugin} />, {
      wrapper: wrap(client([newer, older])),
    });
    expect(await screen.findByText(labelOf("pev_2"))).toBeDefined();
    const list = screen.getByRole("list", { name: "Past evals" });
    const [first, second] = within(list).getAllByRole("button");
    expect(first?.getAttribute("aria-current")).toBe("true");
    fireEvent.click(second!);
    expect(await screen.findByText(labelOf("pev_1"))).toBeDefined();
    expect(screen.queryByText(labelOf("pev_2"))).toBeNull();
    expect(second?.getAttribute("aria-current")).toBe("true");
    expect(first?.getAttribute("aria-current")).toBeNull();
  });

  it("offers an editor Cancel while the eval runs", async () => {
    const running = evalWith([{ name: "review-fires" }]);
    running.status!.phase = PluginEvalPhase.running;
    const mock = client([running]);
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(mock) });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await vi.waitFor(() =>
      expect(mock.plugineval.cancel).toHaveBeenCalledWith("pev_1"),
    );
  });

  it("offers no Cancel to someone who cannot edit the plugin", async () => {
    const running = evalWith([{ name: "review-fires" }]);
    running.status!.phase = PluginEvalPhase.running;
    const mock = client([running], { canEdit: false });
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(mock) });
    expect(await screen.findByRole("table")).toBeDefined();
    await vi.waitFor(() =>
      expect(mock.iamPolicy.checkMyPermission).toHaveBeenCalled(),
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run evals" })).toBeNull();
  });

  it.each(["pending", "fails"] as const)(
    "shows neither Run evals nor Cancel while the can_edit check %s",
    async (check) => {
      const running = evalWith([{ name: "review-fires" }]);
      running.status!.phase = PluginEvalPhase.running;
      const mock = client([running], { check });
      render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(mock) });
      expect(await screen.findByRole("table")).toBeDefined();
      await vi.waitFor(() =>
        expect(mock.iamPolicy.checkMyPermission).toHaveBeenCalled(),
      );
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Run evals" })).toBeNull();
    },
  );

  it("compares two evals case by case and marks a changed case", async () => {
    const newer = evalWith(
      [
        { name: "steady", score: 1, delta: 0.5 },
        { name: "better", score: 1, delta: 0.6 },
      ],
      undefined,
      "pev_2",
    );
    const older = evalWith(
      [
        { name: "steady", score: 1, delta: 0.5 },
        { name: "better", score: 0.5, delta: 0.1 },
      ],
      undefined,
      "pev_1",
    );
    render(<PluginEvalsTab plugin={plugin} />, {
      wrapper: wrap(client([newer, older])),
    });
    expect(await screen.findByLabelText("Before")).toBeDefined();
    const compare = await vi.waitFor(() => {
      const found = screen
        .queryAllByRole("table")
        .find((table) => within(table).queryByText("Δ before") !== null);
      if (found === undefined) throw new Error("no comparison yet");
      return found;
    });
    const changed = within(compare).getByRole("row", { name: /better/ });
    expect(changed.getAttribute("data-changed")).toBe("true");
    expect(within(changed).getByText("changed")).toBeDefined();
    expect(
      within(compare)
        .getByRole("row", { name: /steady/ })
        .getAttribute("data-changed"),
    ).toBeNull();
  });

  it("shows a comparison read's error, never loading forever", async () => {
    const newer = evalWith([{ name: "a", score: 1 }], undefined, "pev_2");
    const older = evalWith([{ name: "a", score: 0.5 }], undefined, "pev_1");
    const mock = client([newer, older]);
    mock.plugineval.get.mockImplementation(async (id: string) => {
      if (id === "pev_1") throw new Error("the server is unavailable");
      return newer;
    });
    render(<PluginEvalsTab plugin={plugin} />, { wrapper: wrap(mock) });
    const alert = await screen.findByText("Could not read the Before eval");
    expect(alert).toBeDefined();
    expect(screen.queryByText("Loading the comparison…")).toBeNull();
  });

  it("asks for two different evals when both pickers name the same one", async () => {
    const newer = evalWith([{ name: "a", score: 1 }], undefined, "pev_2");
    const older = evalWith([{ name: "a", score: 0.5 }], undefined, "pev_1");
    render(<PluginEvalsTab plugin={plugin} />, {
      wrapper: wrap(client([newer, older])),
    });
    expect(screen.queryByText("Pick two different evals.")).toBeNull();
    fireEvent.change(await screen.findByLabelText("After"), {
      target: { value: "pev_1" },
    });
    expect(screen.getByText("Pick two different evals.")).toBeDefined();
    expect(
      screen
        .queryAllByRole("table")
        .some((table) => within(table).queryByText("Δ before") !== null),
    ).toBe(false);
  });
});
