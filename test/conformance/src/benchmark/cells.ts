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
// three timing cells are three turns in one session with the second sampled:
// one reads, then edits, then follows up; one asks three read-only questions
// that each reach a different skill, the session whose later turns show
// whether the system prompt, and so the provider's prompt cache, held from one
// message to the next; and one asks why a sync failed, from a log too long to
// read whole whose cause is written in its last lines, the turn that shows
// what the agent sees of a tool result past the runner's bound.
//
// Two more working-agent cells are single turns where running a command in
// the background pays, asked in a person's ordinary words that never name
// the background: run a slow test suite while fixing a bug, and start a
// server and call it. Their workspace gains a slow suite and a server from
// an overlay (fixtures/working-agent-background), copied over the seed for
// these cells only, so every other cell and the quality eval read the bytes
// they always did. Each names checks of the work (`doneChecks`), read after
// the turn into the sample's `task_done`. Every other cell is their control:
// a background start there is the agent using it where it does not pay.
//
// The quality arm is the working agent as a plugin with an `evals/` suite
// (fixtures/working-agent, the plugin-eval format), run by one eval run
// about the plugin, with each harness on its parity model as a
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
// absent, the way it refuses a cell whose key is missing. An eval run's try
// loads no memory, so the quality arm needs no CLI.
//
// Refusals are by name and never silent: a cell the environment cannot run
// (no key for its provider, no key for the judge) or the flags exclude is a
// `RefusedCell` in the report, so a reader has one question to ask ("is the
// side present") and one place to see why not.
//
// The native arm's model is a flag (`--native-model`): a catalog id, or the
// own-endpoint form `openai:<name>` / `anthropic:<name>` the server and the
// runner accept on native without a catalog row (server modelcatalog/
// pin-validation.ts). It replaces PARITY_MODEL["deep-agent"] in the native
// parity, turn-2 and working cells and the native quality target; the Cursor
// arm, the judge and every prompt stay as they are, so the grader is the same
// in every arm. One run measures one native model, because the runner the
// benchmark spawns holds one OpenAI-slot key and address (its environment's
// OPENAI_API_KEY and OPENAI_BASE_URL) for the whole run. Which key a native
// cell needs follows the model's provider, derived here the way the runner
// derives it (`nativeProvider`).
import type { AgentShape, BenchmarkHarness, ComparisonMode, NativeApi, RefusedCell, SessionShape } from "./report";

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

/**
 * The working agent's long-log session: a question about the code, then why
 * last night's sync failed, from a log of about 49,000 characters (above the
 * runner's 30,000-character bound on a tool result, in fewer lines than a read
 * returns by default) whose cause sits in its last lines, then the setting
 * behind it. The second turn is the sampled one.
 */
export const WORKING_LONG_LOG_PROMPTS: readonly string[] = [
  "In one sentence, what does syncer/syncer.go do?",
  "Last night's sync failed; its log is logs/sync-2026-10-20.log. Why did it fail?",
  "Which setting in config/sync.yaml decides how long it kept trying?",
];

/** The port the background cells' server listens on (fixtures/working-agent-background). */
export const BACKGROUND_SERVER_PORT = 8765;

/** The slow-suite job: start the minute-long suite, fix a bug while it runs, hear how it ended. */
export const BACKGROUND_SLOW_SUITE_PROMPT =
  'Two things. The integration tests in ./integration take about a minute: run them and tell me whether they pass. And make ParseMinutes in duration/duration.go accept seconds ("90s" is 1, rounding down), with a test case.';

/** The server job: a process that never ends on its own, called twice. */
export const BACKGROUND_DEV_SERVER_PROMPT = `Start the service's HTTP server (go run ./cmd/server; it listens on 127.0.0.1:${BACKGROUND_SERVER_PORT}) and tell me what GET /minutes?d=1h30m and GET /minutes?d=90s return.`;

/**
 * One check of a cell's work, in the quality cases' regex shape
 * (fixtures/working-agent/evals/<case>/case.yaml): a pattern over a
 * workspace file, the agent's final reply, or what its shell commands
 * printed (a foreground call's result or a background command's output).
 */
export interface DoneCheck {
  name: string;
  pattern: string;
  flags?: string;
  target: { source: "file"; path: string } | { source: "reply" } | { source: "command_output" };
}

