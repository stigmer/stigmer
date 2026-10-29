// Unit arms for the run's Stigmer arm, with no stack: the registry is a stubbed
// fetch and the API clients a fake whose organization create refuses.
// Domain: conformance benchmark (one Stigmer-harness model per run).
//
// Pinned: an own-endpoint Stigmer-harness model (`openai:<name>`) passes the registry
// pre-check without a row, as on the server, while a catalog id the registry
// does not carry is still refused; the report records the Stigmer arm's
// model, the endpoint the run read, the API its name selects, and a cost
// basis of "catalog" only when the registry has a priced row for it, and the
// runner's marker counts from every runner log in the run's directory. The
// summary names the arm, the measured code beside the instrument and the
// marker counts, and marks a default-rate Stigmer cost with a line saying it
// is not a price, leaving Claude's and an unobserved cost unmarked,
// and lists every side a cell ran on. A Claude target passes the registry
// pre-check only on a Claude row, and its eval target is `claude/<model>`;
// the report records every arm's model, the Stigmer harness's from the plan. A stack
// root is the instrument's own unless `--stack` names a stigmer checkout, and
// a path that is none is refused by name.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { PARITY_MODEL, type CellPlan } from "../cells";
import { emptyMarkers } from "../log-markers";
import { summarize, type BackgroundReadings, type BenchmarkReport } from "../report";
import { renderSummary, resolveStackRoot, runBenchmark, type BenchmarkStack, type RunOptions } from "../run";
import { makeSample } from "./sample-fixture";

const OPTIONS: RunOptions = {
  reps: 1,
  qualityReps: 1,
  git: { head_sha: "abc1234", main_sha: "abc1234", code_sha: "def5678" },
  titlingSuppressed: true,
  stigmerEndpoint: "generativelanguage.googleapis.com",
  shellBackground: "on",
};

/** A stack whose organization create refuses; its run directory holds `logs`, by file name. */
function refusingStack(logs: Record<string, string> = {}): BenchmarkStack {
  const clients = {
    organizationCommand: { create: () => Promise.reject(new Error("organizations are closed")) },
  } as unknown as ConformanceClients;
  const runDir = mkdtempSync(join(tmpdir(), "run-stigmer-arm-"));
  for (const [name, text] of Object.entries(logs)) writeFileSync(join(runDir, name), text);
  return { clients, serverBaseUrl: "http://stack.invalid", runDir } as unknown as BenchmarkStack;
}

const io = { now: () => Date.UTC(2026, 9, 23), log: () => undefined };

function stubRegistry(models: Record<string, unknown>[]): void {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ models }))));
}

