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
// passes only on the model's reply, and a terminal failure (of an agent run,
// or of the legacy arm's workflow run) ends the wait at once instead of being
// retried to the deadline (#1514). The state probes the upgrade rehearsal
// reads: what the runs created is recorded, read back after an upgrade, and
// every loss or change named at once (compareState is pure; recordState and
// assertStateSurvived run against a scripted lane whose rows can be made to
// vanish, the way a data-losing migration would, and which can serve a
// release from before runs were named runs and then upgrade, so state
// recorded through the old run API reads back through the new one). The
// legacy workflow arm: a base that still serves workflows, under either run
// API, records one workflow run, a base that serves none records none, and
// the workflow API must be gone after the upgrade. The version probe: the
// server's own getServerInfo answer, refused when empty. The refusal probe:
// a request the server must refuse passes only on a non-2xx naming the
// expected text, and an admission or another refusal fails, naming the
// answer. The log probes: the server's log is read in both of its forms, a
// log with no parseable line refuses, and the boot line that derives the
// OAuth callback must name the public address it was given. The stream probe: a CLI run's NDJSON is read for its final phase and its
// last top-level reply, the two facts a live-model run asserts. Run via
// `npm run test:scripts` (node --test; wired into the root `npm test` and
// ci.ts-workspace).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  assertConsoleServed,
  assertMissingOrganizationRefused,
  assertOAuthCallbackFromPublicOrigin,
  assertStateSurvived,
  assertWorkflowApiGone,
  compareState,
  connectRefusal,
  expectRefusal,
  LEGACY_WORKFLOW_APIS,
  legacyWorkflowApiOf,
  pollUntil,
  RUN_APIS,
  readState,
  recordState,
  runAgentToReply,
  runApiOf,
  runSetVarsWorkflow,
  serverLogEntries,
  serverVersion,
  streamedRunOutcome,
  readSingleOrganization,
  smokeOrganization,
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
    const handler = route;
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      // The check is repeated where the call is made: the path is the
      // caller's, and only a function the table holds may answer it.
      if (typeof handler !== "function") return;
      const answer = handler(n, raw === "" ? {} : JSON.parse(raw));
      // A route answers a refusal as { refuse: { status, code, message } }.
      const refusal = answer?.refuse;
      response.writeHead(refusal?.status ?? 200, { "content-type": "application/json" });
      response.end(JSON.stringify(refusal === undefined ? answer : { code: refusal.code, message: refusal.message }));
    });
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
const AEX_CREATE = "ai.stigmer.agentic.agentrun.v1.AgentRunCommandController/create";
const AEX_GET = "ai.stigmer.agentic.agentrun.v1.AgentRunQueryController/get";
const REPLY = "This is the Stigmer fake model's default reply; no real model was called.";

function agentLane(executionAt, aexCreate = () => ({ metadata: { id: "aex_smoke_1" } })) {
  return serveConnectLane({
    // A server that holds several organizations: the line makes its own.
    [SERVER_INFO]: () => ({ edition: "oss", version: "3.41.0" }),
    [ORG_CREATE]: () => ({ metadata: { id: "org_smoke_1" } }),
    [AGENT_CREATE]: () => ({ metadata: { id: "agt_smoke_1", slug: "smoke-agent" } }),
    [AEX_CREATE]: aexCreate,
    [AEX_GET]: executionAt,
  });
}

function completedWith(messages) {
  return { metadata: { id: "aex_smoke_1" }, status: { phase: "RUN_COMPLETED", messages } };
}

test("an agent run starts a conversation on the agent's reference", async () => {
  const sent = [];
  const lane = await agentLane(
    () => completedWith([{ type: "MESSAGE_AI", content: REPLY }]),
    (_n, body) => {
      sent.push(body.spec);
      return { metadata: { id: "aex_smoke_1" } };
    },
  );
  try {
    await runAgentToReply(lane.baseUrl, 10_000, { expectText: REPLY });
    assert.deepEqual(sent, [
      {
        sessionSpec: { agentRef: { kind: "agent", org: "org_smoke_1", slug: "smoke-agent" } },
        message: "Say hello.",
      },
    ]);
  } finally {
    await lane.close();
  }
});

