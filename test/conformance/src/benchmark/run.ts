// The live benchmark's driver: boots the process kit in DIRECT mode (no mock
// proxy: the runner talks to the real providers with the keys in its
// environment), runs every planned cell against it, reads each execution
// through the five readers, and assembles the report.
// Domain: conformance benchmark (the live half; an experiment, never a test).
//
// The stack is the local execution target's boot order (targets/local-
// execution.ts) with the runner spawned WITHOUT `proxy` and WITH a log file
// under the run's directory; the target itself is not reused because it
// hard-wires the mock proxy and the MCP fixture into every boot. The runner
// child inherits this process's environment, which is how ANTHROPIC_API_KEY
// and CURSOR_API_KEY reach it; nothing is written anywhere.
//
// Per execution, in order: the clock is read, the execution is created with
// the one-call session bootstrap (a FRESH session per execution, with a fixed
// subject so the background titling activity returns early), the subscribe
// stream is watched to the terminal phase, then the status facts, the runner's
// two timing lines (re-read from the log until present) and the Temporal
// history are joined by execution id. Nothing is retried: a provider fault or
// a stall is a fact about the harness under measurement and stays on the
// sample as its outcome. Each cell's first attempt is a discarded warm-up;
// the run's first call per harness and served model is the cold call.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import { fetchModelRegistryDocument, type ModelRegistryDocument } from "../harness/model-registry";
import { ensureRunnerBuilt } from "../harness/runner-build";
import { spawnRunner, type RunningRunner } from "../harness/runner-process";
import { spawnServer, type RunningServer } from "../harness/server-process";
import { spawnTemporal, type RunningTemporal } from "../harness/temporal";
import { ensureTsServerEntry } from "../harness/ts-build";
import { BARE_AGENT_INSTRUCTIONS, makeAgent } from "../support/agents";
import { makeAgentExecution } from "../support/agentexecutions";
import { uniqueName, uniqueOrg } from "../support/naming";
import { awaitTerminal as awaitWorkflowTerminal, makeWorkflowExecution } from "../support/workflowexecutions";
import { makeGradedAgentCallWorkflow } from "../support/workflows";
import {
  BENCHMARK_SESSION_SUBJECT,
  JUDGE_MODEL,
  PARITY_MODEL,
  type BenchmarkCell,
  type CellPlan,
  type QualityCell as PlannedQualityCell,
} from "./cells";
import { verdictOf } from "./quality";
import {
  BENCHMARK_REPORT_SCHEMA_VERSION,
  costRatio,
  summarize,
  type BenchmarkComparison,
  type BenchmarkHarness,
  type BenchmarkReport,
  type BenchmarkSample,
  type BenchmarkStat,
  type QualityCell,
  type RefusedCell,
  type SiblingTurn,
} from "./report";
import { nullAxes, statusFacts } from "./status-facts";
import { subscribeTo, watchExecution } from "./stream-watch";
import { executeActivityNameFor, historyAxes, invokeWorkflowIdFor, showWorkflow } from "./temporal-history";
import { awaitTimingLines, axesFromTiming } from "./timing-lines";

/** How long one execution may take before the sample is a `timeout`: a live codegen turn outlives the poll core's default. */
export const EXECUTION_BUDGET_MS = 10 * 60_000;

export interface BenchmarkStack {
  clients: ConformanceClients;
  serverBaseUrl: string;
  temporal: { hostPort: string; namespace: string };
  runnerLogFile: string;
  stop(): Promise<void>;
}

