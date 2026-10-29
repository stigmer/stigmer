/**
 * Proves the finished conversation's summary (../SessionSummary.tsx): what
 * was asked, who or what started it (a routine by name, linked through the
 * host; "Started by a routine" for a reader the server refuses the routine
 * to, and for a guest, who is never sent the read; a channel conversation by
 * where it came from), how it ended, its time, what came out, and the
 * estimated cost only where cost is shown; while a turn works, only its
 * first line.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { samples, scenarios } from "../../test";
import { CHANNEL_SESSION_LABELS } from "../channelOrigin";
import { SessionSummary } from "../SessionSummary";

afterEach(cleanup);

const NIGHTLY = create(RoutineSchema, { metadata: { id: "rtn_1", name: "Nightly billing check", slug: "nightly-billing-check", org: "demo" } });

function client(get: (id: string) => Promise<Routine>) {
  return { routine: { get: vi.fn(get) } } as unknown as Stigmer & { routine: { get: ReturnType<typeof vi.fn> } };
}

function renderSummary(
  stigmer: ReturnType<typeof client>,
  props: Partial<React.ComponentProps<typeof SessionSummary>> = {},
  scenario = scenarios.finished,
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
    const facts = link.parentElement!.textContent!;
    expect(facts).toContain("Started by routine");
    expect(facts).toContain("Finished · 1 min 14 s · 2 files made · 1 change · about $0.42, estimated");
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
    expect(screen.getByText(/^From a channel conversation · Finished/)).toBeTruthy();
  });

  it("keeps only its first line while a turn works", () => {
    const busy = scenarios.busy;
    renderSummary(client(async () => NIGHTLY), {}, busy);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Fix invoice rounding");
    expect(screen.queryByText(/Finished|Working/)).toBeNull();
  });
});
