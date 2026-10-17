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
// ANTHROPIC_API_KEY and CURSOR_API_KEY reach it; nothing is written anywhere.
//
// Every turn of every cell goes through one driver (session.ts), so a turn
// means the same thing wherever it is measured. Per attempt, a cell gets a
// fresh agent: the bare agent in a fresh org, or a freshly provisioned working
// agent (support/working-agent.ts) with its workspace re-seeded at one fixed
// path outside this repository. Everything an attempt created is removed when
// it ends. Each cell's first attempt is a discarded warm-up. The run's first
// call per harness, served model and agent shape is the cold call.
//
// The quality arm is one eval run about a plugin (quality-eval.ts): the
// working agent as a plugin, pushed into a fresh organization, its `evals/`
// suite run by the platform with each planned harness's parity model as a
// target and the judge model for its AI-graded checks. Its result document
// is the report's `quality`.
//
// Nothing aborts the run but the stack itself. A provisioning or create error
// fails its attempt with `failure.stage: "create"`, and the run goes on.
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { FixtureTracker } from "../harness/fixtures";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { createTransport, makeClients } from "../harness/clients";
import { McpToolFixture } from "../harness/mcp-server";
import { fetchModelRegistryDocument, type ModelRegistryDocument } from "../harness/model-registry";
import { ensureRunnerBuilt } from "@stigmer/test-support/runner-build";
import { spawnRunner, type RunningRunner } from "@stigmer/test-support/runner-process";
import { spawnServer, type RunningServer } from "@stigmer/test-support/server-process";
import { spawnTemporal, type RunningTemporal } from "@stigmer/test-support/temporal";
import { ensureLibraryServerEntry } from "@stigmer/test-support/ts-build";
import { type AgentRefInit, BARE_AGENT_INSTRUCTIONS, agentRefOf, makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { createUniqueOrganization } from "../support/organizations";
import {
  provisionWorkingAgent,
  WORKING_AGENT_FIXTURE_DIR,
  WORKING_AGENT_MCP_TOOLS,
  WORKING_AGENT_WORKSPACE_NAME,
  workingAgentSessionSpec,
} from "../support/working-agent";
import {
  BENCHMARK_SESSION_SUBJECT,
  JUDGE_MODEL,
  PARITY_MODEL,
  type BenchmarkCell,
  type CellPlan,
} from "./cells";
import { renderQuality, runQualityEval } from "./quality-eval";
import {
  BENCHMARK_REPORT_SCHEMA_VERSION,
  costRatio,
  summarize,
  type AgentShape,
  type BenchmarkComparison,
  type BenchmarkHarness,
  type BenchmarkReport,
  type BenchmarkSample,
  type BenchmarkStat,
  type QualityEval,
  type RefusedCell,
  type SiblingTurn,
} from "./report";
import { EXECUTION_BUDGET_MS, failedAtCreate, measureSession, type MeasuredTurn, type SessionPlan, type SessionStack } from "./session";

/**
 * Where the working agent's workspace is seeded before every session: one
 * fixed path, so the prompt that names it is the same in every session, and
 * outside this repository, so its go.work cannot capture the agent's `go`.
 */
export const WORKING_WORKSPACE_DIR = join(tmpdir(), "stigmer-benchmark", WORKING_AGENT_WORKSPACE_NAME);

export interface BenchmarkStack extends SessionStack {
  serverBaseUrl: string;
  /** The tool fixture the working agent's MCP server points at. */
  mcpFixture: McpToolFixture;
  stop(): Promise<void>;
}

/** The MCP fixture, Temporal, then the server on it, then the runner in direct mode; `stop()` reverses. */
export async function bootBenchmarkStack(runDir: string): Promise<BenchmarkStack> {
  await mkdir(runDir, { recursive: true });
  // The library entry: every working-agent cell provisions an organization
  // of its own (support/working-agent.ts).
  /* v8 ignore next -- @preserve: the live benchmark is a hand-run script no vitest config collects (vitest.unit.config.ts tests only its pure readers) */
  const serverEntry = await ensureLibraryServerEntry();
  const runnerEntry = await ensureRunnerBuilt();

  const mcpFixture = new McpToolFixture();
  await mcpFixture.start();
  let temporal: RunningTemporal | undefined;
  let server: RunningServer | undefined;
  let runner: RunningRunner | undefined;
  const stop = async (): Promise<void> => {
    await runner?.stop();
    await server?.stop();
    await temporal?.stop();
    await mcpFixture.close();
  };
  try {
    temporal = await spawnTemporal();
    server = await spawnServer(process.execPath, { args: [serverEntry], temporalHostPort: temporal.hostPort });
    const clients = makeClients(createTransport(server.baseUrl));
    await awaitGrpcReady(clients, () => server?.logTail() ?? "(no server)");
    runner = await spawnRunner({
      entryPath: runnerEntry,
      temporalHostPort: temporal.hostPort,
      backendEndpoint: server.baseUrl,
      registryOrigin: server.baseUrl,
      artifactDir: server.artifactBaseDir,
      logFile: join(runDir, "runner.log"),
    });
    return {
      clients,
      serverBaseUrl: server.baseUrl,
      temporal: { hostPort: temporal.hostPort, namespace: temporal.namespace },
      runnerLogFile: runner.logFile,
      mcpFixture,
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
  /** Tries per quality case and target. */
  qualityReps: number;
  git: BenchmarkReport["git"];
  titlingSuppressed: true;
  /** Every execution asks for thinking; the judge's never does. */
  thinking?: "enabled";
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
  const qualityTargets = plan.quality.filter((cell) => {
    if (!registryHas(registry, cell.modelRequested, cell.harness) || !registryHas(registry, JUDGE_MODEL, "deep-agent")) {
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
    const sides = statsByScenario.get(cell.scenario.name) ?? {};
    const ratio = costRatio(sides["deep-agent"], sides.cursor);
    comparisons.push({
      scenario: cell.scenario.name,
      prompts: [...cell.scenario.prompts],
      mode: cell.scenario.mode,
      session_shape: cell.scenario.sessionShape,
      agent: cell.scenario.agent,
      ...(sides["deep-agent"] !== undefined ? { native: sides["deep-agent"] } : {}),
      ...(sides.cursor !== undefined ? { cursor: sides.cursor } : {}),
      ...(ratio !== undefined ? { cost_ratio: ratio } : {}),
    });
  }

  let quality: QualityEval | null = null;
  if (qualityTargets.length > 0) {
    io.log(`quality: one eval run, ${qualityTargets.map((cell) => cell.id).join(", ")}, ${options.qualityReps} tries per case`);
    quality = await runQualityEval(stack.clients, qualityTargets, { runs: options.qualityReps, judgeModel: JUDGE_MODEL }, io);
    io.log(`quality: ${quality.failure === undefined ? `eval ${quality.eval_id} ended` : `${quality.failure.stage}: ${quality.failure.message}`}`);
  }

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
    },
    models: { parity_native: PARITY_MODEL["deep-agent"], parity_cursor: PARITY_MODEL.cursor, judge_requested: JUDGE_MODEL },
    comparisons,
    quality,
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
  cell: { agent: AgentShape; harness: BenchmarkHarness },
): Promise<ProvisionedAgent> {
  const harness = sessionHarness(cell.harness);
  if (cell.agent === "working") {
    const agent = await provisionWorkingAgent(stack.clients, fixtures, {
      mcpUrl: stack.mcpFixture.url(WORKING_AGENT_MCP_TOOLS),
      workspaceDir: WORKING_WORKSPACE_DIR,
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
  try {
    let agent: ProvisionedAgent;
    try {
      agent = await provisionAgent(stack, fixtures, { agent: cell.scenario.agent, harness: cell.harness });
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
    if (cell.scenario.sessionShape === "fresh-per-execution") return turns[0]!.sample;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** One row per cell: the medians a reader wants at a glance, the quality medians, and the refusals. Markdown, for stdout. */
export function renderSummary(report: BenchmarkReport): string {
  const lines: string[] = [];
  const cell = (value: number | null | undefined): string => (value === null || value === undefined ? "n/a" : String(Math.round(value)));
  lines.push(
    `| scenario | harness | n | failed | e2e ms | first token ms | runner first token ms | before activity ms | rounds | tool calls | mcp connect ms | cursor send ms | est. cost µ$ | cache hit | model |`,
  );
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const comparison of report.comparisons) {
    for (const side of [comparison.native, comparison.cursor]) {
      if (side === undefined) continue;
      const m = side.median;
      lines.push(
        `| ${comparison.scenario} | ${side.harness} | ${side.n} | ${side.failed} | ${cell(m?.end_to_end_ms)} | ${cell(m?.client_first_visible_token_ms)} | ${cell(m?.runner_first_visible_token_ms)} | ${cell(m?.before_activity_ms)} | ${cell(m?.rounds)} | ${cell(m?.tool_calls)} | ${cell(m?.mcp_connect_ms)} | ${cell(m?.cursor_send_returned_ms)} | ${cell(m?.estimated_cost_micros)} | ${Math.round(side.cache_hit_ratio * 100)}% | ${side.models.join(",") || "n/a"} |`,
      );
    }
  }
  lines.push(...renderQuality(report.quality));
  if (report.refused.length > 0) {
    lines.push("");
    lines.push("Refused:");
    for (const refusal of report.refused) lines.push(`- ${refusal.cell}: ${refusal.reason}`);
  }
  return lines.join("\n");
}
