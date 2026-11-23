// Shared runners beside a sandbox driver: a signed-in server with per-session
// sandboxes (the local-process driver) and shared runners on
// (STIGMER_SHARED_RUNNER_KEY), one runner that serves only conversations
// without a computer, and a member's two conversations side by side.
// Domain: agentic / agentexecution (placement, the sealed run credential,
// the shared runner's Temporal lane).
//
// What is pinned over the wire:
//
//   - a member's conversation WITH a computer runs in a sandbox the server
//     starts, never on the shared runner; its turn's workflow input names
//     no shared runner and carries its credential as before;
//   - a member's conversation WITHOUT a computer runs on the shared runner,
//     while the other runs in its sandbox, and completes: its workflow input
//     says `runner: "shared"` and carries the credential only SEALED, so the
//     turn's history shows no value that acts for the member;
//   - the shared runner acts as the member, never as itself: its one token is
//     the shared-runner key, which only the server's Temporal lane accepts,
//     so the turn's status writes, its session events and its session's title
//     land only because every call the turn made carried the turn's own
//     credential (the runner-as-subject proof, on a shared runner);
//   - a turn whose conversation has a computer is never taken by the shared
//     runner (it would refuse it): the shared runner's log names the
//     computer-less run alone.
//
// It boots its own stack (an OIDC issuer, Temporal, the server, a mock LLM
// and the shared runner) through the target's sibling spawn, so it runs on
// the targets that boot their own engine (`engineCoordinates()`); the cloud
// targets, whose engine is the service's, report SKIPPED.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { anthropicText } from "@stigmer/test-support/llm-wire";
import { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { ensureRunnerBuilt } from "@stigmer/test-support/runner-build";
import { spawnRunner, type RunningRunner } from "@stigmer/test-support/runner-process";
import { startTcpFront, type TcpFront } from "@stigmer/test-support/tcp-front";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newSiblingEnforcingLane, type SiblingEnforcingLane } from "../harness/enforcing-lane";
import type { ConformanceClients } from "../harness/clients";
import { agentRefOf, makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { awaitTerminal, makeAgentExecution, sessionIdOf } from "../support/runs";
import { pollUntil } from "../support/run-poll";
import { createTarget, type TargetProfile } from "../targets";
import type { SiblingExecutionServer } from "../targets/target";

const execFileAsync = promisify(execFile);
const hasEngine = createTarget().engineCoordinates !== undefined;

const SHARED_RUNNER_KEY = randomBytes(32).toString("base64url");
const PAYLOAD_KEY = randomBytes(32).toString("base64");
const PAYLOAD_KEY_ID = "conformance-shared";
const UNTITLED_SESSION_SUBJECT = "Auto-created session";

describe.skipIf(!hasEngine)("shared runners beside a sandbox driver (a member's two conversations)", () => {
  let target: TargetProfile;
  let people: SiblingEnforcingLane;
  let sibling: SiblingExecutionServer | undefined;
  let shared: RunningRunner | undefined;
  const mock = new MockLlmProxy();
  let scratch = "";
  // The address the driver hands each sandbox as the server's, known before
  // the server's own ephemeral port is: a deployment's Service.
  let front: TcpFront | undefined;

  beforeAll(async () => {
    target = createTarget();
    await mock.start();
    // Every model call is one short answer, whoever asks and in what order:
    // two runners share this mock, so a FIFO could hand one run's answer
    // to the other.
    mock.routeWith(() => ({ body: anthropicText("Done.") }));
    const runnerEntry = await ensureRunnerBuilt();
    scratch = await mkdtemp(join(tmpdir(), "stigmer-shared-runner-"));
    // The local-process driver starts one executable per sandbox, with no
    // arguments; this is the runner the harness built.
    const sandboxRunner = join(scratch, "sandbox-runner.sh");
    await writeFile(sandboxRunner, `#!/bin/sh\nexec "${process.execPath}" "${runnerEntry}"\n`);
    await chmod(sandboxRunner, 0o755);
    front = await startTcpFront();

    const spawnSibling = target.spawnSibling?.bind(target);
    if (spawnSibling === undefined) {
      throw new Error(`target "${target.name}" boots its own engine but spawns no sibling`);
    }
    people = await newSiblingEnforcingLane({
      async spawnSibling(options) {
        const spawned = (await spawnSibling({
          ...options,
          env: {
            ...options.env,
            STIGMER_ACTIVITY_ROUTING: "session",
            STIGMER_DEFAULT_EXECUTION_TARGET: "cloud",
            SANDBOX_PROVISIONER_TYPE: "local-process",
            STIGMER_SANDBOX_RUNNER_COMMAND: sandboxRunner,
            STIGMER_SANDBOX_BACKEND_ENDPOINT: front!.baseUrl,
            STIGMER_SHARED_RUNNER_KEY: SHARED_RUNNER_KEY,
            STIGMER_PAYLOAD_ENCRYPTION_KEY: PAYLOAD_KEY,
            STIGMER_PAYLOAD_ENCRYPTION_KEY_ID: PAYLOAD_KEY_ID,
            // A sandbox inherits the server's environment: its model calls
            // reach the same mock.
            STIGMER_PROXY_ENDPOINT: mock.url(),
            STIGMER_PRIMARY_MODEL: "claude-sonnet-4-6",
            SKIP_MCP_CONNECT_BACKFILL: "true",
          },
        })) as SiblingExecutionServer;
        sibling = spawned;
        return spawned;
      },
    });
    const engine = sibling!.engine;
    front.add(Number(new URL(engine.serverBaseUrl).port));
    const serverHostPort = new URL(engine.serverBaseUrl).host;
    shared = await spawnRunner({
      entryPath: runnerEntry,
      // The server's own address: the runner reaches Temporal through the
      // server's lane, its key its only credential there.
      temporalHostPort: serverHostPort,
      backendEndpoint: engine.serverBaseUrl,
      registryOrigin: engine.serverBaseUrl,
      proxy: { endpoint: mock.url(), token: SHARED_RUNNER_KEY },
      artifactDir: sibling!.artifactStore.dir,
      env: {
        STIGMER_RUNNER_SERVES: "computerless",
        STIGMER_PAYLOAD_ENCRYPTION_KEY: PAYLOAD_KEY,
        STIGMER_PAYLOAD_ENCRYPTION_KEY_ID: PAYLOAD_KEY_ID,
      },
    });
  }, 240_000);

  afterAll(async () => {
    await shared?.stop();
    await people?.close();
    await mock.close();
    await front?.close();
    if (scratch !== "") await rm(scratch, { recursive: true, force: true });
  });

  async function startTurn(by: ConformanceClients, org: string, founder: ConformanceClients, computer: Computer, label: string) {
    const input = makeAgent({ org, name: uniqueName(label), computer });
    input.metadata = { ...input.metadata, visibility: ApiResourceVisibility.visibility_org };
    const agent = await founder.agentCommand.create(input);
    return by.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName(label), agentRef: agentRefOf(agent), message: "Say hello.", autoApproveAll: true }),
    );
  }

  /** The decoded input the run's workflow was started with, read from Temporal's own history. */
  async function workflowInputOf(runId: string): Promise<Record<string, unknown>> {
    const { stdout } = await execFileAsync("temporal", [
      "workflow",
      "show",
      "--workflow-id",
      `stigmer/agent-execution/invoke/${runId}`,
      "--address",
      sibling!.engine.temporalHostPort,
      "--output",
      "json",
    ]);
    interface StartedEvent {
      readonly workflowExecutionStartedEventAttributes?: { readonly input?: { readonly payloads?: ReadonlyArray<{ readonly data?: unknown }> } };
    }
    const history = JSON.parse(stdout) as { readonly events: readonly StartedEvent[] };
    const started = history.events.find((event) => event.workflowExecutionStartedEventAttributes !== undefined);
    const data = started?.workflowExecutionStartedEventAttributes?.input?.payloads?.[0]?.data;
    const text = typeof data === "string" ? Buffer.from(data, "base64").toString("utf8") : JSON.stringify(data);
    return JSON.parse(text) as Record<string, unknown>;
  }

  it("runs the computer-less conversation on the shared runner, as the member, beside the sandboxed one", async () => {
    const tenancy = await people.lane.provisionTenancy();
    const member = await people.lane.provisionMember(tenancy);
    const founder = people.lane.clients;

    const [sandboxed, computerless] = await Promise.all([
      startTurn(member, tenancy.org, founder, Computer.REQUIRED, "sandboxed"),
      startTurn(member, tenancy.org, founder, Computer.NONE, "computerless"),
    ]);
    const sandboxedId = sandboxed.metadata!.id;
    const computerlessId = computerless.metadata!.id;
    console.info(`[shared-runner] sandboxed run ${sandboxedId}, computer-less run ${computerlessId}`);

    const [sandboxedEnd, computerlessEnd] = await Promise.all([
      awaitTerminal(member, sandboxedId, { timeoutMs: 180_000 }),
      awaitTerminal(member, computerlessId, { timeoutMs: 180_000 }),
    ]);
    expect(computerlessEnd.status?.phase, computerlessEnd.status?.error).toBe(RunPhase.RUN_COMPLETED);
    expect(sandboxedEnd.status?.phase, sandboxedEnd.status?.error).toBe(RunPhase.RUN_COMPLETED);

    // Placement, by what each workflow was started with.
    const sharedInput = await workflowInputOf(computerlessId);
    expect(sharedInput["runner"]).toBe("shared");
    expect("execution_context_token" in sharedInput, "no credential in the clear").toBe(false);
    expect(typeof sharedInput["sealed_execution_context_token"]).toBe("string");
    const sandboxInput = await workflowInputOf(sandboxedId);
    expect("runner" in sandboxInput).toBe(false);
    expect("sealed_execution_context_token" in sandboxInput).toBe(false);

    // Which runner served which: the shared runner names the computer-less
    // run alone.
    const sharedLog = shared!.logTail() + "\n";
    expect(sharedLog).toContain(computerlessId);
    expect(sharedLog).not.toContain(sandboxedId);

    // The shared runner titled the member's session with the turn's own
    // credential: its own key opens nothing but Temporal.
    const sessionId = sessionIdOf(computerlessEnd);
    expect(sessionId).not.toBe("");
    await pollUntil(
      () => member.sessionQuery.get({ value: sessionId }),
      (session) => (session.spec?.subject ?? "") !== "" && session.spec?.subject !== UNTITLED_SESSION_SUBJECT,
      (last, timeoutMs) => `session ${sessionId} was not titled within ${timeoutMs}ms (subject: "${last?.spec?.subject ?? "(none)"}")`,
    );

    await people.lane.cleanupTenancy(tenancy);
  }, 300_000);
});