test("an agent run on a server that predates agent references names the agent by id", async () => {
  const sent = [];
  const lane = await agentLane(
    () => completedWith([{ type: "MESSAGE_AI", content: REPLY }]),
    (_n, body) => {
      sent.push(body.spec);
      return body.spec.sessionSpec === undefined
        ? { metadata: { id: "aex_smoke_1" } }
        : {
            refuse: {
              status: 400,
              code: "invalid_argument",
              message:
                'cannot decode message ai.stigmer.agentic.session.v1.SessionSpec from JSON: key "agentRef" is unknown',
            },
          };
    },
  );
  try {
    const result = await runAgentToReply(lane.baseUrl, 10_000, { expectText: REPLY });
    assert.equal(result.executionId, "aex_smoke_1");
    assert.deepEqual(sent[1], { agentId: "agt_smoke_1", message: "Say hello." });
  } finally {
    await lane.close();
  }
});

test("an agent run passes on the model's reply, and yields the ids an upgrade reads back", async () => {
  const lane = await agentLane((n) =>
    n === 1
      ? { status: { phase: "RUN_IN_PROGRESS", messages: [] } }
      : completedWith([
          { type: "MESSAGE_HUMAN", content: "Say hello." },
          { type: "MESSAGE_AI", content: REPLY },
        ]),
  );
  try {
    const result = await runAgentToReply(lane.baseUrl, 10_000, { expectText: REPLY });
    assert.deepEqual(result, {
      orgId: "org_smoke_1",
      agentId: "agt_smoke_1",
      agentSlug: "smoke-agent",
      executionId: "aex_smoke_1",
      reply: REPLY,
    });
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
    status: { phase: "RUN_FAILED", error: "400 invalid_request_error: the model refused" },
  }));
  const started = Date.now();
  try {
    await assert.rejects(
      runAgentToReply(lane.baseUrl, 60_000, { expectText: REPLY }),
      /agent execution reached RUN_FAILED: 400 invalid_request_error: the model refused/,
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
    "ai.stigmer.agentic.workflowrun.v1.WorkflowRunCommandController/create": () => ({
      metadata: { id: "wex_smoke_1" },
    }),
    "ai.stigmer.agentic.workflowrun.v1.WorkflowRunQueryController/get": () => ({
      status: { phase: "RUN_FAILED", error: { message: "set_vars failed" } },
    }),
  });
  const started = Date.now();
  try {
    await assert.rejects(
      runSetVarsWorkflow(lane.baseUrl, 60_000, () => {}, { api: LEGACY_WORKFLOW_APIS[0] }),
      /execution reached RUN_FAILED: .*set_vars failed/,
    );
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
  agentOrg: { id: "org_ag", name: "smoke-agent-org-1", slug: "smoke-agent-org-1" },
  agent: { id: "agt_1", name: "smoke-agent-1", slug: "smoke-agent-1" },
  agentByReference: { id: "agt_1", name: "smoke-agent-1", slug: "smoke-agent-1" },
  agentExecution: { id: "aex_1", name: "smoke-aex-1", slug: "smoke-aex-1", phase: "RUN_COMPLETED", reply: REPLY },
});

function readOf(changes) {
  return Object.fromEntries(Object.entries(SNAPSHOT).map(([key, value]) => [key, { ...value, ...(changes[key] ?? {}) }]));
}

test("compareState finds nothing when the state read back is the state recorded", () => {
  assert.deepEqual(compareState(SNAPSHOT, readOf({})), []);
});

test("compareState names every changed field and every missing resource at once", () => {
  const read = readOf({ agent: { name: "renamed" }, agentExecution: { reply: "" } });
  read.agentOrg = { error: "OrganizationQueryController/get -> HTTP 404: not found" };
  delete read.agentByReference;
  assert.deepEqual(compareState(SNAPSHOT, read), [
    "agentOrg: missing after the upgrade (OrganizationQueryController/get -> HTTP 404: not found)",
    'agent.name: was "smoke-agent-1", now "renamed"',
    "agentByReference: missing after the upgrade (not read)",
    `agentExecution.reply: was ${JSON.stringify(REPLY)}, now ""`,
  ]);
});

