// Plays one long turn in REAL time against the wire mock and reports, minute
// by minute, how far it got (`npm run long-turn:real-clock -- <flags>`; the
// `long-turn-real-clock.yaml` workflow runs it on demand).
// Domain: conformance long turn (the real-clock run's entrypoint).
//
// THIS IS A MEASUREMENT, NOT A TEST. No vitest config collects it, it costs no
// tokens (the model is the mock), and it takes as long as its profile: about
// an hour for `goal` at most, three hours for `endurance`. It boots the
// execution target's own stack (Temporal, the server, the native runner and
// the mock, src/targets/local-execution.ts), creates one run trusted for the
// whole run (spec.auto_approve_all, since a shell is gated in every other
// posture), scripts the mock with one tool call per step of the profile, and
// lets the tools really run: a real `sleep`, a real loop that prints, a real
// subagent whose model call the mock holds, real output big enough to compact
// the conversation. A `kill` or `drain` step ends the runner through the
// target's restartRunner while the step is provably open (its marker), and
// releases the step once the runner is replaced. A `server-restart` step
// replaces the server through the target's restartServer, behind the front
// the runner and every client dial: on `--target local-postgres-execution`
// the two servers serve together and the step ends while they do (a
// rolling update's overlap), on `local-execution` (SQLite) the server stops
// and starts on the same file.
//
// The report (src/long-turn/report.ts) is rewritten after every minute, so a
// run that is stopped still leaves one. A streaming follower reads the
// session from its first event through every restart. At the end the
// session's log is read back: its sequence numbers must run unbroken and the
// follower must have been sent exactly them, once and in order, or the
// transcript reads broken and the script exits 1. The `goal` profile's
// `message` step sends the person's message mid-tool and replaces the server
// while it waits; the run must read it, once, after that step's result, and
// a follower of what needs the person (streamAttention, opened before the
// run) must be told of the turn once, `finished`, or the script exits 1.
// Every summary the mock answered must be one compaction marker in the log,
// and the turn's reply never the mock's summary, or the script exits 1
// (`compactionVerdictOf`). What it cannot see is
// said in the report: against the mock the runner holds a static token, so
// the token re-mint a hosted runner does at 0.8 of its lifetime never runs.
//
// On `--harness claude` the run's session is on Claude and the engine plays
// the same steps, each scripted by conversation (src/support/engine-arms.ts),
// so a replacement runner that resumes the engine from the session's store is
// answered the same way. The agent lists one saved helper for the subagent
// step (Claude has no general-purpose helper of its own). Each model call
// reports the input its request stands for, as the API does, and a request
// past the model's window is refused as the API refuses it, so the engine
// compacts its own conversation where a real one would; the summary keeps
// the task and the steps done, as a model's would. A step a kill cut comes
// back to the model as interrupted, its outcome unknown, and the model asks
// for it again; native re-runs it from its checkpoint.
//
// Needs: the `temporal` CLI on PATH, and the `stigmer` CLI (`make
// install-cli-shim`), as the execution lane does; CONFORMANCE_POSTGRES_URL for
// the Postgres target.
//
// Flags:
//   --profile goal|endurance   what the turn plays (src/long-turn/profile.ts); default goal; `retention` is live only
//   --minutes N                endurance's length (default 180)
//   --steps a,b                play only these steps of the profile, in its order
//   --target <name>            local-execution (default, SQLite) or local-postgres-execution
//   --harness <name>           deep-agent (default, native) or claude
//   --out <dir>                where the report lands (default .test-output/long-turn-real-clock/<profile>-<stamp>)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { anthropicText, anthropicToolUse, type MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { driveLongTurn } from "../src/long-turn/drive";
import { parseLongTurnFlags, profileOf, shellCommandOf, timeoutSecondsOf, type LongTurnProfile, type LongTurnStep, type StepFiles } from "../src/long-turn/profile";
import { compactionVerdictOf, messageVerdictOf, transcriptVerdictOf, type LongTurnReport } from "../src/long-turn/report";
import { AttentionFollower } from "../src/long-turn/follow";
import { agentRefOf, makeAgent } from "../src/support/agents";
import { claudeArm, type ArmStep } from "../src/support/engine-arms";
import type { ConformanceClients } from "../src/harness/clients";
import { uniqueName } from "../src/support/naming";
import { makeAgentExecution } from "../src/support/runs";
import { LocalExecutionTarget } from "../src/targets/local-execution";
import { LocalPostgresExecutionTarget } from "../src/targets/local-postgres";

