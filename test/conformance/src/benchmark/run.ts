// The live benchmark's driver: boots the process kit in DIRECT mode (no mock
// proxy: the runner talks to the real providers with the keys in its
// environment), runs every planned cell against it, and assembles the report.
// Domain: conformance benchmark (the live half; an experiment, never a test).
//
// The stack is the local execution target's boot order (targets/local-
// execution.ts): the MCP tool fixture, Temporal, the server, then the runner
// spawned WITHOUT `proxy` and WITH a log file under the run's directory. The
// target itself is not reused because it hard-wires the mock proxy into every
// boot. The runner child inherits this process's environment, which is how
// ANTHROPIC_API_KEY and OPENAI_API_KEY (with OPENAI_BASE_URL, when the
// Stigmer-harness model is served on another OpenAI-compatible address) reach it;
// nothing is written anywhere. So one run holds one OpenAI-slot
// address, and measures one Stigmer-harness model (cells.ts).
//
// Every turn of every cell goes through one driver (session.ts), so a turn
// means the same thing wherever it is measured. Per attempt, a cell gets a
// fresh agent: the bare agent in a fresh org, or a freshly provisioned working
// agent (support/working-agent.ts) with its workspace re-seeded at one fixed
// path outside this repository. Everything an attempt created is removed when
// it ends. Each cell's first attempt is a discarded warm-up. The run's first
// call per harness, served model and agent shape is the cold call.
//
// The runner's background commands are the run's arm (`shellBackground`): on
// by default, off through the operator's setting the runner reads,
// STIGMER_SHELL_BACKGROUND_ENABLED, passed in its environment, so the off arm
// is the engine as an operator who turned it off runs it. The background
// cells' workspace gains the overlay's slow suite and server; before each of
// their attempts Go's test cache is cleared (a passing suite is otherwise
// answered from it at once, the workspace being re-seeded byte-identical),
// and an attempt whose server port is already taken is refused by name, so
// a leftover server can never answer for it. After every working-agent
// attempt the processes it left behind are counted and stopped
// (`orphans.ts`), and a cell's checks of the work are read into `task_done`.
//
// The quality arm is one eval run about a plugin (quality-eval.ts): the
// working agent as a plugin, pushed into a fresh organization, its `evals/`
// suite run by the platform with each planned harness's parity model as a
// target and the judge model for its AI-graded checks. Its result document
// is the report's `quality`.
//
// Nothing aborts the run but the stack itself. A provisioning or create error
// fails its attempt with `failure.stage: "create"`, and the run goes on.
//
// The server and the runner are the code under test; everything else is the
// instrument. They come from this checkout by default, or from another one
// (`stackRoot`, the script's `--stack`), built there: so one instrument, its
// clients and its readers from this tree, measures two versions of the code
// alike, and the report keys the arm by both (report.ts, schema v9). Once
// every execution has ended, the run's runner logs are read for the runner's
// marker lines (log-markers.ts).
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { FixtureTracker } from "../harness/fixtures";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { createTransport, makeClients } from "../harness/clients";
import { McpToolFixture } from "../harness/mcp-server";
import { fetchModelRegistryDocument, type ModelRegistryDocument } from "../harness/model-registry";
import { ensureRunnerBuilt } from "@stigmer/test-support/runner-build";
import { makeRunnerDirs, spawnRunner, type RunnerOptions, type RunningRunner } from "@stigmer/test-support/runner-process";
import { spawnServer, type RunningServer } from "@stigmer/test-support/server-process";
import { spawnTemporal, type RunningTemporal } from "@stigmer/test-support/temporal";
import { ensureLibraryServerEntry } from "@stigmer/test-support/ts-build";
import { type AgentRefInit, BARE_AGENT_INSTRUCTIONS, agentRefOf, makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { createUniqueOrganization } from "../support/organizations";
import {
  provisionWorkingAgent,
  WORKING_AGENT_BACKGROUND_OVERLAY_DIR,
  WORKING_AGENT_FIXTURE_DIR,
  WORKING_AGENT_MCP_TOOLS,
  WORKING_AGENT_WORKSPACE_NAME,
  workingAgentSessionSpec,
} from "../support/working-agent";
import {
  BACKGROUND_SERVER_PORT,
  BENCHMARK_SESSION_SUBJECT,
  JUDGE_MODEL,
  PARITY_MODEL,
  SESSION_HARNESS,
  doneChecksHold,
  explicitProvider,
  stigmerApi,
  type BenchmarkCell,
  type CellPlan,
  type Scenario,
} from "./cells";
import { readRunnerLogMarkers, renderRunnerLog } from "./log-markers";
import { listenersOn, sweepLeftovers } from "./orphans";
import { summarizeBackground } from "./background-readings";
import { renderQuality, runQualityEval } from "./quality-eval";
import {
  BENCHMARK_REPORT_SCHEMA_VERSION,
  HARNESSES,
  comparisonOf,
  summarize,
  type AgentShape,
  type BenchmarkComparison,
  type BenchmarkHarness,
  type BenchmarkReport,
  type BenchmarkSample,
  type BenchmarkStat,
  type QualityEval,
  type RefusedCell,
  type ShellBackground,
  type SiblingTurn,
} from "./report";
import { EXECUTION_BUDGET_MS, failedAtCreate, measureSession, type MeasuredTurn, type SessionPlan, type SessionStack } from "./session";

/**
 * Where the working agent's workspace is seeded before every session: one
 * fixed path, so the prompt that names it is the same in every session, and
 * outside this repository, so its go.work cannot capture the agent's `go`.
 */
export const WORKING_WORKSPACE_DIR = join(tmpdir(), "stigmer-benchmark", WORKING_AGENT_WORKSPACE_NAME);

const execFileAsync = promisify(execFile);

export interface BenchmarkStack extends SessionStack {
  serverBaseUrl: string;
  /** The run's directory, where every runner log is written. */
  runDir: string;
  /** The tool fixture the working agent's MCP server points at. */
  mcpFixture: McpToolFixture;
  /**
   * Ends the runner by `signal` and returns once a replacement serves, on the
   * same HOME and workspace root, as a pod restarted on a durable volume
   * does: the replacement sees the checkpoints and the workspace lock the
   * ended one left (the local execution target's door, `targets/local-execution.ts`).
   * Its output goes to `runner-<n>.log` beside the first runner's.
   */
  restartRunner(signal: "SIGKILL" | "SIGTERM"): Promise<void>;
  /** The serving runner's process id (a restart changes it). */
  runnerPid(): number;
  stop(): Promise<void>;
}

/**
 * The checkout whose server and runner a run boots: `stack`, resolved, when
 * given, else the instrument's own `instrumentRoot`. A path that is not a
 * stigmer checkout is refused by name before anything boots.
 */
export function resolveStackRoot(
  stack: string | undefined,
  instrumentRoot: string,
  isDirectory: (path: string) => boolean = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true,
): string {
  if (stack === undefined) return instrumentRoot;
  const root = resolve(stack);
  if (!isDirectory(join(root, "backend", "services", "runner"))) {
    throw new Error(`--stack ${root} is not a stigmer checkout: it has no backend/services/runner`);
  }
  return root;
}

export interface BenchmarkStackOptions {
  /** Whether the runner lets the Stigmer harness's agent start commands in the background; on unless off. */
  shellBackground?: ShellBackground;
}

/**
 * The MCP fixture, Temporal, then the server on it, then the runner in direct
 * mode; `stop()` reverses. The server and the runner are `stackRoot`'s (this
 * checkout's when absent), built there when their dist is missing.
 */
export async function bootBenchmarkStack(
  runDir: string,
  stackRoot?: string,
  options: BenchmarkStackOptions = {},
): Promise<BenchmarkStack> {
  await mkdir(runDir, { recursive: true });
  // The library entry: every working-agent cell provisions an organization
  // of its own (support/working-agent.ts).
  /* v8 ignore start -- @preserve: the live benchmark is a hand-run script no vitest config collects (vitest.unit.config.ts tests only its pure readers) */
  const serverEntry = await ensureLibraryServerEntry(stackRoot);
  const runnerEntry = await ensureRunnerBuilt(stackRoot);

  const mcpFixture = new McpToolFixture();
  await mcpFixture.start();
  // The runner's directories are the stack's, so a replacement runs on them.
  const runnerDirs = await makeRunnerDirs();
  let temporal: RunningTemporal | undefined;
  let server: RunningServer | undefined;
  let runner: RunningRunner | undefined;
  let runnerOptions: RunnerOptions | undefined;
  let restarts = 0;
  const stop = async (): Promise<void> => {
    await runner?.stop();
    await server?.stop();
    await temporal?.stop();
    await mcpFixture.close();
    await rm(runnerDirs.homeDir, { recursive: true, force: true });
    await rm(runnerDirs.workspaceDir, { recursive: true, force: true });
  };
  const restartRunner = async (signal: "SIGKILL" | "SIGTERM"): Promise<void> => {
    if (runner === undefined || runnerOptions === undefined) throw new Error("bootBenchmarkStack: no runner to restart");
    const ended = runner;
    runner = undefined;
    await ended.kill(signal);
    restarts += 1;
    runner = await spawnRunner({ ...runnerOptions, logFile: join(runDir, `runner-${restarts + 1}.log`) });
  };
  try {
    temporal = await spawnTemporal();
    server = await spawnServer(process.execPath, { args: [serverEntry], temporalHostPort: temporal.hostPort });
    const clients = makeClients(createTransport(server.baseUrl));
    await awaitGrpcReady(clients, () => server?.logTail() ?? "(no server)");
    runnerOptions = {
      entryPath: runnerEntry,
      temporalHostPort: temporal.hostPort,
      backendEndpoint: server.baseUrl,
      registryOrigin: server.baseUrl,
      artifactDir: server.artifactBaseDir,
      logFile: join(runDir, "runner.log"),
      dirs: runnerDirs,
      env: { STIGMER_SHELL_BACKGROUND_ENABLED: options.shellBackground === "off" ? "false" : "true" },
    };
    runner = await spawnRunner(runnerOptions);
    return {
      clients,
      serverBaseUrl: server.baseUrl,
      runDir,
      temporal: { hostPort: temporal.hostPort, namespace: temporal.namespace },
      runnerLogFile: runner.logFile,
      mcpFixture,
      restartRunner,
      runnerPid: () => {
        if (runner === undefined) throw new Error("bootBenchmarkStack: no runner is serving");
        return runner.pid;
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
  /* v8 ignore stop */
}

export interface RunIo {
  now: () => number;
  /** Prose for the operator; stderr. */
  log: (line: string) => void;
}

export interface RunOptions {
  reps: number;
  /** Tries per quality case and target. */
  qualityReps: number;
  git: BenchmarkReport["git"];
  titlingSuppressed: true;
  /** Every execution asks for thinking; the judge's never does. */
  thinking?: "enabled";
  /** Where the runner serves the Stigmer harness's model (cells.ts `stigmerEndpoint`, read from the runner's environment). */
  stigmerEndpoint: string;
  /** The arm the stack was booted on (`BenchmarkStackOptions.shellBackground`). */
  shellBackground: ShellBackground;
}

/**
 * Runs the plan against the stack and returns the report. Refuses, before
 * any call is paid for, a parity or judge model the registry does not carry
 * for its harness (an own-endpoint Stigmer-harness model needs no row, as on the
 * server); such cells join the plan's own refusals. The runner's marker
 * lines are counted last, when no execution is left running.
 */
export async function runBenchmark(stack: BenchmarkStack, plan: CellPlan, options: RunOptions, io: RunIo): Promise<BenchmarkReport> {
  const registry = await fetchModelRegistryDocument(stack.serverBaseUrl);
  const refused: RefusedCell[] = [...plan.refused];
  const cells = plan.cells.filter((cell) => {
    if (cell.modelRequested !== null && !registryHas(registry, cell.modelRequested, cell.harness)) {
      refused.push({ cell: cell.id, reason: "model not in registry for harness" });
      return false;
    }
    return true;
  });
  const qualityTargets = plan.quality.filter((cell) => {
    if (!registryHas(registry, cell.modelRequested, cell.harness) || !registryHas(registry, JUDGE_MODEL, "stigmer")) {
      refused.push({ cell: cell.id, reason: "model not in registry for harness" });
      return false;
    }
    return true;
  });

  // The run's first call per harness, served model and agent shape is the
  // cold call; a key is claimed by the cell whose warm-up first reports it.
  const coldSeen = new Set<string>();
  const statsByScenario = new Map<string, Partial<Record<BenchmarkHarness, BenchmarkStat>>>();

  for (const cell of cells) {
    io.log(`cell ${cell.id}: warm-up + ${options.reps} samples`);
    const measure = (attempt: number): Promise<BenchmarkSample> => measureCell(stack, cell, attempt, options.thinking, io);
    const warmup = await measure(0);
    const samples: BenchmarkSample[] = [];
    for (let i = 1; i <= options.reps; i++) samples.push(await measure(i));
    const coldKey = `${cell.harness}|${warmup.model_reported}|${cell.scenario.agent}`;
    let cold: BenchmarkSample | null = null;
    if (warmup.model_reported !== "" && !coldSeen.has(coldKey)) {
      coldSeen.add(coldKey);
      cold = warmup;
    }
    const stat = summarize(cell.harness, warmup, samples, cold);
    const entry = statsByScenario.get(cell.scenario.name) ?? {};
    entry[cell.harness] = stat;
    statsByScenario.set(cell.scenario.name, entry);
    io.log(`cell ${cell.id}: n=${stat.n} failed=${stat.failed} median_e2e=${stat.median ? `${stat.median.end_to_end_ms}ms` : "n/a"}`);
  }

  const comparisons: BenchmarkComparison[] = [];
  for (const cell of cells) {
    if (comparisons.some((comparison) => comparison.scenario === cell.scenario.name)) continue;
    /* v8 ignore next -- @preserve: the live benchmark is a hand-run script no vitest config collects; comparisonOf is tested */
    comparisons.push(comparisonOf(cell.scenario, statsByScenario.get(cell.scenario.name) ?? {}));
  }

  let quality: QualityEval | null = null;
  if (qualityTargets.length > 0) {
    io.log(`quality: one eval run, ${qualityTargets.map((cell) => cell.id).join(", ")}, ${options.qualityReps} tries per case`);
    quality = await runQualityEval(stack.clients, qualityTargets, { runs: options.qualityReps, judgeModel: JUDGE_MODEL }, io);
    io.log(`quality: ${quality.failure === undefined ? `eval ${quality.eval_id} ended` : `${quality.failure.stage}: ${quality.failure.message}`}`);
  }
  const runnerLog = await readRunnerLogMarkers(stack.runDir);

  return {
    schema_version: BENCHMARK_REPORT_SCHEMA_VERSION,
    timestamp: new Date(io.now()).toISOString(),
    git: options.git,
    host: { platform: `${process.platform}/${process.arch}`, node: process.version },
    methodology: {
      reps: options.reps,
      quality_reps: options.qualityReps,
      warmup_discarded: true,
      cold: "first-call-of-run-per-harness-model-and-agent",
      titling_suppressed: options.titlingSuppressed,
      file_review: "approved-at-review-ready",
      ...(options.thinking !== undefined ? { thinking_mode: options.thinking } : {}),
      shell_background: options.shellBackground,
    },
    models: {
      parity: { ...PARITY_MODEL, stigmer: plan.stigmerModel },
      judge_requested: JUDGE_MODEL,
      stigmer_endpoint: options.stigmerEndpoint,
      // The planner refuses every Stigmer cell whose provider it cannot place, so an unknown API measured nothing.
      stigmer_api: stigmerApi(plan.stigmerModel) ?? "chat-completions",
      stigmer_cost_basis: registry.models.some((row) => row.id === plan.stigmerModel && row.priced) ? "catalog" : "default-rate",
    },
    comparisons,
    quality,
    refused,
    runner_log: runnerLog,
  };
}

/**
 * Whether `id` can run on `harness`: a registry row for it, or on Stigmer an
 * explicit `openai:` / `anthropic:` model, which the server admits without a
 * row (server modelcatalog/pin-validation.ts `unknownModelPinRefusal`).
 */
function registryHas(registry: ModelRegistryDocument, id: string, harness: BenchmarkHarness): boolean {
  if (harness === "stigmer" && explicitProvider(id) !== undefined) return true;
  return registry.models.some((row) => row.id === id && row.harness === harness);
}

/** The agent an attempt runs, provisioned fresh; its resources are deferred on `fixtures`. */
interface ProvisionedAgent {
  org: string;
  agentRef: AgentRefInit;
  sessionSpec: MessageInitShape<typeof SessionSpecSchema>;
}

/* v8 ignore next -- @preserve: the live benchmark is a hand-run script no vitest config collects (vitest.unit.config.ts tests only its pure readers) */
async function provisionAgent(
  stack: BenchmarkStack,
  fixtures: FixtureTracker,
  cell: { agent: AgentShape; harness: BenchmarkHarness; overlay?: Scenario["overlay"] },
): Promise<ProvisionedAgent> {
  const harness = SESSION_HARNESS[cell.harness];
  if (cell.agent === "working") {
    const agent = await provisionWorkingAgent(stack.clients, fixtures, {
      mcpUrl: stack.mcpFixture.url(WORKING_AGENT_MCP_TOOLS),
      workspaceDir: WORKING_WORKSPACE_DIR,
      ...(cell.overlay === "background" ? { overlayDir: WORKING_AGENT_BACKGROUND_OVERLAY_DIR } : {}),
    });
    return { org: agent.org, agentRef: agent.agentRef, sessionSpec: workingAgentSessionSpec(agent, harness, BENCHMARK_SESSION_SUBJECT) };
  }
  // A real Organization, never a bare name: every edition answers NOT_FOUND
  // for one the server does not hold (support/organizations.ts).
  const { id: org } = await createUniqueOrganization(stack.clients.organizationCommand, "a bare benchmark agent");
  fixtures.defer(() => stack.clients.organizationCommand.delete({ value: org }));
  const agent = await stack.clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("bench-agent"), instructions: BARE_AGENT_INSTRUCTIONS }),
  );
  fixtures.defer(() => stack.clients.agentCommand.delete({ value: agent.metadata!.id }));
  return { org, agentRef: agentRefOf(agent), sessionSpec: { harness, subject: BENCHMARK_SESSION_SUBJECT } };
}

/** One attempt of a cell: one execution, or one three-turn session whose second turn is the sample. */
/* v8 ignore next -- @preserve: the live benchmark is a hand-run script no vitest config collects (vitest.unit.config.ts tests only its pure readers) */
async function measureCell(
  stack: BenchmarkStack,
  cell: BenchmarkCell,
  attempt: number,
  thinking: "enabled" | undefined,
  io: RunIo,
): Promise<BenchmarkSample> {
  const fixtures = new FixtureTracker();
  const label = `${cell.id}#${attempt}`;
  const { scenario } = cell;
  try {
    if (scenario.overlay === "background") {
      const refusal = await prepareBackgroundAttempt();
      if (refusal !== undefined) {
        io.log(`${label}: ${refusal}`);
        return failedAtCreate(cell.modelRequested, refusal);
      }
    }
    let agent: ProvisionedAgent;
    try {
      agent = await provisionAgent(stack, fixtures, {
        agent: scenario.agent,
        harness: cell.harness,
        ...(scenario.overlay !== undefined ? { overlay: scenario.overlay } : {}),
      });
    } catch (error) {
      io.log(`${label}: provisioning failed: ${errorMessage(error)}`);
      return failedAtCreate(cell.modelRequested, `provision the agent: ${errorMessage(error)}`);
    }
    const plan: SessionPlan = {
      org: agent.org,
      agentRef: agent.agentRef,
      harness: cell.harness,
      modelRequested: cell.modelRequested,
      ...(thinking !== undefined ? { thinking } : {}),
      sessionSpec: agent.sessionSpec,
      prompts: cell.scenario.sessionShape === "fresh-per-execution" ? cell.scenario.prompts.slice(0, 1) : cell.scenario.prompts,
      label,
    };
    const turns = await measureSession(stack, plan, io);
    const sampled = cell.scenario.sessionShape === "fresh-per-execution" ? turns[0]! : turns[1]!;
    if (scenario.agent === "working") await readAfterAttempt(stack, scenario, sampled, label, io);
    if (cell.scenario.sessionShape === "fresh-per-execution") return sampled.sample;
    // One session, three turns: the second turn is the sample, the others
    // ride on it as siblings.
    const sibling = (turnSeq: number, turn: MeasuredTurn): SiblingTurn => ({
      turn_seq: turnSeq,
      execution_id: turn.sample.execution_id,
      measures: turn.sample.measures,
      timing: turn.sample.timing,
      tool_calls: turn.sample.tool_calls,
      todos: turn.sample.todos,
      outcome: turn.sample.outcome,
      ...(turn.sample.failure !== undefined ? { failure: turn.sample.failure } : {}),
    });
    return { ...turns[1]!.sample, sibling_turns: [sibling(1, turns[0]!), sibling(3, turns[2]!)] };
  } finally {
    await fixtures.cleanup();
  }
}

/**
 * Before a background cell's attempt: Go's test cache cleared, and the
 * server's port free. Returns why the attempt is refused, if it is.
 */
/* v8 ignore next -- @preserve: the live benchmark is a hand-run script no vitest config collects (vitest.unit.config.ts tests only its pure readers) */
async function prepareBackgroundAttempt(): Promise<string | undefined> {
  try {
    await execFileAsync("go", ["clean", "-testcache"]);
  } catch (error) {
    return `clear Go's test cache: ${errorMessage(error)}`;
  }
  const holders = await listenersOn(BACKGROUND_SERVER_PORT);
  if (holders.length > 0) {
    return `port ${BACKGROUND_SERVER_PORT} is already taken (pid ${holders.join(", ")}): its server would answer for this attempt's`;
  }
  return undefined;
}

/**
 * After a working-agent attempt, before its workspace is re-seeded: what it
 * left running, counted and stopped, and the cell's checks of the work, both
 * onto the sampled turn.
 */
/* v8 ignore next -- @preserve: the live benchmark is a hand-run script no vitest config collects (vitest.unit.config.ts tests only its pure readers) */
async function readAfterAttempt(stack: BenchmarkStack, scenario: Scenario, sampled: MeasuredTurn, label: string, io: RunIo): Promise<void> {
  const { sample } = sampled;
  try {
    const orphans = await sweepLeftovers({ workspaceDir: WORKING_WORKSPACE_DIR, port: BACKGROUND_SERVER_PORT, runnerPid: stack.runnerPid() });
    if (orphans > 0) io.log(`${label}: stopped ${orphans} process group(s) the attempt left running`);
    if (sample.background !== null) sample.background.orphans = orphans;
  } catch (error) {
    io.log(`${label}: could not look for processes left running: ${errorMessage(error)}`);
  }
  const checks = scenario.doneChecks;
  if (checks === undefined || sample.execution_id === "") return;
  const files = new Map<string, string | undefined>();
  for (const check of checks) {
    if (check.target.source !== "file") continue;
    files.set(check.target.path, await readFile(join(WORKING_WORKSPACE_DIR, check.target.path), "utf8").catch(() => undefined));
  }
  sample.task_done = doneChecksHold(checks, { reply: sampled.reply, commandOutputs: sampled.commandOutputs, files });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The summary's background table (`summarizeBackground`), headed by the run's arm. */
function renderBackgroundTable(report: BenchmarkReport): string[] {
  const rows: string[] = [];
  const value = (n: number | null): string => (n === null ? "n/a" : String(Math.round(n)));
  for (const comparison of report.comparisons) {
    for (const harness of HARNESSES) {
      const side = comparison.sides[harness];
      if (side === undefined) continue;
      const summary = summarizeBackground(side.samples);
      if (summary === null) continue;
      const done = summary.task_done === null ? "n/a" : `${summary.task_done.done}/${summary.task_done.of}`;
      rows.push(
        `| ${comparison.scenario} | ${side.harness} | ${summary.used}/${summary.ran} | ${summary.starts} | ${value(summary.polls_median)} (max ${value(summary.polls_max)}) | ${value(summary.worked_while_running_ms)} | ${summary.waits} | ${summary.reminders} | ${summary.self_backgrounded} | ${summary.foreground_timeouts} | ${summary.gated_while_running} | ${summary.orphans} | ${done} |`,
      );
    }
  }
  if (rows.length === 0) return [];
  return [
    "",
    `Background commands (${report.methodology.shell_background}), over the samples that ran:`,
    "",
    "| scenario | harness | used | starts | polls median | worked while running ms | waits | reminders | own & | fg timeouts | would pause | left running | task done |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ];
}

/** Writes the report as `<timestamp>-<sha>.json` under `dir` and returns the path. */
export async function writeReport(dir: string, report: BenchmarkReport): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = report.timestamp.replace(/[:.]/g, "-");
  const sha = report.git.head_sha.replace(/-dirty$/, "").slice(0, 9);
  const path = join(dir, `${stamp}-${sha}.json`);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/**
 * One row per cell: the medians a reader wants at a glance, the quality
 * medians, and the refusals. Markdown, for stdout. A Stigmer cost the runner
 * took at its default rate is marked, with a line naming why, so it is never
 * read as a price. Then what the agent did with background commands, cell by
 * cell, over the samples that ran.
 */
export function renderSummary(report: BenchmarkReport): string {
  const lines: string[] = [];
  const cell = (value: number | null | undefined): string => (value === null || value === undefined ? "n/a" : String(Math.round(value)));
  const defaultRate = report.models.stigmer_cost_basis === "default-rate";
  let markedStigmer = false;
  lines.push(
    `Stigmer arm: ${report.models.parity.stigmer} at ${report.models.stigmer_endpoint}, ${report.models.stigmer_api} API, cost basis ${report.models.stigmer_cost_basis}`,
    `Code: ${report.git.code_sha}${report.git.code_sha === report.git.head_sha ? " (the instrument's own)" : `, measured by the instrument at ${report.git.head_sha}`}`,
    `Runner log: ${renderRunnerLog(report.runner_log)}`,
    "",
  );
  lines.push(
    `| scenario | harness | n | failed | e2e ms | first token ms | runner first token ms | before activity ms | rounds | tool calls | mcp connect ms | est. cost µ$ | cache hit | model |`,
  );
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const comparison of report.comparisons) {
    for (const harness of HARNESSES) {
      const side = comparison.sides[harness];
      if (side === undefined) continue;
      const m = side.median;
      const marked = defaultRate && side.harness === "stigmer" && m !== null;
      if (marked) markedStigmer = true;
      const cost = `${cell(m?.estimated_cost_micros)}${marked ? "*" : ""}`;
      lines.push(
        `| ${comparison.scenario} | ${side.harness} | ${side.n} | ${side.failed} | ${cell(m?.end_to_end_ms)} | ${cell(m?.client_first_visible_token_ms)} | ${cell(m?.runner_first_visible_token_ms)} | ${cell(m?.before_activity_ms)} | ${cell(m?.rounds)} | ${cell(m?.tool_calls)} | ${cell(m?.mcp_connect_ms)} | ${cost} | ${Math.round(side.cache_hit_ratio * 100)}% | ${side.models.join(",") || "n/a"} |`,
      );
    }
  }
  if (markedStigmer) {
    lines.push(
      "",
      `* ${report.models.parity.stigmer} has no priced catalog row: its cost is the runner's default rate, not a price; price it from the samples' tokens at the provider's rate.`,
    );
  }
  lines.push(...renderBackgroundTable(report));
  lines.push(...renderQuality(report.quality));
  if (report.refused.length > 0) {
    lines.push("");
    lines.push("Refused:");
    for (const refusal of report.refused) lines.push(`- ${refusal.cell}: ${refusal.reason}`);
  }
  return lines.join("\n");
}
