/**
 * The probes every self-host smoke asks of a running Stigmer, in one place so
 * the compose gate (scripts/smoke-compose.mjs) and the all-in-one image smoke
 * (scripts/smoke-all-in-one.mjs) prove the same facts the same way: a server
 * that answers SERVING, a console lane that serves its contract, an artifact
 * file server on its published port, and the end-to-end runs through the
 * runner (a workflow, then an agent answered by the install's model). A smoke
 * that needs a new probe adds it here, never inline. The upgrade rehearsal
 * (scripts/rehearse-upgrade.mjs) adds the state probes: what the runs created
 * is recorded before an upgrade and read back after it, field by field, and
 * the server says which release answers (getServerInfo). The refusal and log
 * probes read what an install must not admit and what its server says at
 * boot: a request for an organization nobody created is refused by name,
 * and the OAuth callback is derived from the public address the install was
 * given. The approval probes read a workflow's human_input gate as a
 * reviewer meets it: waiting in the organization's queue, resolved on the
 * execution's event log, and printed by `stigmer execution logs`.
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

/**
 * A unary Connect-JSON call the server must refuse. Resolves the refusal
 * `{ status, code, message }` when the answer is a non-2xx whose message
 * contains `text`; throws when the server admits the request, or refuses it
 * for another reason, naming what it answered.
 */
export async function expectRefusal(baseUrl, procedure, body, { text }) {
  const response = await fetch(`${baseUrl}/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const refusal = connectRefusal(response.status, await response.text());
  const problem = refusalProblem(refusal, text);
  if (problem !== undefined) throw new Error(`${procedure}: ${problem}`);
  return refusal;
}

/** A Connect answer as `{ status, code, message }`; a body that is not a Connect error keeps its text as the message. */
export function connectRefusal(status, body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object" && typeof parsed.message === "string") {
      return { status, code: typeof parsed.code === "string" ? parsed.code : "", message: parsed.message };
    }
  } catch {
    // not JSON: the raw text is the message
  }
  return { status, code: "", message: body.slice(0, 300) };
}

/** Why `refusal` is not the refusal expected, or undefined when it is. Pure. */
export function refusalProblem(refusal, text) {
  if (refusal.status >= 200 && refusal.status < 300) {
    return `expected a refusal containing ${JSON.stringify(text)}, the server answered ${refusal.status}`;
  }
  if (!refusal.message.includes(text)) {
    return (
      `refused, but not with ${JSON.stringify(text)}: ` +
      `HTTP ${refusal.status} ${refusal.code || "(no code)"}: ${refusal.message}`
    );
  }
  return undefined;
}

/**
 * An install that runs no bootstrap holds no organization, so a bare create
 * naming one (what `stigmer apply` sends as the implicit `stigmer`) is
 * refused with the organization named, never stored under a slug nobody
 * created (#1484). Run before anything creates an organization.
 */
export async function assertMissingOrganizationRefused(baseUrl, { org = "stigmer" } = {}) {
  return expectRefusal(
    baseUrl,
    "ai.stigmer.agentic.agent.v1.AgentCommandController/create",
    {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: `smoke-orphan-${uniqueSuffix()}`, org },
      spec: { description: "self-host smoke fixture", instructions: "Never stored.", mcpServerUsages: [] },
    },
    { text: `Organization not found: ${org}` },
  );
}

/**
 * The server's log lines as `{ level, message, fields }`, in either form the
 * server writes (boot/logger.ts): NDJSON, or the local pretty line
 * `<time> <LEVEL> <message> <fields as JSON>`. Lines in neither form (another
 * process's output) are skipped; a log in which no line parses throws, so a
 * change of format fails the probes that read it instead of letting them
 * find nothing and pass.
 */
export function serverLogEntries(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    const entry = ndjsonEntry(line) ?? prettyEntry(line);
    if (entry !== undefined) entries.push(entry);
  }
  if (entries.length === 0) {
    throw new Error(`no line of the server's log parses as a log entry:\n${text.slice(0, 600)}`);
  }
  return entries;
}

const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

function ndjsonEntry(line) {
  if (!line.startsWith("{")) return undefined;
  try {
    const { level, message, time: _time, ...fields } = JSON.parse(line);
    return LOG_LEVELS.has(level) && typeof message === "string" ? { level, message, fields } : undefined;
  } catch {
    return undefined;
  }
}

