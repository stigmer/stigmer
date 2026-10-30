/**
 * Pins the Evals tab on an agent: it says plainly that a plugin's cases
 * were written for the plugin and that case filters leave such a case out;
 * an agent that attaches no plugins sees that its cases live in plugins, a
 * way to its plugins, and a form that runs nothing until a plugin is
 * compared; the Run evals form and Cancel only for the agent's editors
 * (asked as `can_edit` on the agent, shown only once the check answers
 * yes: neither shows while it is pending or after it failed, nor to a
 * non-editor); a start sends the agent's id and organization, no name, no
 * case source while every attached plugin is picked, the picked ones
 * otherwise, and the allowed tools as typed, and opens the new eval run; a
 * tool name the API refuses stops the form; comparing a plugin (attached
 * or not, picked among the organization's plugins) sends it by id with the
 * comparison as the ablation and runs its cases by default; the past eval
 * runs list each by its agent version and score; an eval run with two
 * plugins shows a section per plugin with its slug and short digest, its
 * one-arm table (no W/OUT, no Δ) with each try a link to its run, and a
 * plugin whose cases did not run with its reason; one that compares a
 * plugin shows WITH, W/OUT and Δ and marks the compared plugin; the result
 * document downloads; Compare labels both agent versions and marks a
 * plugin whose digest differs, and a changed case. Also: a plugin cleared
 * and picked again sends no case source (every plugin) and the case
 * filters and tries at once are sent as typed; a past eval run picked from
 * the list opens; one whose read fails shows the error; Compare asks for
 * two different eval runs when both pickers name one, shows a side whose
 * read failed, and says why a plugin's cases did not run on a side.
 * Evals: the organization's Evals the caller may view are offered after
 * the plugins, a picked one sent as an `eval` source; an agent with no
 * plugins in an organization with Evals is not told its cases live in
 * plugins and runs an Eval alone; an eval run's Evals show a section each
 * after the plugins, marked as an Eval.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunPhase } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { EvalRunsTab } from "../EvalRunsTab";
import { agentEvalRunWith, digestOf } from "./eval-fixture.agent";

const download = vi.hoisted(() => ({
  files: [] as Array<{ content: string; filename: string; mimeType: string }>,
}));

vi.mock("../../internal/download.js", () => ({
  downloadTextFile: (content: string, filename: string, mimeType: string) => {
    download.files.push({ content, filename, mimeType });
  },
}));

vi.mock("../../models/ModelSelector.js", () => ({
  ModelSelector: () => <span>model picker</span>,
}));

// The organization's plugins the compare picker lists.
vi.mock("../../plugin/usePluginList.js", () => ({
  usePluginList: () => ({
    plugins: [
      { id: "plg_thermos", slug: "thermos", name: "thermos" },
      { id: "plg_refund", slug: "refund-policy", name: "refund-policy" },
    ],
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  download.files.length = 0;
});

function agentWith(plugins: readonly string[]) {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "org_acme", name: "Reviewer", slug: "reviewer" },
    spec: { plugins: plugins.map((slug) => ({ org: "org_acme", slug })) },
  });
}

function client(
  evals: EvalRun[],
  opts: {
    canEdit?: boolean;
    started?: EvalRun;
    check?: "pending" | "fails";
    /** The slugs of the organization's Evals the caller may view. */
    evals?: readonly string[];
  } = {},
) {
  const byId = new Map(evals.map((evalRun) => [evalRun.metadata?.id ?? "", evalRun]));
  if (opts.started) byId.set(opts.started.metadata?.id ?? "", opts.started);
  return {
    evalrun: {
      listByAgent: vi.fn(async () => ({ entries: evals, nextPageToken: "" })),
      get: vi.fn(async (id: string) => byId.get(id)),
      create: vi.fn(async () => opts.started),
      cancel: vi.fn(async (id: string) => byId.get(id)),
    },
    eval: {
      list: vi.fn(async () => ({
        entries: (opts.evals ?? []).map((slug, index) =>
          create(EvalSchema, { metadata: { id: `evs_${index + 1}`, org: "org_acme", slug } }),
        ),
        nextPageToken: "",
      })),
    },
    grant: {
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

/** Waits until the `can_edit` check has answered, or failed, and the tab has read it. */
async function permissionSettled(mock: ReturnType<typeof client>): Promise<void> {
  await vi.waitFor(() => expect(mock.grant.checkMyPermission).toHaveBeenCalled());
  await act(async () => {
    await Promise.allSettled(
      mock.grant.checkMyPermission.mock.results.map((result) => result.value as Promise<unknown>),
    );
  });
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

const TWO_PLUGINS = agentEvalRunWith(
  [
    {
      slug: "thermos",
      digest: digestOf("abcdef123456"),
      cases: [
        { name: "review-fires", score: 1 },
        { name: "asks-first", score: 0 },
      ],
    },
    { slug: "linter", notRun: "no eval cases at this version" },
  ],
  { id: "evr_2", version: "feedc0de99" },
);

describe("EvalRunsTab on an agent", () => {
  it("says a plugin's cases were written for the plugin, and that case filters leave such a case out", async () => {
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(client([])) });
    expect(screen.getByText(/cases were written for the plugin, not for this agent/)).toBeDefined();
    expect(screen.getByText(/case filters leave such a case out/)).toBeDefined();
    expect(await screen.findByText("No eval runs yet.")).toBeDefined();
  });

  it("tells an agent with no plugins where cases live, offers a way to its plugins, and runs nothing until a plugin is compared", async () => {
    const onOpenPlugins = vi.fn();
    const started = agentEvalRunWith([], { id: "evr_9" });
    const mock = client([], { started });
    render(<EvalRunsTab agent={agentWith([])} onOpenPlugins={onOpenPlugins} />, { wrapper: wrap(mock) });
    expect(screen.getByText(/This agent attaches no plugins/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Go to the agent's plugins" }));
    expect(onOpenPlugins).toHaveBeenCalled();
    const run = (await screen.findByRole("button", { name: "Run evals" })) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(screen.getByText("Pick at least one plugin or eval whose cases run.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Compare with a plugin"), { target: { value: "plg_refund" } });
    expect(run.disabled).toBe(false);
    fireEvent.click(run);
    await vi.waitFor(() => expect(mock.evalrun.create).toHaveBeenCalled());
    expect(mock.evalrun.create).toHaveBeenCalledWith(
      expect.objectContaining({ comparedPluginId: "plg_refund", cases: [], ablation: EvalRunAblation.with_without }),
    );
  });

  it("offers the organization's Evals after the plugins and sends a picked one as an eval source", async () => {
    const started = agentEvalRunWith([], { id: "evr_9" });
    const mock = client([], { started, evals: ["support-evals", "refunds"] });
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
    expect(screen.getByText(/pushed to the organization with stigmer push eval/)).toBeDefined();
    const support = await screen.findByRole("checkbox", { name: "Eval support-evals" });
    const boxes = screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label") ?? box.parentElement?.textContent);
    expect(boxes).toEqual(["thermos", "Eval support-evals", "Eval refunds"]);
    expect(mock.eval.list).toHaveBeenCalledWith(expect.objectContaining({ org: "org_acme" }));
    fireEvent.click(support);
    fireEvent.click(screen.getByRole("checkbox", { name: "Eval refunds" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Eval refunds" }));
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    await vi.waitFor(() => expect(mock.evalrun.create).toHaveBeenCalled());
    expect(mock.evalrun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cases: [
          { plugin: { org: "org_acme", slug: "thermos" } },
          { eval: { org: "org_acme", slug: "support-evals" } },
        ],
      }),
    );
  });

  it("runs an Eval alone on an agent with no plugins, never saying its cases live only in plugins", async () => {
    const started = agentEvalRunWith([], { id: "evr_9" });
    const mock = client([], { started, evals: ["support-evals"] });
    render(<EvalRunsTab agent={agentWith([])} />, { wrapper: wrap(mock) });
    const support = await screen.findByRole("checkbox", { name: "Eval support-evals" });
    expect(screen.queryByText(/This agent attaches no plugins/)).toBeNull();
    const run = screen.getByRole("button", { name: "Run evals" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    fireEvent.click(support);
    expect(run.disabled).toBe(false);
    fireEvent.click(run);
    await vi.waitFor(() => expect(mock.evalrun.create).toHaveBeenCalled());
    expect(mock.evalrun.create).toHaveBeenCalledWith(
      expect.objectContaining({ cases: [{ eval: { org: "org_acme", slug: "support-evals" } }] }),
    );
  });

  it("shows an Eval's cases in a section of its own after the plugins, marked as an Eval", async () => {
    const withEval = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "review-fires", score: 1 }] }], {
      id: "evr_4",
      evals: [{ slug: "support-evals", digest: digestOf("5e4444"), cases: [{ name: "refund-window", score: 0 }] }],
    });
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(client([withEval])) });
    const section = await screen.findByRole("region", { name: "Eval support-evals" });
    expect(within(section).getByText("5e4444000000")).toBeDefined();
    expect(within(section).getByText("eval")).toBeDefined();
    expect(within(section).getByRole("button", { name: "refund-window" })).toBeDefined();
    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(regions.indexOf("Plugin thermos")).toBeLessThan(regions.indexOf("Eval support-evals"));
  });

  it("compares a plugin the agent attaches: its cases by default, the comparison switch as the ablation", async () => {
    const started = agentEvalRunWith([], { id: "evr_9" });
    const mock = client([], { started });
    render(<EvalRunsTab agent={agentWith(["thermos", "linter"])} />, { wrapper: wrap(mock) });
    const picker = (await screen.findByLabelText("Compare with a plugin")) as HTMLSelectElement;
    expect(within(picker).getByRole("option", { name: "thermos (attached)" })).toBeDefined();
    fireEvent.change(picker, { target: { value: "plg_thermos" } });
    expect((screen.getByRole("checkbox", { name: "thermos" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "linter" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Also run each case without the plugin" }));
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    await vi.waitFor(() => expect(mock.evalrun.create).toHaveBeenCalled());
    expect(mock.evalrun.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1", comparedPluginId: "plg_thermos", cases: [], ablation: EvalRunAblation.none }),
    );
  });

  it("shows an eval run that compares a plugin with WITH, W/OUT and Δ, the compared plugin marked", async () => {
    const comparing = agentEvalRunWith(
      [
        { slug: "thermos", cases: [{ name: "a", score: 1 }] },
        { slug: "refund-policy", attached: false, cases: [{ name: "b", score: 1 }] },
      ],
      { id: "evr_5", version: "feedc0de99", compared: "refund-policy" },
    );
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(client([comparing])) });
    expect(await screen.findByRole("heading", { name: /^Version feedc0de with and without refund-policy · started/ })).toBeDefined();
    const refund = screen.getByRole("region", { name: "Plugin refund-policy" });
    expect(within(refund).getByText("compared, not attached")).toBeDefined();
    expect(within(within(refund).getByRole("table")).getByText("W/OUT")).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Plugin thermos" })).queryByText(/compared/)).toBeNull();
  });

  it("hides Run evals from someone who cannot edit the agent, asking can_edit on the agent", async () => {
    const mock = client([], { canEdit: false });
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
    await permissionSettled(mock);
    expect(mock.grant.checkMyPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({ kind: "agent", id: "agt_1" }),
        relation: "can_edit",
      }),
    );
    expect(screen.queryByRole("button", { name: "Run evals" })).toBeNull();
  });

  it.each(["pending", "fails"] as const)(
    "shows neither Run evals nor Cancel while the can_edit check %s",
    async (check) => {
      const running = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a" }] }], {
        phase: EvalRunPhase.running,
      });
      const mock = client([running], { check });
      render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
      expect(await screen.findByRole("table")).toBeDefined();
      if (check === "fails") {
        await permissionSettled(mock);
      } else {
        await vi.waitFor(() => expect(mock.grant.checkMyPermission).toHaveBeenCalled());
      }
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Run evals" })).toBeNull();
    },
  );

  it("starts an eval of every plugin, unnamed, with the allowed tools, and opens it", async () => {
    const started = agentEvalRunWith([{ slug: "thermos", cases: [] }], { id: "evr_9", version: "0badcafe11" });
    const mock = client([], { started });
    render(<EvalRunsTab agent={agentWith(["thermos", "linter"])} />, { wrapper: wrap(mock) });
    const runAs = await screen.findByRole("switch", { name: /Run the agent as it runs/ });
    expect(runAs.getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Allowed tools"), { target: { value: "Skill\nAgent" } });
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    await vi.waitFor(() => expect(mock.evalrun.create).toHaveBeenCalled());
    expect(mock.evalrun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "",
        org: "org_acme",
        agentId: "agt_1",
        cases: [],
        targets: [],
        runs: 0,
        maxCostUsd: 5,
        allowTools: ["Skill", "Agent"],
      }),
    );
    expect(await screen.findByRole("heading", { name: /^Version 0badcafe · started/ })).toBeDefined();
  });

  it("sends the plugins left picked, and refuses a tool name the API refuses", async () => {
    const started = agentEvalRunWith([], { id: "evr_9" });
    const mock = client([], { started });
    render(<EvalRunsTab agent={agentWith(["thermos", "linter"])} />, { wrapper: wrap(mock) });
    fireEvent.click(await screen.findByRole("checkbox", { name: "thermos" }));
    fireEvent.change(screen.getByLabelText("Allowed tools"), { target: { value: "skill" } });
    expect(screen.getByText(/'skill' is not a tool name/)).toBeDefined();
    const run = screen.getByRole("button", { name: "Run evals" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Allowed tools"), { target: { value: "" } });
    fireEvent.click(run);
    await vi.waitFor(() => expect(mock.evalrun.create).toHaveBeenCalled());
    expect(mock.evalrun.create).toHaveBeenCalledWith(expect.objectContaining({ cases: [{ plugin: { org: "org_acme", slug: "linter" } }] }));
  });

  it("lists past evals by agent version and score, and shows an eval plugin by plugin with each try a link to its run", async () => {
    const onNavigateToRun = vi.fn();
    render(<EvalRunsTab agent={agentWith(["thermos", "linter"])} onNavigateToRun={onNavigateToRun} />, {
      wrapper: wrap(client([TWO_PLUGINS])),
    });
    const list = await screen.findByRole("list", { name: "Past eval runs" });
    expect(within(list).getByRole("button").textContent).toMatch(/^Version feedc0de · started .* · Completed · score 0\.75 · 1\/2 passed · \$1\.50$/);

    const thermos = await screen.findByRole("region", { name: "Plugin thermos" });
    expect(within(thermos).getByText("abcdef123456")).toBeDefined();
    const table = within(thermos).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: /^Score/ })).toBeDefined();
    expect(within(table).queryByText("W/OUT")).toBeNull();
    expect(within(table).queryByText("Δ")).toBeNull();
    fireEvent.click(within(table).getByRole("button", { name: "review-fires" }));
    fireEvent.click(within(thermos).getByRole("button", { name: "#1: 1.00" }));
    expect(onNavigateToRun).toHaveBeenCalledWith("run_thermos_review-fires_1");
    expect(within(thermos).getByText("#2: not graded: platform busy")).toBeDefined();

    const linter = screen.getByRole("region", { name: "Plugin linter" });
    expect(within(linter).getByText("Not run: no eval cases at this version")).toBeDefined();
    expect(within(linter).queryByRole("table")).toBeNull();
  });

  it("downloads the eval run's result document", async () => {
    render(<EvalRunsTab agent={agentWith(["thermos", "linter"])} />, {
      wrapper: wrap(client([TWO_PLUGINS])),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Download results" }));
    expect(download.files).toHaveLength(1);
    const [file] = download.files;
    expect(file).toMatchObject({ filename: "reviewer-evr_2.json", mimeType: "application/json" });
    const document = JSON.parse(file!.content) as {
      evalRunId: string;
      subject: { kind: string; slug: string; versionHash: string };
      plugins: Array<{ plugin: { slug: string }; notRunReason: string | null }>;
    };
    expect(document.evalRunId).toBe("evr_2");
    expect(document.subject).toMatchObject({ kind: "agent", slug: "reviewer", versionHash: "feedc0de99" });
    expect(document.plugins.map((block) => [block.plugin.slug, block.notRunReason])).toEqual([
      ["thermos", null],
      ["linter", "no eval cases at this version"],
    ]);
  });

  it("offers an editor Cancel while the eval runs", async () => {
    const running = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a" }] }], {
      phase: EvalRunPhase.running,
    });
    const mock = client([running]);
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(mock.evalrun.cancel).toHaveBeenCalledWith("evr_1"));
  });

  it("offers no Cancel to someone who cannot edit the agent", async () => {
    const running = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a" }] }], {
      phase: EvalRunPhase.running,
    });
    const mock = client([running], { canEdit: false });
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
    expect(await screen.findByRole("table")).toBeDefined();
    await permissionSettled(mock);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("compares two evals labelled with both agent versions, marking a plugin whose digest differs and a changed case", async () => {
    const older = agentEvalRunWith(
      [
        { slug: "thermos", digest: digestOf("aaaa"), cases: [{ name: "steady", score: 1 }, { name: "better", score: 0 }] },
        { slug: "linter", digest: digestOf("cccc"), cases: [{ name: "lint", score: 1 }] },
      ],
      { id: "evr_1", version: "11111111ffff" },
    );
    const newer = agentEvalRunWith(
      [
        { slug: "thermos", digest: digestOf("bbbb"), cases: [{ name: "steady", score: 1 }, { name: "better", score: 1 }] },
        { slug: "linter", digest: digestOf("cccc"), cases: [{ name: "lint", score: 1 }] },
      ],
      { id: "evr_2", version: "22222222ffff" },
    );
    render(<EvalRunsTab agent={agentWith(["thermos", "linter"])} />, {
      wrapper: wrap(client([newer, older])),
    });
    const thermos = await screen.findByRole("region", { name: "Compare plugin thermos" });
    expect(thermos.getAttribute("data-digest-changed")).toBe("true");
    expect(within(thermos).getByText(/plugin version changed/)).toBeDefined();
    expect(within(thermos).getByText("aaaa00000000 → bbbb00000000")).toBeDefined();
    expect(within(thermos).getByRole("columnheader", { name: "Before (version 11111111)" })).toBeDefined();
    expect(within(thermos).getByRole("columnheader", { name: "After (version 22222222)" })).toBeDefined();
    expect(within(thermos).getByRole("row", { name: /better/ }).getAttribute("data-changed")).toBe("true");
    expect(within(thermos).getByRole("row", { name: /steady/ }).getAttribute("data-changed")).toBeNull();

    const linter = screen.getByRole("region", { name: "Compare plugin linter" });
    expect(linter.getAttribute("data-digest-changed")).toBeNull();
    expect(within(linter).queryByText(/plugin version changed/)).toBeNull();
  });

  it("sends every plugin once a cleared one is picked again, and the case filters and tries at once as typed", async () => {
    const started = agentEvalRunWith([], { id: "evr_9" });
    const mock = client([], { started });
    render(<EvalRunsTab agent={agentWith(["thermos", "linter"])} />, { wrapper: wrap(mock) });
    const thermos = await screen.findByRole("checkbox", { name: "thermos" });
    fireEvent.click(thermos);
    expect((thermos as HTMLInputElement).checked).toBe(false);
    fireEvent.click(thermos);
    expect((thermos as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Cases matching"), { target: { value: "review-*" } });
    fireEvent.change(screen.getByLabelText("Case tags"), { target: { value: "smoke, fast" } });
    fireEvent.change(screen.getByLabelText("Tries at once"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    await vi.waitFor(() => expect(mock.evalrun.create).toHaveBeenCalled());
    expect(mock.evalrun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cases: [],
        caseGlob: "review-*",
        caseTags: ["smoke", "fast"],
        concurrency: 3,
      }),
    );
  });

  it("opens a past eval picked from the list", async () => {
    const newer = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a", score: 1 }] }], {
      id: "evr_2",
      version: "22222222ffff",
    });
    const older = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a", score: 0 }] }], {
      id: "evr_1",
      version: "11111111ffff",
    });
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(client([newer, older])) });
    expect(await screen.findByRole("heading", { name: /^Version 22222222 · started/ })).toBeDefined();
    const list = screen.getByRole("list", { name: "Past eval runs" });
    const [first, second] = within(list).getAllByRole("button");
    expect(first?.getAttribute("aria-current")).toBe("true");
    fireEvent.click(second!);
    expect(await screen.findByRole("heading", { name: /^Version 11111111 · started/ })).toBeDefined();
    expect(screen.queryByRole("heading", { name: /^Version 22222222 · started/ })).toBeNull();
    expect(second?.getAttribute("aria-current")).toBe("true");
    expect(first?.getAttribute("aria-current")).toBeNull();
  });

  it("shows the error when the eval cannot be read", async () => {
    const mock = client([TWO_PLUGINS]);
    mock.evalrun.get.mockRejectedValue(new Error("the server is unavailable"));
    render(<EvalRunsTab agent={agentWith(["thermos", "linter"])} />, { wrapper: wrap(mock) });
    expect(await screen.findByText(/the server is unavailable/)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Plugin thermos" })).toBeNull();
    expect(screen.queryByText("Loading the eval run…")).toBeNull();
  });

  it("asks for two different evals when both compare pickers name one", async () => {
    const newer = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a", score: 1 }] }], { id: "evr_2" });
    const older = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a", score: 0 }] }], { id: "evr_1" });
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(client([newer, older])) });
    expect(await screen.findByRole("region", { name: "Compare plugin thermos" })).toBeDefined();
    expect(screen.queryByText("Pick two different eval runs.")).toBeNull();
    fireEvent.change(screen.getByLabelText("After"), { target: { value: "evr_1" } });
    expect(screen.getByText("Pick two different eval runs.")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Compare plugin thermos" })).toBeNull();
  });

  it("shows a compare side whose read failed, never loading forever", async () => {
    const newer = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a", score: 1 }] }], { id: "evr_2" });
    const older = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a", score: 0 }] }], { id: "evr_1" });
    const mock = client([newer, older]);
    mock.evalrun.get.mockImplementation(async (id: string) => {
      if (id === "evr_1") throw new Error("the server is unavailable");
      return newer;
    });
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
    expect(await screen.findByText("Could not read the Before eval run")).toBeDefined();
    expect(screen.queryByText("Could not read the After eval run")).toBeNull();
    expect(screen.queryByText("Loading the comparison…")).toBeNull();
  });

  it("says in the comparison why a plugin's cases did not run on a side", async () => {
    const newer = agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a", score: 1 }] }], { id: "evr_2" });
    const older = agentEvalRunWith([{ slug: "thermos", notRun: "not selected" }], { id: "evr_1" });
    render(<EvalRunsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(client([newer, older])) });
    const thermos = await screen.findByRole("region", { name: "Compare plugin thermos" });
    expect(within(thermos).getByText("Not run in Before: not selected")).toBeDefined();
    expect(within(thermos).queryByText(/Not run in After/)).toBeNull();
    expect(within(thermos).getByRole("row", { name: /^a/ }).getAttribute("data-changed")).toBe("true");
  });
});
