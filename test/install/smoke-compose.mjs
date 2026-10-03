#!/usr/bin/env node

/**
 * The compose-stack gate smoke — the ONE smoke,
 * shared by three consumers so their proofs cannot drift:
 *
 *   - local dev:        make smoke-compose            (build-from-source)
 *   - PR CI:            ci.compose-stack.yaml         (build-from-source)
 *   - the release lane: release.npm-libs.yaml runs it against the PUSHED
 *                       image tags on native amd64 AND arm64 runners
 *                       before `latest` moves and the compose pin bumps
 *
 * What one pass proves, in order: 1. `docker compose up` from this clean
 * tree reaches a healthy server (the image HEALTHCHECK via compose
 * depends_on, then the real health service answering SERVING over Connect
 * JSON); 2. the console is served on the unified port (/config.json contract
 * + / answers HTML) — the one-origin console must survive the compose
 * topology; 3. the artifact file server is published and answering on 7235
 * (the 0.0.0.0 bind + port publish — a 404 from it IS the proof of life); 4.
 * the env file's STIGMER_PUBLIC_URL reached the server through the compose
 * file: its boot line derives the MCP OAuth callback from that address (from
 * "public-origin"), not from the file's default (#1486); 5. an organization
 * nobody created is refused by name: compose runs no bootstrap, so an agent
 * create naming `stigmer` (what a bare `stigmer apply` sends) answers
 * "Organization not found: stigmer" instead of storing it (#1484); 6. one
 * END-TO-END RUN: a deterministic `set_vars` workflow execution travels
 * server → Temporal → runner → COMPLETED, with zero LLM keys (the
 * ci.conformance-execution precedent). This is the line that matters: the
 * runner container polled the queue and executed real work; 7. one AGENT RUN
 * answered by a model: the stack is configured the way the guide tells a
 * user to (ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL in the env file),
 * pointed at a fake Anthropic API on this host
 * (test/install/lib/fake-model.mjs), and the run must complete with the
 * fake's reply as its last message; 8. clean teardown (`docker compose down
 * --volumes`).
 *
 * Usage:
 *   node test/install/smoke-compose.mjs --build
 *       Builds both images from source via docker-compose.dev.yml. Both
 *       images COPY staged inputs: the server image a prebuilt slim tree
 *       (`make build-server build-web` and `node backend/services/
 *       stigmer-server/scripts/bundle-slim.mjs`), the runner image the CLI
 *       tarballs it installs (`make stage-compose-runner-cli`). `make
 *       smoke-compose` does all of it.
 *
 *   node test/install/smoke-compose.mjs --published --version=vX.Y.Z
 *       Pulls the published ghcr.io images at that tag (the release
 *       lane's mode; requires the tags to exist).
 *
 *   --keep    leave the stack running (skip teardown) for debugging; the
 *             fake model stops with this process, so agent runs then fail.
 *   --fake-model=error   the fake answers every model call with an error,
 *             so step 7 must fail — the red-first check of that step.
 *
 * How the stack is brought up and torn down (the env file, the override,
 * the source build) is test/install/lib/install-compose.mjs, the one boot the
 * upgrade rehearsal shares. The stack publishes fixed host ports 7234/7235
 * (the product contract), so this smoke refuses to start if they are
 * occupied — stop any running `stigmer up` or compose stack first. Keys are
 * generated fresh per run; a developer's real .env is never read.
 *
 * Plain node + docker CLI, no dependencies — runnable everywhere CI is.
 */
