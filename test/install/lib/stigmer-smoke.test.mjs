// Pins two probes every self-host smoke shares. The console lane: /config.json
// under the trusted-local posture is ONE document (apiUrl and appUrl empty,
// meaning "the console's own origin"; sign-in disabled;
// no OIDC coordinates), asserted whole, and / answers HTML. The document is
// spelled out here rather than imported so a drift in the library's constant
// is caught, not mirrored. The Host-derived arm is the #1087 incident: four
// gates accepted `http://<host>` after the server stopped serving it. The
// organization probes: a fresh install holds exactly the `stigmer`
// organization the server made, and says it fills it; a smoke line runs in
// the organization it is given, else a one-organization server's, else a
// fresh one. The run probes: an agent run
// passes only on the model's reply, and a terminal failure (of an agent or a
// workflow run) ends the wait at once instead of being retried to the
// deadline (#1514). The state probes the upgrade rehearsal reads: what the
// runs created is recorded, read back after an upgrade, and every loss or
// change named at once (compareState is pure; recordState and
// assertStateSurvived run against a scripted lane whose rows can be made to
// vanish, the way a data-losing migration would). The version probe: the
// server's own getServerInfo answer, refused when empty. The refusal probe:
// a request the server must refuse passes only on a non-2xx naming the
// expected text, and an admission or another refusal fails, naming the
// answer. The log probes: the server's log is read in both of its forms, a
// log with no parseable line refuses, and the boot line that derives the
// OAuth callback must name the public address it was given. The approval
// probes: a gate is found in the organization's queue by its workflow, its
// resolutions are read from every page of the event log, its creator is
// refused when absent, and `stigmer execution logs` must say a timed-out gate
// decided nothing before its task failed, and name who approved the other.
// The stream probe: a CLI run's NDJSON is read for its final phase and its
// last top-level reply, the two facts a live-model run asserts. Run via
// `npm run test:scripts` (node --test; wired into the root `npm test` and
// ci.ts-workspace).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  approvalResolutions,
  assertConsoleServed,
  assertMissingOrganizationRefused,
  assertOAuthCallbackFromPublicOrigin,
  assertStateSurvived,
  compareState,
  connectRefusal,
  expectRefusal,
  gateLogProblem,
  pollUntil,
  readState,
  recordState,
  runAgentToReply,
  runSetVarsWorkflow,
  serverLogEntries,
  serverVersion,
  streamedRunOutcome,
  readSingleOrganization,
  smokeOrganization,
  waitForPendingApproval,
  workflowExecutionCreator,
  workflowIdByReference,
} from "./stigmer-smoke.mjs";

const TRUSTED_LOCAL_DOCUMENT = {
  apiUrl: "",
  appUrl: "",
  authMode: "disabled",
  oidcIssuer: "",
  oidcClientId: "",
  oidcAudience: "",
};

/**
 * A console lane on 127.0.0.1:0 whose two routes are shaped by the test:
 * `config` is what /config.json returns (an object is sent as JSON; a string
 * verbatim), `configStatus`/`configType` its status and content-type, and
 * `indexType` the content-type of /. Resolves the base URL; `close` stops it.
 */
