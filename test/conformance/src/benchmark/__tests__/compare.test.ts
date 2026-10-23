// Unit arms for the arm comparison: which reports may be compared, how arms
// are found and pooled, and each clause of the bar at and past its edge.
// Domain: conformance benchmark (the readout).
//
// Pinned: reports that differ on main_sha, reps, quality_reps, thinking mode
// or host, or lie more than 24 hours apart, are refused by naming the field;
// an arm is a harness on one model at one endpoint, the default reference is
// native on the parity model, and a later report's scenario replaces an
// earlier one's. Quality holds at the reference's mean minus 0.05 and misses
// past it, over the cases graded on both arms only (a null score is left
// out); failures hold at the reference's count and miss above it; the wasted
// share holds at the reference's plus 5 points and misses past it, counting
// settled calls only across sampled and sibling turns. Fewer than three
// samples that ran, or three cases graded on both arms, reads "not measured";
// a create failure is not a sample that ran; a cell the arm's report refused
// by design is expected, and one refused for want of a key is not measured.
import { describe, expect, it } from "vitest";
import { PARITY_MODEL } from "../cells";
import {
  armLabel,
  assertComparable,
  compareReports,
  renderComparison,
  wastedShare,
  type ComparedReport,
} from "../compare";
import { summarize, type BenchmarkReport, type BenchmarkSample, type ToolCallFact } from "../report";
import { makeSample } from "./sample-fixture";

const REF = PARITY_MODEL["deep-agent"];

function call(outcome: ToolCallFact["outcome"]): ToolCallFact {
  return { round: 1, name: "edit_file", target: "a.go", status: outcome === "ok" ? "completed" : "failed", outcome };
}

/** `n` samples, each with the given tool-call outcomes on its sampled turn. */
function samples(n: number, calls: ToolCallFact["outcome"][] = ["ok"], overrides: Partial<BenchmarkSample> = {}): BenchmarkSample[] {
  return Array.from({ length: n }, () => makeSample({ tool_calls: calls.map(call), ...overrides }));
}

interface ArmSpec {
  model?: string;
  endpoint?: string;
  basis?: "catalog" | "default-rate";
  timestamp?: string;
  /** Per scenario, the native side's samples; omitted scenarios have no native side. */
  cells?: Record<string, BenchmarkSample[]>;
  /** Per case, the native target's score and pass^k; omitted means no quality document. */
  quality?: Record<string, { score: number | null; passK?: boolean }>;
  refused?: BenchmarkReport["refused"];
  mainSha?: string;
}

function report(spec: ArmSpec = {}): BenchmarkReport {
  const model = spec.model ?? REF;
  const cells = spec.cells ?? { "working-read-edit": samples(3) };
  return {
    schema_version: 8,
    timestamp: spec.timestamp ?? "2026-10-23T10:00:00Z",
    git: { head_sha: "h", main_sha: spec.mainSha ?? "m".repeat(40) },
    host: { platform: "darwin/arm64", node: "v22.22.1" },
    methodology: {
      reps: 3,
      quality_reps: 3,
      warmup_discarded: true,
      cold: "first-call-of-run-per-harness-model-and-agent",
      titling_suppressed: true,
      file_review: "approved-at-review-ready",
    },
    models: {
      parity_native: model,
      parity_cursor: PARITY_MODEL.cursor,
      judge_requested: REF,
      native_endpoint: spec.endpoint ?? (model.startsWith("openai:") ? "api.openai.com" : "api.anthropic.com"),
      native_api: model.startsWith("openai:") ? "chat-completions" : "messages",
      native_cost_basis: spec.basis ?? "catalog",
    },
    comparisons: Object.entries(cells).map(([scenario, list]) => ({
      scenario,
      prompts: ["p"],
      mode: "working-agent" as const,
      session_shape: "one-session-three-turns" as const,
      agent: "working" as const,
      native: summarize("deep-agent", makeSample(), list, null),
    })),
    quality:
      spec.quality === undefined
        ? null
        : {
            plugin: "working-agent",
            eval_id: "evr_1",
            targets: [`native/${model}`],
            judge_model: REF,
            runs: 3,
            document: {
              schemaVersion: 1,
              plugins: [
                {
                  targets: [
                    {
                      label: `native/${model}`,
                      cases: Object.entries(spec.quality).map(([name, c]) => ({ name, aggregates: { score: c.score }, passK: c.passK ?? false })),
                    },
                  ],
                },
              ],
            },
          },
    refused: spec.refused ?? [],
  };
}

