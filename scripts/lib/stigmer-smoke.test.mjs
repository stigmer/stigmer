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
// deadline (#1514). Run via
// `npm run test:scripts` (node --test; wired into the root `npm test` and
// ci.ts-workspace).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  assertConsoleServed,
  pollUntil,
  runAgentToReply,
  runSetVarsWorkflow,
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