import process from "node:process";
import {
  assertArtifactLane,
  assertConsoleServed,
  assertMissingOrganizationRefused,
  assertOAuthCallbackFromPublicOrigin,
  assertPortFree,
  runAgentToReply,
  runSetVarsWorkflow,
  waitForServing,
} from "./lib/stigmer-smoke.mjs";
import { fakeModelEnv, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import {
  COMPOSE_ARTIFACT_PORT,
  COMPOSE_PUBLIC_URL,
  COMPOSE_SERVER_PORT,
  createComposeStack,
} from "./lib/install-compose.mjs";

// First boot pulls/starts four containers, runs Temporal schema setup, and
// waits for the server's start-period; generous on shared CI hosts.
const SERVER_HEALTHY_TIMEOUT_MS = 240_000;
// The end-to-end run additionally needs the runner's worker to connect
// (it restarts until Temporal answers) and the first task-queue poll.
const RUN_COMPLETED_TIMEOUT_MS = 240_000;

function parseArgs() {
  let mode = "";
  let version = "";
  let keep = false;
  let fakeModel = "reply";
  for (const arg of process.argv.slice(2)) {
    let m;
    const fakeModelMode = parseFakeModelArg(arg);
    if (fakeModelMode !== undefined) fakeModel = fakeModelMode;
    else if (arg === "--build") mode = "build";
    else if (arg === "--published") mode = mode === "" ? "published" : mode;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) version = m[1].replace(/^v/, "");
    else if (arg === "--keep") keep = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (mode === "") fail("pass exactly one of --build or --published");
  if (mode === "published" && version === "") {
    fail("--published requires --version=vX.Y.Z (the pushed image tag)");
  }
  return { release: mode === "build" ? { kind: "build" } : { kind: "published", version }, keep, fakeModel };
}

function fail(message) {
  console.error(`smoke-compose: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`smoke-compose: ${step}`);
}

async function main() {
  const { release, keep, fakeModel } = parseArgs();

  await assertPortFree(COMPOSE_SERVER_PORT);
  await assertPortFree(COMPOSE_ARTIFACT_PORT);

  // The model the stack is configured with: the fake on this host, which the
  // runner container reaches through the gateway name the override maps.
  const fake = await startFakeModel({ host: "0.0.0.0", mode: fakeModel });
  const model = fakeModelEnv(fake, "host.docker.internal");

  const stack = createComposeStack({ model, log });
  let failed = false;
  try {
    await stack.start(release);
    const { baseUrl } = stack;

    // 1. The server healthy — through compose depends_on this also proves
    // Postgres answered pg_isready and the image HEALTHCHECK went green.
    log("waiting for the server health service (SERVING)...");
    await waitForServing(baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    log("health service: SERVING");

    // 2. The console lane through the compose topology: the one
    // trusted-local /config.json document (test/install/lib/stigmer-smoke.mjs).
    await assertConsoleServed(baseUrl);
    log("console lane: /config.json contract + / html both answer");

    // 3. The artifact file server on its published port.
    await assertArtifactLane(stack.artifactUrl);
    log("artifact file server: answering on the published port");

    // 4. The public address the env file gave the stack, as the server took it.
    const callback = assertOAuthCallbackFromPublicOrigin(stack.logs("stigmer-server"), COMPOSE_PUBLIC_URL);
    log(`public address: the server derived its OAuth callback ${callback.redirectUri} from ${callback.from}`);

    // 5. Nothing has created an organization yet, and nothing may be stored under one.
    const refusal = await assertMissingOrganizationRefused(baseUrl);
    log(`missing organization: refused (HTTP ${refusal.status} ${refusal.code}: ${refusal.message})`);

    // 6. The end-to-end run — the line that matters: it only completes if the
    // runner container connected to Temporal and polled the queue.
    const { executionId } = await runSetVarsWorkflow(baseUrl, RUN_COMPLETED_TIMEOUT_MS, log);
    log(`end-to-end run: execution ${executionId} COMPLETED through the runner`);

    // 7. The agent run — the model path a user configures, end to end.
    const agentRun = await runAgentToReply(baseUrl, RUN_COMPLETED_TIMEOUT_MS, { expectText: fake.replyText, log });
    log(`agent run: execution ${agentRun.executionId} COMPLETED with the model's reply (${fake.requests()} model calls)`);

    log("PASS");
  } catch (error) {
    failed = true;
    console.error(
      `smoke-compose: FAIL — ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(stack.diagnostics());
  } finally {
    await stack.stop({ keep: keep && !failed });
    await fake.close();
  }
  process.exit(failed ? 1 : 0);
}

await main();