const at = (path: string, body: BenchmarkReport): ComparedReport => ({ path, report: body });

const GOOD_QUALITY = { a: { score: 1, passK: true }, b: { score: 0.9 }, c: { score: 0.8 } };

function readingOf(reference: ArmSpec, arm: ArmSpec) {
  const comparison = compareReports([at("ref.json", report(reference)), at("arm.json", report({ model: "openai:gpt-5.5", ...arm }))]);
  expect(comparison.readings).toHaveLength(1);
  return comparison.readings[0]!;
}

describe("assertComparable", () => {
  it.each([
    ["git.main_sha", (r: BenchmarkReport) => (r.git.main_sha = "other")],
    ["methodology.reps", (r: BenchmarkReport) => (r.methodology.reps = 5)],
    ["methodology.quality_reps", (r: BenchmarkReport) => (r.methodology.quality_reps = 1)],
    ["methodology.thinking_mode", (r: BenchmarkReport) => (r.methodology.thinking_mode = "enabled")],
    ["host", (r: BenchmarkReport) => (r.host.node = "v24.0.0")],
  ])("refuses reports that differ on %s, naming both", (field, change) => {
    const other = report({ model: "openai:gpt-5.5" });
    change(other);
    expect(() => assertComparable([at("a.json", report()), at("b.json", other)])).toThrow(`reports differ on ${field}:`);
    expect(() => assertComparable([at("a.json", report()), at("b.json", other)])).toThrow("(a.json) and");
  });

  it("admits reports 24 hours apart and refuses them past it", () => {
    const early = at("a.json", report({ timestamp: "2026-10-23T00:00:00Z" }));
    expect(() => assertComparable([early, at("b.json", report({ timestamp: "2026-10-24T00:00:00Z" }))])).not.toThrow();
    expect(() => assertComparable([early, at("b.json", report({ timestamp: "2026-10-24T00:00:01Z" }))])).toThrow(
      "reports differ on timestamp by more than 24 hours: a.json and b.json",
    );
  });

  it("refuses no reports and an unreadable timestamp", () => {
    expect(() => assertComparable([])).toThrow("no reports to compare");
    expect(() => assertComparable([at("a.json", report({ timestamp: "yesterday" }))])).toThrow("not a time: a.json");
  });
});

describe("compareReports: arms and pooling", () => {
  it("labels an arm by harness, model and endpoint, and defaults the reference to native on the parity model", () => {
    const comparison = compareReports([
      at("ref.json", report()),
      at("gemini.json", report({ model: "openai:gemini-3-pro", endpoint: "generativelanguage.googleapis.com" })),
    ]);
    expect(comparison.reference).toBe(`native/${REF}@api.anthropic.com`);
    expect(comparison.arms).toEqual([`native/${REF}@api.anthropic.com`, "native/openai:gemini-3-pro@generativelanguage.googleapis.com"]);
    expect(armLabel(report(), "cursor")).toBe(`cursor/${PARITY_MODEL.cursor}`);
  });

  it("takes a named reference, and refuses one no report carries or one that matches several arms", () => {
    const reports = [at("ref.json", report()), at("gpt.json", report({ model: "openai:gpt-5.5" }))];
    expect(compareReports(reports, "native/openai:gpt-5.5").reference).toBe("native/openai:gpt-5.5@api.openai.com");
    expect(() => compareReports(reports, "native/claude-opus-4.7")).toThrow("no report carries the reference arm native/claude-opus-4.7");
    const twoEndpoints = [
      at("ref.json", report()),
      at("a.json", report({ model: "openai:x", endpoint: "a.example" })),
      at("b.json", report({ model: "openai:x", endpoint: "b.example" })),
    ];
    expect(() => compareReports(twoEndpoints, "native/openai:x")).toThrow("matches several arms");
  });

  it("pools an arm's reports, a later scenario replacing an earlier one", () => {
    const comparison = compareReports([
      at("ref.json", report()),
      at("first.json", report({ model: "openai:gpt-5.5", timestamp: "2026-10-23T11:00:00Z", cells: { "working-read-edit": samples(3, ["failed"]) } })),
      at("rerun.json", report({ model: "openai:gpt-5.5", timestamp: "2026-10-23T12:00:00Z", cells: { "working-read-edit": samples(3) } })),
    ]);
    expect(comparison.readings[0]!.cells[0]!.wasted?.arm).toBe(0);
  });
});

