// Unit arms for the arm comparison: which reports may be compared, how arms
// are found and pooled, and each clause of the bar at and past its edge.
// Domain: conformance benchmark (the readout).
//
// Pinned: reports that differ on the instrument's head_sha, reps,
// quality_reps, thinking mode or host, or lie more than 24 hours apart, are
// refused by naming the field, and a report from a dirty instrument is
// refused by name; reports of one instrument on two versions of the code are
// compared. An arm is a harness on one model at one endpoint on one version
// of the code: two codes are two arms, never pooled, and one code pools, a
// later report's scenario replacing an earlier one's. The default reference
// is the Stigmer arm on the parity model; a reference resolves by a prefix ending
// where the label's endpoint or code begins, and one matching two codes is
// refused naming both. Each report's runner marker counts are printed with
// the arms it measured, and never gate a verdict. A Stigmer-arm report taken with background commands off
// is an arm of its own, and the input-token median and each side's
// background readings are printed, never gated. Quality holds at the reference's mean minus 0.05 and misses
// past it, over the cases graded on both arms only (a null score is left
// out); failures hold at the reference's count and miss above it; the wasted
// share holds at the reference's plus 5 points and misses past it, counting
// settled calls only across sampled and sibling turns. Fewer than three
// samples that ran, or three cases graded on both arms, reads "not measured";
// a create failure is not a sample that ran; a cell the arm's report refused
// by design is expected, and one refused for want of a key is not measured.
// A Claude arm is `claude/<model>#<code>`, its side and its quality target
// found under its own harness, and pools against the Stigmer reference like
// any other arm.
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
import { emptyMarkers } from "../log-markers";
import { summarize, type BackgroundReadings, type BenchmarkHarness, type BenchmarkReport, type BenchmarkSample, type RunnerLogMarkers, type ToolCallFact } from "../report";
import { makeSample } from "./sample-fixture";

const REF = PARITY_MODEL.stigmer;
/** The label suffix of the default code, `git.code_sha` "c" * 40. */
const C = `#${"c".repeat(10)}`;

/** A sample's background readings with nothing started and every timeline reading at zero. */
const NO_BACKGROUND: BackgroundReadings = {
  starts: 0,
  endings: { exited: 0, timed_out: 0, stopped_by_agent: 0, stopped_by_person: 0, stopped_by_approval: 0, stopped_by_turn: 0, failed_to_start: 0, running: 0 },
  worked_while_running_ms: 0,
  polls: 0,
  sleeps: 0,
  self_backgrounded: 0,
  foreground_timeouts: 0,
  waits: 0,
  wait_ms: 0,
  reminders: 0,
  gated_while_running: 0,
  orphans: 0,
};

function call(outcome: ToolCallFact["outcome"]): ToolCallFact {
  return { round: 1, start_ms: 100, name: "edit_file", target: "a.go", status: outcome === "ok" ? "completed" : "failed", outcome };
}

/** `n` samples, each with the given tool-call outcomes on its sampled turn. */
function samples(n: number, calls: ToolCallFact["outcome"][] = ["ok"], overrides: Partial<BenchmarkSample> = {}): BenchmarkSample[] {
  return Array.from({ length: n }, () => makeSample({ tool_calls: calls.map(call), ...overrides }));
}

interface ArmSpec {
  /** The harness whose side the cells and the quality target are; Stigmer by default. */
  harness?: BenchmarkHarness;
  model?: string;
  endpoint?: string;
  basis?: "catalog" | "default-rate";
  timestamp?: string;
  /** Per scenario, the harness's side's samples; omitted scenarios have no side. */
  cells?: Record<string, BenchmarkSample[]>;
  /** Per case, the harness's target's score and pass^k; omitted means no quality document. */
  quality?: Record<string, { score: number | null; passK?: boolean }>;
  refused?: BenchmarkReport["refused"];
  headSha?: string;
  codeSha?: string;
  runnerLog?: RunnerLogMarkers;
  shellBackground?: "on" | "off";
}