test("compareState names an execution that is no longer COMPLETED", () => {
  assert.deepEqual(compareState(SNAPSHOT, readOf({ agentExecution: { phase: "RUN_PENDING" } })), [
    'agentExecution.phase: was "RUN_COMPLETED", now "RUN_PENDING"',
  ]);
});

/**
 * A lane that serves every call the state probes make, from rows it keeps:
 * creates add a row, gets read it, and `lane.lose(id)` deletes one, as a
 * migration that dropped rows would. It speaks `api` (RUN_APIS) and, when
 * `workflows` names one (LEGACY_WORKFLOW_APIS), that workflow run API, until
 * `lane.upgrade()`, which serves the current run API and no workflow API over
 * the same rows with their phases renamed, as the store's enum numbers read
 * after the rename. An unrouted procedure answers as the Connect adapter
 * does: a bare 404.
 */
async function stateLane(api = RUN_APIS.current, workflows = undefined) {
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
  const workflowRoutes = (served) =>
    served === undefined
      ? {}
      : {
          "ai.stigmer.agentic.workflow.v1.WorkflowCommandController/create": create("wfl"),
          [`${served.service}CommandController/create`]: (body) => {
            assert.equal(body.kind, served.kind);
            return create("wex", { status: { phase: `${served.phasePrefix}COMPLETED` } })(body);
          },
          [`${served.service}QueryController/get`]: get,
        };
  const routesFor = (speaks, served) =>
    new Map(Object.entries({
      [SERVER_INFO]: () => ({ edition: "oss", version: "3.41.0" }),
      [ORG_CREATE]: create("org"),
      ...workflowRoutes(served),
      [AGENT_CREATE]: create("agt"),
      [`${speaks.agentService}CommandController/create`]: (body) => {
        assert.equal(body.kind, speaks.agentKind);
        return create("aex", {
          status: { phase: `${speaks.phasePrefix}COMPLETED`, messages: [{ type: "MESSAGE_AI", content: REPLY }] },
        })(body);
      },
      "ai.stigmer.tenancy.organization.v1.OrganizationQueryController/get": get,
      "ai.stigmer.agentic.agent.v1.AgentQueryController/get": get,
      [`${speaks.agentService}QueryController/get`]: get,
      "ai.stigmer.agentic.agent.v1.AgentQueryController/getByReference": (body) =>
        [...rows.values()].find((row) => row.metadata.slug === body.slug && body.kind === "agent"),
    }));
  let routes = routesFor(api, workflows);
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const route = routes.get((request.url ?? "").replace(/^\//, ""));
      if (typeof route !== "function") {
        response.writeHead(404);
        response.end();
        return;
      }
      const answer = route(JSON.parse(raw || "{}"));
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
    setPhase: (id, phase) => {
      rows.get(id).status.phase = phase;
    },
    upgrade: () => {
      routes = routesFor(RUN_APIS.current, undefined);
      for (const row of rows.values()) {
        const phase = row.status?.phase;
        if (phase?.startsWith(api.phasePrefix)) {
          row.status.phase = `${RUN_APIS.current.phasePrefix}${phase.slice(api.phasePrefix.length)}`;
        }
      }
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
    assert.equal(recorded.workflowRun, undefined, "a base that serves no workflows records no workflow run");
    assert.equal(recorded.ids.workflowOrgId, undefined);
    assert.equal(recorded.snapshot.workflowOrg, undefined);
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

test("state recorded through the run API before the rename reads back whole through the current one", async () => {
  const lane = await stateLane(RUN_APIS.beforeRunRename);
  try {
    assert.equal(await runApiOf(lane.baseUrl), RUN_APIS.beforeRunRename);
    const recorded = await recordState(lane.baseUrl, 10_000, { expectText: REPLY });
    assert.equal(recorded.snapshot.agentExecution.phase, "COMPLETED");
    assert.equal(recorded.snapshot.agentExecution.reply, REPLY);
    lane.upgrade();
    assert.equal(await runApiOf(lane.baseUrl), RUN_APIS.current);
    await assertStateSurvived(lane.baseUrl, recorded);
  } finally {
    await lane.close();
  }
});

test("a run that lost its phase across the rename is named", async () => {
  const lane = await stateLane(RUN_APIS.beforeRunRename);
  try {
    const recorded = await recordState(lane.baseUrl, 10_000, { expectText: REPLY });
    lane.upgrade();
    lane.setPhase(recorded.ids.agentExecutionId, "RUN_PHASE_UNSPECIFIED");
    await assert.rejects(
      assertStateSurvived(lane.baseUrl, recorded),
      /agentExecution\.phase: was "COMPLETED", now "PHASE_UNSPECIFIED"/,
    );
  } finally {
    await lane.close();
  }
});

test("runApiOf takes any answer but an unrouted procedure's bare 404 as the current run API", async () => {
  for (const [status, body] of [
    [404, { code: "not_found", message: "agent run aex_run_api_probe not found" }],
    [400, { code: "invalid_argument", message: "value: not an id" }],
  ]) {
    const lane = await serveAnswer(status, body);
    try {
      assert.equal(await runApiOf(lane.baseUrl), RUN_APIS.current);
    } finally {
      await lane.close();
    }
  }
});

test("readState keeps a failed read as an error and skips the reference it depends on", async () => {
  const lane = await stateLane();
  try {
    const read = await readState(lane.baseUrl, {
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

test("a base that still serves workflows records one completed workflow run, under either run API", async () => {
  for (const [api, workflows] of [
    [RUN_APIS.current, LEGACY_WORKFLOW_APIS[0]],
    [RUN_APIS.beforeRunRename, LEGACY_WORKFLOW_APIS[1]],
  ]) {
    const lane = await stateLane(api, workflows);
    try {
      assert.equal(await legacyWorkflowApiOf(lane.baseUrl), workflows);
      const recorded = await recordState(lane.baseUrl, 10_000, { expectText: REPLY });
      assert.match(recorded.workflowRun?.executionId ?? "", /^wex_/);
      assert.match(recorded.workflowRun?.workflowId ?? "", /^wfl_/);
      // The run's organization joins the ids, and reads back with the rest.
      assert.equal(recorded.ids.workflowOrgId, recorded.workflowRun?.orgId);
      assert.equal(recorded.snapshot.workflowOrg?.id, recorded.workflowRun?.orgId);
      assert.equal(recorded.snapshot.agentExecution.reply, REPLY);
    } finally {
      await lane.close();
    }
  }
});

test("the workflow API must be gone after the upgrade: refused while it is routed, passed once it is not", async () => {
  const lane = await stateLane(RUN_APIS.current, LEGACY_WORKFLOW_APIS[0]);
  try {
    const recorded = await recordState(lane.baseUrl, 10_000, { expectText: REPLY });
    await assert.rejects(assertWorkflowApiGone(lane.baseUrl), /still routes ai\.stigmer\.agentic\.workflowrun\.v1\.WorkflowRunQueryController\/get/);
    lane.upgrade();
    assert.equal(await legacyWorkflowApiOf(lane.baseUrl), undefined);
    await assertWorkflowApiGone(lane.baseUrl);
    await assertStateSurvived(lane.baseUrl, recorded);
  } finally {
    await lane.close();
  }
});

test("legacyWorkflowApiOf takes any answer but an unrouted procedure's bare 404 as a routed workflow API", async () => {
  const lane = await serveAnswer(404, { code: "not_found", message: "workflow run wex_workflow_api_probe not found" });
  try {
    assert.equal(await legacyWorkflowApiOf(lane.baseUrl), LEGACY_WORKFLOW_APIS[0]);
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
