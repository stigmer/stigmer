// A turn outlives its sandbox pod: the open-source server, on the
// agent-sandbox driver against a real cluster, runs a Stigmer turn whose shell
// step is held open inside the Session's pod, the pod is deleted, and the
// turn completes on the pod the controller brings back, the model handed the
// task once.
// Domain: the agent-sandbox lane (scripts/agent-sandbox-live.mjs), not a
// conformance target: no target, edition or readout runs this file; the lane
// runs it after the driver's own live test, on the same kind cluster, with
// the addresses that script hands it.
//
// Two deletions:
//   - Graceful (`kubectl delete pod`): the runner, the pod's PID 1, hears
//     SIGTERM while the step runs, and the pod's grace lets the step finish;
//     the runner yields at the step's boundary (the drained pod asks the model
//     nothing after the step, and says once that the turn moves on), and the
//     turn continues on the new pod, which asks the next round; the step began
//     once.
//   - Forced (`--grace-period=0 --force`): the step is cut, the workflow
//     recovers the turn once its heartbeat lapses, and the new pod resumes
//     from the Stigmer harness's checkpoint on the Session's home claim, so the cut step
//     runs once more and the task is still handed once. The kill waits for the
//     step's start to reach the session's log, so the turn that picks it up
//     says once why it paused.
//
// The runner in the pod is the lane's image (the published `latest` on CI,
// which moves with main), pointed at this file's mock LLM through the
// operator's runner list (STIGMER_SANDBOX_RUNNER_ENV). The mock listens where
// the pod reaches the host (STIGMER_AGENT_SANDBOX_LIVE_BIND), the server on
// every interface (the shipped server takes no listen address), and the pod
// names the host by STIGMER_AGENT_SANDBOX_LIVE_POD_HOST.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { anthropicText, anthropicToolUse, MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { spawnServer, type RunningServer } from "@stigmer/test-support/server-process";
import { ensureLibraryServerEntry } from "@stigmer/test-support/ts-build";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { agentRefOf, makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { createUniqueOrganization } from "../support/organizations";
import { awaitTerminal, makeAgentExecution, sessionIdOf } from "../support/runs";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set: run this file through make test-agent-sandbox (scripts/agent-sandbox-live.mjs)`);
  }
  return value;
}

const namespace = required("STIGMER_SANDBOX_K8S_NAMESPACE");
const podHost = required("STIGMER_AGENT_SANDBOX_LIVE_POD_HOST");
const bindHost = required("STIGMER_AGENT_SANDBOX_LIVE_BIND");

/** What the held step prints when it ends: the tool result a continued conversation carries. */
const STEP_DONE = "step finished";
/** Where the held step keeps its marks: the workspace claim, which outlives the pod. */
const STEP_DIR = "/workspace/pod-proof";
/** The workflow recovers a lost runner once its two-minute heartbeat lapses; then a new pod boots and asks the model. */
const RECOVERY_MS = 6 * 60_000;

let mock: MockLlmProxy;
let server: RunningServer;
let clients: ConformanceClients;
let org: string;

function kubectl(...args: string[]): string {
  return execFileSync("kubectl", ["-n", namespace, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A port free on this host now, for a server whose address the pod must know before it boots. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, bindHost, resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port for the server");
  return address.port;
}

/**
 * A pod's runner log as it is written, from now until the pod is gone: the
 * runner's own word on what it did with its turn. A replacement pod has the
 * Sandbox's name too, so a pod is read here by the stream opened on it, not
 * by its name later.
 */
function followLog(pod: string): { readonly text: () => string; readonly stop: () => void } {
  let text = "";
  const child: ChildProcess = spawn("kubectl", ["-n", namespace, "logs", "-f", pod, "-c", "runner"], { stdio: ["ignore", "pipe", "ignore"] });
  child.stdout?.on("data", (chunk: Buffer) => {
    text += chunk.toString("utf8");
  });
  return { text: () => text, stop: () => child.kill() };
}

/** The uid of the pod now holding `name`, or "" when there is none. */
function podUid(name: string): string {
  return kubectl("get", "pod", name, "--ignore-not-found", "-o", "jsonpath={.metadata.uid}").trim();
}

/** The Session's running pod (not one being deleted), or undefined. */
function livePod(sessionId: string): { readonly name: string; readonly uid: string } | undefined {
  const lines = kubectl("get", "pods", "-l", `stigmer.ai/sandbox-id=${sessionId}`, "-o", "jsonpath={range .items[*]}{.metadata.name} {.metadata.uid} {.metadata.deletionTimestamp} {.status.phase}{\"\\n\"}{end}");
  for (const line of lines.split("\n")) {
    const [name, uid, deleting, phase] = line.trim().split(" ");
    if (name !== undefined && name !== "" && uid !== undefined && (deleting === "" || deleting === undefined) && phase === "Running") return { name, uid };
  }
  return undefined;
}

/** Polls `read` each second until it answers a value (a read that throws is a "not yet"); bounded, naming what it waited for. */
async function until<T>(what: string, read: () => T | undefined | false | Promise<T | undefined | false>, budgetMs: number): Promise<T> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    let value: T | undefined | false;
    try {
      value = await read();
    } catch {
      value = undefined;
    }
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}\n${server.logTail()}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * A shell step held open inside the pod: it appends a line to its `starts`
 * file each time it begins and, the first time only, waits for its `release`
 * file, so a run of it again (after a forced kill) finishes at once. Both
 * files live on the workspace claim, so a pod that replaces the first one
 * sees them.
 */
class PodHeldStep {
  private readonly starts: string;
  private readonly releaseFile: string;

  constructor(tag: string) {
    this.starts = `${STEP_DIR}/${tag}.starts`;
    this.releaseFile = `${STEP_DIR}/${tag}.release`;
  }

  command(): string {
    return (
      `mkdir -p ${STEP_DIR} && echo started >> ${this.starts}; ` +
      `if [ "$(grep -c started ${this.starts})" -eq 1 ]; then while [ ! -f ${this.releaseFile} ]; do sleep 0.2; done; fi; ` +
      `echo '${STEP_DONE}'`
    );
  }

  /** How many times the step has begun, read in `pod`. */
  started(pod: string): number {
    const out = kubectl("exec", pod, "-c", "runner", "--", "sh", "-c", `grep -c started ${this.starts} 2>/dev/null || true`);
    return Number.parseInt(out.trim() || "0", 10);
  }

  release(pod: string): void {
    kubectl("exec", pod, "-c", "runner", "--", "sh", "-c", `mkdir -p ${STEP_DIR} && echo released > ${this.releaseFile}`);
  }
}

/** A trusted run of a fresh agent whose model asks for `step`, then says `closing`; returns its id and Session. */
async function startHeldRun(task: string, step: PodHeldStep, closing: string): Promise<{ readonly id: string; readonly sessionId: string }> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("pod-turn-agent") }));
  mock.enqueue(anthropicToolUse(uniqueName("call_pod"), "execute", { command: step.command() }));
  mock.enqueue(anthropicText(closing));
  const created = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("pod-turn-run"), agentRef: agentRefOf(agent), message: task, autoApproveAll: true }),
  );
  const id = created.metadata!.id;
  const sessionId = sessionIdOf(await clients.agentExecutionQuery.get({ value: id }));
  expect(sessionId, "the run started a Session").not.toBe("");
  return { id, sessionId };
}

/**
 * Whether the last request the model answered from the script carries the
 * step's result: only a conversation that continued holds it, while one
 * started over on an empty thread holds the task alone.
 */
function lastRequestCarriesStepResult(): boolean {
  return JSON.stringify(mock.scriptedRequests().at(-1)?.body ?? "").includes(STEP_DONE);
}

/** How many times the last request the model answered from the script carried `task` in a user message. */
function taskHandedInLastRequest(task: string): number {
  const last = mock.scriptedRequests().at(-1);
  const messages = (last?.body as { messages?: Array<{ role?: string; content?: unknown }> } | undefined)?.messages ?? [];
  return messages.filter((m) => m.role === "user" && JSON.stringify(m.content ?? "").includes(task)).length;
}

beforeAll(async () => {
  mock = new MockLlmProxy({ bindHost });
  await mock.start();
  const port = await freePort();
  const backend = `http://${podHost}:${port}`;
  server = await spawnServer(process.execPath, {
    args: [await ensureLibraryServerEntry()],
    port,
    temporalHostPort: required("STIGMER_AGENT_SANDBOX_LIVE_TEMPORAL"),
    env: {
      SANDBOX_PROVISIONER_TYPE: "agent-sandbox",
      STIGMER_ACTIVITY_ROUTING: "session",
      STIGMER_DEFAULT_EXECUTION_TARGET: "cloud",
      STIGMER_SANDBOX_BACKEND_ENDPOINT: backend,
      STIGMER_SANDBOX_TEMPORAL_ADDRESS: required("STIGMER_SANDBOX_TEMPORAL_ADDRESS"),
      STIGMER_SANDBOX_RUNNER_IMAGE: required("STIGMER_SANDBOX_RUNNER_IMAGE"),
      STIGMER_SANDBOX_K8S_NAMESPACE: namespace,
      KUBECONFIG: required("KUBECONFIG"),
      // The runner's model is this file's mock; its model registry is the server.
      STIGMER_SANDBOX_RUNNER_ENV: "STIGMER_PROXY_ENDPOINT,STIGMER_PRIMARY_MODEL,STIGMER_CLOUD_API_URL",
      STIGMER_PROXY_ENDPOINT: mock.urlAt(podHost),
      STIGMER_PRIMARY_MODEL: "claude-sonnet-4-6",
      STIGMER_CLOUD_API_URL: backend,
    },
  });
  clients = makeClients(createTransport(server.baseUrl));
  await awaitGrpcReady(clients, () => server.logTail());
  org = (await createUniqueOrganization(clients.organizationCommand, "pod-turn")).id;
});

