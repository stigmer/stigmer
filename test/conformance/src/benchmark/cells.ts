// The benchmark's cell matrix: the scenarios every run measures,
// the models the parity cells are pinned to, the judge, and the pure planner
// that decides — before anything boots — which cells the environment and the
// flags allow and which are refused by name.
// Domain: conformance benchmark (what is measured).
//
// The six first-turn scenarios and their prompts are the July cost benchmark's,
// verbatim, so a category keeps its meaning from one run to the next:
//   git show 4c968690b^:test/integration/cost_benchmark_test.go (L269, L295-325)
// The `default` cells let each harness pick its model; the `parity` twins pin
// both to the same served model so the difference is harness overhead. The
// turn-2 scenario is that suite's multi-turn cell (L103-135), three turns in
// one session with the SECOND turn sampled: the warm-session experience no
// first-turn cell can show.
//
// The bare agent under measurement is the one the request-shape goldens
// photograph (support/agents.ts BARE_AGENT_INSTRUCTIONS), by import, so a
// change to it moves the goldens and this baseline together.
//
// Refusals are by name and never silent: a cell the environment cannot run
// (no key for its provider, no key for the judge) or the flags exclude is a
// `RefusedCell` in the report, so a reader has one question to ask ("is the
// side present") and one place to see why not.
import type { BenchmarkHarness, ComparisonMode, RefusedCell, SessionShape } from "./report";

/** The registry ids the parity cells pin, per harness: one served model, two registry rows. */
export const PARITY_MODEL: Record<BenchmarkHarness, string> = {
  "deep-agent": "claude-sonnet-4.6",
  cursor: "claude-sonnet-4-6",
};

/** The judge the quality fixture requests; the grade records what the runner used. */
export const JUDGE_MODEL = "claude-sonnet-4.6";

/** The subject every benchmark session is created with, so the background titling call returns early. */
export const BENCHMARK_SESSION_SUBJECT = "harness benchmark";

/** The July code-generation prompt, verbatim. */
export const CODEGEN_PROMPT =
  'Write a Go function that parses a duration string like "1h30m" and returns total minutes as an int, with proper error handling. Reply with only the code, no explanation.';

/** The July multi-turn prompts, verbatim, in order. */
export const TURN_2_PROMPTS: readonly string[] = [
  "Remember this fact: the capital of France is Paris.",
  "What is the capital of France?",
  "Now tell me: what was the first thing I told you?",
];

export interface Scenario {
  name: string;
  mode: ComparisonMode;
  sessionShape: SessionShape;
  prompts: readonly string[];
}

export const SCENARIOS: readonly Scenario[] = [
  { name: "report-simple", mode: "default", sessionShape: "fresh-per-execution", prompts: ["Reply with exactly: hello"] },
  { name: "report-medium", mode: "default", sessionShape: "fresh-per-execution", prompts: ["Explain in one sentence what a hash table is."] },
  { name: "report-codegen", mode: "default", sessionShape: "fresh-per-execution", prompts: [CODEGEN_PROMPT] },
  { name: "report-parity-simple", mode: "parity", sessionShape: "fresh-per-execution", prompts: ["Reply with exactly: hello"] },
  { name: "report-parity-medium", mode: "parity", sessionShape: "fresh-per-execution", prompts: ["Explain in one sentence what a hash table is."] },
  { name: "report-parity-codegen", mode: "parity", sessionShape: "fresh-per-execution", prompts: [CODEGEN_PROMPT] },
  { name: "report-parity-turn-2", mode: "turn-2", sessionShape: "one-session-three-turns", prompts: TURN_2_PROMPTS },
];

export const HARNESSES: readonly BenchmarkHarness[] = ["deep-agent", "cursor"];

/** One scenario on one harness. */
export interface BenchmarkCell {
  /** `<scenario>/<harness>`, the name a refusal or a flag addresses. */
  id: string;
  scenario: Scenario;
  harness: BenchmarkHarness;
  /** The registry id pinned on every execution, or `null` for the harness's default. */
  modelRequested: string | null;
}