describe("the quality clause", () => {
  it("holds at the reference's mean minus 0.05 and misses past it", () => {
    const reference = { quality: GOOD_QUALITY };
    expect(readingOf(reference, { quality: { a: { score: 0.95 }, b: { score: 0.85 }, c: { score: 0.75 } } }).quality.status).toBe("holds");
    expect(readingOf(reference, { quality: { a: { score: 0.94 }, b: { score: 0.85 }, c: { score: 0.75 } } }).quality.status).toBe("misses");
  });

  it("scores only the cases graded on both arms, a null score left out on either side", () => {
    const reading = readingOf(
      { quality: { ...GOOD_QUALITY, d: { score: null } } },
      { quality: { a: { score: 1 }, b: { score: 0.9 }, c: { score: 0.8 }, d: { score: 0 }, e: { score: 0 } } },
    );
    expect(reading.quality).toMatchObject({ status: "holds", cases: 3, armMean: 0.9, referenceMean: 0.9 });
  });

  it("reads not measured under three cases graded on both arms, or with no quality target", () => {
    expect(readingOf({ quality: GOOD_QUALITY }, { quality: { a: { score: 1 }, b: { score: null }, c: { score: 1 } } }).quality).toMatchObject({
      status: "not measured",
      why: "2 cases graded on both arms (need 3)",
    });
    expect(readingOf({ quality: GOOD_QUALITY }, {}).quality.status).toBe("not measured");
  });

  it("counts pass^k on both sides", () => {
    const reading = readingOf({ quality: GOOD_QUALITY }, { quality: { a: { score: 1, passK: true }, b: { score: 1, passK: true }, c: { score: 1 } } });
    expect(reading.quality.passK).toEqual({ arm: 2, reference: 1 });
  });
});

describe("the timing-cell clauses", () => {
  const cellOf = (reference: BenchmarkSample[], arm: BenchmarkSample[]) =>
    readingOf({ cells: { "working-read-edit": reference }, quality: GOOD_QUALITY }, { cells: { "working-read-edit": arm }, quality: GOOD_QUALITY }).cells[0]!;

  it("failures hold at the reference's count and miss above it", () => {
    const failed = (n: number, of: number) => [...samples(of - n), ...samples(n, ["ok"], { outcome: "failed", failure: { stage: "execution", message: "x" } })];
    expect(cellOf(failed(1, 4), failed(1, 4)).failures).toEqual({ arm: 1, reference: 1, status: "holds" });
    expect(cellOf(failed(1, 4), failed(2, 4))).toMatchObject({ status: "misses", failures: { arm: 2, reference: 1, status: "misses" } });
  });

  it("the wasted share holds at the reference's plus 5 points and misses past it", () => {
    // Reference: 1 wasted of 20 settled (5%). Arm at 10% holds; at 15% misses.
    const reference = [...samples(1, [...Array(19).fill("ok"), "not_found"]), ...samples(2, [])];
    const tenPercent = [...samples(1, [...Array(18).fill("ok"), "not_found", "not_unique"]), ...samples(2, [])];
    const fifteenPercent = [...samples(1, [...Array(17).fill("ok"), "not_found", "not_unique", "failed"]), ...samples(2, [])];
    expect(cellOf(reference, tenPercent).wasted?.status).toBe("holds");
    expect(cellOf(reference, fifteenPercent)).toMatchObject({ status: "misses", wasted: { status: "misses" } });
  });

  it("reads not measured under three samples that ran, a create failure not counting as one", () => {
    const atCreate = samples(1, [], { outcome: "failed", failure: { stage: "create", message: "refused" } });
    const cell = cellOf(samples(3), [...samples(2), ...atCreate]);
    expect(cell).toMatchObject({ status: "not measured", why: "samples that ran: arm 2, reference 3 (need 3)" });
    expect(cell.printed?.arm.end_to_end_ms, "the numbers are still printed").toBe(1000);
  });

  it("a cell the arm's report refused by design is expected; one refused for a missing key, or absent, is not measured", () => {
    const reference = { cells: { "report-simple": samples(3), "working-read-edit": samples(3), "working-cross-turn": samples(3) }, quality: GOOD_QUALITY };
    const reading = readingOf(reference, {
      cells: {},
      quality: GOOD_QUALITY,
      refused: [
        { cell: "report-simple/deep-agent", reason: "the native model is pinned by --native-model" },
        { cell: "working-read-edit/deep-agent", reason: "missing OPENAI_API_KEY" },
      ],
    });
    expect(reading.cells.map((cell) => [cell.scenario, cell.status, cell.why])).toEqual([
      ["report-simple", "expected refusal", "the native model is pinned by --native-model"],
      ["working-read-edit", "not measured", "refused: missing OPENAI_API_KEY"],
      ["working-cross-turn", "not measured", "absent from the arm's reports"],
    ]);
    expect(reading.verdict).toBe("not measured");
  });
});