function qualityPlan(stigmerModel: string): CellPlan {
  return {
    stigmerModel,
    cells: [],
    judge: false,
    quality: [{ id: "quality/stigmer", harness: "stigmer", modelRequested: stigmerModel }],
    refused: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runBenchmark's Stigmer arm", () => {
  it("admits an own-endpoint model without a registry row, and records its endpoint, API and default-rate basis", async () => {
    stubRegistry([{ id: PARITY_MODEL.stigmer, harness: "stigmer", pricing: { inputPricePerMillion: 3 } }]);
    const report = await runBenchmark(refusingStack(), qualityPlan("openai:gemini-3-pro"), OPTIONS, io);
    expect(report.refused).toEqual([]);
    expect(report.quality?.targets).toEqual(["stigmer/openai:gemini-3-pro"]);
    expect(report.models).toEqual({
      parity: { stigmer: "openai:gemini-3-pro", claude: PARITY_MODEL.claude },
      judge_requested: PARITY_MODEL.stigmer,
      stigmer_endpoint: "generativelanguage.googleapis.com",
      stigmer_api: "chat-completions",
      stigmer_cost_basis: "default-rate",
    });
  });

  it("checks a Claude target against the registry's Claude row, and names it claude/<model>", async () => {
    const plan: CellPlan = { ...qualityPlan(PARITY_MODEL.stigmer), quality: [{ id: "quality/claude", harness: "claude", modelRequested: PARITY_MODEL.claude }] };
    stubRegistry([{ id: PARITY_MODEL.stigmer, harness: "stigmer" }]);
    const stigmerRowOnly = await runBenchmark(refusingStack(), plan, OPTIONS, io);
    expect(stigmerRowOnly.refused, "a Stigmer row is not the Claude engine's").toEqual([{ cell: "quality/claude", reason: "model not in registry for harness" }]);
    stubRegistry([
      { id: PARITY_MODEL.stigmer, harness: "stigmer" },
      { id: PARITY_MODEL.claude, harness: "claude" },
    ]);
    const report = await runBenchmark(refusingStack(), plan, OPTIONS, io);
    expect(report.refused).toEqual([]);
    expect(report.quality?.targets).toEqual([`claude/${PARITY_MODEL.claude}`]);
  });

  it("still refuses a catalog id the registry does not carry for Stigmer", async () => {
    stubRegistry([{ id: PARITY_MODEL.stigmer, harness: "stigmer" }]);
    const report = await runBenchmark(refusingStack(), qualityPlan("gpt-4o"), OPTIONS, io);
    expect(report.refused).toEqual([{ cell: "quality/stigmer", reason: "model not in registry for harness" }]);
    expect(report.quality).toBeNull();
  });

  it("reads the cost basis from a priced row only: a catalog row without pricing is default-rate too", async () => {
    stubRegistry([{ id: PARITY_MODEL.stigmer, harness: "stigmer", pricing: { inputPricePerMillion: 3 } }]);
    const priced = await runBenchmark(refusingStack(), { ...qualityPlan(PARITY_MODEL.stigmer), quality: [] }, OPTIONS, io);
    expect(priced.models.stigmer_cost_basis).toBe("catalog");
    expect(priced.models.stigmer_api).toBe("messages");
    stubRegistry([{ id: PARITY_MODEL.stigmer, harness: "stigmer" }]);
    const unpriced = await runBenchmark(refusingStack(), { ...qualityPlan(PARITY_MODEL.stigmer), quality: [] }, OPTIONS, io);
    expect(unpriced.models.stigmer_cost_basis).toBe("default-rate");
  });

  it("counts the runner's markers over every runner log of the run, and records the measured code", async () => {
    stubRegistry([{ id: PARITY_MODEL.stigmer, harness: "stigmer" }]);
    const stack = refusingStack({
      "runner.log": "[REPO-INSTRUCTIONS] root=1 chars=171 cut=0\n[TRUNCATED] tool=read_file original_chars=49434 limit=30000 chars_truncated=19434 kept=yes\n",
      "runner-2.log": "[REPO-INSTRUCTIONS] root=1 chars=171 cut=0\n",
    });
    const report = await runBenchmark(stack, { ...qualityPlan(PARITY_MODEL.stigmer), quality: [] }, OPTIONS, io);
    expect(report.git.code_sha).toBe("def5678");
    expect(report.runner_log.files).toEqual(["runner.log", "runner-2.log"]);
    expect(report.runner_log.repo_instructions).toEqual({ root: 2, nested: 0 });
    expect(report.runner_log.truncated).toEqual({ kept_yes: 1, kept_no: 0, kept_absent: 0, by_tool: { read_file: 1 } });
  });
});

describe("resolveStackRoot", () => {
  const checkout = (path: string): boolean => path === "/work/before/backend/services/runner";

  it("is the instrument's own root when no stack is named", () => {
    expect(resolveStackRoot(undefined, "/work/after", checkout)).toBe("/work/after");
  });

  it("is the named checkout, resolved, when it holds a runner", () => {
    expect(resolveStackRoot("/work/before/", "/work/after", checkout)).toBe("/work/before");
    expect(resolveStackRoot("../before", "/work/after", (path) => path === resolve("../before", "backend/services/runner"))).toBe(resolve("../before"));
  });

  it("refuses, by name, a path that is not a stigmer checkout", () => {
    expect(() => resolveStackRoot("/work/elsewhere", "/work/after", checkout)).toThrow(
      "--stack /work/elsewhere is not a stigmer checkout: it has no backend/services/runner",
    );
  });

  it("reads the file system when no reader is given", () => {
    expect(() => resolveStackRoot(tmpdir(), "/work/after")).toThrow("is not a stigmer checkout");
    const instrument = resolve(import.meta.dirname, "../../../../..");
    expect(resolveStackRoot(instrument, "/work/after")).toBe(instrument);
  });
});

