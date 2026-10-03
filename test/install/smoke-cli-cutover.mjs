#!/usr/bin/env node

/**
 * CLI E2E smoke (born as the TypeScript server's cutover gate): `stigmer
 * up` → apply →
 * run → stream → `stigmer down`, against an ISOLATED home, proving the
 * daemon launches the packaged server end-to-end. Nothing else exercises
 * `stigmer up` whole — the e2e suites boot the server entry directly,
 * bypassing the CLI.
 *
 * The script stages the SLIM server artifact (dist-slim) as a server
 * package and launches it through the daemon's node+entry path — the exact
 * packaged entry users get from @stigmer/server-slim. (The script's second
 * arm — the STIGMER_SERVER_BIN Go rollback — retired with the Go server.)
 *
 * The launch is verified, not assumed: after `up`, the server child's real
 * command line (via its PID file) must be a node+entry process.
 *
 * The workflow under test is a single deterministic set_vars task — no LLM,
 * no API keys, no network beyond npm/Temporal's own machinery. What it
 * proves: CLI daemon → server (gRPC gate) → bootstrap → workflow apply
 * → Temporal orchestration → runner execution → event streaming → clean
 * shutdown. Then an agent is applied and run with `stigmer run <agent> -m`:
 * the shell `stigmer up` starts from carries the model settings a user
 * exports (ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL), pointed at a fake
 * Anthropic API on loopback (test/install/lib/fake-model.mjs), and the streamed
 * run must carry the fake's reply — what a CLI user sees as the answer (or,
 * with `--live-model`, the real provider's; see Usage).
 * Then two workflow approval gates are run and decided the way a reviewer
 * does from the CLI: one times out under the fail policy, and
 * `stigmer execution logs` must say it decided nothing before its task
 * failed; the other is approved with `stigmer execution approve --comment`,
 * and the logs must name who approved it (the run's creator) while its
 * approval_resolved event carries the comment. No model is called. A gate's
 * run is still streaming while the smoke decides it, so a step that fails
 * meanwhile ends that run before the smoke reports, rather than leaving it
 * to its own timeout.
 * Since the console restoration it also proves the
 * unified port serves the bundled web console: /config.json synthesis, a
 * dynamic deep link, and the 404 posture — the "`stigmer up` serves the
 * console end-to-end" arm.
 *
 * The CLI itself runs from source under tsx — the repo's documented dev
 * launch (its `start` script; the daemon re-exec replays the loader via
 * process.execArgv, see daemon/launch.ts). The packaged artifact under test
 * here is the SERVER slim bundle, staged byte-for-byte.
 *
 * How the CLI is installed, started and stopped in its isolated home is
 * test/install/lib/install-cli.mjs, the one boot the upgrade rehearsal shares.
 * `stigmer up` serves on port 7234, so the smoke refuses before anything
 * starts when that port is taken: another stack is running.
 *
 * Prereqs (the gate's build steps): backend/services/runner built (dist/)
 * and the server's dist-slim/ (make smoke-cli-cutover builds both).
 *
 * Usage:
 *   node test/install/smoke-cli-cutover.mjs
 *       The CLI from source, the staged slim server (the gate's mode).
 *   node test/install/smoke-cli-cutover.mjs --published --version=X.Y.Z
 *       The published CLI, installed by site/public/install.sh into the
 *       isolated home, which acquires its own published server and runner
 *       on `up` — a user's install, end to end.
 *   --fake-model=error   the fake answers every model call with an error,
 *       so the agent run must fail (its red-first check).
 *   --live-model   no fake: the install is handed the shell's ANTHROPIC_API_KEY
 *       and no base URL, the agent runs on the cheapest native model
 *       (`LIVE_MODEL`), and the stream's `done` event must report `completed`
 *       with a non-empty reply; the words are never compared. The live lane runs it
 *       against the published CLI after a release. It spends real money (one
 *       short turn), and the CLI has no cost-limit flag, so the bound is the
 *       one turn.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { LIVE_MODEL, fakeModelEnv, liveModelEnv, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import { CLI_SERVER_PORT, createCliInstall, whileRunning } from "./lib/install-cli.mjs";
import {
  approvalResolutions,
  assertConsoleServed,
  assertPortFree,
  connectJson,
  gateLogProblem,
  pollUntil,
  streamedRunOutcome,
  waitForBootstrapOrganization,
  waitForPendingApproval,
  workflowExecutionCreator,
  workflowIdByReference,
} from "./lib/stigmer-smoke.mjs";

/** The org `stigmer up`'s bootstrap creates — the CLI's fallback on a local backend. */
const ORG = "stigmer";
const RUN_TIMEOUT_MS = 120_000;
/** The agent the smoke applies and runs by slug. */
const AGENT = "cutover-smoke-agent";
/** The two gated workflows: one whose gate times out under the fail policy, one a reviewer approves. */
const TIMEOUT_GATE_WORKFLOW = "cutover-smoke-gate-timeout";
const APPROVED_GATE_WORKFLOW = "cutover-smoke-gate-approved";
/** Long enough for the smoke to see the gate waiting before it times out. */
const GATE_TIMEOUT_SECONDS = 20;
const REVIEW_COMMENT = "approved by the CLI smoke's reviewer";
const TERMINAL_PHASES = new Set(["EXECUTION_COMPLETED", "EXECUTION_FAILED", "EXECUTION_CANCELLED", "EXECUTION_TERMINATED"]);