/** What a cell's checks read, gathered after the turn. */
export interface DoneSources {
  reply: string;
  /** Everything the turn's shell commands printed. */
  commandOutputs: readonly string[];
  /** The workspace files the checks name; `undefined` for one that is not there. */
  files: ReadonlyMap<string, string | undefined>;
}

/** Whether every check holds; a file that is not there fails its check. */
export function doneChecksHold(checks: readonly DoneCheck[], sources: DoneSources): boolean {
  return checks.every((check) => {
    const pattern = new RegExp(check.pattern, check.flags);
    switch (check.target.source) {
      case "reply":
        return pattern.test(sources.reply);
      case "command_output":
        return sources.commandOutputs.some((output) => pattern.test(output));
      case "file": {
        const text = sources.files.get(check.target.path);
        return text !== undefined && pattern.test(text);
      }
    }
  });
}

export interface Scenario {
  name: string;
  mode: ComparisonMode;
  sessionShape: SessionShape;
  agent: AgentShape;
  prompts: readonly string[];
  /**
   * Files copied over the working agent's seeded workspace for this cell
   * alone: `background` is fixtures/working-agent-background's slow suite and
   * server (support/working-agent.ts `WORKING_AGENT_BACKGROUND_OVERLAY_DIR`).
   */
  overlay?: "background";
  /** Checks of the work, read after each attempt into `task_done`. */
  doneChecks?: readonly DoneCheck[];
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
  { name: "working-long-log", mode: "working-agent", sessionShape: "one-session-three-turns", agent: "working", prompts: WORKING_LONG_LOG_PROMPTS },
  {
    name: "background-slow-suite",
    mode: "working-agent",
    sessionShape: "fresh-per-execution",
    agent: "working",
    prompts: [BACKGROUND_SLOW_SUITE_PROMPT],
    overlay: "background",
    doneChecks: [
      { name: "suite-passed", pattern: "^ok\\s+\\S*integration", flags: "m", target: { source: "command_output" } },
      { name: "seconds-test", pattern: '"\\d+s"', target: { source: "file", path: "duration/duration_test.go" } },
    ],
  },
  {
    name: "background-dev-server",
    mode: "working-agent",
    sessionShape: "fresh-per-execution",
    agent: "working",
    prompts: [BACKGROUND_DEV_SERVER_PROMPT],
    overlay: "background",
    doneChecks: [
      { name: "hours-answered", pattern: "\\b90\\b", target: { source: "reply" } },
      { name: "seconds-refused", pattern: "\\b400\\b|unknown unit|error", flags: "i", target: { source: "reply" } },
    ],
  },
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
  /** The native arm's model, in place of PARITY_MODEL["deep-agent"]; the native `default` cells are then refused. */
  nativeModel?: string;
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
  /** OPENAI_API_KEY, the key an OpenAI-provider native model is served with (whatever OPENAI_BASE_URL names). */
  openaiKey: boolean;
  cursorKey: boolean;
  /** `stigmer` is on PATH (the working agent's memory spawns `stigmer mcp-server`). */
  stigmerCli: boolean;
}

/** The judge's calibration over its example set; it runs on the native path. */
export const JUDGE_CALIBRATION_CELL = "judge/calibration";

export interface CellPlan {
  /** The native arm's model: `--native-model`, else PARITY_MODEL["deep-agent"]. */
  nativeModel: string;
  cells: BenchmarkCell[];
  quality: QualityTarget[];
  /** Whether the judge cell runs. */
  judge: boolean;
  refused: RefusedCell[];
}

/** Every cell, the native pinned cells on `nativeModel`. */
export function benchmarkCells(nativeModel: string = PARITY_MODEL["deep-agent"]): BenchmarkCell[] {
  return SCENARIOS.flatMap((scenario) =>
    HARNESSES.map((harness) => ({
      id: `${scenario.name}/${harness}`,
      scenario,
      harness,
      modelRequested: scenario.mode === "default" ? null : armModel(harness, nativeModel),
    })),
  );
}

/** One quality target per harness, the native one on `nativeModel`. */
export function qualityTargets(nativeModel: string = PARITY_MODEL["deep-agent"]): QualityTarget[] {
  return HARNESSES.map((harness) => ({ id: `quality/${harness}`, harness, modelRequested: armModel(harness, nativeModel) }));
}