async function serveConsoleLane({
  config = TRUSTED_LOCAL_DOCUMENT,
  configStatus = 200,
  configType = "application/json",
  indexType = "text/html; charset=utf-8",
} = {}) {
  const server = createServer((request, response) => {
    if (request.url === "/config.json") {
      response.writeHead(configStatus, { "content-type": configType });
      response.end(
        typeof config === "string" ? config : JSON.stringify(config),
      );
      return;
    }
    response.writeHead(200, { "content-type": indexType });
    response.end(
      indexType.includes("text/html")
        ? "<!doctype html><title>Stigmer</title>"
        : "{}",
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Runs the probe against a lane shaped by `shape` and returns the refusal, or undefined when it passed. */
async function refusalFor(shape) {
  const lane = await serveConsoleLane(shape);
  try {
    await assertConsoleServed(lane.baseUrl);
    return undefined;
  } catch (error) {
    return error;
  } finally {
    await lane.close();
  }
}

test("passes the trusted-local document served with HTML at /", async () => {
  assert.equal(await refusalFor({}), undefined);
});

test("passes the document whatever order the server writes its keys in", async () => {
  const reordered = Object.fromEntries(
    Object.entries(TRUSTED_LOCAL_DOCUMENT).reverse(),
  );
  assert.equal(await refusalFor({ config: reordered }), undefined);
});

test("refuses the pre-#1082 Host-derived apiUrl, naming the field and both documents", async () => {
  const lane = await serveConsoleLane();
  await lane.close();
  const refusal = await refusalFor({
    config: { ...TRUSTED_LOCAL_DOCUMENT, apiUrl: lane.baseUrl },
  });
  assert.ok(
    refusal instanceof Error,
    "the Host-derived document must be refused",
  );
  assert.match(refusal.message, /\/config\.json/);
  assert.match(
    refusal.message,
    new RegExp(`"apiUrl":"${lane.baseUrl}"`),
    "the served document is quoted",
  );
  assert.match(refusal.message, /"apiUrl":""/, "the wanted document is quoted");
});

test("refuses a document missing a field", async () => {
  const { appUrl: _dropped, ...withoutAppUrl } = TRUSTED_LOCAL_DOCUMENT;
  const refusal = await refusalFor({ config: withoutAppUrl });
  assert.ok(refusal instanceof Error);
  assert.match(refusal.message, /\/config\.json/);
});

test("refuses a document carrying an unexpected field", async () => {
  const refusal = await refusalFor({
    config: { ...TRUSTED_LOCAL_DOCUMENT, grpcPort: "7234" },
  });
  assert.ok(refusal instanceof Error);
  assert.match(refusal.message, /"grpcPort":"7234"/);
});

test("refuses the OIDC posture: a smoke proves trusted-local, sign-in stays the handler test's", async () => {
  const refusal = await refusalFor({
    config: {
      ...TRUSTED_LOCAL_DOCUMENT,
      authMode: "oidc",
      oidcIssuer: "https://auth.example.com/realms/main",
    },
  });
  assert.ok(refusal instanceof Error);
  assert.match(refusal.message, /"authMode":"oidc"/);
});

test("refuses a /config.json that is not 200, with the status, before reading the body", async () => {
  const refusal = await refusalFor({ configStatus: 404, config: "not found" });
  assert.ok(refusal instanceof Error);
  assert.match(refusal.message, /\/config\.json.*404/);
  assert.doesNotMatch(
    refusal.message,
    /Unexpected token|not valid JSON/,
    "no parse error leaks: the status is the diagnosis",
  );
});

test("refuses a /config.json that is not JSON, with its content-type, before parsing", async () => {
  const refusal = await refusalFor({
    configType: "text/html; charset=utf-8",
    config: "<!doctype html><title>the app shell, not the contract</title>",
  });
  assert.ok(refusal instanceof Error);
  assert.match(refusal.message, /\/config\.json.*text\/html/);
  assert.match(
    refusal.message,
    /application\/json/,
    "the wanted type is named",
  );
});

test("refuses a / that does not answer HTML", async () => {
  const refusal = await refusalFor({ indexType: "application/json" });
  assert.ok(refusal instanceof Error);
  assert.match(refusal.message, /console \/.*text\/html/);
});

/**
 * A Connect-JSON lane that answers by procedure: `routes` maps a procedure's
 * last segment ("create", "get") under its service to a function of the call
 * count, so a test scripts what each poll reads. Unrouted calls answer 404.
 */
async function serveConnectLane(routes) {
  const table = new Map(Object.entries(routes));
  const calls = new Map();
  const server = createServer((request, response) => {
    const procedure = (request.url ?? "").replace(/^\//, "");
    const route = table.get(procedure);
    if (typeof route !== "function") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "not_found", message: procedure }));
      return;
    }
    const n = (calls.get(procedure) ?? 0) + 1;
    calls.set(procedure, n);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(route(n)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    calls: (procedure) => calls.get(procedure) ?? 0,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const ORG_CREATE = "ai.stigmer.tenancy.organization.v1.OrganizationCommandController/create";
const SERVER_INFO = "ai.stigmer.platform.v1.PlatformQueryController/getServerInfo";
const MY_ORGS = "ai.stigmer.tenancy.organization.v1.OrganizationQueryController/findMyOrganizations";
const STIGMER_ORG = { metadata: { id: "stigmer", slug: "stigmer", name: "Stigmer" } };
const OTHER_ORG = { metadata: { id: "acme", slug: "acme", name: "acme" } };
const AGENT_CREATE = "ai.stigmer.agentic.agent.v1.AgentCommandController/create";
const AEX_CREATE = "ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController/create";
const AEX_GET = "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController/get";
const REPLY = "This is the Stigmer fake model's default reply; no real model was called.";

function agentLane(executionAt) {
  return serveConnectLane({
    // A server that holds several organizations: the line makes its own.
    [SERVER_INFO]: () => ({ edition: "oss", version: "3.41.0" }),
    [ORG_CREATE]: () => ({ metadata: { id: "org_smoke_1" } }),
    [AGENT_CREATE]: () => ({ metadata: { id: "agt_smoke_1" } }),
    [AEX_CREATE]: () => ({ metadata: { id: "aex_smoke_1" } }),
    [AEX_GET]: executionAt,
  });
}

function completedWith(messages) {
  return { metadata: { id: "aex_smoke_1" }, status: { phase: "EXECUTION_COMPLETED", messages } };
}

test("an agent run passes on the model's reply, and yields the ids an upgrade reads back", async () => {
  const lane = await agentLane((n) =>
    n === 1
      ? { status: { phase: "EXECUTION_IN_PROGRESS", messages: [] } }
      : completedWith([
          { type: "MESSAGE_HUMAN", content: "Say hello." },
          { type: "MESSAGE_AI", content: REPLY },
        ]),
  );
  try {
    const result = await runAgentToReply(lane.baseUrl, 10_000, { expectText: REPLY });
    assert.deepEqual(result, { orgId: "org_smoke_1", agentId: "agt_smoke_1", executionId: "aex_smoke_1", reply: REPLY });
    assert.equal(lane.calls(AEX_GET), 2);
  } finally {
    await lane.close();
  }
});

test("an agent run that completes without the model's reply fails, naming both texts", async () => {
  const lane = await agentLane(() =>
    completedWith([
      { type: "MESSAGE_AI", content: REPLY },
      { type: "MESSAGE_AI", content: "something else answered" },
    ]),
  );
  try {
    await assert.rejects(
      runAgentToReply(lane.baseUrl, 10_000, { expectText: REPLY }),
      /last reply is not the model's: expected it to contain .*got "something else answered"/,
    );
  } finally {
    await lane.close();
  }
});

test("an agent run that fails ends the wait at once with the execution's error", async () => {
  const lane = await agentLane(() => ({
    status: { phase: "EXECUTION_FAILED", error: "400 invalid_request_error: the model refused" },
  }));
  const started = Date.now();
  try {
    await assert.rejects(
      runAgentToReply(lane.baseUrl, 60_000, { expectText: REPLY }),
      /agent execution reached EXECUTION_FAILED: 400 invalid_request_error: the model refused/,
    );
    assert.ok(Date.now() - started < 5_000, "the failure waited for the deadline");
    assert.equal(lane.calls(AEX_GET), 1);
  } finally {
    await lane.close();
  }
});

// ─── The organization probes ────────────────────────────────────────────────

test("a fresh install holds exactly `stigmer`, made and filled by the server", async () => {
  const lane = await serveConnectLane({
    [SERVER_INFO]: () => ({ edition: "oss", singleOrg: true }),
    [MY_ORGS]: () => ({ entries: [STIGMER_ORG] }),
  });
  try {
    assert.equal(await readSingleOrganization(lane.baseUrl), "stigmer");
  } finally {
    await lane.close();
  }
});

test("the organization probe refuses a server that does not fill one, and any other set of organizations", async () => {
  const cases = [
    [{ edition: "oss" }, [STIGMER_ORG], /does not report a single organization/],
    [{ edition: "oss", singleOrg: true }, [], /want exactly the organization 'stigmer', got \[\]/],
    [{ edition: "oss", singleOrg: true }, [OTHER_ORG], /got \["acme"\]/],
    [{ edition: "oss", singleOrg: true }, [STIGMER_ORG, OTHER_ORG], /got \["stigmer","acme"\]/],
  ];
  for (const [info, entries, refusal] of cases) {
    const lane = await serveConnectLane({ [SERVER_INFO]: () => info, [MY_ORGS]: () => ({ entries }) });
    try {
      await assert.rejects(readSingleOrganization(lane.baseUrl), refusal);
    } finally {
      await lane.close();
    }
  }
});

test("a smoke line runs in the organization it is given, without asking", async () => {
  const lane = await serveConnectLane({});
  try {
    assert.equal(await smokeOrganization(lane.baseUrl, "unused", { org: "recorded" }), "recorded");
    assert.equal(lane.calls(SERVER_INFO), 0);
  } finally {
    await lane.close();
  }
});

test("a smoke line runs in a one-organization server's organization, and creates none", async () => {
  const lane = await serveConnectLane({
    [SERVER_INFO]: () => ({ edition: "oss", singleOrg: true }),
    [MY_ORGS]: () => ({ entries: [STIGMER_ORG] }),
    [ORG_CREATE]: () => ({ metadata: { id: "never" } }),
  });
  try {
    assert.equal(await smokeOrganization(lane.baseUrl, "smoke-org-1"), "stigmer");
    assert.equal(lane.calls(ORG_CREATE), 0);
  } finally {
    await lane.close();
  }
});

test("a smoke line on a server that holds several makes an organization of its own", async () => {
  const lane = await serveConnectLane({
    [SERVER_INFO]: () => ({ edition: "oss", version: "3.41.0" }),
    [ORG_CREATE]: () => ({ metadata: { id: "org_smoke_1" } }),
  });
  try {
    assert.equal(await smokeOrganization(lane.baseUrl, "smoke-org-1"), "org_smoke_1");
    assert.equal(lane.calls(ORG_CREATE), 1);
  } finally {
    await lane.close();
  }
});

test("an agent run needs the reply text the install's model answers with", async () => {
  await assert.rejects(runAgentToReply("http://127.0.0.1:9", 1_000, {}), /needs the reply text/);
});

test("a workflow run that fails ends the wait at once (#1514)", async () => {
  const lane = await serveConnectLane({
    [SERVER_INFO]: () => ({ edition: "oss", version: "3.41.0" }),
    [ORG_CREATE]: () => ({ metadata: { id: "org_smoke_1" } }),
    "ai.stigmer.agentic.workflow.v1.WorkflowCommandController/create": () => ({ metadata: { id: "wfl_smoke_1" } }),
    "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController/create": () => ({
      metadata: { id: "wex_smoke_1" },
    }),
    "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get": () => ({
      status: { phase: "EXECUTION_FAILED", error: { message: "set_vars failed" } },
    }),
  });
  const started = Date.now();
  try {
    await assert.rejects(runSetVarsWorkflow(lane.baseUrl, 60_000), /execution reached EXECUTION_FAILED: .*set_vars failed/);
    assert.ok(Date.now() - started < 5_000, "the failure waited for the deadline");
  } finally {
    await lane.close();
  }
});

test("pollUntil retries a transient error until the probe succeeds", async () => {
  let n = 0;
  const value = await pollUntil(
    "a flaky probe",
    5_000,
    async () => {
      n += 1;
      if (n < 3) throw new Error("connection refused");
      return "ready";
    },
    { intervalMs: 10 },
  );
  assert.equal(value, "ready");
  assert.equal(n, 3);
});

test("pollUntil reports a timeout with the probe's last error", async () => {
  await assert.rejects(
    pollUntil("never", 50, async () => {
      throw new Error("still booting");
    }, { intervalMs: 10 }),
    /timed out waiting for never \(50ms\): still booting/,
  );
});

const SNAPSHOT = Object.freeze({
  workflowOrg: { id: "org_wf", name: "smoke-org-1", slug: "smoke-org-1" },
  agentOrg: { id: "org_ag", name: "smoke-agent-org-1", slug: "smoke-agent-org-1" },
  agent: { id: "agt_1", name: "smoke-agent-1", slug: "smoke-agent-1" },
  agentByReference: { id: "agt_1", name: "smoke-agent-1", slug: "smoke-agent-1" },
  workflowExecution: { id: "wex_1", name: "smoke-wfx-1", slug: "smoke-wfx-1", phase: "EXECUTION_COMPLETED" },
  agentExecution: { id: "aex_1", name: "smoke-aex-1", slug: "smoke-aex-1", phase: "EXECUTION_COMPLETED", reply: REPLY },
});

function readOf(changes) {
  return Object.fromEntries(Object.entries(SNAPSHOT).map(([key, value]) => [key, { ...value, ...(changes[key] ?? {}) }]));
}

test("compareState finds nothing when the state read back is the state recorded", () => {
  assert.deepEqual(compareState(SNAPSHOT, readOf({})), []);
});

test("compareState names every changed field and every missing resource at once", () => {
  const read = readOf({ agent: { name: "renamed" }, agentExecution: { reply: "" } });
  read.workflowExecution = { error: "WorkflowExecutionQueryController/get -> HTTP 404: not found" };
  delete read.agentByReference;
  assert.deepEqual(compareState(SNAPSHOT, read), [
    'agent.name: was "smoke-agent-1", now "renamed"',
    "agentByReference: missing after the upgrade (not read)",
    "workflowExecution: missing after the upgrade (WorkflowExecutionQueryController/get -> HTTP 404: not found)",
    `agentExecution.reply: was ${JSON.stringify(REPLY)}, now ""`,
  ]);
});

test("compareState names an execution that is no longer COMPLETED", () => {
  assert.deepEqual(compareState(SNAPSHOT, readOf({ workflowExecution: { phase: "EXECUTION_PENDING" } })), [
    'workflowExecution.phase: was "EXECUTION_COMPLETED", now "EXECUTION_PENDING"',
  ]);
});

/**
 * A lane that serves every call the state probes make, from rows it keeps:
 * creates add a row, gets read it, and `lane.lose(id)` deletes one, as a
 * migration that dropped rows would.
 */
async function stateLane() {
  const rows = new Map();
  let n = 0;
  const create = (prefix, extra = {}) => (body) => {
    n += 1;
    const id = `${prefix}_${n}`;
    const row = { metadata: { ...body.metadata, id, slug: body.metadata.name }, ...extra };
    rows.set(id, row);
    return row;
  };
  const get = (body) => rows.get(body.value);
  // A Map, and a function check at the call: the path is the caller's, so it
  // must never reach an inherited property (a path of "constructor") or call
  // something that is not a route.
  const routes = new Map(Object.entries({
    [SERVER_INFO]: () => ({ edition: "oss", version: "3.41.0" }),
    [ORG_CREATE]: create("org"),
    "ai.stigmer.agentic.workflow.v1.WorkflowCommandController/create": create("wfl"),
    "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController/create": create("wex", {
      status: { phase: "EXECUTION_COMPLETED" },
    }),
    [AGENT_CREATE]: create("agt"),
    [AEX_CREATE]: create("aex", {
      status: { phase: "EXECUTION_COMPLETED", messages: [{ type: "MESSAGE_AI", content: REPLY }] },
    }),
    "ai.stigmer.tenancy.organization.v1.OrganizationQueryController/get": get,
    "ai.stigmer.agentic.agent.v1.AgentQueryController/get": get,
    "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get": get,
    [AEX_GET]: get,
    "ai.stigmer.agentic.agent.v1.AgentQueryController/getByReference": (body) =>
      [...rows.values()].find((row) => row.metadata.slug === body.slug && body.kind === "agent"),
  }));
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const route = routes.get((request.url ?? "").replace(/^\//, ""));
      const answer = typeof route === "function" ? route(JSON.parse(raw || "{}")) : undefined;
      response.writeHead(answer === undefined ? 404 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(answer ?? { code: "not_found" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    lose: (id) => rows.delete(id),
    rename: (id, name) => {
      rows.get(id).metadata.name = name;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("recorded state that reads back whole survives", async () => {
  const lane = await stateLane();
  try {
    const recorded = await recordState(lane.baseUrl, 10_000, { expectText: REPLY });
    assert.equal(recorded.snapshot.agentExecution.reply, REPLY);
    assert.equal(recorded.snapshot.agentByReference.id, recorded.ids.agentId);
    await assertStateSurvived(lane.baseUrl, recorded);
  } finally {
    await lane.close();
  }
});

test("a lost agent execution and a renamed agent both fail the survival check, named", async () => {
  const lane = await stateLane();
  try {
    const recorded = await recordState(lane.baseUrl, 10_000, { expectText: REPLY });
    lane.lose(recorded.ids.agentExecutionId);
    lane.rename(recorded.ids.agentId, "renamed-by-a-migration");
    await assert.rejects(
      assertStateSurvived(lane.baseUrl, recorded),
      (error) =>
        /agentExecution: missing after the upgrade \(.*HTTP 404/.test(error.message) &&
        /agent\.name: was "smoke-agent-.*", now "renamed-by-a-migration"/.test(error.message),
    );
  } finally {
    await lane.close();
  }
});

test("readState keeps a failed read as an error and skips the reference it depends on", async () => {
  const lane = await stateLane();
  try {
    const read = await readState(lane.baseUrl, {
      workflowOrgId: "org_gone",
      workflowExecutionId: "wex_gone",
      agentOrgId: "org_gone",
      agentId: "agt_gone",
      agentExecutionId: "aex_gone",
    });
    assert.match(read.agent.error, /HTTP 404/);
    assert.match(read.agentByReference.error, /did not read back by id/);
  } finally {
    await lane.close();
  }
});

test("serverVersion reads getServerInfo's version and refuses an empty one", async () => {
  const lane = await serveConnectLane({
    "ai.stigmer.platform.v1.PlatformQueryController/getServerInfo": (n) =>
      n === 1 ? { edition: "EDITION_LOCAL", version: "3.41.0" } : { edition: "EDITION_LOCAL" },
  });
  try {
    assert.equal(await serverVersion(lane.baseUrl), "3.41.0");
    await assert.rejects(serverVersion(lane.baseUrl), /reported no version/);
  } finally {
    await lane.close();
  }
});

/** A lane that answers every call with one status and body, and records the bodies it was sent. */
async function serveAnswer(status, body) {
  const sent = [];
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      sent.push({ procedure: (request.url ?? "").replace(/^\//, ""), body: JSON.parse(text) });
      response.writeHead(status, { "content-type": "application/json" });
      response.end(typeof body === "string" ? body : JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    sent,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** A lane that answers 200 with `answer(body, n)` for the nth call, and records what it was sent. */
async function serveAnswerBy(answer) {
  const sent = [];
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      const body = JSON.parse(text);
      sent.push({ procedure: (request.url ?? "").replace(/^\//, ""), body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(answer(body, sent.length)));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    sent,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("a refusal naming the expected text passes, and yields its status, code and message", async () => {
  const lane = await serveAnswer(404, { code: "not_found", message: "Organization not found: stigmer" });
  try {
    assert.deepEqual(await expectRefusal(lane.baseUrl, "x.v1.C/create", {}, { text: "Organization not found: stigmer" }), {
      status: 404,
      code: "not_found",
      message: "Organization not found: stigmer",
    });
  } finally {
    await lane.close();
  }
});

test("an admitted request fails the refusal probe, naming the status", async () => {
  const lane = await serveAnswer(200, { metadata: { id: "agt_1" } });
  try {
    await assert.rejects(expectRefusal(lane.baseUrl, "x.v1.C/create", {}, { text: "Organization not found" }), {
      message: 'x.v1.C/create: expected a refusal containing "Organization not found", the server answered 200',
    });
  } finally {
    await lane.close();
  }
});

test("a refusal for another reason fails the refusal probe, naming what the server said", async () => {
  const lane = await serveAnswer(400, { code: "invalid_argument", message: "spec.instructions is required" });
  try {
    await assert.rejects(
      expectRefusal(lane.baseUrl, "x.v1.C/create", {}, { text: "Organization not found" }),
      /refused, but not with "Organization not found": HTTP 400 invalid_argument: spec\.instructions is required/,
    );
  } finally {
    await lane.close();
  }
});

test("a refusal whose body is not a Connect error keeps its text as the message", () => {
  assert.deepEqual(connectRefusal(502, "<html>bad gateway</html>"), { status: 502, code: "", message: "<html>bad gateway</html>" });
});

test("a JSON refusal with no string message keeps its code and takes its text as the message", () => {
  const cases = [
    ['{"code":"not_found"}', { status: 404, code: "not_found", message: '{"code":"not_found"}' }],
    ['{"code":"internal","message":5}', { status: 404, code: "internal", message: '{"code":"internal","message":5}' }],
    ["null", { status: 404, code: "", message: "null" }],
    ['["not_found","gone"]', { status: 404, code: "", message: '["not_found","gone"]' }],
    ['"Organization not found"', { status: 404, code: "", message: '"Organization not found"' }],
  ];
  for (const [body, want] of cases) assert.deepEqual(connectRefusal(404, body), want, body);
});

test("the missing-organization probe creates an agent in an organization nobody made and wants it named", async () => {
  const lane = await serveAnswer(404, { code: "not_found", message: "Organization not found: no-such-org" });
  try {
    await assertMissingOrganizationRefused(lane.baseUrl);
    assert.equal(lane.sent.length, 1);
    assert.equal(lane.sent[0].procedure, "ai.stigmer.agentic.agent.v1.AgentCommandController/create");
    assert.equal(lane.sent[0].body.metadata.org, "no-such-org");
  } finally {
    await lane.close();
  }
});

const DERIVED =
  "STIGMER_OAUTH_REDIRECT_URI is not set — deriving the served console's callback for MCP server OAuth Connect";

test("the server's log reads in its pretty form and as NDJSON, and other output is skipped", () => {
  const text = [
    `2026-10-01T10:00:00.000Z INFO  ${DERIVED} {"redirectUri":"http://127.0.0.1:7234/auth/oauth/callback","from":"public-origin"}`,
    "2026-10-01T10:00:00.100Z WARN  a message {with a brace} and no fields",
    '{"level":"error","time":"2026-10-01T10:00:01.000Z","message":"boom","cause":"x"}',
    "Temporal worker: something that is not the server's",
  ].join("\n");
  assert.deepEqual(serverLogEntries(text), [
    {
      level: "info",
      message: DERIVED,
      fields: { redirectUri: "http://127.0.0.1:7234/auth/oauth/callback", from: "public-origin" },
    },
    { level: "warn", message: "a message {with a brace} and no fields", fields: {} },
    { level: "error", message: "boom", fields: { cause: "x" } },
  ]);
});

test("a log in which no line parses refuses, so a format change cannot pass unseen", () => {
  assert.throws(() => serverLogEntries("plain text\nmore plain text\n"), /no line of the server's log parses/);
});

test("the callback derived from the public address passes", () => {
  const log = `2026-10-01T10:00:00.000Z INFO  ${DERIVED} {"redirectUri":"http://127.0.0.1:7234/auth/oauth/callback","from":"public-origin"}`;
  assert.deepEqual(assertOAuthCallbackFromPublicOrigin(log, "http://127.0.0.1:7234"), {
    redirectUri: "http://127.0.0.1:7234/auth/oauth/callback",
    from: "public-origin",
  });
});

test("a callback derived from the compose file's default address fails, naming both", () => {
  const log = `2026-10-01T10:00:00.000Z INFO  ${DERIVED} {"redirectUri":"http://localhost:7234/auth/oauth/callback","from":"public-origin"}`;
  assert.throws(
    () => assertOAuthCallbackFromPublicOrigin(log, "http://127.0.0.1:7234"),
    /derived as \{"redirectUri":"http:\/\/localhost:7234\/auth\/oauth\/callback","from":"public-origin"\}; want \{"redirectUri":"http:\/\/127\.0\.0\.1:7234\/auth\/oauth\/callback"/,
  );
});

test("a boot that logs no derived callback fails", () => {
  const log = '{"level":"warn","time":"t","message":"STIGMER_OAUTH_REDIRECT_URI is not set — OAuth Connect flows for MCP servers are unavailable (initiateOAuthConnect will refuse)"}';
  assert.throws(() => assertOAuthCallbackFromPublicOrigin(log, "http://127.0.0.1:7234"), /logged no derived OAuth callback/);
});

const WEX_QUERY = "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController";

test("a pending approval is found by the workflow its execution runs, once it reaches the queue", async () => {
  // An entry's workflowName is its execution's own name, so the probe reads
  // each candidate's execution for the workflow it runs.
  const executions = { wex_other: "wfl_other", wex_gate: "wfl_gated" };
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      const procedure = (request.url ?? "").replace(/^\//, "");
      response.writeHead(200, { "content-type": "application/json" });
      if (procedure === `${WEX_QUERY}/listPendingApprovals`) {
        listed += 1;
        listedOrgs.push(JSON.parse(text).org);
        const entries = [{ executionId: "wex_other", workflowName: "wfx-1", taskName: "review" }];
        if (listed > 1) entries.push({ executionId: "wex_gate", workflowName: "wfx-2", taskName: "review" });
        response.end(JSON.stringify({ entries }));
      } else {
        const id = JSON.parse(text).value;
        response.end(JSON.stringify({ metadata: { id }, spec: { workflowId: executions[id] } }));
      }
    });
  });
  let listed = 0;
  const listedOrgs = [];
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await waitForPendingApproval(baseUrl, { orgId: "org_1", workflowId: "wfl_gated", timeoutMs: 10_000 }), {
      executionId: "wex_gate",
      taskName: "review",
    });
    assert.equal(listed, 2);
    // The list is keyed by the organization's id, never its slug.
    assert.deepEqual(listedOrgs, ["org_1", "org_1"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("approval resolutions are read from every page of the event log, each page after the last one's sequence", async () => {
  const lane = await serveAnswerBy((body) =>
    body.afterSequence === 0
      ? {
          events: [{ sequenceNumber: "4", taskName: "review", approvalResolved: { outcome: "approve", comment: "first" } }],
          hasMore: true,
        }
      : { events: [{ sequenceNumber: "9", taskName: "second", approvalResolved: { autoResolved: true } }] },
  );
  try {
    assert.deepEqual(await approvalResolutions(lane.baseUrl, "wex_gate"), [
      { taskName: "review", outcome: "approve", comment: "first" },
      { taskName: "second", autoResolved: true },
    ]);
    assert.deepEqual(
      lane.sent.map((call) => call.body.afterSequence),
      [0, 4],
    );
    assert.deepEqual(lane.sent[0].body.eventTypes, ["approval_resolved"]);
  } finally {
    await lane.close();
  }
});

test("a workflow is resolved by its org/slug reference, and one with no id refuses", async () => {
  const lane = await serveAnswerBy((_body, n) => (n === 1 ? { metadata: { id: "wfl_1" } } : { metadata: {} }));
  try {
    assert.equal(await workflowIdByReference(lane.baseUrl, { org: "stigmer", slug: "gated" }), "wfl_1");
    assert.deepEqual(lane.sent[0].body, { org: "stigmer", kind: "workflow", slug: "gated" });
    await assert.rejects(workflowIdByReference(lane.baseUrl, { org: "stigmer", slug: "gated" }), /workflow stigmer\/gated has no id/);
  } finally {
    await lane.close();
  }
});

test("a workflow execution's creator is read from its audit, and its absence refuses", async () => {
  const lane = await serveConnectLane({
    [`${WEX_QUERY}/get`]: (n) =>
      n === 1 ? { status: { audit: { specAudit: { createdBy: { id: "acc_local" } } } } } : { status: {} },
  });
  try {
    assert.equal(await workflowExecutionCreator(lane.baseUrl, "wex_gate"), "acc_local");
    await assert.rejects(workflowExecutionCreator(lane.baseUrl, "wex_gate"), /records no creator/);
  } finally {
    await lane.close();
  }
});

// The CLI's own line form, `[HH:MM:SS] <glyph> <text>`
// (client-apps/cli/src/resources/stream/workflow-render-plaintext.ts): an
// event with no glyph of its own prints two spaces in the glyph's place.
const TIMED_OUT_LOGS = [
  "[10:00:00] ▶ execution started",
  "[10:00:00] → task started: review",
  "[10:00:00] ⏳ approval requested: review — Approve?",
  "[10:00:01]    event: WORKFLOW_EVENT_TYPE_SIGNAL_RECEIVED",
  "[10:00:20] ⏱ approval resolved: review — timed out, no decision",
  "[10:00:20] ✗ task failed: review — human_input timed out",
  "[10:00:20] ✗ execution failed: human_input timed out",
].join("\n");

test("a timed-out gate's logs pass when it decided nothing before its task failed", () => {
  assert.equal(gateLogProblem(TIMED_OUT_LOGS, "review", "timed out"), undefined);
});

test("a timed-out gate's logs fail without the no-decision line, or with the failure first", () => {
  assert.match(
    gateLogProblem(TIMED_OUT_LOGS.replace("timed out, no decision", "approve (timeout)"), "review", "timed out"),
    /no line reads "approval resolved: review — timed out, no decision"/,
  );
  const reordered = TIMED_OUT_LOGS.split("\n");
  [reordered[4], reordered[5]] = [reordered[5], reordered[4]];
  assert.match(gateLogProblem(reordered.join("\n"), "review", "timed out"), /printed before its gate resolved/);
});

test("an approved gate's logs must name its outcome and its reviewer", () => {
  const logs = "[10:00:05] ✓ approval resolved: review — approve by acc_local";
  assert.equal(gateLogProblem(logs, "review", { outcome: "approve", by: "acc_local" }), undefined);
  assert.match(gateLogProblem(logs, "review", { outcome: "approve", by: "acc_someone_else" }), /no line reads/);
  assert.match(gateLogProblem("[10:00:05] ✓ approval resolved: review — approve", "review", { outcome: "approve", by: "acc_local" }), /no line reads/);
  // A longer line is another resolution: an auto-resolved gate, or another reviewer whose id starts the same.
  assert.match(
    gateLogProblem("[10:00:05] ✓ approval resolved: review — approve by acc_local (timeout)", "review", { outcome: "approve", by: "acc_local" }),
    /no line reads/,
  );
  assert.match(
    gateLogProblem("[10:00:05] ✓ approval resolved: review — approve by acc_local_other", "review", { outcome: "approve", by: "acc_local" }),
    /no line reads/,
  );
});

test("reads a CLI run's stream: the done phase and the last top-level reply, skipping what is not the stream", () => {
  const line = (type, payload) => JSON.stringify({ type, ts: "2026-10-01T00:00:00Z", payload });
  const stream = [
    "a status line that is not JSON",
    line("phase_change", { phase: "in_progress", previous: "pending" }),
    line("ai_message", { content: "a sub-agent's words", sub_agent_id: "sub_1" }),
    line("ai_message", { content: "Hello there." }),
    line("done", { phase: "completed" }),
  ].join("\n");
  assert.deepEqual(streamedRunOutcome(stream), { phase: "completed", reply: "Hello there." });
  // A streamed reply carries no ai_message: its text is ai_stream_end's.
  const streamed = [
    line("ai_stream_start", { content: "" }),
    line("ai_stream_delta", { content: "Hel" }),
    line("ai_stream_end", { content: "Hello, streamed.", tool_calls: [] }),
    line("ai_stream_end", { content: "a sub-agent's streamed words", sub_agent_id: "sub_1" }),
    line("done", { phase: "completed" }),
  ].join("\n");
  assert.deepEqual(streamedRunOutcome(streamed), { phase: "completed", reply: "Hello, streamed." });
  assert.deepEqual(streamedRunOutcome(line("done", { phase: "failed", error: "boom" })), { phase: "failed", reply: "" });
  assert.deepEqual(streamedRunOutcome(""), { phase: "", reply: "" });
});
