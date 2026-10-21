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
// Defaults: $10 a run on native, $20 on Cursor (which bills the Cursor
// account).
//
// The profile's `kill` and `drain` steps end the runner through the stack's
// door (`restartRunner`, src/benchmark/run.ts), as the real-clock run does
// against the mock: a SIGKILL while the step's shell runs, or a SIGTERM and
// the step's release a moment later. `--steps` picks the steps a run plays,
// so an opening leaves them out and a kill-and-drain run names them. The
// stack has no server door, so a `server-restart` step is released as it is.
// A streaming follower reads the session throughout, and a transcript that
// reads broken (report.ts `transcriptVerdictOf`) exits the script 1.
//
// Needs: the `temporal` CLI on PATH; ANTHROPIC_API_KEY for native,
// CURSOR_API_KEY for Cursor; the `stigmer` CLI (`make install-cli-shim`).
//
// Flags: those of the real-clock run (--profile, --minutes, --steps, --out),
// plus --harness deep-agent|cursor (default deep-agent) and --max-cost-usd N.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { PARITY_MODEL } from "../src/benchmark/cells";
import type { BenchmarkHarness } from "../src/benchmark/report";
import { bootBenchmarkStack } from "../src/benchmark/run";
import { driveLongTurn } from "../src/long-turn/drive";
import { narrateStep, parseLongTurnFlags, profileOf, type StepFiles } from "../src/long-turn/profile";
import { transcriptVerdictOf, type LongTurnReport } from "../src/long-turn/report";
import { agentRefOf, makeAgent } from "../src/support/agents";
import { uniqueName } from "../src/support/naming";
import { createUniqueOrganization } from "../src/support/organizations";
import { makeAgentExecution } from "../src/support/runs";

/** The product cost cap each harness's run carries unless --max-cost-usd says otherwise. */
const DEFAULT_MAX_COST_USD: Record<BenchmarkHarness, number> = { "deep-agent": 10, cursor: 20 };
const KEY_OF: Record<BenchmarkHarness, string> = { "deep-agent": "ANTHROPIC_API_KEY", cursor: "CURSOR_API_KEY" };

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
  if (flags.harness !== "deep-agent" && flags.harness !== "cursor") throw new Error(`--harness must be deep-agent or cursor, not '${flags.harness}'`);
  const harness: BenchmarkHarness = flags.harness;
  if (!process.env[KEY_OF[harness]]) throw new Error(`${KEY_OF[harness]} is not set: the live ${harness} run needs it`);
  const capIndex = argv.indexOf("--max-cost-usd");
  const maxCostUsd = capIndex >= 0 ? Number(argv[capIndex + 1]) : DEFAULT_MAX_COST_USD[harness];
  if (!(maxCostUsd > 0)) throw new Error(`--max-cost-usd must be a positive number`);

  const full = profileOf(flags.profile, { minutes: flags.minutes, steps: flags.steps });
  const profile = { ...full, model: PARITY_MODEL[harness] };
  const startedAt = new Date();
  const out = resolve(flags.out ?? join(".test-output", "long-turn-live", `${harness}-${profile.name}-${startedAt.toISOString().replace(/[:.]/g, "-")}`));
  mkdirSync(out, { recursive: true });
  const files: StepFiles = { markers: join(out, "markers.log"), releaseOf: (id) => join(out, `release-${id}`) };
  writeFileSync(files.markers, "");
  const report: LongTurnReport = {
    profile: `${profile.name} (live, ${harness})`,
    model: profile.model,
    startedAt: startedAt.toISOString(),
    steps: profile.steps.map((s) => s.id),
    notes: [
      `The run's ceiling is the product's cost cap: max_cost_usd ${maxCostUsd}.`,
      "A live run has no mock, so model calls and compactions are not counted here.",
    ],
    samples: [],
    runnerEvents: [],
  };

  const stack = await bootBenchmarkStack(out);
  console.log(`[long-turn] live ${harness} on ${profile.model}, cap $${maxCostUsd}; the report goes to ${out}`);
  try {
    const { clients } = stack;
    const { id: org } = await createUniqueOrganization(clients.organizationCommand, "the live long turn");
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("long-turn-live-agent"), instructions: LIVE_AGENT_INSTRUCTIONS }));
    const message = [
      "This is the platform's long-turn measurement: the operator wants each step below run exactly as written, to see how a turn that runs for a long time is carried. " +
        "Perform the steps in order, one at a time, waiting for each to finish before the next. Skip none, add none.",
      ...profile.steps.map((step, i) => `${i + 1}. ${narrateStep(step, files)}`),
      "When every step is done, reply with exactly: done",
    ].join("\n");
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("long-turn-live-run"),
        agentRef: agentRefOf(agent),
        sessionSpec: { harness: harness === "cursor" ? Harness.CURSOR : Harness.NATIVE },
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
    });
    const verdict = transcriptVerdictOf(ended.end!);
    if (!verdict.whole) {
      console.error(`[long-turn] the transcript is broken: ${verdict.reasons.join("; ")}`);
      process.exitCode = 1;
    }
  } finally {
    await stack.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
