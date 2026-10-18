// Conformance suite for a long turn on a real runner (Class B): what happens
// to a turn whose runner dies, is drained, or is sent a message while it works.
// Domain: agentic / agentexecution — a turn's survival across its runner's life.
//
// Each arm runs the native harness against the wire mock, with a REAL
// `execute` the model asks for: a shell that records each start in a marker
// file the arm owns and waits for the arm's release file, so the arm knows the
// step is running and decides when it may finish (no sleep guesses). The runs
// carry the whole-run trust (spec.auto_approve_all), because a shell is gated
// in every other posture. The runner is ended through the target's one door,
// `restartRunner` (TargetProfile): the replacement boots on the same HOME and
// workspace root, as a pod restarted on a durable volume does, so it sees the
// sqlite checkpoint and the workspace lock the ended one left.
//
//   - Kill mid-tool: SIGKILL while the shell runs. Nothing is written; the
//     workflow notices by the activity's missed heartbeat (its fixed 2-minute
//     heartbeatTimeout, invoke-agent-execution.ts) and the replacement takes
//     the turn up. Desired: the turn completes, and the model is handed the
//     user's task once, in the request it answers last.
//   - Drain mid-tool: SIGTERM while the shell runs, and the step is let finish
//     a moment later. Desired: the drain waits for the running step, which
//     runs once, the turn never shows FAILED on the way, and it completes. The
//     run is followed to its end, not to its first terminal phase: a drained
//     turn writes FAILED before the workflow recovers it.
//   - A `user.message` mid-turn, sent through the Managed Agents wire while
//     the first turn's shell works. Desired: the message joins the running
//     turn or waits as its next one, never a second run working beside the
//     first, and neither fails. The runner's own workspace lock is today's
//     only order between the two (15 minutes by default; no boot path lets a
//     test shrink it, stigmer#1731), so this arm reads the overlap from the
//     two runs' own start and completion stamps.
//
// Whatever is not true today is a known gap, marked by its open issue
// (`@stigmer/test-support/known-gap`): the arm asserts what the user should
// get, passes while today's named outcome holds, and fails once the gap closes.
//
// Cursor is not here: its SDK cannot run inside a runner process against a
// double (the hermetic kit mocks `@cursor/sdk` in the test process), so its
// continuation is proven in process by the contract kit's re-sent-task arm.
// The cloud target is excluded by name (vitest.cloud-execution.config.ts): its
// runner is the composition's and has no restart door.
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { expectKnownGap } from "@stigmer/test-support/known-gap";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { agentRefOf, makeAgent } from "../support/agents";
import { managedAgentsClient } from "../support/managed-agents";
import { uniqueName } from "../support/naming";
import { awaitPhase, awaitTerminal, makeAgentExecution, requireLlmProxy, sessionIdOf } from "../support/runs";
import { createTarget, type TargetProfile } from "../targets";
import type { RunnerRestartOptions } from "../targets/target";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

/** The open issues these arms are known gaps of. */
const TASK_HANDED_AGAIN = "stigmer/stigmer#2417";
const DRAIN_STOPS_THE_STEP = "stigmer/stigmer#2428";
const MESSAGE_STARTS_A_SECOND_RUN = "stigmer/stigmer#2429";

/** How long the mid-turn arm's first turn keeps working after the message arrives. */
const FIRST_TURN_WORKS_ON_MS = 10_000;

/** A kill is noticed by the workflow's 2-minute heartbeat timeout, then a 5 s recovery backoff and a fresh turn. */
const KILL_RECOVERY_MS = 4 * 60_000;
const KILL_ARM_TIMEOUT_MS = 5 * 60_000;
const ARM_TIMEOUT_MS = 2 * 60_000;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  if (target.restartRunner === undefined) {
    throw new Error(`${target.name} has no restartRunner; this suite runs only where the target spawns its runner (exclude it by name elsewhere)`);
  }
});

