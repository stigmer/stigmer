/**
 * The probes every self-host smoke asks of a running Stigmer, in one place so
 * the compose gate (test/install/smoke-compose.mjs) and the all-in-one image smoke
 * (test/install/smoke-all-in-one.mjs) prove the same facts the same way: a server
 * that answers SERVING, a console lane that serves its contract, an artifact
 * file server on its published port, and the end-to-end run through the
 * runner (an agent answered by the install's model). A smoke that needs a new
 * probe adds it here, never inline. The upgrade rehearsal
 * (test/install/rehearse-upgrade.mjs) adds the state probes: what the runs created
 * is recorded before an upgrade and read back after it, field by field, and
 * the server says which release answers (getServerInfo). On a base release
 * that still serves workflows, the rehearsal also records one workflow run
 * through the legacy arm below and requires the workflow API gone after the
 * upgrade. The refusal and log probes read what an install must not admit
 * and what its server says at boot: a request for an organization nobody
 * created is refused by name, and the OAuth callback is derived from the
 * public address the install was given.
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

/**
 * A Connect answer as `{ status, code, message }`. A JSON object keeps its
 * string `code` even without a string `message`, whose place the raw text
 * takes; any other body (not JSON, or JSON that is not an object) is text,
 * with no code.
 */
export function connectRefusal(status, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // not JSON: the raw text is the message
  }
  // An array is an object too, but JSON gives it no named fields: it lands as text.
  const isObject = parsed !== null && typeof parsed === "object";
  const code = isObject && typeof parsed.code === "string" ? parsed.code : "";
  const message = isObject && typeof parsed.message === "string" ? parsed.message : body.slice(0, 300);
  return { status, code, message };
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
 * A create naming an organization the server does not hold is refused with
 * the organization named, never stored under a slug nobody created (#1484).
 * The server makes its own organization at its first start, so the probe
 * names one nobody made.
 */
export async function assertMissingOrganizationRefused(baseUrl, { org = "no-such-org" } = {}) {
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
 * scheme and host the browser reached it by (a TLS proxy, a LAN address).
 * There is no edition-specific value here: a `stigmer up`
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
 * The console lane: /config.json IS the trusted-local document,
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
 * The organization a fresh install holds: the server makes it at its first
 * start, before its port binds, so it is there by the time anything can ask —
 * exactly one, with the `slug` the server gives it, and getServerInfo says the
 * server fills it (`singleOrg`). A fresh install needs no default content
 * beside it, because a session with no agent runs the built-in assistant.
 * Resolves to the organization's id.
 */
export async function readSingleOrganization(baseUrl, { slug = "stigmer" } = {}) {
  const info = await connectJson(baseUrl, "ai.stigmer.platform.v1.PlatformQueryController/getServerInfo", {});
  if (info.singleOrg !== true) {
    throw new Error(`getServerInfo does not report a single organization: ${JSON.stringify(info)}`);
  }
  const list = await connectJson(
    baseUrl,
    "ai.stigmer.tenancy.organization.v1.OrganizationQueryController/findMyOrganizations",
    {},
  );
  const entries = list.entries ?? [];
  if (entries.length !== 1 || entries[0].metadata?.slug !== slug) {
    throw new Error(
      `want exactly the organization '${slug}', got ${JSON.stringify(entries.map((org) => org.metadata?.slug))}`,
    );
  }
  const id = entries[0].metadata?.id;
  if (!id) throw new Error(`organization '${slug}' has no id: ${JSON.stringify(entries[0])}`);
  return id;
}

/**
 * The organization a smoke line runs in: `org` when the caller names one;
 * otherwise, on a server that holds one organization, that one; otherwise a
 * fresh organization named `name`. A one-organization server refuses a
 * second, and a release from before it held one makes none, so the same line
 * runs on both. Resolves to the organization's id.
 */
export async function smokeOrganization(baseUrl, name, { org } = {}) {
  if (org !== undefined) return org;
  const info = await connectJson(baseUrl, "ai.stigmer.platform.v1.PlatformQueryController/getServerInfo", {});
  if (info.singleOrg === true) {
    const list = await connectJson(
      baseUrl,
      "ai.stigmer.tenancy.organization.v1.OrganizationQueryController/findMyOrganizations",
      {},
    );
    const id = (list.entries ?? [])[0]?.metadata?.id;
    if (!id) throw new Error(`a server that holds one organization listed none: ${JSON.stringify(list)}`);
    return id;
  }
  const created = await connectJson(baseUrl, "ai.stigmer.tenancy.organization.v1.OrganizationCommandController/create", {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name },
  });
  const id = created.metadata?.id;
  if (!id) throw new Error(`organization create returned no id: ${JSON.stringify(created)}`);
  return id;
}

/**
 * The run API a server speaks. The rename of agent executions to runs moved
 * their service, kind string and phase names; an upgrade rehearsal records
 * its state on a release from before it and reads it back on the build
 * after, so every run line takes the API of the server it talks to
 * ({@link runApiOf}).
 */
export const RUN_APIS = Object.freeze({
  current: Object.freeze({
    agentService: "ai.stigmer.agentic.agentrun.v1.AgentRun",
    agentKind: "AgentRun",
    phasePrefix: "RUN_",
  }),
  beforeRunRename: Object.freeze({
    agentService: "ai.stigmer.agentic.agentexecution.v1.AgentExecution",
    agentKind: "AgentExecution",
    phasePrefix: "EXECUTION_",
  }),
});

/**
 * Whether `baseUrl` routes `procedure`. The Connect adapter answers an
 * unrouted procedure with a bare 404 and no body; a routed one that refuses
 * (an unknown id, a malformed one) answers a Connect error naming its code.
 */
async function routes(baseUrl, procedure, body) {
  const response = await fetch(`${baseUrl}/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return !(response.status === 404 && text.trim() === "");
}

/**
 * The run API `baseUrl` serves: the current one, unless the server does not
 * route the current agent-run query, which only a release from before the
 * rename does.
 */
export async function runApiOf(baseUrl) {
  return (await routes(baseUrl, `${RUN_APIS.current.agentService}QueryController/get`, { value: "aex_run_api_probe" }))
    ? RUN_APIS.current
    : RUN_APIS.beforeRunRename;
}

/** A run phase without its API's prefix (`COMPLETED`), so phases compare across the rename. */
export function runPhaseWord(phase, api) {
  return phase.startsWith(api.phasePrefix) ? phase.slice(api.phasePrefix.length) : phase;
}

const TERMINAL_FAILURES = new Set(["FAILED", "CANCELLED", "TERMINATED"]);

// The legacy workflow arm, for a base release that still serves workflows; removed once the newest release has none (stigmer#1989).
/**
 * The workflow run APIs of the releases that still serve workflows: the one
 * after runs were named runs, and the one before. The upgrade rehearsal
 * records a workflow run on such a base ({@link runSetVarsWorkflow}) and
 * requires the API gone after the upgrade ({@link assertWorkflowApiGone}).
 */
export const LEGACY_WORKFLOW_APIS = Object.freeze([
  Object.freeze({ service: "ai.stigmer.agentic.workflowrun.v1.WorkflowRun", kind: "WorkflowRun", phasePrefix: "RUN_" }),
  Object.freeze({
    service: "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution",
    kind: "WorkflowExecution",
    phasePrefix: "EXECUTION_",
  }),
]);

/** The workflow run API `baseUrl` routes ({@link LEGACY_WORKFLOW_APIS}), or undefined for a server that serves no workflows. */
export async function legacyWorkflowApiOf(baseUrl) {
  for (const api of LEGACY_WORKFLOW_APIS) {
    if (await routes(baseUrl, `${api.service}QueryController/get`, { value: "wex_workflow_api_probe" })) return api;
  }
  return undefined;
}

/** Throws unless `baseUrl` routes no workflow run API: what the build requires after an upgrade from a release that served one. */
export async function assertWorkflowApiGone(baseUrl) {
  const api = await legacyWorkflowApiOf(baseUrl);
  if (api !== undefined) {
    throw new Error(`the upgraded server still routes ${api.service}QueryController/get; it must serve no workflow API`);
  }
}

/**
 * On a base release that still serves workflows (`api`, from
 * {@link legacyWorkflowApiOf}), in the smoke's organization
 * ({@link smokeOrganization}; `org` names one), a single `set_vars` workflow
 * (sub-second, hermetic, no LLM, no MCP, no keys), run it, and wait for its
 * COMPLETED phase. Returns the organization, workflow and execution ids. A
 * terminal failure surfaces immediately with the server's own error.
 */
export async function runSetVarsWorkflow(baseUrl, timeoutMs, log = () => {}, { org, api }) {
  const suffix = uniqueSuffix();
  const orgId = await smokeOrganization(baseUrl, `smoke-org-${suffix}`, { org });

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
    `${api.service}CommandController/create`,
    {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: api.kind,
      metadata: { name: `smoke-wfx-${suffix}`, org: orgId },
      spec: { workflowId },
    },
  );
  const executionId = execution.metadata?.id;
  if (!executionId) throw new Error(`execution create returned no id: ${JSON.stringify(execution)}`);
  log(`execution ${executionId} created — awaiting COMPLETED...`);

  await pollUntil("execution COMPLETED", timeoutMs, async () => {
    const current = await connectJson(
      baseUrl,
      `${api.service}QueryController/get`,
      { value: executionId },
    );
    const phase = current.status?.phase ?? "";
    if (TERMINAL_FAILURES.has(runPhaseWord(phase, api))) {
      throw new PollStop(`execution reached ${phase}: ${JSON.stringify(current.status?.error ?? {})}`);
    }
    return runPhaseWord(phase, api) === "COMPLETED";
  });
  return { orgId, workflowId, executionId };
}

/**
 * The end-to-end line every self-host smoke draws: in the smoke's
 * organization ({@link smokeOrganization}; `org` names one), an agent with no tools, send it one message, and wait for
 * RUN_COMPLETED with the model's reply as the last message. It completes
 * only if the runner connected to Temporal and polled the queue, the install
 * wired a model the runner can reach, the runner called it, and the answer
 * travelled back to the record a user reads. The smokes
 * point the install at fake-model.mjs, so `expectText` is its reply. Returns
 * the ids and the reply, so an upgrade rehearsal can read them back. A
 * terminal failure surfaces immediately with the execution's own error.
 */
export async function runAgentToReply(baseUrl, timeoutMs, { expectText, log = () => {}, org, api = RUN_APIS.current }) {
  requireExpectText(expectText);
  const agent = await createSmokeAgent(baseUrl, { log, org });
  const run = await runAgentExecution(baseUrl, agent, timeoutMs, { expectText, log, api });
  return { ...agent, ...run };
}

/** A tool-less agent in the smoke's organization, the fixture the agent line runs. Resolves `{ orgId, agentId, agentSlug }`. */
export async function createSmokeAgent(baseUrl, { log = () => {}, org } = {}) {
  const suffix = uniqueSuffix();
  const orgId = await smokeOrganization(baseUrl, `smoke-agent-org-${suffix}`, { org });

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
  return { orgId, agentId, agentSlug: agent.metadata?.slug ?? "" };
}

/**
 * The first turn of a new conversation on the agent: a session that names
 * the agent by reference. A server released before conversations named
 * their agent refuses that field as unknown JSON and takes the agent's id
 * instead, so the line answers either: the upgrade rehearsal records its
 * state on the release it upgrades from with this same line.
 */
async function startAgentConversation(baseUrl, { orgId, agentId, agentSlug }, api) {
  const create = (target) =>
    connectJson(baseUrl, `${api.agentService}CommandController/create`, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: api.agentKind,
      metadata: { name: `smoke-aex-${uniqueSuffix()}`, org: orgId },
      spec: { ...target, message: "Say hello." },
    });
  try {
    return await create({ sessionSpec: { agentRef: { kind: "agent", org: orgId, slug: agentSlug } } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("HTTP 400") || !message.includes("agentRef")) throw error;
    return create({ agentId });
  }
}

/**
 * One run of an existing agent, to RUN_COMPLETED with the model's reply
 * as its last message. The upgrade rehearsal runs the agent an older release
 * stored this way, which is what shows the stored agent still works. Resolves
 * `{ executionId, reply }`.
 */
export async function runAgentExecution(baseUrl, agent, timeoutMs, { expectText, log = () => {}, api = RUN_APIS.current }) {
  requireExpectText(expectText);
  const execution = await startAgentConversation(baseUrl, agent, api);
  const executionId = execution.metadata?.id;
  if (!executionId) throw new Error(`agent execution create returned no id: ${JSON.stringify(execution)}`);
  log(`agent execution ${executionId} created — awaiting the model's reply...`);

  const completed = await pollUntil("agent execution RUN_COMPLETED", timeoutMs, async () => {
    const current = await readAgentExecution(baseUrl, executionId, api);
    const phase = current.status?.phase ?? "";
    if (TERMINAL_FAILURES.has(runPhaseWord(phase, api))) {
      throw new PollStop(`agent execution reached ${phase}: ${current.status?.error || "(no error recorded)"}`);
    }
    return runPhaseWord(phase, api) === "COMPLETED" ? current : false;
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
export async function readAgentExecution(baseUrl, executionId, api = RUN_APIS.current) {
  return connectJson(baseUrl, `${api.agentService}QueryController/get`, {
    value: executionId,
  });
}

/** The content of an execution's last AI message, or "" when it has none. */
export function lastAiReply(execution) {
  const messages = execution.status?.messages ?? [];
  const ai = messages.filter((message) => message.type === "MESSAGE_AI" && !message.isStreaming);
  return ai.at(-1)?.content ?? "";
}

/**
 * What a `stigmer run <agent> --json` stream says happened: the phase of its
 * `done` event and the content of its last top-level reply (the CLI writes
 * one `{type, ts, payload}` line per event; a line that is not JSON is not the
 * stream's and is skipped). A reply arrives whole as `ai_message`, or, when
 * the provider streamed it, as `ai_stream_start` / `_delta` / `_end`, whose
 * `ai_stream_end` carries the full text; the last of either kind is the reply.
 * A real model's words are never compared; the caller asks only that the run
 * completed with a reply.
 */
export function streamedRunOutcome(ndjson) {
  let phase = "";
  let reply = "";
  for (const line of ndjson.split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "done") phase = String(event.payload?.phase ?? "");
    const isReply = event?.type === "ai_message" || event?.type === "ai_stream_end";
    if (isReply && !event.payload?.sub_agent_id) reply = String(event.payload?.content ?? "");
  }
  return { phase, reply };
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
});

/**
 * The state an upgrade must carry: an agent run with the model's reply, in
 * the smoke's organization ({@link smokeOrganization}: one of its own on a
 * server that holds several, the server's one where it holds one), and every
 * resource as the server reads it back right after. Resolves
 * `{ ids, snapshot, workflowRun? }`: the ids to read again later, the
 * snapshot {@link compareState} holds the later read to, and, on a base that
 * still serves workflows, the completed workflow run recorded beside them
 * (`{ orgId, workflowId, executionId }`).
 */
export async function recordState(baseUrl, timeoutMs, { expectText, log = () => {} }) {
  const api = await runApiOf(baseUrl);
  // The legacy workflow arm (stigmer#1989).
  const workflowApi = await legacyWorkflowApiOf(baseUrl);
  const workflowRun = workflowApi === undefined ? undefined : await runSetVarsWorkflow(baseUrl, timeoutMs, log, { api: workflowApi });
  const agent = await runAgentToReply(baseUrl, timeoutMs, { expectText, log, api });
  const ids = {
    agentOrgId: agent.orgId,
    agentId: agent.agentId,
    agentSlug: agent.agentSlug,
    agentExecutionId: agent.executionId,
  };
  const snapshot = await readState(baseUrl, ids);
  const problems = Object.entries(snapshot)
    .filter(([, value]) => value.error !== undefined)
    .map(([key, value]) => `${key}: ${value.error}`);
  if (problems.length > 0) throw new Error(`the state just created does not read back: ${problems.join("; ")}`);
  return { ids, snapshot, ...(workflowRun !== undefined ? { workflowRun } : {}) };
}

/**
 * Every recorded resource read again, by id, and the agent once more by its
 * `org/slug` reference (the lookup `stigmer run <agent>` makes). A read that
 * fails is kept as `{ error }` rather than thrown, so one comparison can name
 * everything that was lost.
 */
export async function readState(baseUrl, ids) {
  const api = await runApiOf(baseUrl);
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
  // The phase without its API's prefix: a run recorded as EXECUTION_COMPLETED
  // reads back as RUN_COMPLETED after the rename, the same phase.
  const execution = (resource) => ({ ...identity(resource), phase: runPhaseWord(resource.status?.phase ?? "", api) });
  const agentOrg = await read(READS.organization, { value: ids.agentOrgId }, identity);
  const agent = await read(READS.agent, { value: ids.agentId }, identity);
  const agentByReference =
    agent.error === undefined && agentOrg.error === undefined
      ? await read(READS.agentByReference, { org: agentOrg.slug, kind: "agent", slug: agent.slug }, identity)
      : { error: "not read: the agent or its organization did not read back by id" };
  return {
    agentOrg,
    agent,
    agentByReference,
    agentExecution: await read(`${api.agentService}QueryController/get`, { value: ids.agentExecutionId }, (resource) => ({
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
