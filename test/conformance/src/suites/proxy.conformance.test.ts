// Side-channel proxy conformance — the HTTP lanes runners use so they carry
// zero provider secrets (Class A; no runner, the suite IS the runner). The
// rows were first read from the retired Java service's behavior, and the
// composition is held to them.
// Domain: proxy.
//
// Lanes and what this file asserts:
//   llm          — relay on the organization's own provider key, the
//                  keyless refusal, usage landing on the meter (read back
//                  through the run's, session's and organization's usage
//                  reports, the only usage reads there are), scope
//                  authorization, verbatim relay of upstream errors marked as
//                  the organization's key with the provider's retry hint,
//                  mid-stream abort, hop-by-hop header hygiene
//   cursor       — the three arms that need no upstream: host allow-list 403,
//                  scope 403, and the 403 for an organization holding no
//                  Cursor key (relay rows are `smoke`: a served call reaches
//                  Cursor itself)
//   cursor-bidi  — the handshake refusals over raw h2c, the Stigmer
//                  credential read from x-stigmer-auth alone (relay is `smoke`)
//   artifact / checkpointer — presign and storage lanes: scope, key rules,
//                  round-trips, 413 (claimcheck: debris — no caller,
//                  stigmer#992; rows kept in the inventory as `debris`)
//   model-registry, health
//
// The upstream is the run's fake LLM provider (test/support/src/fake-llm-upstream.ts):
// the server was booted with both provider base URLs pointed at it, so what
// it captures IS what the proxy forwarded, and what it is scripted to answer
// IS what the proxy relays or classifies.
//
// Authentication-class arms (401 without a bearer, foreign tokens,
// x-api-key resolution, denyAll, the required scope header) run on every
// cloud environment: the conformance environment boots the composition in its
// production posture, so they measure the real edge alongside the
// authorization arms (FGA 403).
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ProviderKeySource } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CLOUD_ENV, provisionConsolePerson, requireDirectLoginTenant } from "../harness/cloud-env";
import { createTransport, makeClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { anthropicText, openAiText } from "@stigmer/test-support/llm-wire";
import { makeAgent, agentRefOf } from "../support/agents";
import { makeAgentExecution, sessionIdOf } from "../support/runs";
import { requireCloudFixtures, type CloudFixturesClient } from "../support/cloud-fixtures-client";
import { bidiHandshake, HTTP2_REFUSED_STREAM } from "../support/cursor-bidi";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";
import { CONFORMANCE_PROVIDER_KEYS } from "../targets/cloud";
import type { ConformanceClients } from "../harness/clients";
import type { TenancyContext } from "../targets/target";
const proxyServed = createTarget().capabilities.sideChannelProxy;

let target: TargetProfile;
let clients: ConformanceClients;
let control: CloudFixturesClient;
let proxyUrl: string;
let primaryToken: string;
const fixtures = new FixtureTracker();

const EXECUTION_HEADER = "x-stigmer-execution-id";
const PROVIDER_KEY_REQUIRED_SENTINEL = "STIGMER_PROVIDER_KEY_REQUIRED";
const CURSOR_KEY_REQUIRED_COPY = "This organization has no Cursor key. An admin can add one in Settings → Provider keys.";
const ORGANIZATION_PROVIDER_KEY_SENTINEL = "STIGMER_ORGANIZATION_PROVIDER_KEY";

// An org holding the fixture provider keys (CONFORMANCE_PROVIDER_KEYS): every
// call the proxy serves for it runs on them, and its runs are admitted. Where
// the run supplies a real Cursor key (cursorRunsAdmitted), keyTenancy saves it
// too.
async function keyedOrg(): Promise<TenancyContext> {
  if (target.provisionKeylessTenancy === undefined || target.keyTenancy === undefined) {
    throw new Error(`target ${target.name} declares sideChannelProxy but lacks the provider-key seams`);
  }
  const context = await target.provisionKeylessTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));
  await target.keyTenancy(context.org);
  return context;
}

