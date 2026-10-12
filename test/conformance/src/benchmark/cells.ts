// The benchmark's cell matrix: the scenarios every run measures,
// the models the parity cells are pinned to, the judge, the quality arm's
// targets, and the pure planner
// that decides — before anything boots — which cells the environment and the
// flags allow and which are refused by name.
// Domain: conformance benchmark (what is measured).
//
// Two agents are measured. The bare agent's cells are the July cost
// benchmark's, below. The working agent (support/working-agent.ts) carries an
// MCP server, memory, eight skills, a sub-agent and a seeded repository. Its
// two timing cells are three turns in one session with the second sampled:
// one reads, then edits, then follows up; the other asks three read-only
// questions that each reach a different skill, the session whose later turns
// show whether the system prompt, and so the provider's prompt cache, held
// from one message to the next.
//
// The quality arm is the working agent as a plugin with an `evals/` suite
// (fixtures/working-agent, the plugin-eval format), run by Stigmer's own
// plugin evals: one eval, with each harness on its parity model as a
// target, graded by the platform's judge on JUDGE_MODEL.
//
// The judge cell (`judge/calibration`) holds the AI judge's rules to their
// example set (judge/): every example graded k times by the real judge on
// the platform's default model, its counts written to judge/calibration.ts
// with `--write-calibration`. It spends money for a purpose of its own, so
// it runs only when `--cells` names it, and is refused by name otherwise.
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
// Every working-agent timing cell needs the `stigmer` CLI on PATH: with memory
// on, the runner spawns `stigmer mcp-server` each turn, and without the CLI
// those turns fail. So the planner refuses them by name when the CLI is
// absent, the way it refuses a cell whose key is missing. A plugin eval's try
// loads no memory, so the quality arm needs no CLI.
//
// Refusals are by name and never silent: a cell the environment cannot run
// (no key for its provider, no key for the judge) or the flags exclude is a
// `RefusedCell` in the report, so a reader has one question to ask ("is the
// side present") and one place to see why not.
import type { AgentShape, BenchmarkHarness, ComparisonMode, RefusedCell, SessionShape } from "./report";

/** The registry ids the parity cells pin, per harness: one served model, two registry rows. */
export const PARITY_MODEL: Record<BenchmarkHarness, string> = {
  "deep-agent": "claude-sonnet-4.6",
  cursor: "claude-sonnet-4-6",
};

/** The judge model the quality arm's eval names for its AI-graded checks. */
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

/**
 * The working agent's timing session: read, edit, follow up. The edit turn
 * (the second) is the sampled one, the turn file review, the tool rounds and
 * a warm session all show on.
 */
export const WORKING_READ_EDIT_PROMPTS: readonly string[] = [
  'Read duration/duration.go. What does ParseMinutes return for "1h30m", and what does it do with "90s"?',
  'Make ParseMinutes accept seconds: "90s" should return 1, rounding down to whole minutes. Add a test case for it.',
  "Run the tests and tell me the result in one line.",
];

/**
 * The working agent's cross-turn session: three read-only questions, each
 * reaching a different one of the fixture's skills by its words (an order and
 * a customer, a data summary, the Go tests), so a native system prompt that
 * chose skills by the message would change on every turn. The sampled second
 * turn and its siblings record their cache writes; a turn whose system prompt
 * held writes only its own new tokens.
 */
export const WORKING_CROSS_TURN_PROMPTS: readonly string[] = [
  "What is the status of order ORD-4821, and can the customer still return it?",
  "Summarise data/signups.csv in two sentences: the key finding and its baseline.",
  "Run go test ./... and tell me in one line whether it passes.",
];

export interface Scenario {
  name: string;
  mode: ComparisonMode;
  sessionShape: SessionShape;
  agent: AgentShape;
  prompts: readonly string[];
}

