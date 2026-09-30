/**
 * The probes every self-host smoke asks of a running Stigmer, in one place so
 * the compose gate (scripts/smoke-compose.mjs) and the all-in-one image smoke
 * (scripts/smoke-all-in-one.mjs) prove the same facts the same way: a server
 * that answers SERVING, a console lane that serves its contract, an artifact
 * file server on its published port, and the end-to-end runs through the
 * runner (a workflow, then an agent answered by the install's model). A smoke
 * that needs a new probe adds it here, never inline.
 *
 * Plain node + fetch, no dependencies — runnable everywhere CI is. Every
 * probe takes the server's base URL so the same code serves a stack on
 * 127.0.0.1:7234 and a stack on a published random port.
 */

import { connect } from "node:net";

/**
 * Thrown by a probe to end the wait at once: the state it read can never turn
 * into the one awaited (an execution that reached a terminal failure). Every
 * other error is transient to {@link pollUntil}, which retries it until the
 * deadline (#1514: a terminal failure used to be retried like a connection
 * refused, and reported as a timeout).
 */
export class PollStop extends Error {}

/**
 * Poll `probe` until it returns a truthy value, failing at the deadline with
 * the last error, or at once when the probe throws {@link PollStop}.
 */
export async function pollUntil(label, timeoutMs, probe, { intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result !== undefined && result !== false) return result;
      lastError = "probe returned falsy";
    } catch (error) {
      if (error instanceof PollStop) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label} (${timeoutMs}ms): ${lastError}`);
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Unary Connect-JSON call against `baseUrl` — the same lane a curl user gets. */
export async function connectJson(baseUrl, procedure, body) {
  const response = await fetch(`${baseUrl}/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${procedure} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

/** Resolves once the real health service answers SERVING (wiring complete, not merely port-bound). */
export async function waitForServing(baseUrl, timeoutMs) {
  await pollUntil("health SERVING", timeoutMs, async () => {
    const health = await connectJson(baseUrl, "grpc.health.v1.Health/Check", {});
    return health.status === "SERVING";
  });
}

/**
 * The /config.json document the console lane serves under the trusted-local
 * posture — the same six fields the server's handler test pins
 * (transport/console/__tests__/handler.test.ts). `apiUrl` and `appUrl` are
 * EMPTY by contract: the console resolves them to its own origin, because the
 * lane that serves it also serves the API on the same port and cannot know the
 * scheme and host the browser reached it by (a TLS proxy, a LAN address;
 * 20260913.02 Q-CL-3). There is no edition-specific value here: a `stigmer up`
 * laptop, the compose stack, the server image and the all-in-one image all
 * serve this one document. Four gates once pinned a Host-derived
 * `http://<host>` inline instead and went red together when the server stopped
 * serving it (#1087) — so the contract lives here, once.
 */
export const TRUSTED_LOCAL_CONSOLE_CONFIG = Object.freeze({
  apiUrl: "",
  appUrl: "",
  authMode: "disabled",
  oidcIssuer: "",
  oidcClientId: "",
  oidcAudience: "",
});

/**
 * The console lane (DD-012): /config.json IS the trusted-local document,
 * asserted whole (a missing or unexpected field refuses, not just a wrong
 * value), and / answers HTML. The status and content-type are checked before
 * the body is read so a 404 or an app-shell page is diagnosed as such, never as
 * a JSON parse error with no URL in it.
 */
export async function assertConsoleServed(baseUrl) {
  const config = await fetch(`${baseUrl}/config.json`);
  if (config.status !== 200) {
    throw new Error(`/config.json -> HTTP ${config.status} — want 200`);
  }
  const configType = config.headers.get("content-type") ?? "";
  if (!configType.includes("application/json")) {
    throw new Error(`/config.json content-type=${configType} — want application/json`);
  }
  const document = await config.json();
  if (canonicalJson(document) !== canonicalJson(TRUSTED_LOCAL_CONSOLE_CONFIG)) {
    throw new Error(
      `/config.json got=${JSON.stringify(document)} — want the trusted-local document ` +
        JSON.stringify(TRUSTED_LOCAL_CONSOLE_CONFIG),
    );
  }
  const index = await fetch(`${baseUrl}/`);
  const indexType = index.headers.get("content-type") ?? "";
  if (index.status !== 200 || !indexType.includes("text/html")) {
    throw new Error(`console / -> ${index.status} ${indexType} — want 200 text/html`);
  }
}

