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
//     the turn up from the engine's last saved step, so the step the kill cut
//     runs again. The turn completes, the model is handed the user's task
//     once, in the request it answers last, and the log says once why the
//     turn paused.
//   - Drain mid-tool: SIGTERM while the shell runs, and the step is let finish
//     a moment later. The drain waits for the running step, which runs once;
//     the turn yields at its next model call, refused inside the engine
//     before it is made, so the replacement asks that round, once; it never
//     shows FAILED on the way, the
//     session's log never reads it idle or failed between the two runners
//     (the agent-hour stretch stays whole), the log says once why the turn
//     moved, and it completes. The run is followed to its end, not to its
//     first terminal phase, so a FAILED on the way would be seen.
//   - A server rollout mid-turn: the target's server is replaced through its
//     one door, `restartServer`, behind the front its clients and runner
//     dial. Where two servers can share the store (Postgres) the turn ends on
//     the outgoing server while a watcher streams from the incoming one, then
//     the outgoing one shuts down; on SQLite the server stops and its
//     replacement starts on the same file. Every watcher, the one pinned to
//     the incoming server and one that follows through the front across the
//     restart, sees every event of the session's log exactly once and in
//     order, the turn's end included.
//   - A `user.message` mid-turn, sent through the Managed Agents wire while
//     the first turn's shell works (stigmer#2429). The message is queued:
//     the send answers it with processed_at null and starts no second run.
//     It is read by the working turn or, once that turn has ended, starts
//     the next one, never a run working beside the first; neither fails, and
//     the log lists the message once, read, where the turn that read it
//     read it. The overlap is read from the runs' own start and completion
//     stamps.
//
// Cursor is not here: its SDK cannot run inside a runner process against a
// double (the hermetic kit mocks `@cursor/sdk` in the test process), so its
// continuation is proven in process by the contract kit's re-sent-task arm.
// The cloud target is excluded by name (vitest.cloud-execution.config.ts): its
// runner and server are the composition's and have no restart door.
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
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