function prettyEntry(line) {
  const match = /^\d{4}-\d{2}-\d{2}T\S+ (DEBUG|INFO|WARN|ERROR)\s+(.*)$/.exec(line);
  if (match === null) return undefined;
  const level = match[1].toLowerCase();
  const rest = match[2];
  // The fields are the JSON object that ends the line; the message is what precedes it.
  for (let at = rest.indexOf(" {"); at !== -1; at = rest.indexOf(" {", at + 1)) {
    try {
      const fields = JSON.parse(rest.slice(at + 1));
      if (fields !== null && typeof fields === "object" && !Array.isArray(fields)) {
        return { level, message: rest.slice(0, at), fields };
      }
    } catch {
      // not the fields yet: a brace inside the message
    }
  }
  return { level, message: rest, fields: {} };
}

/**
 * With no STIGMER_OAUTH_REDIRECT_URI, a server that serves the console
 * derives the MCP OAuth callback from the public address it was given and
 * says so at boot (boot/compose.ts). Throws unless that line names
 * `<publicUrl>/auth/oauth/callback` and `from: "public-origin"` (#1486).
 * Pure over the log's text.
 */
export function assertOAuthCallbackFromPublicOrigin(logText, publicUrl) {
  const wanted = `${publicUrl}/auth/oauth/callback`;
  const derived = serverLogEntries(logText).filter((entry) =>
    entry.message.includes("deriving the served console's callback"),
  );
  if (derived.length === 0) {
    throw new Error("the server logged no derived OAuth callback at boot");
  }
  const last = derived.at(-1);
  if (last.fields.redirectUri !== wanted || last.fields.from !== "public-origin") {
    throw new Error(
      `the OAuth callback was derived as ${JSON.stringify(last.fields)}; want ` +
        JSON.stringify({ redirectUri: wanted, from: "public-origin" }),
    );
  }
  return last.fields;
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
 * and polled the queue. Returns the organization, workflow and execution ids,
 * so an upgrade rehearsal can read them back. A terminal failure surfaces
 * immediately with the server's own error.
 */
export async function runSetVarsWorkflow(baseUrl, timeoutMs, log = () => {}) {
  const suffix = uniqueSuffix();
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
  return { orgId, workflowId, executionId };
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
  requireExpectText(expectText);
  const agent = await createSmokeAgent(baseUrl, { log });
  const run = await runAgentExecution(baseUrl, agent, timeoutMs, { expectText, log });
  return { ...agent, ...run };
}

/** An organization and a tool-less agent in it, the fixture the agent line runs. Resolves `{ orgId, agentId }`. */
export async function createSmokeAgent(baseUrl, { log = () => {} } = {}) {
  const suffix = uniqueSuffix();
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
  return { orgId, agentId };
}

/**
 * One run of an existing agent, to EXECUTION_COMPLETED with the model's reply
 * as its last message. The upgrade rehearsal runs the agent an older release
 * stored this way, which is what shows the stored agent still works. Resolves
 * `{ executionId, reply }`.
 */
export async function runAgentExecution(baseUrl, { orgId, agentId }, timeoutMs, { expectText, log = () => {} }) {
  requireExpectText(expectText);
  const execution = await connectJson(
    baseUrl,
    "ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController/create",
    {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: { name: `smoke-aex-${uniqueSuffix()}`, org: orgId },
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
  return { executionId, reply };
}

function requireExpectText(expectText) {
  if (typeof expectText !== "string" || expectText === "") {
    throw new Error("runAgentToReply needs the reply text the install's model answers with");
  }
}

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

/** The release the server reports it is (getServerInfo, public): `3.41.0` for a release, `0.0.0-dev.<sha>` for a stamped source build. */
export async function serverVersion(baseUrl) {
  const info = await connectJson(baseUrl, "ai.stigmer.platform.v1.PlatformQueryController/getServerInfo", {});
  if (typeof info.version !== "string" || info.version === "") {
    throw new Error(`getServerInfo reported no version: ${JSON.stringify(info)}`);
  }
  return info.version;
}

const READS = Object.freeze({
  organization: "ai.stigmer.tenancy.organization.v1.OrganizationQueryController/get",
  agent: "ai.stigmer.agentic.agent.v1.AgentQueryController/get",
  agentByReference: "ai.stigmer.agentic.agent.v1.AgentQueryController/getByReference",
  workflowExecution: "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get",
  agentExecution: "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController/get",
});

/**
 * The state an upgrade must carry: a workflow run and an agent run with the
 * model's reply, each in an organization of its own, and every resource as
 * the server reads it back right after. Resolves `{ ids, snapshot }`: the ids
 * to read again later, and the snapshot {@link compareState} holds the later
 * read to.
 */
export async function recordState(baseUrl, timeoutMs, { expectText, log = () => {} }) {
  const workflow = await runSetVarsWorkflow(baseUrl, timeoutMs, log);
  const agent = await runAgentToReply(baseUrl, timeoutMs, { expectText, log });
  const ids = {
    workflowOrgId: workflow.orgId,
    workflowExecutionId: workflow.executionId,
    agentOrgId: agent.orgId,
    agentId: agent.agentId,
    agentExecutionId: agent.executionId,
  };
  const snapshot = await readState(baseUrl, ids);
  const problems = Object.entries(snapshot)
    .filter(([, value]) => value.error !== undefined)
    .map(([key, value]) => `${key}: ${value.error}`);
  if (problems.length > 0) throw new Error(`the state just created does not read back: ${problems.join("; ")}`);
  return { ids, snapshot };
}

/**
 * Every recorded resource read again, by id, and the agent once more by its
 * `org/slug` reference (the lookup `stigmer run <agent>` makes). A read that
 * fails is kept as `{ error }` rather than thrown, so one comparison can name
 * everything that was lost.
 */
export async function readState(baseUrl, ids) {
  const read = async (procedure, body, pick) => {
    try {
      return pick(await connectJson(baseUrl, procedure, body));
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  const identity = (resource) => ({
    id: resource.metadata?.id ?? "",
    name: resource.metadata?.name ?? "",
    slug: resource.metadata?.slug ?? "",
  });
  const execution = (resource) => ({ ...identity(resource), phase: resource.status?.phase ?? "" });
  const workflowOrg = await read(READS.organization, { value: ids.workflowOrgId }, identity);
  const agentOrg = await read(READS.organization, { value: ids.agentOrgId }, identity);
  const agent = await read(READS.agent, { value: ids.agentId }, identity);
  const agentByReference =
    agent.error === undefined && agentOrg.error === undefined
      ? await read(READS.agentByReference, { org: agentOrg.slug, kind: "agent", slug: agent.slug }, identity)
      : { error: "not read: the agent or its organization did not read back by id" };
  return {
    workflowOrg,
    agentOrg,
    agent,
    agentByReference,
    workflowExecution: await read(READS.workflowExecution, { value: ids.workflowExecutionId }, execution),
    agentExecution: await read(READS.agentExecution, { value: ids.agentExecutionId }, (resource) => ({
      ...execution(resource),
      reply: lastAiReply(resource),
    })),
  };
}

/**
 * What differs between a snapshot taken before an upgrade and a read after
 * it: one line per missing resource or changed field, empty when the state
 * survived whole. Pure, so its verdicts are pinned without a server.
 */
export function compareState(before, after) {
  const problems = [];
  for (const [key, expected] of Object.entries(before)) {
    const actual = after[key];
    if (actual === undefined || actual.error !== undefined) {
      problems.push(`${key}: missing after the upgrade (${actual?.error ?? "not read"})`);
      continue;
    }
    for (const [field, value] of Object.entries(expected)) {
      if (actual[field] !== value) {
        problems.push(`${key}.${field}: was ${JSON.stringify(value)}, now ${JSON.stringify(actual[field])}`);
      }
    }
  }
  return problems;
}

/** Throws, naming every loss at once, unless the recorded state reads back unchanged. */
export async function assertStateSurvived(baseUrl, recorded) {
  const problems = compareState(recorded.snapshot, await readState(baseUrl, recorded.ids));
  if (problems.length > 0) {
    throw new Error(`the state did not survive the upgrade:\n  ${problems.join("\n  ")}`);
  }
}

const WORKFLOW_EXECUTION_QUERY = "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController";

/** A workflow's id, by its `org/slug` reference: what `stigmer run workflow <slug>` resolves. */
export async function workflowIdByReference(baseUrl, { org, slug }) {
  const workflow = await connectJson(baseUrl, "ai.stigmer.agentic.workflow.v1.WorkflowQueryController/getByReference", {
    org,
    kind: "workflow",
    slug,
  });
  const id = workflow.metadata?.id;
  if (!id) throw new Error(`workflow ${org}/${slug} has no id: ${JSON.stringify(workflow)}`);
  return id;
}

/**
 * Waits until a run of workflow `workflowId` has a human_input gate in the
 * organization `orgId`'s approval queue (listPendingApprovals), and resolves
 * that entry's `{ executionId, taskName }`: the gate a reviewer is asked to
 * decide. An entry names its execution, not its workflow (its workflowName
 * is the execution's own name), so each candidate's execution is read for
 * the workflow it runs.
 */
export async function waitForPendingApproval(baseUrl, { orgId, workflowId, timeoutMs }) {
  return pollUntil(
    `a pending approval of ${workflowId} in ${orgId}`,
    timeoutMs,
    async () => {
      const list = await connectJson(baseUrl, `${WORKFLOW_EXECUTION_QUERY}/listPendingApprovals`, { org: orgId, pageSize: 100 });
      for (const entry of list.entries ?? []) {
        const execution = await connectJson(baseUrl, `${WORKFLOW_EXECUTION_QUERY}/get`, { value: entry.executionId });
        if (execution.spec?.workflowId === workflowId) return { executionId: entry.executionId, taskName: entry.taskName };
      }
      return false;
    },
    { intervalMs: 500 },
  );
}

/** Every approval_resolved payload on an execution's event log, oldest first (getEventLog, paged to its end). */
export async function approvalResolutions(baseUrl, executionId) {
  const resolutions = [];
  let afterSequence = 0;
  for (;;) {
    const page = await connectJson(baseUrl, `${WORKFLOW_EXECUTION_QUERY}/getEventLog`, {
      executionId,
      afterSequence,
      eventTypes: ["approval_resolved"],
    });
    const events = page.events ?? [];
    for (const event of events) {
      if (event.approvalResolved !== undefined) resolutions.push({ taskName: event.taskName ?? "", ...event.approvalResolved });
    }
    if (!page.hasMore || events.length === 0) return resolutions;
    afterSequence = Number(events.at(-1).sequenceNumber);
  }
}

/** The identity a workflow execution records as its creator (status.audit.specAudit.createdBy), the person a local gate's decision is attributed to. */
export async function workflowExecutionCreator(baseUrl, executionId) {
  const execution = await connectJson(baseUrl, `${WORKFLOW_EXECUTION_QUERY}/get`, { value: executionId });
  const creator = execution.status?.audit?.specAudit?.createdBy?.id ?? "";
  if (creator === "") throw new Error(`workflow execution ${executionId} records no creator`);
  return creator;
}

/**
 * Why `stigmer execution logs` output does not show a gate's resolution, or
 * undefined when it does. `resolution` is `"timed out"` for a gate that
 * timed out under the fail policy, whose line must say it decided nothing
 * and come before the task's failure; otherwise `{ outcome, by }`, whose
 * line must name both and end there. Pure, over the command's text.
 */
export function gateLogProblem(text, task, resolution) {
  const lines = text.split("\n");
  const wanted =
    resolution === "timed out"
      ? `approval resolved: ${task} — timed out, no decision`
      : `approval resolved: ${task} — ${resolution.outcome} by ${resolution.by}`;
  // The resolution ends its line (after the time and the icon), so a longer
  // line, such as an auto-resolved "… by <reviewer> (timeout)", is not it.
  const at = lines.findIndex((line) => line.trimEnd().endsWith(wanted));
  if (at === -1) return `no line reads ${JSON.stringify(wanted)} in:\n${text}`;
  if (resolution === "timed out") {
    const failedAt = lines.findIndex((line) => line.includes(`task failed: ${task}`));
    if (failedAt === -1) return `no line reads "task failed: ${task}" after the timeout in:\n${text}`;
    if (failedAt < at) return `the task's failure is printed before its gate resolved in:\n${text}`;
  }
  return undefined;
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