/**
 * JSON with keys in sorted order, so two flat documents compare by content and
 * not by the order a server happened to write them. Anything that is not a
 * plain object (null, an array, a scalar) serializes as itself and so can never
 * equal the document.
 */
function canonicalJson(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const sorted = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(sorted));
}

/**
 * The artifact file server on its published port: a 404 from the listener
 * proves the 0.0.0.0 bind and the port publish; content round-trips ride the
 * artifact conformance suites, not a smoke.
 */
export async function assertArtifactLane(artifactBaseUrl) {
  const probe = await fetch(`${artifactBaseUrl}/smoke-nonexistent-key`);
  if (probe.status !== 404) {
    throw new Error(`artifact server probe -> HTTP ${probe.status} — want 404`);
  }
}

/**
 * The organization a fresh backend is bootstrapped with, read back the way
 * `stigmer up` decides whether to create it: the `stigmer` organization
 * among the caller's own (the CLI's `bootstrapBackend` asks
 * findMyOrganizations and matches the slug). The bootstrap runs a few
 * seconds after SERVING, from the daemon's onStarted, and creating this
 * organization is the whole of it — a fresh install needs no default
 * content, because a session with no agent runs the built-in assistant.
 * Resolves to the organization's id.
 */
export async function waitForBootstrapOrganization(baseUrl, timeoutMs, { slug = "stigmer" } = {}) {
  return pollUntil(`organization '${slug}' present`, timeoutMs, async () => {
    const list = await connectJson(
      baseUrl,
      "ai.stigmer.tenancy.organization.v1.OrganizationQueryController/findMyOrganizations",
      {},
    );
    const match = (list.entries ?? []).find((org) => org.metadata?.slug === slug);
    if (match === undefined) return false;
    const id = match.metadata?.id;
    if (!id) throw new Error(`organization '${slug}' has no id: ${JSON.stringify(match)}`);
    return id;
  });
}

const TERMINAL_FAILURES = new Set(["EXECUTION_FAILED", "EXECUTION_CANCELLED", "EXECUTION_TERMINATED"]);

/**
 * The end-to-end line every self-host smoke draws: create an organization and
 * a single `set_vars` workflow (sub-second, hermetic, no LLM, no MCP, no keys —
 * the conformance suite's canonical execution fixture), run it, and wait for
 * EXECUTION_COMPLETED. It completes only if the runner connected to Temporal
 * and polled the queue. Returns the execution id. A terminal failure surfaces
 * immediately with the server's own error.
 */
export async function runSetVarsWorkflow(baseUrl, timeoutMs, log = () => {}) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const org = await connectJson(baseUrl, "ai.stigmer.tenancy.organization.v1.OrganizationCommandController/create", {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: `smoke-org-${suffix}` },
  });
  const orgId = org.metadata?.id;
  if (!orgId) throw new Error(`organization create returned no id: ${JSON.stringify(org)}`);

  const workflow = await connectJson(baseUrl, "ai.stigmer.agentic.workflow.v1.WorkflowCommandController/create", {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Workflow",
    metadata: { name: `smoke-wf-${suffix}`, org: orgId },
    spec: {
      description: "self-host smoke fixture",
      document: { dsl: "1.0.0", namespace: orgId, name: `smoke-wf-${suffix}`, version: "1.0.0" },
      tasks: [
        {
          name: "setVars",
          kind: "set_vars",
          taskConfig: { variables: { greeting: "hello" } },
          export: { as: "${ . }" },
        },
      ],
    },
  });
  const workflowId = workflow.metadata?.id;
  if (!workflowId) throw new Error(`workflow create returned no id: ${JSON.stringify(workflow)}`);
  log(`workflow ${workflowId} created`);

  const execution = await connectJson(
    baseUrl,
    "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController/create",
    {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "WorkflowExecution",
      metadata: { name: `smoke-wfx-${suffix}`, org: orgId },
      spec: { workflowId },
    },
  );
  const executionId = execution.metadata?.id;
  if (!executionId) throw new Error(`execution create returned no id: ${JSON.stringify(execution)}`);
  log(`execution ${executionId} created — awaiting COMPLETED...`);

  await pollUntil("execution EXECUTION_COMPLETED", timeoutMs, async () => {
    const current = await connectJson(
      baseUrl,
      "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get",
      { value: executionId },
    );
    const phase = current.status?.phase ?? "EXECUTION_PHASE_UNSPECIFIED";
    if (TERMINAL_FAILURES.has(phase)) {
      throw new PollStop(`execution reached ${phase}: ${JSON.stringify(current.status?.error ?? {})}`);
    }
    return phase === "EXECUTION_COMPLETED";
  });
  return executionId;
}