function report(spec: ArmSpec = {}): BenchmarkReport {
  const model = spec.model ?? REF;
  const harness = spec.harness ?? "stigmer";
  const parity = { ...PARITY_MODEL, stigmer: model };
  const target = `${harness}/${parity[harness]}`;
  const cells = spec.cells ?? { "working-read-edit": samples(3) };
  return {
    schema_version: 12,
    timestamp: spec.timestamp ?? "2026-10-23T10:00:00Z",
    git: { head_sha: spec.headSha ?? "h".repeat(40), main_sha: "m".repeat(40), code_sha: spec.codeSha ?? "c".repeat(40) },
    host: { platform: "darwin/arm64", node: "v22.22.1" },
    methodology: {
      reps: 3,
      quality_reps: 3,
      warmup_discarded: true,
      cold: "first-call-of-run-per-harness-model-and-agent",
      titling_suppressed: true,
      file_review: "approved-at-review-ready",
      shell_background: spec.shellBackground ?? "on",
    },
    models: {
      parity,
      judge_requested: REF,
      stigmer_endpoint: spec.endpoint ?? (model.startsWith("openai:") ? "api.openai.com" : "api.anthropic.com"),
      stigmer_api: model.startsWith("openai:") ? "chat-completions" : "messages",
      stigmer_cost_basis: spec.basis ?? "catalog",
    },
    comparisons: Object.entries(cells).map(([scenario, list]) => ({
      scenario,
      prompts: ["p"],
      mode: "working-agent" as const,
      session_shape: "one-session-three-turns" as const,
      agent: "working" as const,
      sides: { [harness]: summarize(harness, makeSample(), list, null) },
      cost_ratio: {},
    })),
    quality:
      spec.quality === undefined
        ? null
        : {
            plugin: "working-agent",
            eval_id: "evr_1",
            targets: [target],
            judge_model: REF,
            runs: 3,
            document: {
              schemaVersion: 1,
              plugins: [
                {
                  targets: [
                    {
                      label: target,
                      cases: Object.entries(spec.quality).map(([name, c]) => ({ name, aggregates: { score: c.score }, passK: c.passK ?? false })),
                    },
                  ],
                },
              ],
            },
          },
    refused: spec.refused ?? [],
    runner_log: spec.runnerLog ?? emptyMarkers(),
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
    ["git.head_sha", (r: BenchmarkReport) => (r.git.head_sha = "other")],
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

  it("refuses a report from an instrument with uncommitted changes, by name", () => {
    const dirty = report({ headSha: `${"h".repeat(40)}-dirty` });
    expect(() => assertComparable([at("a.json", dirty)])).toThrow(
      `report was measured by an instrument with uncommitted changes (git.head_sha ${"h".repeat(40)}-dirty): a.json`,
    );
  });

  it("admits one instrument's reports on two versions of the code, whatever their merge base", () => {
    const before = report({ codeSha: "b".repeat(40) });
    before.git.main_sha = "other";
    expect(() => assertComparable([at("before.json", before), at("after.json", report())])).not.toThrow();
  });

  it("refuses no reports and an unreadable timestamp", () => {
    expect(() => assertComparable([])).toThrow("no reports to compare");
    expect(() => assertComparable([at("a.json", report({ timestamp: "yesterday" }))])).toThrow("not a time: a.json");
  });
});

