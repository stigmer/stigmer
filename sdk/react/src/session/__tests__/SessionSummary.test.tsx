/**
 * Proves the conversation's summary (../SessionSummary.tsx): what was asked,
 * and how it stands in the status pill. Once a turn ended: the pill says how
 * (Done, Didn't finish), then who or what started it (a routine by name,
 * linked through the host; "Started by a routine" for a reader the server
 * refuses the routine to, and for a guest, who is never sent the read; a
 * channel conversation by where it came from), its time, what came out (the
 * Files made, then a Plan-mode turn's plans, never counted as files), and
 * the estimated cost only where cost is shown. While a turn works, the pill
 * says Working with the turn's time, ticking each second, and beside it how
 * far the turn has got: its to-do list, else the steps it settled, else
 * nothing; while it waits on a person, the amber pill says so. Drawn over
 * the scenario catalogue's states at its clock.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { clone, create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { SCENARIO_CLOCK, sampleInstant, samples, scenarios, type Scenario } from "../../test";
import { CHANNEL_SESSION_LABELS } from "../channelOrigin";
import { SessionSummary } from "../SessionSummary";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Freezes the clock at `at`, letting the summary's one-second tick be driven by hand. */
function freezeClock(at: string | number) {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(at));
}

/** A one-turn scenario of `turn`'s events folded, the finished one's session and nothing else. */
function oneTurn(turn: ReturnType<typeof samples.turn>): Scenario {
  return { ...scenarios.busy, fold: { ...scenarios.busy.fold, turns: [turn] }, runs: [], files: [] };
}

/** The meta line under the title: the pill and the words beside it. */
function metaLine() {
  return screen.getByRole("heading", { level: 1 }).parentElement!.nextElementSibling!;
}

const NIGHTLY = create(RoutineSchema, { metadata: { id: "rtn_1", name: "Nightly billing check", slug: "nightly-billing-check", org: "demo" } });

function client(get: (id: string) => Promise<Routine>) {
  return { routine: { get: vi.fn(get) } } as unknown as Stigmer & { routine: { get: ReturnType<typeof vi.fn> } };
}

function renderSummary(
  stigmer: ReturnType<typeof client>,
  props: Partial<React.ComponentProps<typeof SessionSummary>> = {},
  scenario: Scenario = scenarios.finished,
) {
  return render(
    <StigmerContext.Provider value={stigmer}>
      <SessionSummary
        session={scenario.session!}
        turns={scenario.fold.turns}
        runs={scenario.runs}
        files={scenario.files}
        showCost
        {...props}
      />
    </StigmerContext.Provider>,
  );
}

