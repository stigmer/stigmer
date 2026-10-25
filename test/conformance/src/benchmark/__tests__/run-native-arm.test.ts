// Unit arms for the run's native arm, with no stack: the registry is a stubbed
// fetch and the API clients a fake whose organization create refuses.
// Domain: conformance benchmark (one native model per run).
//
// Pinned: an own-endpoint native model (`openai:<name>`) passes the registry
// pre-check without a row, as on the server, while a catalog id the registry
// does not carry is still refused; the report records the native arm's
// model, the endpoint the run read, the API its name selects, and a cost
// basis of "catalog" only when the registry has a priced row for it, and the
// runner's marker counts from every runner log in the run's directory. The
// summary names the arm, the measured code beside the instrument and the
// marker counts, and marks a default-rate native cost with a line saying it
// is not a price, leaving Cursor's and an unobserved cost unmarked. A stack
// root is the instrument's own unless `--stack` names a stigmer checkout, and
// a path that is none is refused by name.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { PARITY_MODEL, type CellPlan } from "../cells";
import { emptyMarkers } from "../log-markers";
import { summarize, type BenchmarkReport } from "../report";
import { renderSummary, resolveStackRoot, runBenchmark, type BenchmarkStack, type RunOptions } from "../run";
import { makeSample } from "./sample-fixture";

const OPTIONS: RunOptions = {
  reps: 1,
  qualityReps: 1,
  git: { head_sha: "abc1234", main_sha: "abc1234", code_sha: "def5678" },
  titlingSuppressed: true,
  nativeEndpoint: "generativelanguage.googleapis.com",
};

/** A stack whose organization create refuses; its run directory holds `logs`, by file name. */
function refusingStack(logs: Record<string, string> = {}): BenchmarkStack {
  const clients = {
    organizationCommand: { create: () => Promise.reject(new Error("organizations are closed")) },
  } as unknown as ConformanceClients;
  const runDir = mkdtempSync(join(tmpdir(), "run-native-arm-"));
  for (const [name, text] of Object.entries(logs)) writeFileSync(join(runDir, name), text);
  return { clients, serverBaseUrl: "http://stack.invalid", runDir } as unknown as BenchmarkStack;
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

  it("counts the runner's markers over every runner log of the run, and records the measured code", async () => {
    stubRegistry([{ id: PARITY_MODEL["deep-agent"], harness: "native" }]);
    const stack = refusingStack({
      "runner.log": "[REPO-INSTRUCTIONS] root=1 chars=171 cut=0\n[TRUNCATED] tool=read_file original_chars=49434 limit=30000 chars_truncated=19434 kept=yes\n",
      "runner-2.log": "[REPO-INSTRUCTIONS] root=1 chars=171 cut=0\n",
    });
    const report = await runBenchmark(stack, { ...qualityPlan(PARITY_MODEL["deep-agent"]), quality: [] }, OPTIONS, io);
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

describe("renderSummary's native arm", () => {
  function report(basis: "catalog" | "default-rate"): BenchmarkReport {
    return {
      schema_version: 9,
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
      runner_log: { ...emptyMarkers(), files: ["runner.log"], hook_failures: 2 },
    };
  }

  it("names the arm, the code and the runner log, and marks a default-rate native cost and only that, with the line that says why", () => {
    const lines = renderSummary(report("default-rate")).split("\n");
    expect(lines[0]).toBe("Native arm: openai:gpt-5.5 at api.openai.com, chat-completions API, cost basis default-rate");
    expect(lines[1]).toBe("Code: abc (the instrument's own)");
    expect(lines[2]).toMatch(/^Runner log: edits repaired 0; .*; hook failures 2; from runner\.log$/);
    expect(lines.find((line) => line.startsWith("| report-parity-simple | deep-agent"))).toContain("| 1234* |");
    expect(lines.find((line) => line.startsWith("| report-parity-simple | cursor"))).toContain("| 999 |");
    expect(lines.find((line) => line.startsWith("| report-parity-medium | deep-agent")), "no cost observed, nothing to mark").toContain("| n/a |");
    expect(lines).toContain(
      "* openai:gpt-5.5 has no priced catalog row: its cost is the runner's default rate, not a price; price it from the samples' tokens at the provider's rate.",
    );
  });

  it("names the measured code beside the instrument that measured it", () => {
    const measured = report("catalog");
    measured.git.code_sha = "b997addb91";
    expect(renderSummary(measured).split("\n")[1]).toBe("Code: b997addb91, measured by the instrument at abc");
  });

  it("marks nothing on a catalog-priced arm", () => {
    const text = renderSummary(report("catalog"));
    expect(text).toContain("| 1234 |");
    expect(text).not.toContain("*");
  });
});
