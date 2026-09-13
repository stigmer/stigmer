/**
 * The probes every self-host smoke asks of a running Stigmer, in one place so
 * the compose gate (scripts/smoke-compose.mjs) and the all-in-one image smoke
 * (scripts/smoke-all-in-one.mjs) prove the same facts the same way: a server
 * that answers SERVING, a console lane that serves its contract, an artifact
 * file server on its published port, and one end-to-end run through the
 * runner. A smoke that needs a new probe adds it here, never inline.
 *
 * Plain node + fetch, no dependencies — runnable everywhere CI is. Every
 * probe takes the server's base URL so the same code serves a stack on
 * 127.0.0.1:7234 and a stack on a published random port.
 */

import { connect } from "node:net";

/** Poll `probe` until it returns a truthy value, failing at the deadline with the last error. */
export async function pollUntil(label, timeoutMs, probe, { intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result !== undefined && result !== false) return result;
      lastError = "probe returned falsy";
    } catch (error) {
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
 * The console lane (DD-012): /config.json honours its contract and / answers
 * HTML. Returns the parsed config so a caller can pin edition-specific fields
 * (the compose gate pins the Host-derived apiUrl; the all-in-one does not).
 */
export async function assertConsoleServed(baseUrl) {
  const config = await (await fetch(`${baseUrl}/config.json`)).json();
  if (config.authMode !== "disabled") {
    throw new Error(`/config.json authMode=${config.authMode} — want disabled`);
  }
  const index = await fetch(`${baseUrl}/`);
  const indexType = index.headers.get("content-type") ?? "";
  if (index.status !== 200 || !indexType.includes("text/html")) {
    throw new Error(`console / -> ${index.status} ${indexType} — want 200 text/html`);
  }
  return config;
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
      throw new Error(`execution reached ${phase}: ${JSON.stringify(current.status?.error ?? {})}`);
    }
    return phase === "EXECUTION_COMPLETED";
  });
  return executionId;
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