describe("renderSummary's Stigmer arm", () => {
  function report(basis: "catalog" | "default-rate"): BenchmarkReport {
    return {
      schema_version: 12,
      timestamp: "2026-10-23T00:00:00Z",
      git: { head_sha: "abc", main_sha: "abc", code_sha: "abc" },
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
        parity: { ...PARITY_MODEL, stigmer: "openai:gpt-5.5" },
        judge_requested: PARITY_MODEL.stigmer,
        stigmer_endpoint: "api.openai.com",
        stigmer_api: "chat-completions",
        stigmer_cost_basis: basis,
      },
      comparisons: [
        {
          scenario: "report-parity-simple",
          prompts: ["Reply with exactly: hello"],
          mode: "parity",
          session_shape: "fresh-per-execution",
          agent: "bare",
          sides: {
            stigmer: summarize("stigmer", makeSample(), [makeSample({ measures: { estimated_cost_micros: 1234 } })], null),
            claude: summarize("claude", makeSample(), [makeSample({ measures: { estimated_cost_micros: 2468 } })], null),
          },
          cost_ratio: { claude: 2 },
        },
        {
          scenario: "report-parity-medium",
          prompts: ["Explain in one sentence what a hash table is."],
          mode: "parity",
          session_shape: "fresh-per-execution",
          agent: "bare",
          sides: { stigmer: summarize("stigmer", makeSample(), [makeSample({ outcome: "failed" })], null) },
          cost_ratio: {},
        },
      ],
      quality: null,
      refused: [],
      runner_log: { ...emptyMarkers(), files: ["runner.log"], hook_failures: 2 },
    };
  }

  it("names the arm, the code and the runner log, and marks a default-rate Stigmer cost and only that, with the line that says why", () => {
    const lines = renderSummary(report("default-rate")).split("\n");
    expect(lines[0]).toBe("Stigmer arm: openai:gpt-5.5 at api.openai.com, chat-completions API, cost basis default-rate");
    expect(lines[1]).toBe("Code: abc (the instrument's own)");
    expect(lines[2]).toMatch(/^Runner log: edits repaired 0; .*; hook failures 2; from runner\.log$/);
    expect(lines.find((line) => line.startsWith("| report-parity-simple | stigmer"))).toContain("| 1234* |");
    expect(lines.find((line) => line.startsWith("| report-parity-simple | claude")), "Claude's cost is the runner's catalog price, unmarked").toContain("| 2468 |");
    expect(lines.find((line) => line.startsWith("| report-parity-medium | stigmer")), "no cost observed, nothing to mark").toContain("| n/a |");
    expect(lines).toContain(
      "* openai:gpt-5.5 has no priced catalog row: its cost is the runner's default rate, not a price; price it from the samples' tokens at the provider's rate.",
    );
  });

  it("names the measured code beside the instrument that measured it", () => {
    const measured = report("catalog");
    measured.git.code_sha = "b997addb91";
    expect(renderSummary(measured).split("\n")[1]).toBe("Code: b997addb91, measured by the instrument at abc");
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
    off.comparisons[0]!.sides.stigmer = summarize(
      "stigmer",
      makeSample(),
      [makeSample({ background: readings(1, 0, 0), task_done: true }), makeSample({ background: readings(0, 1, 1), task_done: false }), makeSample({ background: null, outcome: "failed" })],
      null,
    );
    const lines = renderSummary(off).split("\n");
    expect(lines).toContain("Background commands (off), over the samples that ran:");
    expect(lines).toContain("| report-parity-simple | stigmer | 1/2 | 1 | 1 (max 1) | 12000 | 1 | 1 | 1 | 0 | 0 | 1 | 1/2 |");
    expect(lines.filter((line) => line.startsWith("| report-parity-medium | stigmer")), "a cell without readings has its main row alone").toHaveLength(1);
  });

  it("marks nothing on a catalog-priced arm", () => {
    const text = renderSummary(report("catalog"));
    expect(text).toContain("| 1234 |");
    expect(text).not.toContain("*");
  });
});