/** How long a watcher may take to catch the log once the turn has ended: a tail read on the other server (15 s), with room. */
const WATCHER_CATCHES_UP_MS = 45_000;

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
  if (target.restartRunner === undefined || target.restartServer === undefined) {
    throw new Error(`${target.name} has no restartRunner or restartServer; this suite runs only where the target spawns its runner and server (exclude it by name elsewhere)`);
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
 * Follow a run to its end, not to its first terminal phase, so a terminal
 * phase written on the way (a drained turn once wrote FAILED before the
 * workflow recovered it) is seen. Returns every phase seen, in order, and the
 * run once it has held a terminal phase for `settleMs` (or when `budgetMs`
 * runs out).
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
    "a server rolled out mid-turn costs a watcher no event: each sees the whole log once, in order, the turn's end included",
    async () => {
      const step = new HeldStep();
      const run = await startHeldRun(uniqueName("Rebuild the index"), step, "The index is rebuilt.");
      await step.whenStarted();
      const sessionId = sessionIdOf(await clients.agentExecutionQuery.get({ value: run.id }));
      const throughTheFront = new Watcher(clients, sessionId, { resumes: true });
      let pinned: Watcher | undefined;

      const restart = await target.restartServer!({
        duringOverlap: async (incoming) => {
          // The runner's connection stays on the outgoing server, where the
          // turn ends; this watcher is on the incoming one alone.
          pinned = new Watcher(incoming, sessionId, { resumes: false });
          step.release();
          await awaitTerminal(incoming, run.id, { timeoutMs: ARM_TIMEOUT_MS / 2 });
        },
      });
      if (!restart.overlapped) {
        step.release();
      }
      const settled = await awaitTerminal(clients, run.id, { timeoutMs: ARM_TIMEOUT_MS / 2 });
      const logged = await loggedSeqs(sessionId);
      const last = logged.at(-1) ?? 0n;
      const watchers = pinned === undefined ? [throughTheFront] : [throughTheFront, pinned];
      for (const watcher of watchers) {
        await watcher.until(last, WATCHER_CATCHES_UP_MS);
      }
      console.log(
        `[long turn] server rollout (${restart.overlapped ? "overlap" : "stop then start"}): ${RunPhase[settled.status?.phase ?? 0]}, ` +
          `${logged.length} events; through the front ${throughTheFront.seqs.length} (streams ended: ${throughTheFront.endings.join(", ")})` +
          (pinned === undefined ? "" : `; pinned ${pinned.seqs.length} (streams ended: ${pinned.endings.join(", ") || "never"})`),
      );

      expect(settled.status?.phase, `the turn across the rollout: ${settled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
      expect((await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000, types: ["session.status_idle"] })).events.length, "the log holds the turn's end").toBe(1);
      expect(throughTheFront.seqs.filter((seq) => seq <= last), "the watcher through the front: every event once, in order").toEqual(logged);
      if (pinned !== undefined) {
        expect(pinned.seqs.filter((seq) => seq <= last), "the watcher on the incoming server: every event once, in order").toEqual(logged);
        expect(pinned.endings, "the incoming server never ended its stream").toEqual([]);
      }
    },
    ARM_TIMEOUT_MS,
  );

  it(
    "a user.message sent through the Managed Agents wire while a turn works is queued, then joins it or starts the next turn; never a second run beside it",
    async () => {
      const step = new HeldStep();
      const first = await startHeldRun(uniqueName("Build the project"), step, "The build is done.");
      await step.whenStarted();
      const sessionId = sessionIdOf(await clients.agentExecutionQuery.get({ value: first.id }));

      mock.enqueue(anthropicText("Here is the answer to the second message."));
      const sdk = await sdkFor(first.org);
      const sent = await sdk.beta.sessions.events.send(sessionId, {
        events: [{ type: "user.message", content: [{ type: "text", text: "While you build: what is left?" }] }],
      });
      const message = sent.data?.[0];
      expect(message?.type, "the send answers the message").toBe("user.message");
      expect(message?.processed_at ?? null, "the message waits while the turn works").toBeNull();
      const messageId = message?.id ?? "";
      expect(await runIdsOf(sessionId), "no second run starts while the first works").toEqual([first.id]);

      await new Promise((resolve) => setTimeout(resolve, FIRST_TURN_WORKS_ON_MS));
      step.release();
      const firstSettled = await awaitTerminal(clients, first.id, { timeoutMs: ARM_TIMEOUT_MS });
      const readerId = await runThatRead(sessionId, messageId, ARM_TIMEOUT_MS);
      fixtures.defer(async () => {
        if (readerId !== first.id) {
          await awaitTerminal(clients, readerId, { timeoutMs: ARM_TIMEOUT_MS }).catch(() => undefined);
          await clients.agentExecutionCommand.delete({ value: readerId }).catch(() => undefined);
        }
      });
      const readerSettled = await awaitTerminal(clients, readerId, { timeoutMs: ARM_TIMEOUT_MS });
      console.log(
        `[long turn] mid-turn message: first ${RunPhase[firstSettled.status?.phase ?? 0]} (completed ${firstSettled.status?.completedAt}), ` +
          `read by ${readerId === first.id ? "the working turn" : `the next turn, started ${readerSettled.status?.startedAt}`} ` +
          `(${RunPhase[readerSettled.status?.phase ?? 0]}) ${readerSettled.status?.error ?? ""}`,
      );

      expect(firstSettled.status?.phase, `the working turn: ${firstSettled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
      expect(readerSettled.status?.phase, `the turn that read the message: ${readerSettled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
      expect(overlapped(firstSettled, readerSettled), "the message never ran as a second run beside the working one").toBe(false);
      const listed = (await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000, types: ["user.message"] })).events.filter(
        (event) => event.event.case === "userMessage" && event.event.value.id === messageId,
      );
      expect(listed.map((event) => event.runId), "the message is listed once, as the run's that read it").toEqual([readerId]);
      expect(listed[0]?.event.value?.processedAt, "the listed message was read").not.toBe("");
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
      let requestsByTheDrainedRunner = -1;
      const draining = restartRunner({ signal: "SIGTERM", onEnded: () => (requestsByTheDrainedRunner = mock.scriptedRequests().length) });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      step.release();
      await draining;
      // Recovery lands within the workflow's 5 s backoff and a fresh turn; a
      // FAILED that holds 20 s is the run's last word.
      const { phases, run: settled } = await followToTheEnd(run.id, ARM_TIMEOUT_MS - 30_000, 20_000);
      console.log(`[long turn] drain: phases ${phases.map((p) => RunPhase[p]).join(" > ")}, the step began ${step.started()} time(s)`);

      const sessionId = sessionIdOf(settled);
      const logged = async (type: string): Promise<number> =>
        (await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000, types: [type] })).events.length;

      expect(settled.status?.phase, `the drained turn: ${settled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
      expect(phases, "the turn never showed FAILED on the way").not.toContain(RunPhase.RUN_FAILED);
      expect(step.started(), "the running step ran once").toBe(1);
      expect(await logged("session.error"), "the session's log never read the turn failed").toBe(0);
      expect(await logged("session.status_idle"), "the session went idle once, when the turn ended").toBe(1);
      expect(await logged("stigmer.harness.note"), "the log says once why the turn moved").toBe(1);
      expect(requestsByTheDrainedRunner, "the drained runner asked the model once, for the step, and stopped before the next round").toBe(1);
      expect(mock.remaining(), "the round after the step was asked once, by the replacement").toBe(0);
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

      const notes = await clients.sessionQuery.listEvents({ sessionId: sessionIdOf(settled), pageSize: 1000, types: ["stigmer.harness.note"] });
      const story = (await clients.sessionQuery.listEvents({ sessionId: sessionIdOf(settled), pageSize: 1000 })).events
        .filter((event) => event.runId === run.id)
        .map((event) => event.event.case)
        .join(", ");

      expect(settled.status?.phase, `the killed turn: ${settled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
      expect(handed, "the model was handed the task once").toBe(1);
      expect(notes.events.length, `the log says once why the turn paused (the run's log: ${story})`).toBe(1);
      expect(mock.remaining(), "the replacement asked only the round after the step").toBe(0);
    },
    KILL_ARM_TIMEOUT_MS,
  );
});

/**
 * A watcher of a session's log over the native stream, as a client resumes
 * one: from the last seq it holds, again whenever its stream ends with a
 * code a client retries. Records every event's seq in arrival order. A
 * pinned watcher does not resume: its stream ending is the finding.
 */
class Watcher {
  readonly seqs: bigint[] = [];
  readonly endings: string[] = [];
  private readonly abort = new AbortController();
  private readonly done: Promise<void>;

  constructor(watchClients: ConformanceClients, sessionId: string, options: { readonly resumes: boolean }) {
    this.done = this.follow(watchClients, sessionId, options.resumes);
    fixtures.defer(() => this.stop());
  }

  private async follow(watchClients: ConformanceClients, sessionId: string, resumes: boolean): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const after = this.seqs.at(-1) ?? 0n;
        for await (const frame of watchClients.sessionQuery.streamEvents({ sessionId, afterSeq: after }, { signal: this.abort.signal })) {
          if (frame.frame.case === "event") this.seqs.push(frame.frame.value.seq);
        }
        this.endings.push("ended cleanly");
      } catch (error) {
        if (this.abort.signal.aborted) return;
        const code = ConnectError.from(error).code;
        this.endings.push(Code[code]);
        if (code !== Code.Unavailable && code !== Code.Canceled && code !== Code.Unknown && code !== Code.Internal) return;
      }
      if (!resumes) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Resolves once the watcher holds `seq`; bounded, naming what it holds. */
  async until(seq: bigint, budgetMs: number): Promise<void> {
    const deadline = Date.now() + budgetMs;
    while ((this.seqs.at(-1) ?? 0n) < seq) {
      if (Date.now() > deadline) {
        throw new Error(`the watcher reached seq ${this.seqs.at(-1) ?? 0n}, not ${seq}, within ${budgetMs} ms (its streams ended: ${this.endings.join(", ") || "never"})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.done;
  }
}

/** Every seq of the session's log, oldest first. */
async function loggedSeqs(sessionId: string): Promise<bigint[]> {
  const seqs: bigint[] = [];
  let pageToken = "";
  do {
    const page = await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000, pageToken });
    seqs.push(...page.events.map((event) => event.seq));
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
  return seqs;
}

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

/** The session's runs, by id, oldest first. */
async function runIdsOf(sessionId: string): Promise<string[]> {
  const page = await clients.agentExecutionQuery.listBySession({ sessionId });
  return page.entries.map((run) => run.metadata?.id ?? "").reverse();
}

/** The run whose user.message `messageId` is, once a run has read it; bounded, naming what it waited for. */
async function runThatRead(sessionId: string, messageId: string, budgetMs: number): Promise<string> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const { events } = await clients.sessionQuery.listEvents({ sessionId, types: ["user.message"], pageSize: 1000 });
    const read = events.find((event) => event.event.case === "userMessage" && event.event.value.id === messageId && event.runId !== "");
    if (read !== undefined) {
      return read.runId;
    }
    if (Date.now() > deadline) {
      throw new Error(`no run read the queued message ${messageId} within ${budgetMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