export interface QualityTask {
  id: string;
  prompt: string;
  rubric: string;
  placeholder: boolean;
}

/** One quality task on one harness. */
export interface QualityCell {
  /** `quality/<task>/<harness>`. */
  id: string;
  task: QualityTask;
  harness: BenchmarkHarness;
  modelRequested: string;
}

export interface PlanFlags {
  only?: BenchmarkHarness;
  /** A glob over cell ids (`*` matches any run of characters). */
  cells?: string;
  includePlaceholders: boolean;
}

export interface PlanEnvironment {
  anthropicKey: boolean;
  cursorKey: boolean;
}

export interface CellPlan {
  cells: BenchmarkCell[];
  quality: QualityCell[];
  refused: RefusedCell[];
}

export function benchmarkCells(): BenchmarkCell[] {
  return SCENARIOS.flatMap((scenario) =>
    HARNESSES.map((harness) => ({
      id: `${scenario.name}/${harness}`,
      scenario,
      harness,
      modelRequested: scenario.mode === "default" ? null : PARITY_MODEL[harness],
    })),
  );
}

export function qualityCells(tasks: readonly QualityTask[]): QualityCell[] {
  return tasks.flatMap((task) =>
    HARNESSES.map((harness) => ({
      id: `quality/${task.id}/${harness}`,
      task,
      harness,
      modelRequested: PARITY_MODEL[harness],
    })),
  );
}

/**
 * What the environment and the flags allow, decided before the stack boots.
 * A native cell needs the Anthropic key; a Cursor cell the Cursor key; a
 * quality cell needs its harness's key AND the Anthropic key, because the
 * judge runs on the native path. Placeholder tasks run only when asked.
 */
export function planCells(tasks: readonly QualityTask[], env: PlanEnvironment, flags: PlanFlags): CellPlan {
  const refused: RefusedCell[] = [];
  const keyFor = (harness: BenchmarkHarness): boolean => (harness === "cursor" ? env.cursorKey : env.anthropicKey);
  const keyReason = (harness: BenchmarkHarness): RefusedCell["reason"] =>
    harness === "cursor" ? "missing CURSOR_API_KEY" : "missing ANTHROPIC_API_KEY";
  const excludedByFlags = (id: string, harness: BenchmarkHarness): RefusedCell["reason"] | undefined => {
    if (flags.only !== undefined && flags.only !== harness) return "excluded by --only";
    if (flags.cells !== undefined && !globMatches(flags.cells, id)) return "excluded by --cells";
    return undefined;
  };

  const cells = benchmarkCells().filter((cell) => {
    const flagReason = excludedByFlags(cell.id, cell.harness);
    if (flagReason !== undefined) {
      refused.push({ cell: cell.id, reason: flagReason });
      return false;
    }
    if (!keyFor(cell.harness)) {
      refused.push({ cell: cell.id, reason: keyReason(cell.harness) });
      return false;
    }
    return true;
  });

  const quality = qualityCells(tasks.filter((task) => flags.includePlaceholders || !task.placeholder)).filter((cell) => {
    const flagReason = excludedByFlags(cell.id, cell.harness);
    if (flagReason !== undefined) {
      refused.push({ cell: cell.id, reason: flagReason });
      return false;
    }
    if (!keyFor(cell.harness)) {
      refused.push({ cell: cell.id, reason: keyReason(cell.harness) });
      return false;
    }
    if (!env.anthropicKey) {
      refused.push({ cell: cell.id, reason: "missing ANTHROPIC_API_KEY" });
      return false;
    }
    return true;
  });

  return { cells, quality, refused };
}

/** `*` matches any run of characters; everything else is literal. */
export function globMatches(glob: string, id: string): boolean {
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`).test(id);
}