describe("compareReports: arms and pooling", () => {
  it("labels an arm by harness, model, endpoint and code, and defaults the reference to Stigmer on the parity model", () => {
    const comparison = compareReports([
      at("ref.json", report()),
      at("gemini.json", report({ model: "openai:gemini-3-pro", endpoint: "generativelanguage.googleapis.com" })),
    ]);
    expect(comparison.reference).toBe(`stigmer/${REF}@api.anthropic.com${C}`);
    expect(comparison.arms).toEqual([`stigmer/${REF}@api.anthropic.com${C}`, `stigmer/openai:gemini-3-pro@generativelanguage.googleapis.com${C}`]);
    expect(armLabel(report(), "claude"), "Claude's label names its model and code, no endpoint").toBe(`claude/${PARITY_MODEL.claude}${C}`);
    expect(armLabel(report({ codeSha: `${"d".repeat(40)}-dirty` }), "stigmer")).toBe(`stigmer/${REF}@api.anthropic.com#${"d".repeat(10)}-dirty`);
  });

  it("reads two versions of the code as two arms, never one, and resolves a reference by its code", () => {
    const before = at("before.json", report({ codeSha: "b".repeat(40), cells: { "working-read-edit": samples(3, ["failed"]) } }));
    const after = at("after.json", report({ timestamp: "2026-10-23T11:00:00Z" }));
    const comparison = compareReports([before, after], `stigmer/${REF}@api.anthropic.com#bbbb`);
    expect(comparison.reference).toBe(`stigmer/${REF}@api.anthropic.com#${"b".repeat(10)}`);
    expect(comparison.arms).toEqual([`stigmer/${REF}@api.anthropic.com#${"b".repeat(10)}`, `stigmer/${REF}@api.anthropic.com${C}`]);
    expect(comparison.readings.map((reading) => reading.arm)).toEqual([`stigmer/${REF}@api.anthropic.com${C}`]);
    expect(comparison.readings[0]!.cells[0]!.wasted).toMatchObject({ arm: 0, reference: 1 });
    expect(() => compareReports([before, after])).toThrow(
      `reference stigmer/${REF} matches several arms: stigmer/${REF}@api.anthropic.com#${"b".repeat(10)}, stigmer/${REF}@api.anthropic.com${C}; name one`,
    );
    expect(() => compareReports([before, after], `stigmer/${REF}@api.anthropic.com`)).toThrow("matches several arms");
  });

  it("takes a named reference, and refuses one no report carries or one that matches several arms", () => {
    const reports = [at("ref.json", report()), at("gpt.json", report({ model: "openai:gpt-5.5" }))];
    expect(compareReports(reports, "stigmer/openai:gpt-5.5").reference).toBe(`stigmer/openai:gpt-5.5@api.openai.com${C}`);
    expect(compareReports(reports, "stigmer/openai:gpt-5.5@api.openai.com").reference).toBe(`stigmer/openai:gpt-5.5@api.openai.com${C}`);
    expect(compareReports(reports, `stigmer/openai:gpt-5.5@api.openai.com${C}`).reference).toBe(`stigmer/openai:gpt-5.5@api.openai.com${C}`);
    expect(() => compareReports(reports, "stigmer/claude-opus-4.7")).toThrow("no report carries the reference arm stigmer/claude-opus-4.7");
    const twoEndpoints = [
      at("ref.json", report()),
      at("a.json", report({ model: "openai:x", endpoint: "a.example" })),
      at("b.json", report({ model: "openai:x", endpoint: "b.example" })),
    ];
    expect(() => compareReports(twoEndpoints, "stigmer/openai:x")).toThrow("matches several arms");
  });

  it("reads a report with background commands off as an arm of its own, beside the same model's arm with them on", () => {
    const off = report({ shellBackground: "off", timestamp: "2026-10-23T09:00:00Z", cells: { "working-read-edit": samples(3, ["failed"]) } });
    const reports = [at("off.json", off), at("on.json", report())];
    expect(armLabel(off, "stigmer")).toBe(`stigmer/${REF}@api.anthropic.com${C}+background-off`);
    expect(armLabel(off, "claude"), "the setting is the Stigmer harness's alone").toBe(`claude/${PARITY_MODEL.claude}${C}`);
    const comparison = compareReports(reports, `stigmer/${REF}@api.anthropic.com${C}+background-off`);
    expect(comparison.arms).toEqual([`stigmer/${REF}@api.anthropic.com${C}+background-off`, `stigmer/${REF}@api.anthropic.com${C}`]);
    expect(comparison.readings[0]!.arm).toBe(`stigmer/${REF}@api.anthropic.com${C}`);
    expect(compareReports(reports, `stigmer/${REF}@api.anthropic.com${C}`).reference, "the full label of the arm with them on names it alone").toBe(`stigmer/${REF}@api.anthropic.com${C}`);
    expect(comparison.readings[0]!.cells[0]!.wasted, "the off arm's samples were not pooled into the on arm").toMatchObject({ arm: 0, reference: 1 });
    expect(() => compareReports(reports), "the bare model now names two arms").toThrow("matches several arms");
  });

  it("reads a Claude arm against the Stigmer reference: its side and its quality target found under its own harness", () => {
    const quality = { a: { score: 1, passK: true }, b: { score: 0.9 }, c: { score: 0.5 } };
    const reports = [
      at("stigmer.json", report({ quality, cells: { "working-read-edit": samples(3) } })),
      at("claude.json", report({ harness: "claude", quality: GOOD_QUALITY, cells: { "working-read-edit": samples(3, ["failed"]) } })),
    ];
    const comparison = compareReports(reports);
    expect(comparison.reference, "the default reference is the Stigmer arm").toBe(`stigmer/${REF}@api.anthropic.com${C}`);
    expect(comparison.arms).toEqual([`stigmer/${REF}@api.anthropic.com${C}`, `claude/${PARITY_MODEL.claude}${C}`]);
    const reading = comparison.readings[0]!;
    expect(reading.arm).toBe(`claude/${PARITY_MODEL.claude}${C}`);
    expect(reading.quality.cases, "the Claude target's cases, graded on both arms").toBe(3);
    expect(reading.cells[0]!.wasted, "the Claude side's samples against the Stigmer harness's").toMatchObject({ arm: 1, reference: 0, status: "misses" });
    expect(reading.verdict).toBe("misses the bar");
    expect(comparison.runnerLogs.map((log) => log.arms)).toEqual([[`stigmer/${REF}@api.anthropic.com${C}`], [`claude/${PARITY_MODEL.claude}${C}`]]);
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
        { cell: "report-simple/stigmer", reason: "the Stigmer harness's model is pinned by --stigmer-model" },
        { cell: "working-read-edit/stigmer", reason: "missing OPENAI_API_KEY" },
        { cell: "working-cross-turn/claude", reason: "excluded by --only" },
      ],
    });
    expect(reading.cells.map((cell) => [cell.scenario, cell.status, cell.why])).toEqual([
      ["report-simple", "expected refusal", "the Stigmer harness's model is pinned by --stigmer-model"],
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
      { cells: { "working-read-edit": samples(3) }, quality: GOOD_QUALITY, refused: [{ cell: "report-simple/stigmer", reason: "the Stigmer harness's model is pinned by --stigmer-model" }] },
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
    expect(text).toContain(`Reference: stigmer/${REF}@api.anthropic.com${C}; instrument hhhhhhhhhh, 3 reps, 3 quality tries, darwin/arm64 v22.22.1`);
    expect(text).toContain(`## stigmer/openai:gpt-5.5@api.openai.com${C}: holds the bar`);
    expect(text).toContain("Quality: holds (mean 0.900 against 0.900 over 3 cases (tolerance 0.05)); pass^k 1 against 1");
    expect(text).toContain("| working-read-edit | holds | 0 / 0 | 0.0% / 0.0% | 1000 / 1000 | 1 / 1 | 3000* / 3000 |");
    expect(text).toContain("* the runner's default rate, not a price");
  });

  it("prints each report's runner marker counts with the arms it measured, and never gates on them", () => {
    const busy = { ...emptyMarkers(), files: ["runner.log"], hook_failures: 3, repo_instructions: { root: 7, nested: 0 } };
    const reports = [
      at("ref.json", report({ quality: GOOD_QUALITY, codeSha: "b".repeat(40) })),
      at("after.json", report({ quality: GOOD_QUALITY, timestamp: "2026-10-23T11:00:00Z", runnerLog: busy })),
    ];
    const comparison = compareReports(reports, `stigmer/${REF}@api.anthropic.com#bbbb`);
    expect(comparison.readings[0]!.verdict).toBe("holds the bar");
    expect(comparison.runnerLogs.map((reading) => [reading.path, reading.arms])).toEqual([
      ["ref.json", [`stigmer/${REF}@api.anthropic.com#${"b".repeat(10)}`]],
      ["after.json", [`stigmer/${REF}@api.anthropic.com${C}`]],
    ]);
    const text = renderComparison(comparison, reports);
    expect(text).toContain("## Runner log, per run (printed, never gated)");
    expect(text).toContain(`- stigmer/${REF}@api.anthropic.com${C} (after.json): edits repaired 0;`);
    expect(text).toContain("repository instructions read on 7 turns, 0 nested; hook failures 3; from runner.log");
    expect(text).toContain(`- stigmer/${REF}@api.anthropic.com#${"b".repeat(10)} (ref.json): edits repaired 0;`);
  });

  it("prints each side's input-token median, and its background readings once a side carries them", () => {
    const used = (polls: number): BenchmarkSample =>
      makeSample({
        measures: { tokens: { input: 1200, output: 20, cache_read: 900, cache_write: 0, total: 1220 } },
        background: { ...NO_BACKGROUND, starts: 1, endings: { ...NO_BACKGROUND.endings, exited: 1 }, polls, worked_while_running_ms: 30_000, waits: 1, wait_ms: 20_000, reminders: 0, gated_while_running: 0, orphans: 0 },
        task_done: true,
      });
    const left = makeSample({ background: { ...NO_BACKGROUND, self_backgrounded: 1, foreground_timeouts: 1, orphans: 1 }, task_done: false });
    const reports = [
      at("off.json", report({ shellBackground: "off", quality: GOOD_QUALITY, cells: { "background-dev-server": [left, left, left] } })),
      at("on.json", report({ quality: GOOD_QUALITY, cells: { "background-dev-server": [used(0), used(0), used(1)] } })),
    ];
    const text = renderComparison(compareReports(reports, `stigmer/${REF}@api.anthropic.com${C}+background-off`), reports);
    expect(text).toContain("| background-dev-server | holds | 0 / 0 | 0.0% / 0.0% | 1000 / 1000 | 1 / 1 | 3000 / 3000 | 1200 / 1000 |");
    expect(text).toContain("Background commands, over the samples that ran:");
    expect(text).toContain("| background-dev-server | 3/3 / 0/3 | 3 / 0 | 0 (1) / 0 (0) | 30000 / n/a | 3 / 0 | 0 / 0 | 0 / 3 | 0 / 3 | 0 / 0 | 0 / 3 | 3/3 / 0/3 |");
    const plain = [at("ref.json", report({ quality: GOOD_QUALITY })), at("gpt.json", report({ model: "openai:gpt-5.5", quality: GOOD_QUALITY }))];
    expect(renderComparison(compareReports(plain), plain), "no readings, no table").not.toContain("Background commands");
  });

  it("prints n/a for a side with no successful sample", () => {
    const failed = samples(3, ["ok"], { outcome: "failed", failure: { stage: "execution", message: "x" } });
    const reports = [at("ref.json", report({ quality: GOOD_QUALITY })), at("gpt.json", report({ model: "openai:gpt-5.5", quality: GOOD_QUALITY, cells: { "working-read-edit": failed } }))];
    const text = renderComparison(compareReports(reports), reports);
    expect(text).toContain("| working-read-edit | misses | 3 / 0 | 0.0% / 0.0% | n/a / 1000 | n/a / 1 | n/a / 3000 |");
  });
});
