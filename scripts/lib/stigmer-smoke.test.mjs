// Pins two probes every self-host smoke shares. The console lane: /config.json
// under the trusted-local posture is ONE document (apiUrl and appUrl empty,
// meaning "the console's own origin" — 20260913.02 Q-CL-3; sign-in disabled;
// no OIDC coordinates), asserted whole, and / answers HTML. The document is
// spelled out here rather than imported so a drift in the library's constant
// is caught, not mirrored. The Host-derived arm is the #1087 incident: four
// gates accepted `http://<host>` after the server stopped serving it. The
// bootstrap probe: polls the caller's organizations until the `stigmer`
// organization the bootstrap creates is present. The run probes: an agent run
// passes only on the model's reply, and a terminal failure (of an agent or a
// workflow run) ends the wait at once instead of being retried to the
// deadline (#1514). The state probes the upgrade rehearsal reads: what the
// runs created is recorded, read back after an upgrade, and every loss or
// change named at once (compareState is pure; recordState and
// assertStateSurvived run against a scripted lane whose rows can be made to
// vanish, the way a data-losing migration would). The version probe: the
// server's own getServerInfo answer, refused when empty. Run via
// `npm run test:scripts` (node --test; wired into the root `npm test` and
// ci.ts-workspace).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  assertConsoleServed,
  assertStateSurvived,
  compareState,
  pollUntil,
  readState,
  recordState,
  runAgentToReply,
  runSetVarsWorkflow,
  serverVersion,
  waitForBootstrapOrganization,
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

// ─── The bootstrap probe ────────────────────────────────────────────────────
//
// An organization query lane on 127.0.0.1:0 that answers findMyOrganizations
// from a script of responses, one per call, so the probe's polling (no
// `stigmer` organization until the bootstrap lands, then present) is pinned
// without a server.

async function serveOrganizationLane(responses) {
  let call = 0;
  const server = createServer((request, response) => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(next));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    calls: () => call,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const STIGMER_ORG = { metadata: { id: "org_stigmer_0001", slug: "stigmer", name: "stigmer" } };
const OTHER_ORG = { metadata: { id: "org_other_0001", slug: "acme", name: "acme" } };

test("waits until the `stigmer` organization is among the caller's, then yields its id", async () => {
  const lane = await serveOrganizationLane([
    { entries: [] },
    { entries: [OTHER_ORG] },
    { entries: [OTHER_ORG, STIGMER_ORG] },
  ]);
  try {
    const id = await waitForBootstrapOrganization(lane.baseUrl, 10_000, {});
    assert.equal(id, "org_stigmer_0001");
    assert.equal(lane.calls(), 3);
  } finally {
    await lane.close();
  }
});

test("matches the organization by slug, never by name", async () => {
  const lane = await serveOrganizationLane([
    { entries: [{ metadata: { id: "org_x", slug: "not-it", name: "stigmer" } }] },
  ]);
  try {
    await assert.rejects(waitForBootstrapOrganization(lane.baseUrl, 2_500, {}), /organization 'stigmer' present/);
  } finally {
    await lane.close();
  }
});

/**
 * A Connect-JSON lane that answers by procedure: `routes` maps a procedure's
 * last segment ("create", "get") under its service to a function of the call
 * count, so a test scripts what each poll reads. Unrouted calls answer 404.
 */
async function serveConnectLane(routes) {
  const calls = new Map();
  const server = createServer((request, response) => {
    const procedure = (request.url ?? "").replace(/^\//, "");
    const route = routes[procedure];
    if (route === undefined) {
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
const AGENT_CREATE = "ai.stigmer.agentic.agent.v1.AgentCommandController/create";
const AEX_CREATE = "ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController/create";
const AEX_GET = "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController/get";
const REPLY = "This is the Stigmer fake model's default reply; no real model was called.";

function agentLane(executionAt) {
  return serveConnectLane({
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

test("an agent run needs the reply text the install's model answers with", async () => {
  await assert.rejects(runAgentToReply("http://127.0.0.1:9", 1_000, {}), /needs the reply text/);
});

test("a workflow run that fails ends the wait at once (#1514)", async () => {
  const lane = await serveConnectLane({
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
