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
// releases the step once the runner is replaced.
//
// The report (src/long-turn/report.ts) is rewritten after every minute, so a
// run that is stopped still leaves one. At the end it reads the session's log
// back and checks the sequence numbers run unbroken. What it cannot see is
// said in the report: against the mock the runner holds a static token, so
// the token re-mint a hosted runner does at 0.8 of its lifetime never runs.
//
// Needs: the `temporal` CLI on PATH, and the `stigmer` CLI (`make
// install-cli-shim`), as the execution lane does.
//
// Flags:
//   --profile goal|endurance   what the turn plays (src/long-turn/profile.ts); default goal
//   --minutes N                endurance's length (default 180)
//   --steps a,b                play only these steps of the profile, in its order
//   --out <dir>                where the report lands (default .test-output/long-turn-real-clock/<profile>-<stamp>)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { driveLongTurn } from "../src/long-turn/drive";
import { parseLongTurnFlags, profileOf, shellCommandOf, type StepFiles } from "../src/long-turn/profile";
import type { LongTurnReport } from "../src/long-turn/report";
import { agentRefOf, makeAgent } from "../src/support/agents";
import { uniqueName } from "../src/support/naming";
import { makeAgentExecution } from "../src/support/runs";
import { LocalExecutionTarget } from "../src/targets/local-execution";

async function main(): Promise<void> {
  const flags = parseLongTurnFlags(process.argv.slice(2));
  const profile = profileOf(flags.profile, { minutes: flags.minutes, steps: flags.steps });
  const startedAt = new Date();
  const out = resolve(flags.out ?? join(".test-output", "long-turn-real-clock", `${profile.name}-${startedAt.toISOString().replace(/[:.]/g, "-")}`));
  mkdirSync(out, { recursive: true });
  const files: StepFiles = { markers: join(out, "markers.log"), releaseOf: (id) => join(out, `release-${id}`) };
  writeFileSync(files.markers, "");
  const report: LongTurnReport = {
    profile: profile.name,
    model: profile.model,
    startedAt: startedAt.toISOString(),
    steps: profile.steps.map((s) => s.id),
    notes: ["Against the mock the runner holds a static token, so the hosted runner's token re-mint (at 0.8 of its lifetime) never runs here."],
    samples: [],
    runnerEvents: [],
  };

  const target = new LocalExecutionTarget();
  console.log(`[long-turn] booting the stack; the report goes to ${out}`);
  try {
    // Inside the try: a stack whose boot fails (a runner not built yet, say)
    // is torn down with what it started, and the script exits instead of
    // hanging on the Temporal and server children it left running.
    await target.setup();
    const clients = target.clients();
    const mock = target.llmProxy();
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("long-turn-agent") }));

    // One scripted model turn per step, then the closing answer. A subagent's
    // own model call is the next queued turn, held for the step's seconds.
    for (const step of profile.steps) {
      if (step.kind === "subagent") {
        mock.enqueue(anthropicToolUse(`call_${step.id}`, "task", { description: "Think about what a careful code review checks.", subagent_type: "general-purpose" }));
        mock.enqueue(anthropicText("A careful review checks correctness, tests and names."), { delayMs: step.seconds * 1_000 });
      } else {
        mock.enqueue(anthropicToolUse(`call_${step.id}`, "execute", { command: shellCommandOf(step, files)! }));
      }
    }
    mock.enqueue(anthropicText("Every step of the long turn is done."));

    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("long-turn-run"),
        agentRef: agentRefOf(agent),
        message: `Play the ${profile.name} long turn.`,
        autoApproveAll: true,
        runConfig: { modelName: profile.model },
      }),
    );
    console.log(`[long-turn] run ${created.metadata!.id} (${profile.steps.length} steps on ${profile.model})`);
    await driveLongTurn({
      clients,
      runId: created.metadata!.id,
      profile,
      files,
      out,
      report,
      startedAtMs: startedAt.getTime(),
      restartRunner: (signal) => target.restartRunner({ signal }),
      counts: () => ({ modelCalls: mock.scriptedRequests().length, compactions: mock.summaryRequests() }),
    });
  } finally {
    // An orphaned held step would outlive the run: release every one.
    for (const step of profile.steps) if (!existsSync(files.releaseOf(step.id))) writeFileSync(files.releaseOf(step.id), "released at teardown\n");
    await target.teardown();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