/** Temporal, then the server on it, then the runner in direct mode; `stop()` reverses. */
export async function bootBenchmarkStack(runDir: string): Promise<BenchmarkStack> {
  await mkdir(runDir, { recursive: true });
  const serverEntry = await ensureTsServerEntry();
  const runnerEntry = await ensureRunnerBuilt();

  const temporal: RunningTemporal = await spawnTemporal();
  let server: RunningServer | undefined;
  let runner: RunningRunner | undefined;
  const stop = async (): Promise<void> => {
    await runner?.stop();
    await server?.stop();
    await temporal.stop();
  };
  try {
    server = await spawnServer(process.execPath, { args: [serverEntry], temporalHostPort: temporal.hostPort });
    const clients = makeClients(createTransport(server.baseUrl));
    await awaitGrpcReady(clients, () => server?.logTail() ?? "(no server)");
    runner = await spawnRunner({
      entryPath: runnerEntry,
      temporalHostPort: temporal.hostPort,
      backendEndpoint: server.baseUrl,
      registryOrigin: server.baseUrl,
      artifactDir: server.artifactBaseDir,
      artifactServeUrl: server.artifactServeUrl,
      logFile: join(runDir, "runner.log"),
    });
    return {
      clients,
      serverBaseUrl: server.baseUrl,
      temporal: { hostPort: temporal.hostPort, namespace: temporal.namespace },
      runnerLogFile: runner.logFile,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export interface RunIo {
  now: () => number;
  /** Prose for the operator; stderr. */
  log: (line: string) => void;
}

export interface RunOptions {
  reps: number;
  git: BenchmarkReport["git"];
  titlingSuppressed: true;
}

/**
 * Runs the plan against the stack and returns the report. Refuses, before
 * any call is paid for, a parity or judge model the registry does not carry
 * for its harness; such cells join the plan's own refusals.
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
  const quality = plan.quality.filter((cell) => {
    if (!registryHas(registry, cell.modelRequested, cell.harness) || !registryHas(registry, JUDGE_MODEL, "deep-agent")) {
      refused.push({ cell: cell.id, reason: "model not in registry for harness" });
      return false;
    }
    return true;
  });

  // The run's first call per harness and served model is the cold call; a
  // key is claimed by the cell whose warm-up first reports that model.
  const coldSeen = new Set<string>();
  const statsByScenario = new Map<string, Partial<Record<BenchmarkHarness, BenchmarkStat>>>();

  for (const cell of cells) {
    io.log(`cell ${cell.id}: warm-up + ${options.reps} samples`);
    const measure = (attempt: number): Promise<BenchmarkSample> => measureCell(stack, cell, attempt, io);
    const warmup = await measure(0);
    const samples: BenchmarkSample[] = [];
    for (let i = 1; i <= options.reps; i++) samples.push(await measure(i));
    const coldKey = `${cell.harness}|${warmup.model_reported}`;
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
    const sides = statsByScenario.get(cell.scenario.name) ?? {};
    comparisons.push({
      scenario: cell.scenario.name,
      prompts: [...cell.scenario.prompts],
      mode: cell.scenario.mode,
      session_shape: cell.scenario.sessionShape,
      ...(sides["deep-agent"] !== undefined ? { native: sides["deep-agent"] } : {}),
      ...(sides.cursor !== undefined ? { cursor: sides.cursor } : {}),
      ...(costRatio(sides["deep-agent"], sides.cursor) !== undefined ? { cost_ratio: costRatio(sides["deep-agent"], sides.cursor) } : {}),
    });
  }

  const graded: QualityCell[] = [];
  for (const cell of quality) {
    io.log(`quality ${cell.id}`);
    graded.push(await gradeCell(stack, cell));
  }

  return {
    schema_version: BENCHMARK_REPORT_SCHEMA_VERSION,
    timestamp: new Date(io.now()).toISOString(),
    git: options.git,
    host: { platform: `${process.platform}/${process.arch}`, node: process.version },
    methodology: {
      reps: options.reps,
      warmup_discarded: true,
      cold: "first-call-of-run-per-harness-and-model",
      titling_suppressed: options.titlingSuppressed,
    },
    models: { parity_native: PARITY_MODEL["deep-agent"], parity_cursor: PARITY_MODEL.cursor, judge_requested: JUDGE_MODEL },
    comparisons,
    quality: graded,
    refused,
  };
}

function registryHas(registry: ModelRegistryDocument, id: string, harness: BenchmarkHarness): boolean {
  const wanted = harness === "cursor" ? "cursor" : "native";
  return registry.models.some((row) => row.id === id && row.harness === wanted);
}

function sessionHarness(harness: BenchmarkHarness): Harness {
  return harness === "cursor" ? Harness.CURSOR : Harness.NATIVE;
}

/** One attempt of a cell: one execution, or one three-turn session for a turn-2 cell. */
async function measureCell(stack: BenchmarkStack, cell: BenchmarkCell, attempt: number, io: RunIo): Promise<BenchmarkSample> {
  const org = uniqueOrg();
  const agent = await stack.clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("bench-agent"), instructions: BARE_AGENT_INSTRUCTIONS }),
  );
  const agentId = agent.metadata!.id;
  const executionConfig: MessageInitShape<typeof ExecutionConfigSchema> | undefined =
    cell.modelRequested === null ? undefined : { modelName: cell.modelRequested };

  if (cell.scenario.sessionShape === "fresh-per-execution") {
    return measureExecution(stack, cell, {
      org,
      agentId,
      prompt: cell.scenario.prompts[0] ?? "",
      executionConfig,
      sessionId: undefined,
      label: `${cell.id}#${attempt}`,
    }, io);
  }

  // One session, three turns: the second turn is the sample, the others ride
  // on it as siblings. A session whose first turn failed still runs on, so
  // the failure is recorded where it happened.
  const first = await measureExecution(stack, cell, {
    org,
    agentId,
    prompt: cell.scenario.prompts[0] ?? "",
    executionConfig,
    sessionId: undefined,
    label: `${cell.id}#${attempt}.1`,
  }, io);
  const sessionId = first.session_id;
  const second = await measureExecution(stack, cell, {
    org,
    agentId,
    prompt: cell.scenario.prompts[1] ?? "",
    executionConfig,
    sessionId,
    label: `${cell.id}#${attempt}.2`,
  }, io);
  const third = await measureExecution(stack, cell, {
    org,
    agentId,
    prompt: cell.scenario.prompts[2] ?? "",
    executionConfig,
    sessionId,
    label: `${cell.id}#${attempt}.3`,
  }, io);
  const sibling = (turnSeq: number, sample: BenchmarkSample): SiblingTurn => ({
    turn_seq: turnSeq,
    execution_id: sample.execution_id,
    measures: sample.measures,
    timing: sample.timing,
    outcome: sample.outcome,
  });
  return { ...second, sibling_turns: [sibling(1, first), sibling(3, third)] };
}

