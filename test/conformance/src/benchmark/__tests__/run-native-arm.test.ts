// Unit arms for the run's native arm, with no stack: the registry is a stubbed
// fetch and the API clients a fake whose organization create refuses.
// Domain: conformance benchmark (one native model per run).
//
// Pinned: an own-endpoint native model (`openai:<name>`) passes the registry
// pre-check without a row, as on the server, while a catalog id the registry
// does not carry is still refused; the report records the native arm's
// model, the endpoint the run read, the API its name selects, and a cost
// basis of "catalog" only when the registry has a priced row for it. The
// summary names the arm, and marks a default-rate native cost with a line
// saying it is not a price, leaving Cursor's and an unobserved cost unmarked.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { PARITY_MODEL, type CellPlan } from "../cells";
import { summarize, type BackgroundReadings, type BenchmarkReport } from "../report";
import { renderSummary, runBenchmark, type BenchmarkStack, type RunOptions } from "../run";
import { makeSample } from "./sample-fixture";

const OPTIONS: RunOptions = {
  reps: 1,
  qualityReps: 1,
  git: { head_sha: "abc1234", main_sha: "abc1234" },
  titlingSuppressed: true,
  nativeEndpoint: "generativelanguage.googleapis.com",
  shellBackground: "on",
};

function refusingStack(): BenchmarkStack {
  const clients = {
    organizationCommand: { create: () => Promise.reject(new Error("organizations are closed")) },
  } as unknown as ConformanceClients;
  return { clients, serverBaseUrl: "http://stack.invalid" } as unknown as BenchmarkStack;
}

const io = { now: () => Date.UTC(2026, 9, 23), log: () => undefined };

function stubRegistry(models: Record<string, unknown>[]): void {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ models }))));
}

function qualityPlan(nativeModel: string): CellPlan {
  return {
    nativeModel,
    cells: [],
    judge: false,
    quality: [{ id: "quality/deep-agent", harness: "deep-agent", modelRequested: nativeModel }],
    refused: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runBenchmark's native arm", () => {
  it("admits an own-endpoint model without a registry row, and records its endpoint, API and default-rate basis", async () => {
    stubRegistry([{ id: PARITY_MODEL["deep-agent"], harness: "native", pricing: { inputPricePerMillion: 3 } }]);
    const report = await runBenchmark(refusingStack(), qualityPlan("openai:gemini-3-pro"), OPTIONS, io);
    expect(report.refused).toEqual([]);
    expect(report.quality?.targets).toEqual(["native/openai:gemini-3-pro"]);
    expect(report.models).toEqual({
      parity_native: "openai:gemini-3-pro",
      parity_cursor: PARITY_MODEL.cursor,
      judge_requested: PARITY_MODEL["deep-agent"],
      native_endpoint: "generativelanguage.googleapis.com",
      native_api: "chat-completions",
      native_cost_basis: "default-rate",
    });
  });

  it("still refuses a catalog id the registry does not carry for native", async () => {
    stubRegistry([{ id: PARITY_MODEL["deep-agent"], harness: "native" }]);
    const report = await runBenchmark(refusingStack(), qualityPlan("gpt-4o"), OPTIONS, io);
    expect(report.refused).toEqual([{ cell: "quality/deep-agent", reason: "model not in registry for harness" }]);
    expect(report.quality).toBeNull();
  });

  it("reads the cost basis from a priced row only: a catalog row without pricing is default-rate too", async () => {
    stubRegistry([{ id: PARITY_MODEL["deep-agent"], harness: "native", pricing: { inputPricePerMillion: 3 } }]);
    const priced = await runBenchmark(refusingStack(), { ...qualityPlan(PARITY_MODEL["deep-agent"]), quality: [] }, OPTIONS, io);
    expect(priced.models.native_cost_basis).toBe("catalog");
    expect(priced.models.native_api).toBe("messages");
    stubRegistry([{ id: PARITY_MODEL["deep-agent"], harness: "native" }]);
    const unpriced = await runBenchmark(refusingStack(), { ...qualityPlan(PARITY_MODEL["deep-agent"]), quality: [] }, OPTIONS, io);
    expect(unpriced.models.native_cost_basis).toBe("default-rate");
  });
});