/** How one harness's model plays the profile: the agent the run is on, the steps scripted, and the mock's counts. */
interface RealClockEngine {
  readonly harness: Harness | undefined;
  /** Create the run's agent (and any helper it lists) in `org`, and script every step on the mock; answers the agent's reference. */
  prepare(clients: ConformanceClients, mock: MockLlmProxy, org: string, task: string): Promise<ReturnType<typeof agentRefOf>>;
  counts(mock: MockLlmProxy): { readonly modelCalls: number; readonly compactions: number };
}

/** The step's shell, its timeout raised as a model raises it. */
function shellStepOf(id: string, step: LongTurnStep, files: StepFiles): ArmStep {
  const timeout = timeoutSecondsOf(step);
  return { kind: "shell", id, command: shellCommandOf(step, files), ...(timeout === undefined ? {} : { timeoutSeconds: timeout }), retryInterrupted: step.kind === "kill" };
}

/**
 * Native: one scripted model turn per step, then the closing answer, on the
 * queue. A subagent's own model calls are the next queued turns: its shell
 * (the step's work, its timeout raised as a model raises it), then its answer.
 */
function nativeEngine(profile: LongTurnProfile, files: StepFiles): RealClockEngine {
  return {
    harness: undefined,
    async prepare(clients, mock, org) {
      const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("long-turn-agent") }));
      const shellCall = (id: string, step: LongTurnStep) => {
        const timeout = timeoutSecondsOf(step);
        return anthropicToolUse(id, "execute", { command: shellCommandOf(step, files), ...(timeout === undefined ? {} : { timeout }) });
      };
      for (const step of profile.steps) {
        if (step.kind === "subagent") {
          mock.enqueue(anthropicToolUse(`call_${step.id}`, "task", { description: "Run the step's shell command and answer done.", subagent_type: "general-purpose" }));
          mock.enqueue(shellCall(`call_${step.id}_work`, step));
          mock.enqueue(anthropicText("done"));
        } else {
          mock.enqueue(shellCall(`call_${step.id}`, step));
        }
      }
      mock.enqueue(anthropicText("Every step of the long turn is done."));
      return agentRefOf(agent);
    },
    counts: (mock) => ({ modelCalls: mock.scriptedRequests().length, compactions: mock.summaryRequests() }),
  };
}

/** The window of the profile's model (Claude Haiku 4.5), which the API refuses a longer prompt at. */
const LONG_TURN_WINDOW_TOKENS = 200_000;

/** Claude: the same steps, played by conversation (the header), the subagent step handed to a saved helper. */
function claudeEngine(profile: LongTurnProfile, files: StepFiles): RealClockEngine {
  const arm = claudeArm({ usage: "sized", windowTokens: LONG_TURN_WINDOW_TOKENS });
  return {
    harness: Harness.CLAUDE,
    async prepare(clients, mock, org, task) {
      const helper = await clients.agentCommand.create(
        makeAgent({ org, name: uniqueName("long-turn-helper"), instructions: "You run the shell command you are given and answer done.", harness: Harness.CLAUDE }),
      );
      const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("long-turn-agent"), harness: Harness.CLAUDE, subagents: [helper.metadata!.slug] }));
      const steps = profile.steps.map((step): ArmStep => {
        if (step.kind !== "subagent") return shellStepOf(`call_${step.id}`, step, files);
        const prompt = `Run the step's shell command and answer done (${step.id}, ${uniqueName("handed")}).`;
        arm.script(mock, prompt, [shellStepOf(`call_${step.id}_work`, step, files), { kind: "text", text: "done" }]);
        return { kind: "delegate", id: `call_${step.id}`, agent: helper.metadata!.slug, prompt };
      });
      arm.script(mock, task, [...steps, { kind: "text", text: "Every step of the long turn is done." }]);
      return agentRefOf(agent);
    },
    counts: (mock) => ({ modelCalls: arm.loopRequests(mock).length, compactions: arm.compactions(mock) }),
  };
}