function log(step) {
  console.log(`smoke-cli-cutover: ${step}`);
}

function parseArgs() {
  const parsed = { published: false, version: "", fakeModel: "reply", liveModel: false };
  for (const arg of process.argv.slice(2)) {
    let m;
    const fakeModelMode = parseFakeModelArg(arg);
    if (fakeModelMode !== undefined) parsed.fakeModel = fakeModelMode;
    else if (arg === "--published") parsed.published = true;
    else if (arg === "--live-model") parsed.liveModel = true;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) parsed.version = m[1].replace(/^v/, "");
    else
      usage(
        `unknown argument: ${arg} (usage: node test/install/smoke-cli-cutover.mjs [--published --version=X.Y.Z] [--fake-model=error | --live-model])`,
      );
  }
  if (parsed.liveModel && parsed.fakeModel !== "reply") usage("--live-model and --fake-model choose the same far side; pass one");
  if (parsed.published && parsed.version === "") usage("--published requires --version=X.Y.Z (the published @stigmer/cli)");
  if (!parsed.published && parsed.version !== "") usage("--version applies only with --published");
  return parsed;
}

function usage(message) {
  console.error(`smoke-cli-cutover: ${message}`);
  process.exit(1);
}

const args = parseArgs();
const release = args.published ? { kind: "published", version: args.version } : { kind: "build" };