describe("SessionSummary", () => {
  it("KIT-09 opens a finished conversation on what was asked, what started it, how it ended, its time, what came out and its estimated cost", async () => {
    const stigmer = client(async () => NIGHTLY);
    renderSummary(stigmer, { routineHref: (routine) => `/library/routines/demo/${routine.metadata?.slug}` });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nightly billing check");
    const link = await screen.findByRole("link", { name: "Nightly billing check" });
    expect(link.getAttribute("href")).toBe("/library/routines/demo/nightly-billing-check");
    expect(screen.getByText("Done").className).toContain("--stgm-status-ready");
    const facts = link.parentElement!.textContent!;
    expect(facts).toBe("· Started by routine Nightly billing check · 1m 14s · 2 files made · 1 change · about $0.42, estimated");
    expect(stigmer.routine.get).toHaveBeenCalledWith(scenarios.finished.session!.status!.routineId);
  });

  it("names the routine without a link when the host gives no routine page", async () => {
    renderSummary(client(async () => NIGHTLY));
    expect(await screen.findByText("Nightly billing check", { selector: "span" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says only that a routine started it when the server refuses the reader the routine", async () => {
    renderSummary(client(async () => Promise.reject(new Error("permission denied"))));
    expect(await screen.findByText(/^Started by a routine/)).toBeTruthy();
  });

  it("never sends a guest the routine read", () => {
    const stigmer = client(async () => NIGHTLY);
    renderSummary(stigmer, { readsRoutine: false });
    expect(stigmer.routine.get).not.toHaveBeenCalled();
    expect(screen.getByText(/^Started by a routine/)).toBeTruthy();
  });

  it("shows no money where cost is not shown", () => {
    renderSummary(client(async () => NIGHTLY), { showCost: false });
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("says an estimate under a cent is under a cent, never $0.00", () => {
    const usage = scenarios.finished.runs.find((run) => run.status?.streamingUsage !== undefined)!.status!.streamingUsage!;
    const before = usage.estimatedCostUsd;
    usage.estimatedCostUsd = 0.0004;
    try {
      renderSummary(client(async () => NIGHTLY));
      expect(screen.getByText(/under \$0\.01, estimated$/)).toBeTruthy();
      expect(screen.queryByText(/\$0\.00/)).toBeNull();
    } finally {
      usage.estimatedCostUsd = before;
    }
  });

  it("says a channel conversation came from a channel", () => {
    const session = samples.session();
    session.metadata!.labels = { [CHANNEL_SESSION_LABELS.channelId]: "chn_1", [CHANNEL_SESSION_LABELS.conversationKey]: "C1:1.0" };
    const completed = scenarios.completed;
    renderSummary(client(async () => NIGHTLY), { session }, completed);
    expect(screen.getByText(/^From a channel conversation · /)).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("says a turn that did not finish in the red pill, with its facts and no origin when nothing started it", () => {
    renderSummary(client(async () => NIGHTLY), {}, scenarios.failed);
    const meta = metaLine();
    expect(screen.getByText("Didn't finish").className).toContain("--stgm-status-failed");
    expect(meta.textContent).not.toContain("Started by");
    expect(meta.textContent).not.toContain(" · ");
  });

  it("says one file made in the singular, and a File it did not return as a change", () => {
    const finished = scenarios.finished;
    renderSummary(client(async () => NIGHTLY), { readsRoutine: false, files: finished.files.slice(0, 1) });
    expect(metaLine().textContent).toBe("Done· Started by a routine · 1m 14s · 1 file made · 2 changes · about $0.42, estimated");
  });

  it("says a Plan-mode turn's plan as a plan, after the files made, never as a file made", () => {
    const finished = scenarios.finished;
    const run = clone(RunSchema, finished.runs[0]!);
    run.spec!.interactionMode = InteractionMode.PLAN;
    const plan = samples.outputFile("fix-rounding_a1b2c3d4.plan.md", { runId: run.metadata!.id, sizeBytes: 312n });
    renderSummary(client(async () => NIGHTLY), { readsRoutine: false, runs: [run], files: [plan, ...finished.files] });
    expect(metaLine().textContent).toBe("Done· Started by a routine · 1m 14s · 2 files made · 1 plan · 1 change · about $0.42, estimated");
  });

  it("KIT-05 says while a turn works that it is Working, for how long, and how far its to-do list has got, ticking each second", () => {
    freezeClock(SCENARIO_CLOCK);
    renderSummary(client(async () => NIGHTLY), {}, scenarios.busy);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Fix invoice rounding");
    const pill = screen.getByText("Working · 1m 30s");
    expect(pill.className).toContain("--stgm-status-running");
    expect(metaLine().textContent).toBe("Working · 1m 30s· 2 of 5 to-dos done");
    expect(screen.queryByText(/Started by|estimated/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("Working · 1m 31s")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(screen.getByText("Working · 2m 00s")).toBeTruthy();
  });

  it("KIT-05 counts the steps settled when the agent keeps no list, and names none before one settles", () => {
    const start = Date.parse(samples.turn().userMessage!.processedAt);
    freezeClock(start + 12_000);
    const settled = { name: "read_file", input: { path: "a.ts" }, result: "ok" };
    const open = { name: "execute", input: { command: "npm test" } };
    const { unmount } = renderSummary(client(async () => NIGHTLY), {}, oneTurn(samples.turn({ phase: "running", reply: "", tools: [settled, open] })));
    expect(metaLine().textContent).toBe("Working · 12s· 1 step");
    unmount();

    const two = renderSummary(
      client(async () => NIGHTLY),
      {},
      oneTurn(samples.turn({ phase: "running", reply: "", tools: [settled, { ...settled, name: "grep", input: { pattern: "x" } }, open] })),
    );
    expect(metaLine().textContent).toBe("Working · 12s· 2 steps");
    two.unmount();

    renderSummary(client(async () => NIGHTLY), {}, oneTurn(samples.turn({ phase: "running", reply: "", tools: [open] })));
    expect(metaLine().textContent).toBe("Working · 12s");
  });

  it("says Starting before the turn runs, its time counted from the message once a second has passed", () => {
    const sent = samples.userMessageEvent("Fix the rounding", { processedAt: sampleInstant(0) });
    const turn = samples.fold([sent]).turns[0]!;
    freezeClock(sampleInstant(400));
    renderSummary(client(async () => NIGHTLY), {}, oneTurn(turn));
    expect(metaLine().textContent).toBe("Starting");
    cleanup();
    freezeClock(sampleInstant(20_000));
    renderSummary(client(async () => NIGHTLY), {}, oneTurn(turn));
    expect(metaLine().textContent).toBe("Starting · 20s");
  });

  it("KIT-08 says the turn waits for the reader in the amber pill, with its time", () => {
    freezeClock(SCENARIO_CLOCK);
    renderSummary(client(async () => NIGHTLY), {}, scenarios.approval);
    const pill = screen.getByText(/^Waiting for you · /);
    expect(pill.className).toContain("--stgm-status-degraded");
  });

  it("tells a reader who cannot answer that the turn waits for an answer", () => {
    freezeClock(SCENARIO_CLOCK);
    renderSummary(client(async () => NIGHTLY), { decides: false }, scenarios.approval);
    expect(screen.getByText(/^Waiting for an answer · /)).toBeTruthy();
    expect(screen.queryByText(/Waiting for you/)).toBeNull();
  });

  it("stops ticking once the turn ends", () => {
    freezeClock(SCENARIO_CLOCK);
    const spy = vi.spyOn(globalThis, "clearInterval");
    const stigmer = client(async () => NIGHTLY);
    const { rerender } = renderSummary(stigmer, {}, scenarios.busy);
    rerender(
      <StigmerContext.Provider value={stigmer}>
        <SessionSummary
          session={scenarios.completed.session!}
          turns={scenarios.completed.fold.turns}
          runs={scenarios.completed.runs}
          files={[]}
          showCost
        />
      </StigmerContext.Provider>,
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(screen.getByText("Done")).toBeTruthy();
  });
});