function armModel(harness: BenchmarkHarness, nativeModel: string): string {
  return harness === "deep-agent" ? nativeModel : PARITY_MODEL[harness];
}

/** The providers native serves a model through. */
export type NativeProvider = "anthropic" | "openai";

const OPENAI_NAME_PREFIXES = ["gpt", "o1", "o3", "o4", "chatgpt"] as const;

/**
 * The provider of an explicit `openai:<name>` / `anthropic:<name>` model,
 * case-insensitive, with a non-empty name after the colon; `undefined` for
 * any other name. The server's rule (modelcatalog/document-catalog.ts
 * `explicitProvider`), copied rather than imported: this suite never imports
 * server or runner internals.
 */
export function explicitProvider(model: string): NativeProvider | undefined {
  const colon = model.indexOf(":");
  if (colon <= 0 || colon === model.length - 1) return undefined;
  const prefix = model.slice(0, colon).toLowerCase();
  return prefix === "anthropic" || prefix === "openai" ? prefix : undefined;
}

/**
 * The provider the runner serves `model` through, in the runner's own order
 * (runner shared/llm-proxy.ts `inferProvider`): the explicit prefix, then a
 * name starting `claude`, then one starting `gpt`, `o1`, `o3`, `o4` or
 * `chatgpt`; `undefined` where the runner would refuse the name.
 */
export function nativeProvider(model: string): NativeProvider | undefined {
  const explicit = explicitProvider(model);
  if (explicit !== undefined) return explicit;
  const lower = model.toLowerCase();
  if (lower.startsWith("claude")) return "anthropic";
  return OPENAI_NAME_PREFIXES.some((prefix) => lower.startsWith(prefix)) ? "openai" : undefined;
}

/**
 * The API a native model is called on: Anthropic's Messages API, or for an
 * OpenAI-provider model the one LangChain's ChatOpenAI picks by the name
 * (@langchain/openai utils/misc.js `_modelPrefersResponsesAPI`: a name
 * containing `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro` or `codex` goes to
 * the Responses API, every other to Chat Completions; the runner never sets
 * `useResponsesApi`). `undefined` where the provider is unknown.
 */
export function nativeApi(model: string): NativeApi | undefined {
  const provider = nativeProvider(model);
  if (provider === undefined) return undefined;
  if (provider === "anthropic") return "messages";
  const prefersResponses = ["gpt-5.2-pro", "gpt-5.4-pro", "gpt-5.5-pro", "codex"].some((marker) => model.includes(marker));
  return prefersResponses ? "responses" : "chat-completions";
}

/** The runner environment variables that decide where a native model is served. */
export interface EndpointEnvironment {
  OPENAI_BASE_URL?: string | undefined;
  ANTHROPIC_BASE_URL?: string | undefined;
  STIGMER_ANTHROPIC_BACKEND?: string | undefined;
}

/**
 * Where the runner the benchmark spawns sends a native model's calls, as a
 * host and never a key or a path: OPENAI_BASE_URL's host for an OpenAI-provider
 * model (the OpenAI SDK reads it when the runner passes no base URL, which in
 * direct mode it never does; default api.openai.com); for an Anthropic model,
 * the backend STIGMER_ANTHROPIC_BACKEND names when it is not `public`
 * (runner shared/llm-backend.ts), else ANTHROPIC_BASE_URL's host (default
 * api.anthropic.com). An unparseable URL is recorded as "invalid
 * <variable>"; the runner refuses it at boot. "unknown" for a model whose
 * provider is unknown.
 */
export function nativeEndpoint(model: string, env: EndpointEnvironment): string {
  const provider = nativeProvider(model);
  if (provider === undefined) return "unknown";
  if (provider === "openai") return hostOf(env.OPENAI_BASE_URL, "OPENAI_BASE_URL", "api.openai.com");
  const backend = env.STIGMER_ANTHROPIC_BACKEND?.trim() ?? "";
  if (backend !== "" && backend !== "public") return backend;
  return hostOf(env.ANTHROPIC_BASE_URL, "ANTHROPIC_BASE_URL", "api.anthropic.com");
}