export const SCENARIOS: readonly Scenario[] = [
  { name: "report-simple", mode: "default", sessionShape: "fresh-per-execution", agent: "bare", prompts: ["Reply with exactly: hello"] },
  { name: "report-medium", mode: "default", sessionShape: "fresh-per-execution", agent: "bare", prompts: ["Explain in one sentence what a hash table is."] },
  { name: "report-codegen", mode: "default", sessionShape: "fresh-per-execution", agent: "bare", prompts: [CODEGEN_PROMPT] },
  { name: "report-parity-simple", mode: "parity", sessionShape: "fresh-per-execution", agent: "bare", prompts: ["Reply with exactly: hello"] },
  { name: "report-parity-medium", mode: "parity", sessionShape: "fresh-per-execution", agent: "bare", prompts: ["Explain in one sentence what a hash table is."] },
  { name: "report-parity-codegen", mode: "parity", sessionShape: "fresh-per-execution", agent: "bare", prompts: [CODEGEN_PROMPT] },
  { name: "report-parity-turn-2", mode: "turn-2", sessionShape: "one-session-three-turns", agent: "bare", prompts: TURN_2_PROMPTS },
  { name: "working-read-edit", mode: "working-agent", sessionShape: "one-session-three-turns", agent: "working", prompts: WORKING_READ_EDIT_PROMPTS },
  { name: "working-cross-turn", mode: "working-agent", sessionShape: "one-session-three-turns", agent: "working", prompts: WORKING_CROSS_TURN_PROMPTS },
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

/** One target of the quality arm's eval: a harness on its parity model. */
export interface QualityTarget {
  /** `quality/<harness>`. */
  id: string;
  harness: BenchmarkHarness;
  modelRequested: string;
}

export interface PlanFlags {
  only?: BenchmarkHarness;
  /** A glob over cell ids (`*` matches any run of characters). */
  cells?: string;
  /**
   * Every execution asks for thinking. A cell on the harness's default model
   * is refused: thinking is a per-model capability, and the server refuses
   * it on Auto.
   */
  thinking?: "enabled";
}

export interface PlanEnvironment {
  anthropicKey: boolean;
  cursorKey: boolean;
  /** `stigmer` is on PATH (the working agent's memory spawns `stigmer mcp-server`). */
  stigmerCli: boolean;
}

/** The judge's calibration over its example set; it runs on the native path. */
export const JUDGE_CALIBRATION_CELL = "judge/calibration";

export interface CellPlan {
  cells: BenchmarkCell[];
  quality: QualityTarget[];
  /** Whether the judge cell runs. */
  judge: boolean;
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

export function qualityTargets(): QualityTarget[] {
  return HARNESSES.map((harness) => ({ id: `quality/${harness}`, harness, modelRequested: PARITY_MODEL[harness] }));
}

/**
 * What the environment and the flags allow, decided before the stack boots.
 * A native cell needs the Anthropic key; a Cursor cell the Cursor key; a
 * quality target needs its harness's key AND the Anthropic key, because the
 * judge runs on the native path. Every working-agent timing cell also needs
 * the `stigmer` CLI. The judge cell runs only when `--cells` names it, and
 * needs the Anthropic key. A thinking run refuses the cells on a harness's
 * default model. The first reason that applies is the one recorded: flags,
 * then keys, then the CLI.
 */
export function planCells(env: PlanEnvironment, flags: PlanFlags): CellPlan {
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
    if (flags.thinking !== undefined && cell.modelRequested === null) {
      refused.push({ cell: cell.id, reason: "thinking needs a pinned model" });
      return false;
    }
    if (!keyFor(cell.harness)) {
      refused.push({ cell: cell.id, reason: keyReason(cell.harness) });
      return false;
    }
    if (cell.scenario.agent === "working" && !env.stigmerCli) {
      refused.push({ cell: cell.id, reason: "missing stigmer CLI" });
      return false;
    }
    return true;
  });

  const quality = qualityTargets().filter((cell) => {
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

  let judge = false;
  const judgeFlagReason = excludedByFlags(JUDGE_CALIBRATION_CELL, "deep-agent");
  if (judgeFlagReason !== undefined) {
    refused.push({ cell: JUDGE_CALIBRATION_CELL, reason: judgeFlagReason });
  } else if (flags.cells === undefined) {
    refused.push({ cell: JUDGE_CALIBRATION_CELL, reason: "runs only when --cells names it" });
  } else if (!env.anthropicKey) {
    refused.push({ cell: JUDGE_CALIBRATION_CELL, reason: "missing ANTHROPIC_API_KEY" });
  } else {
    judge = true;
  }

  return { cells, quality, judge, refused };
}

/** `*` matches any run of characters; everything else is literal. */
export function globMatches(glob: string, id: string): boolean {
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`).test(id);
}