describe("renderSummary's native arm", () => {
  function report(basis: "catalog" | "default-rate"): BenchmarkReport {
    return {
      schema_version: 9,
      timestamp: "2026-10-23T00:00:00Z",
      git: { head_sha: "abc", main_sha: "abc" },
      host: { platform: "darwin/arm64", node: "v22.22.1" },
      methodology: {
        reps: 1,
        quality_reps: 1,
        warmup_discarded: true,
        cold: "first-call-of-run-per-harness-model-and-agent",
        titling_suppressed: true,
        file_review: "approved-at-review-ready",
        shell_background: "on",
      },
      models: {
        parity_native: "openai:gpt-5.5",
        parity_cursor: PARITY_MODEL.cursor,
        judge_requested: PARITY_MODEL["deep-agent"],
        native_endpoint: "api.openai.com",
        native_api: "chat-completions",
        native_cost_basis: basis,
      },
      comparisons: [
        {
          scenario: "report-parity-simple",
          prompts: ["Reply with exactly: hello"],
          mode: "parity",
          session_shape: "fresh-per-execution",
          agent: "bare",
          native: summarize("deep-agent", makeSample(), [makeSample({ measures: { estimated_cost_micros: 1234 } })], null),
          cursor: summarize("cursor", makeSample(), [makeSample({ measures: { estimated_cost_micros: 999 } })], null),
        },
        {
          scenario: "report-parity-medium",
          prompts: ["Explain in one sentence what a hash table is."],
          mode: "parity",
          session_shape: "fresh-per-execution",
          agent: "bare",
          native: summarize("deep-agent", makeSample(), [makeSample({ outcome: "failed" })], null),
        },
      ],
      quality: null,
      refused: [],
    };
  }

  it("names the arm, and marks a default-rate native cost and only that, with the line that says why", () => {
    const lines = renderSummary(report("default-rate")).split("\n");
    expect(lines[0]).toBe("Native arm: openai:gpt-5.5 at api.openai.com, chat-completions API, cost basis default-rate");
    expect(lines.find((line) => line.startsWith("| report-parity-simple | deep-agent"))).toContain("| 1234* |");
    expect(lines.find((line) => line.startsWith("| report-parity-simple | cursor"))).toContain("| 999 |");
    expect(lines.find((line) => line.startsWith("| report-parity-medium | deep-agent")), "no cost observed, nothing to mark").toContain("| n/a |");
    expect(lines).toContain(
      "* openai:gpt-5.5 has no priced catalog row: its cost is the runner's default rate, not a price; price it from the samples' tokens at the provider's rate.",
    );
  });

  it("adds the background table, headed by the arm, over the samples that ran, and none when no sample carries readings", () => {
    expect(renderSummary(report("catalog")), "no readings, no table").not.toContain("Background commands");
    const readings = (starts: number, polls: number, orphans: number): BackgroundReadings => ({
      starts,
      endings: { exited: starts, timed_out: 0, stopped_by_agent: 0, stopped_by_person: 0, stopped_by_approval: 0, stopped_by_turn: 0, failed_to_start: 0, running: 0 },
      worked_while_running_ms: starts > 0 ? 12_000 : 0,
      polls,
      sleeps: 0,
      self_backgrounded: starts > 0 ? 0 : 1,
      foreground_timeouts: 0,
      waits: starts,
      wait_ms: 0,
      reminders: starts,
      gated_while_running: 0,
      orphans,
    });
    const off = report("catalog");
    off.methodology.shell_background = "off";
    off.comparisons[0]!.native = summarize(
      "deep-agent",
      makeSample(),
      [makeSample({ background: readings(1, 0, 0), task_done: true }), makeSample({ background: readings(0, 1, 1), task_done: false }), makeSample({ background: null, outcome: "failed" })],
      null,
    );
    const lines = renderSummary(off).split("\n");
    expect(lines).toContain("Background commands (off), over the samples that ran:");
    expect(lines).toContain("| report-parity-simple | deep-agent | 1/2 | 1 | 1 (max 1) | 12000 | 1 | 1 | 1 | 0 | 0 | 1 | 1/2 |");
    expect(lines.filter((line) => line.startsWith("| report-parity-medium | deep-agent")), "a cell without readings has its main row alone").toHaveLength(1);
  });

  it("marks nothing on a catalog-priced arm", () => {
    const text = renderSummary(report("catalog"));
    expect(text).toContain("| 1234 |");
    expect(text).not.toContain("*");
  });
});
