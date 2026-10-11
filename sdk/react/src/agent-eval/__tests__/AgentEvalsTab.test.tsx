/**
 * Pins the agent's Evals tab: it says plainly that a plugin's cases were
 * written for the plugin and that case filters leave such a case out; an
 * agent that attaches no plugins sees why there is nothing to run and a
 * way to its plugins, and no form; the Run evals form and Cancel only for
 * the agent's editors (asked as `can_edit` on the agent, shown only once
 * the check answers yes: neither shows while it is pending or after it
 * failed, nor to a non-editor); a start sends the agent's id and
 * organization, no name, no plugin while every one is picked, the picked
 * ones otherwise, and the allowed tools as typed, and opens the new eval;
 * a tool name the API refuses stops the form; the past evals list each
 * eval by its agent version and score; an eval with two plugins shows a
 * section per plugin with its slug and short digest, its one-arm table
 * (no W/OUT, no Δ) with each try a link to its run, and a plugin whose
 * cases did not run with its reason; the result document downloads;
 * Compare labels both agent versions and marks a plugin whose digest
 * differs, and a changed case.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { AgentEvalsTab } from "../AgentEvalsTab";
import { agentEvalWith, digestOf } from "./agent-eval-fixture";

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
  evals: AgentEval[],
  opts: {
    canEdit?: boolean;
    started?: AgentEval;
    check?: "pending" | "fails";
  } = {},
) {
  const byId = new Map(evals.map((agentEval) => [agentEval.metadata?.id ?? "", agentEval]));
  if (opts.started) byId.set(opts.started.metadata?.id ?? "", opts.started);
  return {
    agenteval: {
      listByAgent: vi.fn(async () => ({ totalCount: evals.length, items: evals })),
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

/** Waits until the `can_edit` check has answered, or failed, and the tab has read it. */
async function permissionSettled(mock: ReturnType<typeof client>): Promise<void> {
  await vi.waitFor(() => expect(mock.iamPolicy.checkMyPermission).toHaveBeenCalled());
  await act(async () => {
    await Promise.allSettled(
      mock.iamPolicy.checkMyPermission.mock.results.map((result) => result.value as Promise<unknown>),
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

const TWO_PLUGINS = agentEvalWith(
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
  { id: "aev_2", version: "feedc0de99" },
);

describe("AgentEvalsTab", () => {
  it("says a plugin's cases were written for the plugin, and that case filters leave such a case out", async () => {
    render(<AgentEvalsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(client([])) });
    expect(screen.getByText(/cases were written for the plugin, not for this agent/)).toBeDefined();
    expect(screen.getByText(/case filters leave such a case out/)).toBeDefined();
    expect(await screen.findByText("No evals have run yet.")).toBeDefined();
  });

  it("tells an agent with no plugins why there is nothing to run, offers a way to its plugins, and no form", async () => {
    const onOpenPlugins = vi.fn();
    const mock = client([]);
    render(<AgentEvalsTab agent={agentWith([])} onOpenPlugins={onOpenPlugins} />, { wrapper: wrap(mock) });
    expect(screen.getByText(/attaches no plugins, so there is nothing to run/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Go to the agent's plugins" }));
    expect(onOpenPlugins).toHaveBeenCalled();
    await permissionSettled(mock);
    expect(screen.queryByRole("button", { name: "Run evals" })).toBeNull();
  });

  it("hides Run evals from someone who cannot edit the agent, asking can_edit on the agent", async () => {
    const mock = client([], { canEdit: false });
    render(<AgentEvalsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
    await permissionSettled(mock);
    expect(mock.iamPolicy.checkMyPermission).toHaveBeenCalledWith(
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
      const running = agentEvalWith([{ slug: "thermos", cases: [{ name: "a" }] }], {
        phase: PluginEvalPhase.running,
      });
      const mock = client([running], { check });
      render(<AgentEvalsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
      expect(await screen.findByRole("table")).toBeDefined();
      if (check === "fails") {
        await permissionSettled(mock);
      } else {
        await vi.waitFor(() => expect(mock.iamPolicy.checkMyPermission).toHaveBeenCalled());
      }
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Run evals" })).toBeNull();
    },
  );

  it("starts an eval of every plugin, unnamed, with the allowed tools, and opens it", async () => {
    const started = agentEvalWith([{ slug: "thermos", cases: [] }], { id: "aev_9", version: "0badcafe11" });
    const mock = client([], { started });
    render(<AgentEvalsTab agent={agentWith(["thermos", "linter"])} />, { wrapper: wrap(mock) });
    const runAs = await screen.findByRole("switch", { name: /Run the agent as it runs/ });
    expect(runAs.getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Allowed tools"), { target: { value: "Skill\nAgent" } });
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    await vi.waitFor(() => expect(mock.agenteval.create).toHaveBeenCalled());
    expect(mock.agenteval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "",
        org: "org_acme",
        agentId: "agt_1",
        plugins: [],
        targets: [],
        runs: 0,
        maxCostUsd: 5,
        allowTools: ["Skill", "Agent"],
      }),
    );
    expect(await screen.findByRole("heading", { name: /^Version 0badcafe · started/ })).toBeDefined();
  });

  it("sends the plugins left picked, and refuses a tool name the API refuses", async () => {
    const started = agentEvalWith([], { id: "aev_9" });
    const mock = client([], { started });
    render(<AgentEvalsTab agent={agentWith(["thermos", "linter"])} />, { wrapper: wrap(mock) });
    fireEvent.click(await screen.findByRole("checkbox", { name: "thermos" }));
    fireEvent.change(screen.getByLabelText("Allowed tools"), { target: { value: "skill" } });
    expect(screen.getByText(/'skill' is not a tool name/)).toBeDefined();
    const run = screen.getByRole("button", { name: "Run evals" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Allowed tools"), { target: { value: "" } });
    fireEvent.click(run);
    await vi.waitFor(() => expect(mock.agenteval.create).toHaveBeenCalled());
    expect(mock.agenteval.create).toHaveBeenCalledWith(expect.objectContaining({ plugins: ["linter"] }));
  });

  it("lists past evals by agent version and score, and shows an eval plugin by plugin with each try a link to its run", async () => {
    const onNavigateToRun = vi.fn();
    render(<AgentEvalsTab agent={agentWith(["thermos", "linter"])} onNavigateToRun={onNavigateToRun} />, {
      wrapper: wrap(client([TWO_PLUGINS])),
    });
    const list = await screen.findByRole("list", { name: "Past evals" });
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

  it("downloads the eval's result document", async () => {
    render(<AgentEvalsTab agent={agentWith(["thermos", "linter"])} />, {
      wrapper: wrap(client([TWO_PLUGINS])),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Download results" }));
    expect(download.files).toHaveLength(1);
    const [file] = download.files;
    expect(file).toMatchObject({ filename: "reviewer-eval-aev_2.json", mimeType: "application/json" });
    const document = JSON.parse(file!.content) as {
      evalId: string;
      agent: { slug: string; versionHash: string };
      plugins: Array<{ plugin: { slug: string }; notRunReason: string | null }>;
    };
    expect(document.evalId).toBe("aev_2");
    expect(document.agent).toMatchObject({ slug: "reviewer", versionHash: "feedc0de99" });
    expect(document.plugins.map((block) => [block.plugin.slug, block.notRunReason])).toEqual([
      ["thermos", null],
      ["linter", "no eval cases at this version"],
    ]);
  });

  it("offers an editor Cancel while the eval runs", async () => {
    const running = agentEvalWith([{ slug: "thermos", cases: [{ name: "a" }] }], {
      phase: PluginEvalPhase.running,
    });
    const mock = client([running]);
    render(<AgentEvalsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(mock.agenteval.cancel).toHaveBeenCalledWith("aev_1"));
  });

  it("offers no Cancel to someone who cannot edit the agent", async () => {
    const running = agentEvalWith([{ slug: "thermos", cases: [{ name: "a" }] }], {
      phase: PluginEvalPhase.running,
    });
    const mock = client([running], { canEdit: false });
    render(<AgentEvalsTab agent={agentWith(["thermos"])} />, { wrapper: wrap(mock) });
    expect(await screen.findByRole("table")).toBeDefined();
    await permissionSettled(mock);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("compares two evals labelled with both agent versions, marking a plugin whose digest differs and a changed case", async () => {
    const older = agentEvalWith(
      [
        { slug: "thermos", digest: digestOf("aaaa"), cases: [{ name: "steady", score: 1 }, { name: "better", score: 0 }] },
        { slug: "linter", digest: digestOf("cccc"), cases: [{ name: "lint", score: 1 }] },
      ],
      { id: "aev_1", version: "11111111ffff" },
    );
    const newer = agentEvalWith(
      [
        { slug: "thermos", digest: digestOf("bbbb"), cases: [{ name: "steady", score: 1 }, { name: "better", score: 1 }] },
        { slug: "linter", digest: digestOf("cccc"), cases: [{ name: "lint", score: 1 }] },
      ],
      { id: "aev_2", version: "22222222ffff" },
    );
    render(<AgentEvalsTab agent={agentWith(["thermos", "linter"])} />, {
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
});
