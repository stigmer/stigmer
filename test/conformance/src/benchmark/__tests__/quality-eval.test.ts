// Unit arms for the benchmark's quality arm as the run drives it, with no
// stack: the registry is a stubbed fetch and the API clients a fake whose
// organization create refuses.
// Domain: conformance benchmark (the quality arm).
//
// Pinned: the run refuses a quality target whose model the registry does not
// carry for its harness, and runs one eval for the rest; a failure to push the
// plugin lands in the report by stage, never thrown; a plan with no quality
// target leaves `quality` null; a Claude target is named `claude/<model>` and
// checked against the Claude engine's registry row. runQualityEval itself, over fake clients:
// each stage's failure lands by stage with what it cleans up, a failed eval
// keeps its document beside the failure, and a finished one keeps its
// document alone. The summary ends with the quality table, read
// from the result document as JSON: one row per case and target (a score that
// is not a number reads "n/a"), then the cases not run, with their target
// where the document names one, then the eval's failure.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { JUDGE_MODEL, PARITY_MODEL, type CellPlan } from "../cells";
import { create } from "@bufbuild/protobuf";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunPhase } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { renderQuality, runQualityEval } from "../quality-eval";
import type { QualityEval } from "../report";
import { renderSummary, runBenchmark, type BenchmarkStack, type RunOptions } from "../run";

const REGISTRY = {
  models: [
    { id: PARITY_MODEL["deep-agent"], harness: "native" },
    { id: PARITY_MODEL.cursor, harness: "cursor" },
    { id: PARITY_MODEL.claude, harness: "claude" },
  ],
};

const OPTIONS: RunOptions = {
  reps: 1,
  qualityReps: 3,
  git: { head_sha: "abc1234", main_sha: "abc1234", code_sha: "abc1234" },
  titlingSuppressed: true,
  nativeEndpoint: "api.anthropic.com",
  shellBackground: "on",
};

/** A stack whose only reachable seam is the organization create, which refuses. */
function refusingStack(): BenchmarkStack {
  const clients = {
    organizationCommand: { create: () => Promise.reject(new Error("organizations are closed")) },
  } as unknown as ConformanceClients;
  return { clients, serverBaseUrl: "http://stack.invalid", runDir: mkdtempSync(join(tmpdir(), "quality-eval-run-")) } as unknown as BenchmarkStack;
}

function quietIo(): { now: () => number; log: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { now: () => Date.UTC(2026, 9, 11), log: (line) => lines.push(line), lines };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runBenchmark's quality arm", () => {
  it("refuses a target the registry does not carry, runs one eval for the rest, and records a failed push by stage", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(REGISTRY))));
    const plan: CellPlan = {
      nativeModel: PARITY_MODEL["deep-agent"],
      cells: [],
      judge: false,
      quality: [
        { id: "quality/deep-agent", harness: "deep-agent", modelRequested: PARITY_MODEL["deep-agent"] },
        { id: "quality/cursor", harness: "cursor", modelRequested: "not-a-cursor-model" },
      ],
      refused: [],
    };
    const io = quietIo();

    const report = await runBenchmark(refusingStack(), plan, OPTIONS, io);

    expect(report.refused).toEqual([{ cell: "quality/cursor", reason: "model not in registry for harness" }]);
    expect(report.quality).toEqual({
      plugin: "",
      eval_id: "",
      targets: [`native/${PARITY_MODEL["deep-agent"]}`],
      judge_model: JUDGE_MODEL,
      runs: 3,
      document: null,
      failure: { stage: "create", message: "push the working agent's plugin: organizations are closed" },
    });
    expect(io.lines).toEqual([
      "quality: one eval run, quality/deep-agent, 3 tries per case",
      "quality: create: push the working agent's plugin: organizations are closed",
    ]);
    expect(renderSummary(report).split("\n").slice(-7)).toEqual([
      "",
      `Quality: eval run (not created), judge ${JUDGE_MODEL}, 3 tries per case`,
      "",
      "Quality eval run: create: push the working agent's plugin: organizations are closed",
      "",
      "Refused:",
      "- quality/cursor: model not in registry for harness",
    ]);
  });

  it("names a Claude target claude/<model>, beside native's, in one eval", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(REGISTRY))));
    const plan: CellPlan = {
      nativeModel: PARITY_MODEL["deep-agent"],
      cells: [],
      judge: false,
      quality: [
        { id: "quality/deep-agent", harness: "deep-agent", modelRequested: PARITY_MODEL["deep-agent"] },
        { id: "quality/claude", harness: "claude", modelRequested: PARITY_MODEL.claude },
      ],
      refused: [],
    };
    const report = await runBenchmark(refusingStack(), plan, OPTIONS, quietIo());
    expect(report.refused).toEqual([]);
    expect(report.quality?.targets).toEqual([`native/${PARITY_MODEL["deep-agent"]}`, `claude/${PARITY_MODEL.claude}`]);
  });

  it("leaves quality null when no target is planned", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(REGISTRY))));
    const report = await runBenchmark(refusingStack(), { nativeModel: PARITY_MODEL["deep-agent"], cells: [], quality: [], judge: false, refused: [] }, OPTIONS, quietIo());
    expect(report.quality).toBeNull();
  });
});