async function main(): Promise<void> {
  const flags = parseLongTurnFlags(process.argv.slice(2));
  if (flags.harness !== "deep-agent" && flags.harness !== "claude") throw new Error(`--harness must be deep-agent or claude, not '${flags.harness}'`);
  const profile = profileOf(flags.profile, { minutes: flags.minutes, steps: flags.steps });
  if (profile.liveOnly) throw new Error(`profile '${profile.name}' is live only: the mock plays its commands literally and keeps no goal to measure (npm run long-turn:live)`);
  const startedAt = new Date();
  const out = resolve(flags.out ?? join(".test-output", "long-turn-real-clock", `${flags.harness}-${profile.name}-${startedAt.toISOString().replace(/[:.]/g, "-")}`));
  mkdirSync(out, { recursive: true });
  const files: StepFiles = { markers: join(out, "markers.log"), keys: join(out, "keys.log"), releaseOf: (id) => join(out, `release-${id}`) };
  writeFileSync(files.markers, "");
  const report: LongTurnReport = {
    profile: flags.harness === "deep-agent" ? profile.name : `${profile.name} (${flags.harness})`,
    model: profile.model,
    startedAt: startedAt.toISOString(),
    steps: profile.steps.map((s) => s.id),
    notes: ["Against the mock the runner holds a static token, so the hosted runner's token re-mint (at 0.8 of its lifetime) never runs here."],
    samples: [],
    runnerEvents: [],
  };

  const target = flags.target === "local-postgres-execution" ? new LocalPostgresExecutionTarget() : new LocalExecutionTarget();
  let attention: AttentionFollower | undefined;
  console.log(`[long-turn] booting the stack; the report goes to ${out}`);
  try {
    // Inside the try: a stack whose boot fails (a runner not built yet, say)
    // is torn down with what it started, and the script exits instead of
    // hanging on the Temporal and server children it left running.
    await target.setup();
    const clients = target.clients();
    const mock = target.llmProxy();
    const { org } = await target.provisionTenancy();
    // Opened before the run, as a person's console is open before they start one.
    attention = new AttentionFollower(clients, org);

    const engine = flags.harness === "claude" ? claudeEngine(profile, files) : nativeEngine(profile, files);
    const task = `Play the ${profile.name} long turn.`;
    const agentRef = await engine.prepare(clients, mock, org, task);
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("long-turn-run"),
        agentRef,
        message: task,
        autoApproveAll: true,
        runConfig: { modelName: profile.model },
        ...(engine.harness === undefined ? {} : { sessionSpec: { harness: engine.harness } }),
      }),
    );
    console.log(`[long-turn] run ${created.metadata!.id} (${profile.steps.length} steps on ${profile.model}, ${flags.harness})`);
    const ended = await driveLongTurn({
      clients,
      runId: created.metadata!.id,
      profile,
      files,
      out,
      report,
      startedAtMs: startedAt.getTime(),
      restartRunner: (signal) => target.restartRunner({ signal }),
      restartServer: (options) => target.restartServer(options),
      counts: () => engine.counts(mock),
      sendMessage: async (sessionId, text) => {
        const sent = await clients.agentExecutionCommand.sendMessage(
          makeAgentExecution({ org, name: uniqueName("long-turn-message"), sessionId, message: text }),
        );
        const event = sent.message?.event;
        return { eventId: event?.case === "userMessage" ? event.value.id : "", queued: sent.run === undefined };
      },
      attention,
    });
    const verdict = transcriptVerdictOf(ended.end!);
    if (!verdict.whole) {
      console.error(`[long-turn] the transcript is broken: ${verdict.reasons.join("; ")}`);
      process.exitCode = 1;
    }
    const read = messageVerdictOf(ended.end!, created.metadata!.id);
    if (!read.read) {
      console.error(`[long-turn] the person's message or attention failed: ${read.reasons.join("; ")}`);
      process.exitCode = 1;
    }
    const compaction = compactionVerdictOf(ended.end!);
    if (!compaction.marked) {
      console.error(`[long-turn] the compactions were not told right: ${compaction.reasons.join("; ")}`);
      process.exitCode = 1;
    }
  } finally {
    // An orphaned held step would outlive the run: release every one.
    for (const step of profile.steps) if (!existsSync(files.releaseOf(step.id))) writeFileSync(files.releaseOf(step.id), "released at teardown\n");
    await attention?.stop();
    await target.teardown();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