afterEach(() => {
  mock.reset();
});

afterAll(async () => {
  try {
    kubectl("delete", "sandboxes", "-l", "stigmer.ai/managed-by=stigmer", "--wait=true", "--timeout=120s");
  } catch {
    // The lane deletes its cluster after the run either way.
  }
  await server?.stop();
  await mock?.close();
});

describe("a turn outlives its sandbox pod", () => {
  it("a pod deleted gracefully lets its running step finish, and the turn completes on the new pod with the task handed once", async () => {
    const task = uniqueName("Build the parser");
    const step = new PodHeldStep(uniqueName("graceful"));
    const run = await startHeldRun(task, step, "The parser is built.");
    const first = await until("the Session's pod to run", () => livePod(run.sessionId), 5 * 60_000);
    await until("the held step to begin", () => step.started(first.name) === 1, 3 * 60_000);

    // The pod is told to stop while its step runs. Only once the runner (the
    // pod's PID 1) has heard SIGTERM is the step let finish, inside the grace.
    const firstLog = followLog(first.name);
    try {
      kubectl("delete", "pod", first.name, "--wait=false");
      await until("the first pod's runner to hear SIGTERM", () => firstLog.text().includes("Received SIGTERM"), 60_000);
      expect(mock.scriptedRequests().length, "the first pod had asked only for the step").toBe(1);
      step.release(first.name);
      // The runner says it yielded the turn; by then it has asked the model
      // nothing after the step (its worker stopped with the yield, and the
      // replacement pod cannot start before this one is gone).
      await until("the first pod's runner to yield the turn", () => firstLog.text().includes("yielded to continue (drain)"), 2 * 60_000);
      expect(mock.scriptedRequests().length, "the drained pod yielded at the step's boundary: it asked the model nothing after the step").toBe(1);
    } finally {
      firstLog.stop();
    }
    await until("the first pod to go", () => podUid(first.name) !== first.uid, RECOVERY_MS);

    const settled = await awaitTerminal(clients, run.id, { timeoutMs: RECOVERY_MS });
    const second = await until("the replacement pod to run", () => livePod(run.sessionId), 60_000);
    const notes = await clients.sessionQuery.listEvents({ sessionId: run.sessionId, pageSize: 1000, types: ["stigmer.harness.note"] });
    expect(settled.status?.phase, `the turn: ${settled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
    expect(mock.scriptedRequests().length, "the round after the step came from the new pod").toBe(2);
    expect(step.started(second.name), "the step finished inside the grace and never ran again").toBe(1);
    expect(taskHandedInLastRequest(task), "the model was handed the task once").toBe(1);
    expect(lastRequestCarriesStepResult(), "the new pod continued the conversation that ran the step").toBe(true);
    expect(notes.events.length, "the drained pod said once that the turn moves on").toBe(1);
    expect(mock.remaining(), "the new pod asked only the round after the step").toBe(0);
  });

  it("a pod deleted by force cuts its step, and the turn resumes on the new pod from its checkpoint with the task handed once", async () => {
    const task = uniqueName("Migrate the database");
    const step = new PodHeldStep(uniqueName("forced"));
    const run = await startHeldRun(task, step, "The migration is done.");
    const first = await until("the Session's pod to run", () => livePod(run.sessionId), 5 * 60_000);
    await until("the held step to begin", () => step.started(first.name) === 1, 3 * 60_000);
    // The kill lands once the log knows the step began, so the turn that picks it up can say why it paused.
    await until(
      "the step's start in the session's log",
      async () => (await clients.sessionQuery.listEvents({ sessionId: run.sessionId, pageSize: 1000, types: ["agent.tool_use"] })).events.length > 0,
      60_000,
    );

    kubectl("delete", "pod", first.name, "--grace-period=0", "--force");
    const second = await until(
      "the replacement pod to run",
      () => {
        const pod = livePod(run.sessionId);
        return pod !== undefined && pod.uid !== first.uid ? pod : undefined;
      },
      RECOVERY_MS,
    );
    // The cut step runs once more on the new pod, from the checkpoint the
    // home claim kept, and finishes at once; an empty thread never runs it.
    const settled = await awaitTerminal(clients, run.id, { timeoutMs: RECOVERY_MS });
    const notes = await clients.sessionQuery.listEvents({ sessionId: run.sessionId, pageSize: 1000, types: ["stigmer.harness.note"] });
    expect(settled.status?.phase, `the turn: ${settled.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
    expect(taskHandedInLastRequest(task), "the model was handed the task once").toBe(1);
    expect(lastRequestCarriesStepResult(), "the new pod continued the conversation that ran the step").toBe(true);
    expect(step.started(second.name), "the cut step ran once more, and only once").toBe(2);
    expect(notes.events.length, "the log says once why the turn paused").toBe(1);
    expect(mock.remaining(), "the new pod asked only the round after the step").toBe(0);
  });
});