/**
 * The agent line every self-host smoke draws after the workflow: create an
 * organization and an agent with no tools, send it one message, and wait for
 * EXECUTION_COMPLETED with the model's reply as the last message. It completes
 * only if the install wired a model the runner can reach, the runner called
 * it, and the answer travelled back to the record a user reads — which the
 * workflow line cannot show, since no workflow step calls a model. The smokes
 * point the install at fake-model.mjs, so `expectText` is its reply. Returns
 * the ids and the reply, so an upgrade rehearsal can read them back. A
 * terminal failure surfaces immediately with the execution's own error.
 */
export async function runAgentToReply(baseUrl, timeoutMs, { expectText, log = () => {} }) {
  if (typeof expectText !== "string" || expectText === "") {
    throw new Error("runAgentToReply needs the reply text the install's model answers with");
  }
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const org = await connectJson(baseUrl, "ai.stigmer.tenancy.organization.v1.OrganizationCommandController/create", {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: `smoke-agent-org-${suffix}` },
  });
  const orgId = org.metadata?.id;
  if (!orgId) throw new Error(`organization create returned no id: ${JSON.stringify(org)}`);

  const agent = await connectJson(baseUrl, "ai.stigmer.agentic.agent.v1.AgentCommandController/create", {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name: `smoke-agent-${suffix}`, org: orgId },
    spec: {
      description: "self-host smoke fixture",
      instructions: "Answer the message in one short sentence.",
      mcpServerUsages: [],
    },
  });
  const agentId = agent.metadata?.id;
  if (!agentId) throw new Error(`agent create returned no id: ${JSON.stringify(agent)}`);
  log(`agent ${agentId} created`);

  const execution = await connectJson(
    baseUrl,
    "ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController/create",
    {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: { name: `smoke-aex-${suffix}`, org: orgId },
      spec: { agentId, message: "Say hello." },
    },
  );
  const executionId = execution.metadata?.id;
  if (!executionId) throw new Error(`agent execution create returned no id: ${JSON.stringify(execution)}`);
  log(`agent execution ${executionId} created — awaiting the model's reply...`);

  const completed = await pollUntil("agent execution EXECUTION_COMPLETED", timeoutMs, async () => {
    const current = await readAgentExecution(baseUrl, executionId);
    const phase = current.status?.phase ?? "EXECUTION_PHASE_UNSPECIFIED";
    if (TERMINAL_FAILURES.has(phase)) {
      throw new PollStop(`agent execution reached ${phase}: ${current.status?.error || "(no error recorded)"}`);
    }
    return phase === "EXECUTION_COMPLETED" ? current : false;
  });
  const reply = lastAiReply(completed);
  if (!reply.includes(expectText)) {
    throw new Error(
      `agent execution completed, but its last reply is not the model's: expected it to contain ` +
        `${JSON.stringify(expectText)}, got ${JSON.stringify(reply)}`,
    );
  }
  log(`agent replied: ${reply}`);
  return { orgId, agentId, executionId, reply };
}

/** One agent execution, as the query lane returns it. */
export async function readAgentExecution(baseUrl, executionId) {
  return connectJson(baseUrl, "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController/get", {
    value: executionId,
  });
}

/** The content of an execution's last AI message, or "" when it has none. */
export function lastAiReply(execution) {
  const messages = execution.status?.messages ?? [];
  const ai = messages.filter((message) => message.type === "MESSAGE_AI" && !message.isStreaming);
  return ai.at(-1)?.content ?? "";
}

/** Fails when the port is already taken — a stigmer stack is running. */
export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port, timeout: 1500 });
    socket.once("connect", () => {
      socket.destroy();
      reject(
        new Error(
          `port ${port} is already in use — stop the running stigmer stack ` +
            `(stigmer down / docker compose down) before the smoke`,
        ),
      );
    });
    socket.once("error", () => resolve(undefined)); // refused = free
    socket.once("timeout", () => {
      socket.destroy();
      resolve(undefined);
    });
  });
}
