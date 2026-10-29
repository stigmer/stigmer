// Plays one long turn in real time against a REAL provider, on one harness,
// under the product's own cost cap, and reports minute by minute how far it
// got (`npm run long-turn:live -- <flags>`).
// Domain: conformance long turn (the live run's entrypoint).
//
// THIS IS A MEASUREMENT THAT SPENDS MONEY. No vitest config collects it. It
// boots the benchmark's process stack (src/benchmark/run.ts
// `bootBenchmarkStack`: Temporal, the server, a direct-mode runner that calls
// the providers with the keys in its environment) and creates one run, trusted
// for the whole run, whose message tells the model to perform the profile's
// steps in order: the same shell commands the real-clock run scripts, said in
// words (src/long-turn/profile.ts `narrateStep`). The model decides; the
// steps' markers say what really ran.
//
// The ceiling is the product's cost cap, never a script-side estimate: the
// run's spec.run_config.max_cost_usd carries it, the server keeps the smallest
// bound any layer sets (domain/run/resolve-run-config.ts), and the runtime
// ends the turn `budget_reached` at the crossing (harness/cost-cap-watch.ts).
// Defaults: $10 a run on Stigmer and on Claude.
//
// On Claude (`--harness claude`) the agent lists one saved helper on Claude
// for the `subagent` step, and the step names it with the engine's `Agent`
// tool: Claude has no general-purpose helper of its own (stigmer#2589).
//
// The profile's `kill` and `drain` steps end the runner through the stack's
// door (`restartRunner`, src/benchmark/run.ts), as the real-clock run does
// against the mock: a SIGKILL while the step's shell runs, or a SIGTERM and
// the step's release a moment later. `--steps` picks the steps a run plays,
// so an opening leaves them out and a kill-and-drain run names them. The
// stack has no server door, so a `server-restart` step is released as it is.
// A streaming follower reads the session throughout, and a transcript that
// reads broken (report.ts `transcriptVerdictOf`) exits the script 1. A
// `message` step sends the person's message while the step's shell runs (no
// server door here, so no restart), and a follower of what needs the person
// watches the turn: the message must be read by the run after that step, and
// the person told once that the turn finished (`messageVerdictOf`), or the
// script exits 1. The reply says what the model made of the message.
//
// Compactions are counted from the log, and the summary must never stand as
// the reply (`compactionVerdictOf`, exit 1). The goal is checked too: the
// opening asks, once, for one thing needed only at the end, a `FINISHED.md`
// in the report directory naming the first and the last step and how many
// ran. Past three compactions the opening itself has been summarized, so a
// right file, with the steps run as listed (each once, in order, nothing
// added), says the model kept its goal (`goalVerdictOf`). The summary says
// kept, lost or void, and the script does not fail on it (a lost goal is a
// measurement, the case for tuning the summarizer). The opening insists on
// one call per step with its whole output: on 2026-10-23 Haiku 4.5 otherwise
// ran the bulk steps in loops with their output discarded, and its context
// never reached a compaction. It still ran them three or four to a call, so
// the `retention` profile chains them: each step takes the key the one
// before it printed (src/long-turn/profile.ts), and a run whose calls still
// bundled steps, or that compacted fewer than three times, reads void.
// `--profile retention --model claude-haiku-4.5` is the goal-retention probe.
//
// Needs: the `temporal` CLI on PATH; ANTHROPIC_API_KEY for Stigmer and Claude;
// the `stigmer` CLI (`make install-cli-shim`).
//
// Flags: those of the real-clock run (--profile, --minutes, --steps, --out),
// plus --harness stigmer|claude (default stigmer), --model <registry id>
// (default the harness's parity model) and --max-cost-usd N.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PARITY_MODEL, SESSION_HARNESS } from "../src/benchmark/cells";
import { HARNESSES, type BenchmarkHarness } from "../src/benchmark/report";
import { bootBenchmarkStack } from "../src/benchmark/run";
import { driveLongTurn } from "../src/long-turn/drive";
import { CHAIN_KEY, GENERAL_PURPOSE_HELPER, narrateStep, parseLongTurnFlags, profileOf, type StepFiles, type StepHelper } from "../src/long-turn/profile";
import { compactionVerdictOf, finishedCheckOf, goalVerdictOf, messageVerdictOf, stepFidelityOf, transcriptVerdictOf, writeLongTurnReport, type LongTurnReport } from "../src/long-turn/report";
import { AttentionFollower } from "../src/long-turn/follow";
import { agentRefOf, makeAgent } from "../src/support/agents";
import { uniqueName } from "../src/support/naming";
import { createUniqueOrganization } from "../src/support/organizations";
import { makeAgentExecution } from "../src/support/runs";