interface ExecutionRequest {
  org: string;
  agentId: string;
  prompt: string;
  executionConfig: MessageInitShape<typeof ExecutionConfigSchema> | undefined;
  /** Set for the later turns of a turn-2 session; a fresh session otherwise. */
  sessionId: string | undefined;
  label: string;
}

async function measureExecution(stack: BenchmarkStack, cell: BenchmarkCell, request: ExecutionRequest, io: RunIo): Promise<BenchmarkSample> {
  const startedAtMs = Date.now();
  const created = await stack.clients.agentExecutionCommand.create(
    makeAgentExecution({
      org: request.org,
      name: uniqueName("bench-aex"),
      ...(request.sessionId === undefined
        ? { agentId: request.agentId, sessionSpec: { harness: sessionHarness(cell.harness), subject: BENCHMARK_SESSION_SUBJECT } }
        : { sessionId: request.sessionId }),
      message: request.prompt,
      autoApproveAll: true,
      ...(request.executionConfig !== undefined ? { executionConfig: request.executionConfig } : {}),
    }),
  );
  const executionId = created.metadata!.id;

  const watched = await watchExecution(subscribeTo(stack.clients, executionId), { startedAtMs, timeoutMs: EXECUTION_BUDGET_MS });
  let terminal = watched.final ?? created;
  let outcomeOverride: BenchmarkSample["outcome"] | undefined;
  if (watched.outcome !== "until") {
    // The budget passed (or the server closed early): cancel what is still
    // running and record the attempt as a timeout, never as a sample.
    outcomeOverride = "timeout";
    try {
      terminal = await stack.clients.agentExecutionCommand.cancel({ id: executionId, reason: "benchmark budget exceeded" });
    } catch {
      // Already terminal, or gone: the snapshot we hold is what there is.
    }
    io.log(`${request.label}: ${executionId} did not reach a terminal phase within ${EXECUTION_BUDGET_MS}ms; recorded as timeout`);
  }

  const facts = statusFacts(terminal);
  const timing = await awaitTimingLines(stack.runnerLogFile, executionId);
  const history = await showWorkflow(stack.temporal.hostPort, stack.temporal.namespace, invokeWorkflowIdFor(executionId)).catch(
    () => ({ events: [] }),
  );
  const fromHistory = historyAxes(history, executeActivityNameFor(cell.harness));

  return {
    execution_id: executionId,
    session_id: facts.session_id || created.spec?.sessionId || "",
    model_requested: cell.modelRequested ?? "default",
    model_reported: facts.model_reported,
    measures: {
      ...nullAxes(),
      end_to_end_ms: watched.end_to_end_ms,
      client_first_visible_token_ms: watched.client_first_visible_token_ms,
      client_first_text_ms: watched.client_first_text_ms,
      before_activity_ms: fromHistory.before_activity_ms,
      ensure_thread_ms: fromHistory.ensure_thread_ms,
      ...axesFromTiming(timing),
      estimated_cost_micros: facts.estimated_cost_micros,
      tokens: facts.tokens,
    },
    cost_source: "runner-rate-card-estimate",
    server: facts.server,
    timing,
    outcome: outcomeOverride ?? facts.outcome,
  };
}