function hostOf(raw: string | undefined, variable: string, fallback: string): string {
  const value = raw?.trim() ?? "";
  if (value === "") return fallback;
  try {
    return new URL(value).host;
  } catch {
    return `invalid ${variable}`;
  }
}

/**
 * What the environment and the flags allow, decided before the stack boots.
 * A native cell needs the key of its model's provider (`nativeProvider`;
 * a model it cannot place is refused as the runner would refuse it); a
 * Cursor cell the Cursor key; a quality target needs its harness's key AND
 * the Anthropic key, because the judge runs on the native path. Every
 * working-agent timing cell also needs the `stigmer` CLI. The judge cell runs
 * only when `--cells` names it, and needs the Anthropic key. Under
 * `--native-model` the native `default` cells are refused: their point is
 * that each harness picks its own model. A thinking run refuses the cells on
 * a harness's default model, and the native cells when the native model is
 * not a catalog Claude model (the runner maps thinking for Anthropic models
 * only, and an own-endpoint model has no catalog row to state its form). The
 * first reason that applies is the one recorded: flags, then keys, then the
 * CLI.
 */
export function planCells(env: PlanEnvironment, flags: PlanFlags): CellPlan {
  const nativeModel = flags.nativeModel ?? PARITY_MODEL["deep-agent"];
  const refused: RefusedCell[] = [];
  const keyReason = (harness: BenchmarkHarness, model: string | null): RefusedCell["reason"] | undefined => {
    if (harness === "cursor") return env.cursorKey ? undefined : "missing CURSOR_API_KEY";
    // A default cell names no model; the harness's default is a catalog Claude model.
    const provider = model === null ? "anthropic" : nativeProvider(model);
    if (provider === undefined) return "model provider unknown";
    if (provider === "openai") return env.openaiKey ? undefined : "missing OPENAI_API_KEY";
    return env.anthropicKey ? undefined : "missing ANTHROPIC_API_KEY";
  };
  const excludedByFlags = (id: string, harness: BenchmarkHarness): RefusedCell["reason"] | undefined => {
    if (flags.only !== undefined && flags.only !== harness) return "excluded by --only";
    if (flags.cells !== undefined && !globMatches(flags.cells, id)) return "excluded by --cells";
    return undefined;
  };
  const thinkingRefusal = (cell: BenchmarkCell): RefusedCell["reason"] | undefined => {
    if (flags.thinking === undefined) return undefined;
    if (cell.modelRequested === null) return "thinking needs a pinned model";
    if (cell.harness === "deep-agent" && (explicitProvider(cell.modelRequested) !== undefined || nativeProvider(cell.modelRequested) !== "anthropic")) {
      return "thinking needs a catalog Claude model";
    }
    return undefined;
  };

  const cells = benchmarkCells(nativeModel).filter((cell) => {
    const flagReason = excludedByFlags(cell.id, cell.harness);
    if (flagReason !== undefined) {
      refused.push({ cell: cell.id, reason: flagReason });
      return false;
    }
    if (flags.nativeModel !== undefined && cell.harness === "deep-agent" && cell.modelRequested === null) {
      refused.push({ cell: cell.id, reason: "the native model is pinned by --native-model" });
      return false;
    }
    const thinking = thinkingRefusal(cell);
    if (thinking !== undefined) {
      refused.push({ cell: cell.id, reason: thinking });
      return false;
    }
    const missingKey = keyReason(cell.harness, cell.modelRequested);
    if (missingKey !== undefined) {
      refused.push({ cell: cell.id, reason: missingKey });
      return false;
    }
    if (cell.scenario.agent === "working" && !env.stigmerCli) {
      refused.push({ cell: cell.id, reason: "missing stigmer CLI" });
      return false;
    }
    return true;
  });

  const quality = qualityTargets(nativeModel).filter((cell) => {
    const flagReason = excludedByFlags(cell.id, cell.harness);
    if (flagReason !== undefined) {
      refused.push({ cell: cell.id, reason: flagReason });
      return false;
    }
    const missingKey = keyReason(cell.harness, cell.modelRequested);
    if (missingKey !== undefined) {
      refused.push({ cell: cell.id, reason: missingKey });
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

  return { nativeModel, cells, quality, judge, refused };
}

/** `*` matches any run of characters; everything else is literal. */
export function globMatches(glob: string, id: string): boolean {
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`).test(id);
}