/** The product cost cap each harness's run carries unless --max-cost-usd says otherwise. */
const DEFAULT_MAX_COST_USD: Record<BenchmarkHarness, number> = { stigmer: 10, claude: 10 };
const KEY_OF: Record<BenchmarkHarness, string> = { stigmer: "ANTHROPIC_API_KEY", claude: "ANTHROPIC_API_KEY" };

/** Whether the harness's `subagent` step needs a saved helper: its engine has no general-purpose one. */
const NEEDS_SAVED_HELPER: Record<BenchmarkHarness, boolean> = { stigmer: false, claude: true };

/**
 * The live agent says what the run is. Without it a model reads a list of
 * sleeps and filler output as waste and declines them, which measures the
 * model's judgement, not the platform (the first live run on 2026-10-18 did
 * exactly that, under a code-review agent's instructions).
 */
const LIVE_AGENT_INSTRUCTIONS =
  "You are the long-turn test agent of a platform's own test suite. Its operator measures how the platform carries " +
  "long-running tool calls: silent commands, commands that print over minutes, delegated work and large outputs. " +
  "The commands you are given are that measurement and are safe on this machine (they sleep, print and append to " +
  "a marker file in a scratch directory). Run each exactly as given, in order, one at a time, without changing it, " +
  "and wait for it to finish. Do not summarize or judge the commands; the timing is the point.";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = parseLongTurnFlags(argv);
  const harness = HARNESSES.find((candidate) => candidate === flags.harness);
  if (harness === undefined) throw new Error(`--harness must be ${HARNESSES.join(", ")}, not '${flags.harness}'`);
  if (!process.env[KEY_OF[harness]]) throw new Error(`${KEY_OF[harness]} is not set: the live ${harness} run needs it`);
  const capIndex = argv.indexOf("--max-cost-usd");
  const maxCostUsd = capIndex >= 0 ? Number(argv[capIndex + 1]) : DEFAULT_MAX_COST_USD[harness];
  if (!(maxCostUsd > 0)) throw new Error(`--max-cost-usd must be a positive number`);

  const full = profileOf(flags.profile, { minutes: flags.minutes, steps: flags.steps });
  const profile = { ...full, model: flags.model ?? PARITY_MODEL[harness] };
  const startedAt = new Date();
  const out = resolve(flags.out ?? join(".test-output", "long-turn-live", `${harness}-${profile.name}-${startedAt.toISOString().replace(/[:.]/g, "-")}`));
  mkdirSync(out, { recursive: true });
  const files: StepFiles = { markers: join(out, "markers.log"), keys: join(out, "keys.log"), releaseOf: (id) => join(out, `release-${id}`) };
  writeFileSync(files.markers, "");
  writeFileSync(files.keys, "");
  const finishedFile = join(out, "FINISHED.md");
  const report: LongTurnReport = {
    profile: `${profile.name} (live, ${harness})`,
    model: profile.model,
    startedAt: startedAt.toISOString(),
    steps: profile.steps.map((s) => s.id),
    notes: [
      `The run's ceiling is the product's cost cap: max_cost_usd ${maxCostUsd}.`,
      "A live run has no mock, so model calls are not counted here; compactions are counted from the log.",
    ],
    samples: [],
    runnerEvents: [],
  };

  const stack = await bootBenchmarkStack(out);
  let attention: AttentionFollower | undefined;
  console.log(`[long-turn] live ${harness} on ${profile.model}, cap $${maxCostUsd}; the report goes to ${out}`);
  try {
    const { clients } = stack;
    const { id: org } = await createUniqueOrganization(clients.organizationCommand, "the live long turn");
    let helper: StepHelper = GENERAL_PURPOSE_HELPER;
    const subagents: string[] = [];
    if (NEEDS_SAVED_HELPER[harness]) {
      const saved = await clients.agentCommand.create(
        makeAgent({ org, name: uniqueName("long-turn-live-helper"), instructions: LIVE_AGENT_INSTRUCTIONS, harness: SESSION_HARNESS[harness] }),
      );
      helper = { tool: "Agent", name: saved.metadata!.slug, saved: true };
      subagents.push(saved.metadata!.slug);
    }
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("long-turn-live-agent"), instructions: LIVE_AGENT_INSTRUCTIONS, ...(subagents.length > 0 ? { subagents } : {}) }),
    );
    attention = new AttentionFollower(clients, org);
    const message = [
      "This is the platform's long-turn measurement: the operator wants each step below run exactly as written, to see how a turn that runs for a long time is carried. " +
        "Perform the steps in order, one at a time, waiting for each to finish before the next. Skip none, add none. " +
        "Each step is one tool call of its own, its command exactly as written: never put two steps into one call, a loop or a script, and never redirect, " +
        "pipe away or shorten a command's output, because each call's whole output coming back to you is what is measured." +
        (profile.steps.some((step) => step.kind === "chained")
          ? ` Each step's output ends with a line 'next key: ...'; the next step's command takes that key in place of ${CHAIN_KEY}.`
          : ""),
      ...profile.steps.map((step, i) => `${i + 1}. ${narrateStep(step, files, helper)}`),
      `When every step is done, write the file '${finishedFile}' with the shell, holding three lines: the id of the first step you ran ` +
        "(the word after 'start' in its command), the id of the last, and how many steps you ran. Then reply with exactly: done",
    ].join("\n");
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("long-turn-live-run"),
        agentRef: agentRefOf(agent),
        sessionSpec: { harness: SESSION_HARNESS[harness] },
        message,
        autoApproveAll: true,
        runConfig: { modelName: profile.model, maxCostUsd },
      }),
    );
    const ended = await driveLongTurn({
      clients,
      runId: created.metadata!.id,
      profile,
      files,
      out,
      report,
      startedAtMs: startedAt.getTime(),
      restartRunner: (signal) => stack.restartRunner(signal),
      sendMessage: async (sessionId, text) => {
        const sent = await clients.agentExecutionCommand.sendMessage(
          makeAgentExecution({ org, name: uniqueName("long-turn-live-message"), sessionId, message: text }),
        );
        const event = sent.message?.event;
        return { eventId: event?.case === "userMessage" ? event.value.id : "", queued: sent.run === undefined };
      },
      attention,
    });
    const ids = profile.steps.map((s) => s.id);
    const finished = finishedCheckOf(ids, existsSync(finishedFile) ? readFileSync(finishedFile, "utf8") : undefined);
    const fidelity = stepFidelityOf(ids, readFileSync(files.markers, "utf8"), readFileSync(files.keys, "utf8"));
    const end = { ...ended.end!, finished, fidelity };
    await writeLongTurnReport(out, { ...ended, end });
    const verdict = transcriptVerdictOf(end);
    if (!verdict.whole) {
      console.error(`[long-turn] the transcript is broken: ${verdict.reasons.join("; ")}`);
      process.exitCode = 1;
    }
    const read = messageVerdictOf(end, created.metadata!.id);
    if (!read.read) {
      console.error(`[long-turn] the person's message or attention failed: ${read.reasons.join("; ")}`);
      process.exitCode = 1;
    }
    const compaction = compactionVerdictOf(end);
    if (!compaction.marked) {
      console.error(`[long-turn] the compactions were not told right: ${compaction.reasons.join("; ")}`);
      process.exitCode = 1;
    }
    const goal = goalVerdictOf(end)!;
    console.log(`[long-turn] ${end.compactedEvents ?? 0} compactions marked; goal ${goal.verdict}${goal.reasons.length === 0 ? "" : `: ${goal.reasons.join("; ")}`}`);
  } finally {
    await attention?.stop();
    await stack.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