describe("the verdict", () => {
  it("holds when every clause holds, misses when any misses, and is not measured otherwise", () => {
    expect(readingOf({ quality: GOOD_QUALITY }, { quality: GOOD_QUALITY }).verdict).toBe("holds the bar");
    expect(readingOf({ quality: GOOD_QUALITY }, { quality: { a: { score: 0 }, b: { score: 0 }, c: { score: 0 } } }).verdict).toBe("misses the bar");
    expect(readingOf({ quality: GOOD_QUALITY }, { cells: { "working-read-edit": samples(1) }, quality: GOOD_QUALITY }).verdict).toBe("not measured");
  });

  it("a cell refused by design does not stop an arm holding the bar", () => {
    const reading = readingOf(
      { cells: { "report-simple": samples(3), "working-read-edit": samples(3) }, quality: GOOD_QUALITY },
      { cells: { "working-read-edit": samples(3) }, quality: GOOD_QUALITY, refused: [{ cell: "report-simple/deep-agent", reason: "the native model is pinned by --native-model" }] },
    );
    expect(reading.verdict).toBe("holds the bar");
  });
});

describe("wastedShare", () => {
  it("counts settled calls only, across the sampled and sibling turns, and is 0 with none settled", () => {
    const sample = makeSample({
      tool_calls: [call("ok"), call("skipped"), call("unsettled")],
      sibling_turns: [
        { ...makeSample(), turn_seq: 1, tool_calls: [call("not_found")] },
        { ...makeSample(), turn_seq: 3, tool_calls: [call("ok"), call("ok")] },
      ],
    });
    expect(wastedShare([sample])).toBe(0.25);
    expect(wastedShare([makeSample({ tool_calls: [call("skipped")] })])).toBe(0);
  });
});

describe("renderComparison", () => {
  it("prints each arm's verdict, its quality line and one row per cell, arm before reference, a default-rate cost marked", () => {
    const reports = [
      at("ref.json", report({ quality: GOOD_QUALITY })),
      at("gpt.json", report({ model: "openai:gpt-5.5", basis: "default-rate", quality: GOOD_QUALITY })),
    ];
    const text = renderComparison(compareReports(reports), reports);
    expect(text).toContain(`Reference: native/${REF}@api.anthropic.com; main mmmmmmmmmm, 3 reps, 3 quality tries, darwin/arm64 v22.22.1`);
    expect(text).toContain("## native/openai:gpt-5.5@api.openai.com: holds the bar");
    expect(text).toContain("Quality: holds (mean 0.900 against 0.900 over 3 cases (tolerance 0.05)); pass^k 1 against 1");
    expect(text).toContain("| working-read-edit | holds | 0 / 0 | 0.0% / 0.0% | 1000 / 1000 | 1 / 1 | 3000* / 3000 |");
    expect(text).toContain("* the runner's default rate, not a price");
  });
});