async function gradeCell(stack: BenchmarkStack, cell: PlannedQualityCell): Promise<QualityCell> {
  const org = uniqueOrg();
  const agent = await stack.clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("bench-graded-agent"), instructions: BARE_AGENT_INSTRUCTIONS }),
  );
  const workflow = await stack.clients.workflowCommand.create(
    makeGradedAgentCallWorkflow({
      org,
      name: uniqueName("bench-graded"),
      agentSlug: agent.metadata!.slug,
      message: cell.task.prompt,
      rubric: cell.task.rubric,
      harness: cell.harness === "cursor" ? "cursor" : "native",
      modelName: cell.modelRequested,
      judgeModel: JUDGE_MODEL,
    }),
  );
  const execution = await stack.clients.workflowExecutionCommand.create(
    makeWorkflowExecution({ org, name: uniqueName("bench-graded-run"), workflowId: workflow.metadata!.id }),
  );
  const executionId = execution.metadata!.id;
  let verdict;
  try {
    verdict = verdictOf(await awaitWorkflowTerminal(stack.clients, executionId, { timeoutMs: EXECUTION_BUDGET_MS }));
  } catch {
    verdict = { score: null, reasoning: "", judge_model: "", agent_execution_id: "", outcome: "timeout" as const };
  }
  return {
    task_id: cell.task.id,
    placeholder: cell.task.placeholder,
    harness: cell.harness,
    model_requested: cell.modelRequested,
    judge_model: verdict.judge_model,
    score: verdict.score,
    reasoning: verdict.reasoning,
    workflow_execution_id: executionId,
    agent_execution_id: verdict.agent_execution_id,
    outcome: verdict.outcome,
  };
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

/** One row per cell: the medians a reader wants at a glance, and the refusals. Markdown, for stdout. */
export function renderSummary(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`| scenario | harness | n | failed | e2e ms | first token ms | runner first token ms | before activity ms | rounds | est. cost µ$ | cache hit | model |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const comparison of report.comparisons) {
    for (const side of [comparison.native, comparison.cursor]) {
      if (side === undefined) continue;
      const m = side.median;
      const cell = (value: number | null | undefined): string => (value === null || value === undefined ? "n/a" : String(Math.round(value)));
      lines.push(
        `| ${comparison.scenario} | ${side.harness} | ${side.n} | ${side.failed} | ${cell(m?.end_to_end_ms)} | ${cell(m?.client_first_visible_token_ms)} | ${cell(m?.runner_first_visible_token_ms)} | ${cell(m?.before_activity_ms)} | ${cell(m?.rounds)} | ${cell(m?.estimated_cost_micros)} | ${Math.round(side.cache_hit_ratio * 100)}% | ${side.models.join(",") || "n/a"} |`,
      );
    }
  }
  if (report.quality.length > 0) {
    lines.push("");
    lines.push(`| quality task | harness | score | judge | placeholder | outcome |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const cell of report.quality) {
      lines.push(`| ${cell.task_id} | ${cell.harness} | ${cell.score ?? "n/a"} | ${cell.judge_model || "n/a"} | ${cell.placeholder ? "yes" : "no"} | ${cell.outcome} |`);
    }
  }
  if (report.refused.length > 0) {
    lines.push("");
    lines.push("Refused:");
    for (const refusal of report.refused) lines.push(`- ${refusal.cell}: ${refusal.reason}`);
  }
  return lines.join("\n");
}