afterEach(async () => {
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

function restartRunner(options: RunnerRestartOptions): Promise<void> {
  return target.restartRunner!(options);
}

/**
 * A shell step the arm controls: it appends a line to `starts` each time it
 * begins, then waits for `release` to exist. Released at the arm's end
 * whatever happened, so an orphaned shell never outlives the file.
 */
class HeldStep {
  readonly dir = mkdtempSync(join(tmpdir(), "stigmer-long-turn-step-"));
  private readonly starts = join(this.dir, "starts");
  private readonly releaseFile = join(this.dir, "release");

  constructor() {
    fixtures.defer(async () => {
      this.release();
      // Give a waiting shell one poll to see the file before it goes.
      await new Promise((resolve) => setTimeout(resolve, 500));
      rmSync(this.dir, { recursive: true, force: true });
    });
  }

  command(): string {
    return `echo started >> '${this.starts}'; while [ ! -f '${this.releaseFile}' ]; do sleep 0.2; done; echo 'step finished'`;
  }

  /** How many times the step has begun. */
  started(): number {
    return existsSync(this.starts) ? readFileSync(this.starts, "utf8").split("\n").filter((line) => line === "started").length : 0;
  }

  /** Resolves once the step has begun `times` times; bounded, naming what it waited for. */
  async whenStarted(times = 1, budgetMs = 60_000): Promise<void> {
    const deadline = Date.now() + budgetMs;
    while (this.started() < times) {
      if (Date.now() > deadline) throw new Error(`the held step began ${this.started()} time(s), not ${times}, within ${budgetMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  release(): void {
    if (!existsSync(this.releaseFile)) appendFileSync(this.releaseFile, "released\n");
  }
}

/** A run of a fresh agent, trusted for the whole run, whose model asks for `step` then says `closing`. */
async function startHeldRun(task: string, step: HeldStep, closing: string): Promise<{ readonly id: string; readonly org: string }> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("long-turn-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
  mock.enqueue(anthropicToolUse(uniqueName("call_held"), "execute", { command: step.command() }));
  mock.enqueue(anthropicText(closing));
  const created = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("long-turn-run"), agentRef: agentRefOf(agent), message: task, autoApproveAll: true }),
  );
  const id = created.metadata!.id;
  fixtures.defer(async () => {
    step.release();
    await awaitTerminal(clients, id, { timeoutMs: ARM_TIMEOUT_MS }).catch(() => undefined);
    await clients.agentExecutionCommand.delete({ value: id }).catch(() => undefined);
  });
  return { id, org };
}

/**
 * Follow a run to its end, not to its first terminal phase: a drained turn
 * writes FAILED, then the workflow recovers it (persists IN_PROGRESS) and
 * runs it on. Returns every phase seen, in order, and the run once it has
 * held a terminal phase for `settleMs` (or when `budgetMs` runs out).
 */
async function followToTheEnd(id: string, budgetMs: number, settleMs = 15_000): Promise<{ readonly phases: readonly RunPhase[]; readonly run: Run }> {
  const deadline = Date.now() + budgetMs;
  const phases: RunPhase[] = [];
  let terminalSince: number | undefined;
  for (;;) {
    const run = await clients.agentExecutionQuery.get({ value: id });
    const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
    if (phases.at(-1) !== phase) phases.push(phase);
    const terminal = phase === RunPhase.RUN_COMPLETED || phase === RunPhase.RUN_FAILED || phase === RunPhase.RUN_CANCELLED || phase === RunPhase.RUN_TERMINATED;
    terminalSince = terminal ? (terminalSince ?? Date.now()) : undefined;
    if (phase === RunPhase.RUN_COMPLETED || (terminalSince !== undefined && Date.now() - terminalSince >= settleMs) || Date.now() > deadline) {
      return { phases, run };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Whether `second` started before `first` completed: two runs of one conversation working at once. */
function overlapped(first: Run, second: Run): boolean {
  const firstCompleted = first.status?.completedAt ?? "";
  const secondStarted = second.status?.startedAt ?? "";
  return firstCompleted !== "" && secondStarted !== "" && Date.parse(secondStarted) < Date.parse(firstCompleted);
}

/** How many user messages carrying `task` the newest model request handed the provider. */
function taskHandedInLastRequest(task: string): number {
  const last = mock.scriptedRequests().at(-1);
  const messages = (last?.body as { messages?: Array<{ role?: string; content?: unknown }> } | undefined)?.messages ?? [];
  return messages.filter((m) => m.role === "user" && JSON.stringify(m.content ?? "").includes(task)).length;
}

describe("a long turn on a real runner", () => {
  it(
    "a user.message sent through the Managed Agents wire while a turn works joins it or waits as its next turn; neither turn fails",
    async () => {
      const step = new HeldStep();
      const first = await startHeldRun(uniqueName("Build the project"), step, "The build is done.");
      await step.whenStarted();
      const sessionId = sessionIdOf(await clients.agentExecutionQuery.get({ value: first.id }));

      mock.enqueue(anthropicText("Here is the answer to the second message."));
      const sdk = await sdkFor(first.org);
      await sdk.beta.sessions.events.send(sessionId, { events: [{ type: "user.message", content: [{ type: "text", text: "While you build: what is left?" }] }] });
      const secondId = await newestRunId(sessionId);
      fixtures.defer(async () => {
        await awaitTerminal(clients, secondId, { timeoutMs: ARM_TIMEOUT_MS }).catch(() => undefined);
        await clients.agentExecutionCommand.delete({ value: secondId }).catch(() => undefined);
      });

      await new Promise((resolve) => setTimeout(resolve, FIRST_TURN_WORKS_ON_MS));
      step.release();
      const firstSettled = await awaitTerminal(clients, first.id, { timeoutMs: ARM_TIMEOUT_MS });
      const secondSettled = await awaitTerminal(clients, secondId, { timeoutMs: ARM_TIMEOUT_MS });
      console.log(
        `[long turn] mid-turn message: first ${RunPhase[firstSettled.status?.phase ?? 0]} (started ${firstSettled.status?.startedAt}, completed ${firstSettled.status?.completedAt}), ` +
          `second ${RunPhase[secondSettled.status?.phase ?? 0]} (started ${secondSettled.status?.startedAt}, completed ${secondSettled.status?.completedAt}) ${secondSettled.status?.error ?? ""}`,
      );

      await expectKnownGap(
        {
          issue: MESSAGE_STARTS_A_SECOND_RUN,
          today: {
            says: "the message starts a second run at once, which waits beside the first on the runner's workspace lock",
            holds: () =>
              firstSettled.status?.phase === RunPhase.RUN_COMPLETED &&
              secondSettled.status?.phase === RunPhase.RUN_COMPLETED &&
              overlapped(firstSettled, secondSettled),
          },
        },
        () => {
          expect(firstSettled.status?.phase, `the working turn: ${firstSettled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
          expect(secondSettled.status?.phase, `the message's turn: ${secondSettled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
          expect(overlapped(firstSettled, secondSettled), "the message never ran as a second run beside the working one").toBe(false);
        },
      );
    },
    ARM_TIMEOUT_MS,
  );

  it(
    "a runner drained mid-tool lets the running step finish, and the turn completes",
    async () => {
      const step = new HeldStep();
      const run = await startHeldRun(uniqueName("Run the test suite"), step, "The suite passed.");
      await step.whenStarted();

      // The drain, and the step's end a moment later: a drain that waits for
      // the running step sees it finish; one that stops it does not.
      const draining = restartRunner({ signal: "SIGTERM" });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      step.release();
      await draining;
      const { phases, run: settled } = await followToTheEnd(run.id, ARM_TIMEOUT_MS - 30_000, 45_000);
      console.log(`[long turn] drain: phases ${phases.map((p) => RunPhase[p]).join(" > ")}, the step began ${step.started()} time(s)`);

      await expectKnownGap(
        {
          issue: DRAIN_STOPS_THE_STEP,
          today: {
            says: "the drain writes the turn FAILED; the workflow recovers it and the replacement finishes it, but the server keeps the terminal FAILED and refuses the finished turn's events",
            holds: () =>
              settled.status?.phase === RunPhase.RUN_FAILED &&
              (settled.status?.error ?? "").includes("runner worker was shut down") &&
              mock.remaining() === 0,
          },
        },
        () => {
          expect(settled.status?.phase, `the drained turn: ${settled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
          expect(phases, "the turn never showed FAILED on the way").not.toContain(RunPhase.RUN_FAILED);
          expect(step.started(), "the running step ran once").toBe(1);
        },
      );
    },
    ARM_TIMEOUT_MS,
  );

  it(
    "a runner killed mid-tool is replaced, the turn completes, and the model is handed the task once",
    async () => {
      const task = uniqueName("Migrate the database");
      const step = new HeldStep();
      const run = await startHeldRun(task, step, "The migration is done.");
      await step.whenStarted();

      await restartRunner({ signal: "SIGKILL" });
      // The killed runner's shell is an orphan now; released, it ends, and a
      // step the replacement runs again finishes at once.
      step.release();
      await awaitPhase(clients, run.id, RunPhase.RUN_IN_PROGRESS, { timeoutMs: 10_000 });
      const settled = await awaitTerminal(clients, run.id, { timeoutMs: KILL_RECOVERY_MS });
      const handed = taskHandedInLastRequest(task);
      console.log(`[long turn] kill: ${RunPhase[settled.status?.phase ?? 0]}, the task in the last request ${handed} time(s), the step began ${step.started()} time(s)`);

      await expectKnownGap(
        {
          issue: TASK_HANDED_AGAIN,
          today: {
            says: "the replacement completes the turn but hands the model the user's task a second time",
            holds: () => settled.status?.phase === RunPhase.RUN_COMPLETED && handed === 2,
          },
        },
        () => {
          expect(settled.status?.phase, `the killed turn: ${settled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
          expect(handed, "the model was handed the task once").toBe(1);
        },
      );
    },
    KILL_ARM_TIMEOUT_MS,
  );
});

/** Anthropic's SDK for `org`, with a key minted there (the Managed Agents suite's shape). */
async function sdkFor(org: string): Promise<Anthropic> {
  const key = await clients.apiKeyCommand.create({
    apiVersion: "iam.stigmer.ai/v1",
    kind: "ApiKey",
    metadata: { name: uniqueName("long-turn-key"), org },
    spec: {},
  });
  const id = key.metadata?.id ?? "";
  fixtures.defer(() => clients.apiKeyCommand.delete({ value: id }).catch(() => undefined));
  return managedAgentsClient(target.managedAgentsBaseUrl(), { apiKey: key.spec?.keyHash ?? "" });
}

/** The run the newest user.message started, from the native log. */
async function newestRunId(sessionId: string): Promise<string> {
  const { events } = await clients.sessionQuery.listEvents({ sessionId, order: "desc", types: ["user.message"], pageSize: 1 });
  const runId = events[0]?.runId ?? "";
  expect(runId, "the sent message started a turn").not.toBe("");
  return runId;
}