// Before anything starts, so a refusal leaves nothing to tear down.
try {
  await assertPortFree(CLI_SERVER_PORT);
} catch (error) {
  console.error(`smoke-cli-cutover: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// The model the stack is started with: the fake on loopback, configured the
// way a user exports a gateway for `stigmer up`; or, with --live-model, the
// real provider through the user's own key.
const fake = args.liveModel ? undefined : await startFakeModel({ mode: args.fakeModel });
const stack = createCliInstall({ model: fake === undefined ? liveModelEnv(process.env) : fakeModelEnv(fake), log });
const { home, cli } = stack;
let failed = false;

try {
  // 1. Up — the daemon resolves the staged server (or acquires the published
  //    one), gates on the gRPC port, and bootstraps the backend (which
  //    creates the org).
  await stack.start(release);

  // 2. Prove WHICH server is running: the server child's command line must
  //    be the node+entry launch. The PID file is the daemon's own record.
  const server = stack.serverCommand();
  log(`server pid ${server.pid}: ${server.command}`);
  if (!(server.command.includes("node") && server.command.includes("main.js"))) {
    throw new Error(`expected a node+entry server process, got: ${server.command}`);
  }

  // 3. Console restoration: the slim artifact ships the web
  //    console and the server serves it from the unified port. Probe the
  //    three load-bearing arms a browser exercises: the synthesized
  //    /config.json (the one trusted-local document, asserted by the shared
  //    probe in test/install/lib/stigmer-smoke.mjs together with / as HTML), a
  //    dynamic deep link resolving to its placeholder document, and the 404
  //    posture (the export's not-found page WITH a 404 status — never the
  //    blank app shell). `--no-web` only suppresses URL reporting; serving
  //    is unconditional.
  const consoleBase = `http://127.0.0.1:${CLI_SERVER_PORT}`;
  await assertConsoleServed(consoleBase).catch((error) => {
    throw new Error(`console ${error instanceof Error ? error.message : String(error)}`);
  });
  const deepLink = await fetch(`${consoleBase}/sessions/zz-smoke-probe`);
  if (
    deepLink.status !== 200 ||
    !(deepLink.headers.get("content-type") ?? "").includes("text/html")
  ) {
    throw new Error(
      `console deep link answered ${deepLink.status} ${deepLink.headers.get("content-type")}`,
    );
  }
  const notFound = await fetch(`${consoleBase}/zz-no-such-route`);
  if (notFound.status !== 404) {
    throw new Error(`console unknown URL answered ${notFound.status}, expected 404`);
  }
  log("console serving verified");

  // 4. Apply the deterministic workflow.
  const workflowPath = join(home, "cutover-smoke.yaml");
  writeFileSync(
    workflowPath,
    `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: cutover-smoke
spec:
  description: Deterministic no-LLM workflow for the CLI cutover smoke.
  document:
    dsl: "1.0.0"
    namespace: stigmer
    name: cutover-smoke
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: hello-from-the-cutover-smoke
      export:
        as: "\${ . }"
`,
  );
  // --org is a root-level global option, so it precedes the subcommand.
  await cli(["--org", ORG, "apply", "-f", workflowPath]);

  // 5. Run it and stream to completion (JSON events on stdout) — a clean
  //    exit is required.
  const run = await cli(["--org", ORG, "run", "workflow", "cutover-smoke", "--json"], {
    timeoutMs: RUN_TIMEOUT_MS,
  });
  if (!/completed/i.test(run.stdout)) {
    throw new Error(
      `run did not reach COMPLETED\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );
  }

  // 6. Apply an agent and run it by slug: the stream must carry the model's
  //    reply, which only happens when `stigmer up` handed the runner the
  //    model settings from its shell and the runner reached the model.
  const agentPath = join(home, "cutover-smoke-agent.yaml");
  writeFileSync(
    agentPath,
    `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: ${AGENT}
spec:
  description: A tool-less agent for the CLI smoke; its model is the one the smoke started the install with.
  instructions: Answer the message in one short sentence.
`,
  );
  await cli(["--org", ORG, "apply", "-f", agentPath]);
  const modelArgs = fake === undefined ? ["--model", LIVE_MODEL] : [];
  const agentRun = await cli(["--org", ORG, "run", AGENT, "-m", "Say hello.", ...modelArgs, "--json"], {
    timeoutMs: RUN_TIMEOUT_MS,
  });
  if (fake === undefined) {
    const outcome = streamedRunOutcome(agentRun.stdout);
    // The CLI's stream names phases in its short words (`pending`, `in_progress`, `completed`).
    if (outcome.phase !== "completed" || outcome.reply.trim() === "") {
      throw new Error(
        `the live agent run on ${LIVE_MODEL} did not complete with a reply (phase ${outcome.phase || "none"})\n` +
          `stdout:\n${agentRun.stdout}\nstderr:\n${agentRun.stderr}`,
      );
    }
    log(`agent run on ${LIVE_MODEL} completed with a reply from the real provider`);
  } else {
    if (!agentRun.stdout.includes(fake.replyText)) {
      throw new Error(
        `the agent run's stream does not carry the model's reply (${fake.requests()} model calls)\n` +
          `stdout:\n${agentRun.stdout}\nstderr:\n${agentRun.stderr}`,
      );
    }
    log(`agent run streamed the model's reply (${fake.requests()} model calls)`);
  }

  // 7. The approval gates, as a reviewer meets them from the CLI.
  const orgId = await waitForBootstrapOrganization(stack.baseUrl, RUN_TIMEOUT_MS, { slug: ORG });
  await applyGateWorkflow(TIMEOUT_GATE_WORKFLOW, { timeoutSeconds: GATE_TIMEOUT_SECONDS });
  const timedOutRun = stack.cliChild(["--org", ORG, "run", "workflow", TIMEOUT_GATE_WORKFLOW, "--json"], {
    timeoutMs: RUN_TIMEOUT_MS,
  });
  const timedOut = await whileRunning(timedOutRun, async () =>
    waitForPendingApproval(stack.baseUrl, {
      orgId,
      workflowId: await workflowIdByReference(stack.baseUrl, { org: ORG, slug: TIMEOUT_GATE_WORKFLOW }),
      timeoutMs: RUN_TIMEOUT_MS,
    }),
  );
  log(`gate ${timedOut.taskName} of ${timedOut.executionId} waits; leaving it to time out`);
  const timedOutResult = await timedOutRun.done;
  const timedOutPhase = await pollUntil("the timed-out gate's run to end", RUN_TIMEOUT_MS, async () => {
    const phase = (
      await connectJson(stack.baseUrl, "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get", {
        value: timedOut.executionId,
      })
    ).status?.phase;
    return TERMINAL_PHASES.has(phase) ? phase : false;
  });
  if (timedOutPhase !== "EXECUTION_FAILED") {
    throw new Error(
      `the timed-out gate's run ended ${timedOutPhase}, expected EXECUTION_FAILED under the fail policy ` +
        `(the CLI exited ${timedOutResult.status}${timedOutResult.error ? `: ${timedOutResult.error.message}` : ""})\n` +
        `stderr:\n${timedOutResult.stderr}`,
    );
  }
  const timedOutLogs = await cli(["--org", ORG, "execution", "logs", timedOut.executionId]);
  const timedOutProblem = gateLogProblem(timedOutLogs.stdout, timedOut.taskName, "timed out");
  if (timedOutProblem !== undefined) throw new Error(`execution logs of the timed-out gate: ${timedOutProblem}`);
  log("execution logs: the timed-out gate decided nothing, then its task failed");

  await applyGateWorkflow(APPROVED_GATE_WORKFLOW);
  const approvedRun = stack.cliChild(["--org", ORG, "run", "workflow", APPROVED_GATE_WORKFLOW, "--json"], {
    timeoutMs: RUN_TIMEOUT_MS,
  });
  const approved = await whileRunning(approvedRun, async () => {
    const pending = await waitForPendingApproval(stack.baseUrl, {
      orgId,
      workflowId: await workflowIdByReference(stack.baseUrl, { org: ORG, slug: APPROVED_GATE_WORKFLOW }),
      timeoutMs: RUN_TIMEOUT_MS,
    });
    await cli([
      "--org",
      ORG,
      "execution",
      "approve",
      pending.executionId,
      "--task",
      pending.taskName,
      "--outcome",
      "approve",
      "--comment",
      REVIEW_COMMENT,
    ]);
    return pending;
  });
  const approvedResult = await approvedRun.done;
  if (approvedResult.status !== 0 || !/completed/i.test(approvedResult.stdout)) {
    throw new Error(
      `the approved gate's run did not complete (exit ${approvedResult.status})\n` +
        `stdout:\n${approvedResult.stdout}\nstderr:\n${approvedResult.stderr}`,
    );
  }
  const reviewer = await workflowExecutionCreator(stack.baseUrl, approved.executionId);
  const approvedLogs = await cli(["--org", ORG, "execution", "logs", approved.executionId]);
  const approvedProblem = gateLogProblem(approvedLogs.stdout, approved.taskName, { outcome: "approve", by: reviewer });
  if (approvedProblem !== undefined) throw new Error(`execution logs of the approved gate: ${approvedProblem}`);
  const resolved = (await approvalResolutions(stack.baseUrl, approved.executionId)).filter(
    (resolution) => resolution.taskName === approved.taskName,
  );
  if (resolved.length !== 1 || resolved[0].comment !== REVIEW_COMMENT) {
    throw new Error(
      `the approved gate's approval_resolved events carry ${JSON.stringify(resolved)}; ` +
        `want one, with the comment ${JSON.stringify(REVIEW_COMMENT)}`,
    );
  }
  log(`execution logs: approve by ${reviewer}; the event carries the reviewer's comment`);

  // 8. Down — clean teardown, port released.
  await cli(["down"]);
  const status = await cli(["status"], { allowFailure: true });
  if (
    /running/i.test(status.stdout) &&
    !/not running|stopped/i.test(status.stdout)
  ) {
    throw new Error(`stack still reports running after down\n${status.stdout}`);
  }
  log("PASS");
} catch (error) {
  failed = true;
  console.error(`smoke-cli-cutover: ${error instanceof Error ? error.message : String(error)}`);
  console.error(stack.diagnostics());
} finally {
  // Success-path hygiene: the isolated home carries a full slim copy plus a
  // Temporal binary (~100 MB) — keep failures around for debugging, never
  // successes.
  await stack.stop({ keepHome: failed });
  await fake?.close();
}
process.exit(failed ? 1 : 0);

/**
 * Apply a workflow whose one gate is a human_input task offering approve or
 * deny, followed by a set_vars step that runs only once the gate resolves.
 * With `timeoutSeconds` the gate fails the run when nobody decides in time.
 */
async function applyGateWorkflow(name, { timeoutSeconds } = {}) {
  const timeoutLines =
    timeoutSeconds === undefined ? "" : `        timeout: ${timeoutSeconds}\n        on_timeout: HUMAN_INPUT_TIMEOUT_FAIL\n`;
  const path = join(home, `${name}.yaml`);
  writeFileSync(
    path,
    `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: ${name}
spec:
  description: An approval gate for the CLI smoke; no model is called.
  document:
    dsl: "1.0.0"
    namespace: stigmer
    name: ${name}
    version: "1.0.0"
  tasks:
    - name: review
      kind: human_input
      task_config:
        prompt: Approve the CLI smoke's run?
        outcomes:
          - name: approve
          - name: deny
${timeoutLines}    - name: after_review
      kind: set_vars
      task_config:
        variables:
          reviewed: "yes"
`,
  );
  await cli(["--org", ORG, "apply", "-f", path]);
}