// A real, owned run in the org: the scope every proxy lane is authorized
// against, and the run the meter attributes each relayed call to. Its agent,
// conversation and UTC creation day are what the usage reports group by.
interface OwnedRun {
  readonly runId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly createdDay: string;
}

async function ownedRun(org: string): Promise<OwnedRun> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("proxy-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("proxy-exec"), agentRef: agentRefOf(agent) }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));
  const createdAt = execution.status?.audit?.specAudit?.createdAt;
  if (createdAt === undefined) throw new Error("the server stamps a run's creation instant on create");
  return {
    runId: execution.metadata!.id,
    agentId: agent.metadata!.id,
    sessionId: sessionIdOf(execution),
    // The day the reports window and bucket the run by: its creation
    // instant's UTC calendar day, read from the server so no midnight
    // between create and read can move it.
    createdDay: timestampDate(createdAt).toISOString().slice(0, 10),
  };
}

async function ownedExecution(org: string): Promise<string> {
  return (await ownedRun(org)).runId;
}

async function ownedSession(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("ckpt-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const session = await clients.sessionCommand.create(makeSession({ org, name: uniqueName("ckpt-session"), agentRef: agentRefOf(agent) }));
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));
  return session.metadata!.id;
}

function proxyFetch(path: string, init: RequestInit & { token?: string; scope?: Record<string, string> } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? primaryToken}` }),
    ...(init.scope ?? {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  return fetch(`${proxyUrl}${path}`, { ...init, headers });
}

function anthropicCall(executionId: string, body: Record<string, unknown> = {}, token?: string): Promise<Response> {
  return proxyFetch("/v1/proxy/llm/anthropic/v1/messages", {
    method: "POST",
    token,
    scope: { [EXECUTION_HEADER]: executionId },
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 64, stream: true, messages: [{ role: "user", content: "hi" }], ...body }),
  });
}

// The run's usage report once the meter holds `calls` calls for it. Usage
// reporting is asynchronous to the relayed stream, so this polls briefly;
// until the first metered call lands the report counts the run from its
// runner's report (empty here: no runner serves these runs).
async function meteredRunReport(runId: string, calls: number) {
  const deadline = Date.now() + 15_000;
  let report = await clients.agentExecutionQuery.getRunUsageReport({ runId });
  while ((report.aggregate?.llmCallCount ?? 0) < calls && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    report = await clients.agentExecutionQuery.getRunUsageReport({ runId });
  }
  return report;
}

// Whose key served the calls, as comparable tuples.
function servedBy(aggregate: { servedBy: ReadonlyArray<{ providerKeySource: ProviderKeySource; totalTokens: bigint; llmCallCount: number }> } | undefined) {
  return (aggregate?.servedBy ?? []).map((row) => [row.providerKeySource, row.totalTokens, row.llmCallCount] as const);
}

describe.skipIf(!proxyServed)("Side-channel proxy conformance (sideChannelProxy targets)", () => {
  beforeAll(async () => {
    target = createTarget();
    await target.setup();
    clients = target.clients();
    if (target.proxyBaseUrl === undefined) throw new Error(`target ${target.name} declares sideChannelProxy but provides no proxyBaseUrl()`);
    proxyUrl = target.proxyBaseUrl();
    primaryToken = process.env["STIGMER_CONFORMANCE_CLOUD_TOKEN"] ?? "";
    control = requireCloudFixtures();
  });

  afterEach(async () => {
    await fixtures.cleanup();
    await control.llm.reset();
  });

  afterAll(async () => {
    await target?.teardown();
  });

  describe("health and model registry", () => {
    it("[proxy.health.anonymous-up] GET /health answers UP without a bearer", async () => {
      const response = await proxyFetch("/health", { token: null as unknown as undefined });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "UP" });
    });

    it("[proxy.model-registry.authenticated-json-cacheable] the authenticated registry is cacheable JSON and matches the public document", async () => {
      const response = await proxyFetch("/v1/proxy/model-registry");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      expect(response.headers.get("cache-control")).toMatch(/max-age=3600/);
      const document = await response.text();
      if (target.publicBaseUrl !== undefined) {
        const pub = await fetch(`${target.publicBaseUrl()}/api/v1/public/model-registry`);
        expect(await pub.text()).toBe(document);
      }
    });

    it("[proxy.model-registry.anonymous-401] [proxy.edge.unknown-path-denied] the registry needs a bearer and unknown paths are denied at the edge", async () => {
      expect((await proxyFetch("/v1/proxy/model-registry", { token: null as unknown as undefined })).status).toBe(401);
      const denied = await proxyFetch("/actuator/env", { token: null as unknown as undefined });
      expect([401, 403]).toContain(denied.status);
    });
  });

  describe("llm lane", () => {
    it("[proxy.llm.anthropic.relays-sse-and-injects-provider-key] [proxy.llm.headers.hop-by-hop-stripped] an Anthropic stream is relayed byte for byte with the organization's key injected upstream", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      await control.llm.enqueue({
        kind: "anthropic",
        body: anthropicText("relayed", { inputTokens: 11, outputTokens: 3 }),
        // A keep-alive value NO server framing would produce on its own: Node's
        // http server advertises `timeout=5` by default on every keep-alive
        // response, so asserting on that value would read the proxy's own
        // framing as a relayed upstream header (the composition once tripped it).
        headers: { "request-id": "req_conf_1", "x-fake-upstream-request-id": "infra_1", "keep-alive": "timeout=42, max=7" },
      });

      const response = await anthropicCall(executionId);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
      // Ordinary upstream headers (Anthropic's request-id) relay; the
      // upstream's x-* infrastructure headers and hop-by-hop headers do not
      // (ProxyHeaders.isForwardableResponseHeader) — the proxy's own framing
      // is its own business.
      expect(response.headers.get("request-id")).toBe("req_conf_1");
      expect(response.headers.get("x-fake-upstream-request-id")).toBeNull();
      expect(response.headers.get("keep-alive")).not.toBe("timeout=42, max=7");
      const body = await response.text();
      expect(body).toContain("event: message_start");
      expect(body).toContain('"text":"relayed"');
      expect(body).toContain("event: message_stop");

      const upstream = (await control.llm.requests()).at(-1);
      expect(upstream?.provider).toBe("anthropic");
      expect(upstream?.headers["x-api-key"]).toBe(CONFORMANCE_PROVIDER_KEYS.anthropic);
      expect(upstream?.headers["anthropic-version"]).toBe("2023-06-01");
      expect(upstream?.headers["authorization"], "the caller's Stigmer bearer never reaches the provider").toBeUndefined();
    });

    it("[proxy.llm.openai.injects-bearer-and-include-usage] an OpenAI chat completion reaches the upstream with the organization's key as bearer and stream_options.include_usage injected", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      await control.llm.enqueue({ kind: "openai", body: openAiText("ok", { inputTokens: 7, outputTokens: 2 }) });
      const response = await proxyFetch("/v1/proxy/llm/openai/v1/chat/completions", {
        method: "POST",
        scope: { [EXECUTION_HEADER]: executionId },
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4.1", stream: true, messages: [{ role: "user", content: "hi" }] }),
      });
      expect(response.status).toBe(200);
      await response.text();
      const upstream = (await control.llm.requests()).at(-1);
      expect(upstream?.provider).toBe("openai");
      expect(upstream?.headers["authorization"]).toBe(`Bearer ${CONFORMANCE_PROVIDER_KEYS.openai}`);
      expect((upstream?.body as { stream_options?: { include_usage?: boolean } }).stream_options?.include_usage).toBe(true);
    });

    it("[proxy.llm.usage.anthropic-sse-usage-lands] [proxy.llm.usage.openai-final-chunk-usage-lands] [billing.rpc.get-run-usage-report.reads-metered-tokens] [billing.rpc.get-org-usage-report.metered-totals-and-top-agents] [rpc:RunQueryController.getRunUsageReport] [rpc:RunQueryController.getSessionUsageReport] [rpc:RunQueryController.getOrgUsageReport] usage extracted from both providers' wire is counted on the run's, the conversation's and the organization's usage reports, metered on the organization's key", async () => {
      const { org } = await keyedOrg();
      const run = await ownedRun(org);
      const executionId = run.runId;

      await control.llm.enqueue({ kind: "anthropic", body: anthropicText("a", { inputTokens: 100, outputTokens: 50 }) });
      await (await anthropicCall(executionId)).text();
      await control.llm.enqueue({ kind: "openai", body: openAiText("b", { inputTokens: 30, outputTokens: 20 }) });
      await (
        await proxyFetch("/v1/proxy/llm/openai/v1/chat/completions", {
          method: "POST",
          scope: { [EXECUTION_HEADER]: executionId },
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "gpt-4.1", stream: true, messages: [] }),
        })
      ).text();
      await control.llm.enqueue({ kind: "openai", body: openAiText("c", { inputTokens: 5, outputTokens: 5 }) });
      await (
        await proxyFetch("/v1/proxy/llm/openai/v1/chat/completions", {
          method: "POST",
          scope: { [EXECUTION_HEADER]: executionId },
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "gpt-4.1", messages: [] }),
        })
      ).text();

      // The run's report reads the meter: three calls and every token the
      // three wires carried (100+50, 30+20, 5+5), all served on the
      // organization's own key.
      const report = await meteredRunReport(executionId, 3);
      expect(report.aggregate?.llmCallCount).toBe(3);
      expect(report.aggregate?.inputTokens).toBe(135n);
      expect(report.aggregate?.outputTokens).toBe(75n);
      expect(report.aggregate?.totalTokens, "an Anthropic call's tokens count toward the total though its wire carries no total").toBe(210n);
      expect(servedBy(report.aggregate)).toEqual([[ProviderKeySource.ORGANIZATION, 210n, 3]]);
      expect(report.modelBreakdown.reduce((sum, model) => sum + model.callCount, 0), "the breakdown counts every call").toBe(3);
      expect(report.modelBreakdown.reduce((sum, model) => sum + model.totalTokens, 0n), "the breakdown sums to the total").toBe(210n);

      // A metered run is counted from the meter, never estimated.
      const session = await clients.agentExecutionQuery.getSessionUsageReport({ sessionId: run.sessionId });
      expect(session.isEstimated).toBe(false);
      expect(session.runs.map((r) => [r.runId, r.isEstimated, r.totalTokens])).toEqual([[executionId, false, 210n]]);

      // The organization's report over the run's own day holds it, its agent
      // at the top by tokens, and one daily row.
      const orgReport = await clients.agentExecutionQuery.getOrgUsageReport({ org, fromDate: run.createdDay, toDate: run.createdDay });
      expect(orgReport.totalRuns).toBe(1);
      expect(orgReport.totalUsage?.totalTokens).toBe(210n);
      expect(orgReport.totalUsage?.llmCallCount).toBe(3);
      expect(servedBy(orgReport.totalUsage)).toEqual([[ProviderKeySource.ORGANIZATION, 210n, 3]]);
      expect(orgReport.topAgents.map((a) => [a.agentId, a.runCount, a.totalTokens])).toEqual([[run.agentId, 1, 210n]]);
      expect(orgReport.dailyUsage.map((d) => [d.date, d.runCount, d.totalTokens, d.llmCallCount])).toEqual([[run.createdDay, 1, 210n, 3]]);
    });

    it("[proxy.llm.unknown-provider-400] an unknown provider answers 400 without touching the upstream", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      const response = await proxyFetch("/v1/proxy/llm/mistral/v1/chat", { method: "POST", scope: { [EXECUTION_HEADER]: executionId }, body: "{}" });
      expect(response.status).toBe(400);
      expect(await control.llm.requests()).toEqual([]);
    });

    it("[proxy.llm.scope.foreign-execution-403] a scope naming an execution the caller cannot edit answers 403 and never reaches the upstream", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      const token = await mintOutsiderToken();
      const response = await anthropicCall(executionId, {}, token);
      expect(response.status).toBe(403);
      expect(await control.llm.requests()).toEqual([]);
    });

    it("[proxy.llm.scope.missing-scope-header-403-when-required] [proxy.llm.authn.no-bearer-401] [proxy.llm.authn.foreign-or-expired-token-401] [proxy.llm.authn.x-api-key-header-accepted] the edge's authentication and require-scope arms", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      expect((await proxyFetch("/v1/proxy/llm/anthropic/v1/messages", { method: "POST", body: "{}", token: null as unknown as undefined })).status).toBe(401);
      expect((await anthropicCall(executionId, {}, "eyJ.not.a-token")).status).toBe(401);
      expect((await proxyFetch("/v1/proxy/llm/anthropic/v1/messages", { method: "POST", body: "{}" })).status).toBe(403);
      await control.llm.enqueue({ kind: "anthropic", body: anthropicText("via-x-api-key") });
      const viaApiKey = await fetch(`${proxyUrl}/v1/proxy/llm/anthropic/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": primaryToken, [EXECUTION_HEADER]: executionId, "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", stream: true, messages: [] }),
      });
      expect(viaApiKey.status).toBe(200);
    });

    it("[proxy.llm.provider-key.keyless-403-sentinel] a call for a provider the organization holds no key for answers 403 with the sentinel and x-should-retry false, and never reaches the upstream", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      // The key is removed after the run was admitted: the proxy is the
      // backstop for every call the admission check could not see.
      await clients.providerKeyCommand.delete({ org, provider: "anthropic" });
      await control.llm.reset();

      const response = await anthropicCall(executionId);
      expect(response.status).toBe(403);
      expect(response.headers.get("x-should-retry")).toBe("false");
      expect(response.headers.get("content-type")).toMatch(/application\/json/);
      const body = (await response.json()) as { type: string; error: { type: string; message: string } };
      expect(body.type, "the refusal is Anthropic-shaped, so the provider SDK reads it").toBe("error");
      expect(body.error.message).toContain(PROVIDER_KEY_REQUIRED_SENTINEL);
      expect(await control.llm.requests()).toEqual([]);
    });

    it("[proxy.llm.upstream.organization-key-failures-relayed-marked] an upstream 401, 403, 429 or billing failure on the organization's key is relayed with its status, never rewritten, and marked as the organization's key", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      const cases: Array<{ status: number; body: unknown; provider: "anthropic" | "openai" }> = [
        { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, provider: "anthropic" },
        { status: 403, body: { error: { message: "forbidden" } }, provider: "openai" },
        { status: 429, body: { error: { type: "insufficient_quota", code: "insufficient_quota", message: "quota" } }, provider: "openai" },
        { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, provider: "anthropic" },
      ];
      for (const c of cases) {
        await control.llm.enqueue({ kind: "error", status: c.status, body: c.body });
        const response =
          c.provider === "anthropic"
            ? await anthropicCall(executionId)
            : await proxyFetch("/v1/proxy/llm/openai/v1/chat/completions", { method: "POST", scope: { [EXECUTION_HEADER]: executionId }, headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-4.1", stream: true, messages: [] }) });
        expect(response.status, `${c.provider} ${c.status}`).toBe(c.status);
        expect(await response.text(), `${c.provider} ${c.status}`).toContain(ORGANIZATION_PROVIDER_KEY_SENTINEL);
      }
    });

    it("[proxy.llm.upstream.other-errors-relayed-verbatim] an upstream error is relayed with its status and the provider's message", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      await control.llm.enqueue({ kind: "error", status: 404, body: { type: "error", error: { type: "not_found_error", message: "model not found" } } });
      const notFound = await anthropicCall(executionId);
      expect(notFound.status).toBe(404);
      expect(await notFound.text()).toContain("model not found");
      await control.llm.enqueue({ kind: "error", status: 429, body: { error: { type: "rate_limit_error", message: "slow down" } } });
      const plain429 = await anthropicCall(executionId);
      expect(plain429.status, "a plain 429 is transient and passes through").toBe(429);
    });

    it("[proxy.llm.upstream.retry-hint-relayed] an upstream 429 or 5xx is relayed with the provider's retry-after and retry-after-ms, and no x-* header", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      for (const status of [429, 529]) {
        await control.llm.enqueue({
          kind: "error",
          status,
          headers: { "retry-after": "7", "retry-after-ms": "6500", "x-should-retry": "true" },
          body: { type: "error", error: { type: status === 429 ? "rate_limit_error" : "overloaded_error", message: "slow down" } },
        });
        const response = await anthropicCall(executionId);
        expect(response.status).toBe(status);
        expect(response.headers.get("retry-after"), `${status}`).toBe("7");
        expect(response.headers.get("retry-after-ms"), `${status}`).toBe("6500");
        expect(response.headers.get("x-should-retry"), `${status}: no x-* header relays`).toBeNull();
        await response.text();
      }
      await control.llm.enqueue({ kind: "error", status: 429, body: { error: { type: "rate_limit_error", message: "no hint" } } });
      const bare = await anthropicCall(executionId);
      expect(bare.headers.get("retry-after"), "an answer without a hint gains none").toBeNull();
      await bare.text();
    });

    it("[proxy.llm.upstream.aborted-mid-stream-truncates-and-records-partial-usage] an upstream cut mid-stream ends the relayed stream early and records the usage seen so far", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      // message_start (input tokens) and one content_block_start arrive; the
      // socket dies before message_delta carries output tokens.
      await control.llm.enqueue({ kind: "abort-mid-stream", body: anthropicText("cut", { inputTokens: 40, outputTokens: 40 }), afterEvents: 2 });
      const response = await anthropicCall(executionId);
      const text = await response.text().catch(() => "");
      expect(text).not.toContain("event: message_stop");
      const report = await meteredRunReport(executionId, 1);
      expect(report.aggregate?.llmCallCount, "the partial call is recorded — the input tokens it saw — rather than dropped").toBe(1);
      expect(report.aggregate?.inputTokens).toBe(40n);
      expect(report.aggregate?.outputTokens, "no message_delta, no output tokens").toBe(0n);
    });
  });

  describe("cursor lanes", () => {
    it("[proxy.cursor.host-allow-list-403] a host outside the allow-list answers 403", async () => {
      const response = await proxyFetch("/v1/proxy/cursor/evil.example.com/v1/models", { method: "GET" });
      expect(response.status).toBe(403);
    });

    it("[proxy.cursor.scope.foreign-execution-403] a scoped Cursor call on a foreign execution answers 403", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      const token = await mintOutsiderToken();
      const response = await proxyFetch("/v1/proxy/cursor/api2.cursor.sh/aiserver.v1.AgentService/Run", {
        method: "POST",
        token,
        scope: { [EXECUTION_HEADER]: executionId },
        body: "",
      });
      expect(response.status).toBe(403);
    });

    it("[proxy.cursor.provider-key-required-403] an authorized call for an organization holding no Cursor key answers 403 with the Connect-shaped body and the sentinel", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      // The org's native run is admitted on the fixture keys; a Cursor key
      // the run supplied is removed, so the org holds none.
      if (target.capabilities.cursorRunsAdmitted) {
        await clients.providerKeyCommand.delete({ org, provider: "cursor" });
      }
      const response = await proxyFetch("/v1/proxy/cursor/api2.cursor.sh/aiserver.v1.AgentService/Run", {
        method: "POST",
        scope: { [EXECUTION_HEADER]: executionId },
        headers: { "content-type": "application/proto" },
        body: "",
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).toMatch(/application\/json/);
      const body = (await response.json()) as { code: string; message: string };
      expect(body.code).toBe("permission_denied");
      expect(body.message).toContain(PROVIDER_KEY_REQUIRED_SENTINEL);
      expect(body.message).toContain(CURSOR_KEY_REQUIRED_COPY);
    });

    it("[proxy.cursor-bidi.missing-token-refused-stream] [proxy.cursor-bidi.authn-failure-401-code-16] [proxy.cursor-bidi.fga-denied-403-code-7] the bidi handshake refuses the three ways it must", async () => {
      if (target.cursorBidiBaseUrl === undefined) throw new Error("cursorBidiBaseUrl missing on a sideChannelProxy target");
      const bidi = target.cursorBidiBaseUrl();
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);

      const missing = await bidiHandshake(bidi, {});
      expect(missing.kind).toBe("reset");
      expect(missing.rstCode).toBe(HTTP2_REFUSED_STREAM);

      // A valid Stigmer token anywhere but x-stigmer-auth is no credential
      // here: the stream's authorization is the Cursor access token it
      // forwards upstream.
      const elsewhere = await bidiHandshake(bidi, {
        headers: { authorization: `Bearer ${primaryToken}`, "x-api-key": primaryToken, [EXECUTION_HEADER]: executionId },
      });
      expect(elsewhere.kind, "a Stigmer token outside x-stigmer-auth").toBe("reset");
      expect(elsewhere.rstCode).toBe(HTTP2_REFUSED_STREAM);

      const foreignToken = await bidiHandshake(bidi, { headers: { "x-stigmer-auth": "Bearer not.a.token", [EXECUTION_HEADER]: executionId } });
      expect(foreignToken.kind).toBe("headers");
      expect(foreignToken.status).toBe(401);
      expect(foreignToken.grpcStatus).toBe(16);
      expect(foreignToken.grpcMessage).toBe("Authentication failed");
      expect(foreignToken.contentType).toMatch(/application\/grpc/);

      const outsiderToken = await mintOutsiderToken();
      const denied = await bidiHandshake(bidi, { headers: { "x-stigmer-auth": `Bearer ${outsiderToken}`, [EXECUTION_HEADER]: executionId } });
      expect(denied.kind).toBe("headers");
      expect(denied.status).toBe(403);
      expect(denied.grpcStatus).toBe(7);
      expect(denied.grpcMessage).toBe("Access denied");
    });
  });

  describe("storage lanes", () => {
    it("[proxy.artifact.presign-by-key-shape-and-permission] artifact presigns are authorized by the execution id inside the key", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      const upload = await proxyFetch("/v1/proxy/artifacts/presigned-upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: `artifacts/${executionId}/out.txt`, content_type: "text/plain" }),
      });
      expect(upload.status).toBe(200);
      const download = await proxyFetch("/v1/proxy/artifacts/presigned-download-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: `artifacts/${executionId}/out.txt` }),
      });
      expect(download.status).toBe(200);
      const token = await mintOutsiderToken();
      const foreign = await proxyFetch("/v1/proxy/artifacts/presigned-upload-url", {
        method: "POST",
        token,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: `artifacts/${executionId}/out.txt`, content_type: "text/plain" }),
      });
      expect(foreign.status).toBe(403);
    });

    it("[proxy.artifact.key-rules-and-mime] artifact keys and content types are validated before authorization", async () => {
      const { org } = await keyedOrg();
      const executionId = await ownedExecution(org);
      const badKeys = ["", `artifacts/${executionId}/../escape`, `artifacts/${executionId}//double`, "other/prefix/x", `attachments/${uniqueName("att")}/in.txt`, `artifacts/${executionId}/${"k".repeat(1100)}`, `artifacts/${executionId}/bad char`];
      for (const key of badKeys) {
        const response = await proxyFetch("/v1/proxy/artifacts/presigned-upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, content_type: "text/plain" }),
        });
        expect(response.status, JSON.stringify(key).slice(0, 50)).toBe(400);
      }
      const badMime = await proxyFetch("/v1/proxy/artifacts/presigned-upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: `artifacts/${executionId}/x.bin`, content_type: "not a mime" }),
      });
      expect(badMime.status).toBe(400);
    });

    it("[proxy.checkpointer.round-trip-by-session-scope] [proxy.checkpointer.foreign-session-403] [proxy.checkpointer.document-over-4mb-413] checkpoints round-trip for the session's owner, refuse outsiders, and refuse oversized documents", async () => {
      const { org } = await keyedOrg();
      const sessionId = await ownedSession(org);
      const threadId = `thread-${sessionId}`;
      const checkpointId = uniqueName("ckpt");
      const document = { thread_id: threadId, checkpoint_ns: "", checkpoint_id: checkpointId, checkpoint: { v: 1, ts: "now" }, metadata: { step: 1 } };

      const put = await proxyFetch("/v1/proxy/checkpoints/checkpoint", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(document) });
      // A bodiless ok(): the contract pinned is "2xx, no body" (the retired
      // Java service answered 204 or 200 run to run), recorded on the
      // inventory row; the composition answers 200.
      expect([200, 204]).toContain(put.status);
      const get = await proxyFetch(`/v1/proxy/checkpoints/checkpoint?thread_id=${threadId}&checkpoint_id=${checkpointId}`);
      expect(get.status).toBe(200);
      expect(((await get.json()) as { checkpoint_id: string }).checkpoint_id).toBe(checkpointId);
      const list = await proxyFetch(`/v1/proxy/checkpoints/checkpoints?thread_id=${threadId}`);
      expect(list.status).toBe(200);
      expect(JSON.stringify(await list.json())).toContain(checkpointId);

      const writes = { writes: [{ thread_id: threadId, checkpoint_ns: "", checkpoint_id: checkpointId, task_id: "t1", idx: 0, channel: "c", value: { x: 1 } }] };
      expect([200, 204]).toContain((await proxyFetch("/v1/proxy/checkpoints/writes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(writes) })).status);
      const gotWrites = await proxyFetch(`/v1/proxy/checkpoints/writes?thread_id=${threadId}&checkpoint_id=${checkpointId}`);
      expect(gotWrites.status).toBe(200);

      const token = await mintOutsiderToken();
      expect((await proxyFetch(`/v1/proxy/checkpoints/checkpoint?thread_id=${threadId}`, { token })).status).toBe(403);
      expect((await proxyFetch("/v1/proxy/checkpoints/checkpoint", { method: "PUT", token, headers: { "content-type": "application/json" }, body: JSON.stringify(document) })).status).toBe(403);

      const huge = JSON.stringify({ ...document, checkpoint: { blob: "z".repeat(4 * 1024 * 1024 + 1) } });
      expect((await proxyFetch("/v1/proxy/checkpoints/checkpoint", { method: "PUT", headers: { "content-type": "application/json" }, body: huge })).status).toBe(413);

      expect((await proxyFetch(`/v1/proxy/checkpoints/thread?thread_id=${threadId}`, { method: "DELETE" })).status).toBe(204);
      const afterDelete = await proxyFetch(`/v1/proxy/checkpoints/checkpoints?thread_id=${threadId}`);
      expect(JSON.stringify(await afterDelete.json())).not.toContain(checkpointId);
    });
  });
});

// A fresh outsider's bearer: a console person the environment's tenant signs
// in, as CloudTarget.provisionIdentity makes one, but returning the token
// itself because the HTTP lanes need the raw bearer rather than gRPC clients.
async function mintOutsiderToken(): Promise<string> {
  const address = process.env[CLOUD_ENV.address] ?? "";
  if (address === "") {
    throw new Error(`the proxy suite needs ${CLOUD_ENV.address} to mint an outsider`);
  }
  const presenting = (token: string) => makeClients(createTransport(address, { bearerToken: token }));
  return (await provisionConsolePerson(requireDirectLoginTenant(), presenting)).token;
}