describe("renderQuality", () => {
  it("renders nothing without an eval", () => {
    expect(renderQuality(null)).toEqual([]);
  });

  it("reads one row per case and target, the cases not run, and the failure", () => {
    const quality: QualityEval = {
      plugin: "working-agent",
      eval_id: "evr_1",
      targets: ["native/claude-sonnet-4.6"],
      judge_model: JUDGE_MODEL,
      runs: 2,
      document: {
        plugins: [
          {
        targets: [
          {
            label: "native/claude-sonnet-4.6",
            cases: [
              { name: "repo-question", aggregates: { score: 0.5 }, passK: true },
              { name: "config-fix", aggregates: {}, passK: false },
            ],
          },
        ],
        notRun: [
          { name: "refine-over-turns", target: "cursor/claude-sonnet-4-6", reason: "not run on Cursor: resumed conversations" },
          { name: "other", reason: "not run: plugins" },
        ],
          },
        ],
      },
      failure: { stage: "execution", message: "the eval run failed: workflow timed out" },
    };
    expect(renderQuality(quality)).toEqual([
      "",
      `Quality: eval run evr_1, judge ${JUDGE_MODEL}, 2 tries per case`,
      "",
      "| quality case | target | score | pass^k |",
      "|---|---|---|---|",
      "| repo-question | native/claude-sonnet-4.6 | 0.50 | yes |",
      "| config-fix | native/claude-sonnet-4.6 | n/a | no |",
      "",
      "Quality cases not run:",
      "- refine-over-turns on cursor/claude-sonnet-4-6: not run on Cursor: resumed conversations",
      "- other: not run: plugins",
      "",
      "Quality eval run: execution: the eval run failed: workflow timed out",
    ]);
  });
});

describe("runQualityEval", () => {
  const TARGETS = [{ id: "quality/deep-agent", harness: "deep-agent", modelRequested: "claude-sonnet-4.6" }] as const;
  const ended = (phase: EvalRunPhase, error = "") =>
    create(EvalRunSchema, {
      metadata: { id: "evr_1" },
      spec: { subject: { case: "pluginId", value: "plg_1" } },
      status: { phase, error },
    });

  /** Clients whose every seam answers, unless a test overrides one; the deletes are recorded. */
  function fakeClients(over: { push?: () => Promise<unknown>; create?: () => Promise<unknown>; get?: () => Promise<unknown> } = {}) {
    const deleted: string[] = [];
    const remove = ({ value }: { value: string }): Promise<object> => {
      deleted.push(value);
      return Promise.resolve({});
    };
    const clients = {
      organizationCommand: { create: () => Promise.resolve({ metadata: { id: "org_1", slug: "org-1" } }), delete: remove },
      pluginCommand: { push: over.push ?? (() => Promise.resolve({ metadata: { id: "plg_1", name: "working-agent" } })), delete: remove },
      evalRunCommand: { create: over.create ?? (() => Promise.resolve({ metadata: { id: "evr_1" } })) },
      evalRunQuery: { get: over.get ?? (() => Promise.resolve(ended(EvalRunPhase.completed))) },
    } as unknown as ConformanceClients;
    return { clients, deleted };
  }

  const run = (clients: ConformanceClients, lines: string[] = []) =>
    runQualityEval(clients, TARGETS, { runs: 1, judgeModel: JUDGE_MODEL }, { log: (line) => lines.push(line) });

  it("records a refused push by stage, and removes the organization it made", async () => {
    const { clients, deleted } = fakeClients({ push: () => Promise.reject(new Error("too large")) });
    const quality = await run(clients);
    expect(quality.failure).toEqual({ stage: "create", message: "push the working agent's plugin: too large" });
    expect(deleted).toEqual(["org_1"]);
  });

  it("records a refused eval create by stage, and removes the plugin and the organization", async () => {
    const { clients, deleted } = fakeClients({ create: () => Promise.reject(new Error("no model")) });
    const quality = await run(clients);
    expect(quality.plugin).toBe("working-agent");
    expect(quality.failure).toEqual({ stage: "create", message: "create the eval run: no model" });
    expect(deleted).toEqual(["plg_1", "org_1"]);
  });

  it("records an eval it could not follow, and one that failed with its document", async () => {
    const lost = await run(fakeClients({ get: () => Promise.reject(new Error("stack gone")) }).clients);
    expect([lost.eval_id, lost.document, lost.failure]).toEqual(["evr_1", null, { stage: "execution", message: "follow the eval run: stack gone" }]);
    const failed = await run(fakeClients({ get: () => Promise.resolve(ended(EvalRunPhase.failed, "the suite did not load")) }).clients);
    expect(failed.failure).toEqual({ stage: "execution", message: "the eval run failed: the suite did not load" });
    expect(failed.document).toMatchObject({ evalRunId: "evr_1" });
  });

  it("keeps a finished eval's result document, and says it started", async () => {
    const lines: string[] = [];
    const quality = await run(fakeClients().clients, lines);
    expect(quality.failure).toBeUndefined();
    expect(quality).toMatchObject({ plugin: "working-agent", eval_id: "evr_1", targets: ["native/claude-sonnet-4.6"], runs: 1 });
    expect(quality.document).toMatchObject({ evalRunId: "evr_1", subject: { kind: "plugin", id: "plg_1" } });
    expect(lines).toEqual(["quality: eval run evr_1 started"]);
  });
});
