// Side-channel proxy conformance — the HTTP lanes runners use so they carry
// zero provider secrets (Class A; no runner, the suite IS the runner). E1 of
// the DD-012 reset (entry 20260906.04): Java's behavior is the spec; the
// composition's reds are C6's acceptance.
// Domain: proxy.
//
// Lanes and what this file asserts:
//   llm          — relay + provider-key injection, usage landing in the
//                  ledger, scope authorization, the platform-error rewrite to
//                  503, verbatim relay of other upstream errors, mid-stream
//                  abort, hop-by-hop header hygiene
//   cursor       — the three arms that need no upstream: host allow-list 403,
//                  scope 403, pool-exhausted 503 (relay rows are `smoke`)
//   cursor-bidi  — the handshake refusals over raw h2c (relay is `smoke`)
//   artifact / checkpointer — presign and storage lanes: scope, key rules,
//                  round-trips, 413 (claimcheck: ruled debris at C6's gate —
//                  no caller, stigmer#992; rows kept in the inventory as `debris`)
//   model-registry, health
//
// The upstream is the run's fake LLM provider (harness/fake-llm-upstream.ts):
// the server was booted with both provider base URLs pointed at it, so what
// it captures IS what the proxy forwarded, and what it is scripted to answer
// IS what the proxy relays or classifies.
//
// Authentication-class arms (401 without a bearer, foreign tokens,
// x-api-key resolution, denyAll, require-scope-header) are unobservable in the
// hermetic launcher's test security mode (HttpSecurityConfig is not loaded)
// and skip through edgeAuthenticationBypass() until the launcher entry runs
// production security (ruling Q1). Authorization arms (FGA 403) ARE observable
// there and run.
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CLOUD_ENV, mintCloudUserToken } from "../harness/cloud-env";
import { FixtureTracker } from "../harness/fixtures";
import { anthropicText, openAiText } from "../harness/llm-wire";
import { makeAgent } from "../support/agents";
import { makeAgentExecution } from "../support/agentexecutions";
import { requireCloudFixtures, type CloudFixturesClient } from "../support/cloud-fixtures-client";
import { bidiHandshake, HTTP2_REFUSED_STREAM } from "../support/cursor-bidi";
import { makeMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { makeWorkflow } from "../support/workflows";
import { makeWorkflowExecution } from "../support/workflowexecutions";
import { createTarget, type TargetProfile } from "../targets";
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
const WORKFLOW_EXECUTION_HEADER = "x-stigmer-workflow-execution-id";
const MCP_SERVER_HEADER = "x-stigmer-mcp-server-id";
const PLATFORM_CAPACITY_SENTINEL = "STIGMER_PLATFORM_MODEL_CAPACITY";

function skipIfEdgeBypassed(ctx: { skip: (note?: string) => never }): void {
  const reason = target.edgeAuthenticationBypass?.();
  if (reason !== undefined) ctx.skip(reason);
}

async function fundedOrg(): Promise<TenancyContext> {
  if (target.provisionUnfundedTenancy === undefined || target.fundTenancy === undefined) {
    throw new Error(`target ${target.name} declares sideChannelProxy but lacks the billing seams`);
  }
  const context = await target.provisionUnfundedTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));
  await target.fundTenancy(context.org);
  return context;
}

// A real, owned agent execution in the org: the scope every proxy lane is
// authorized against. In a funded org the workflow-side reserve authorizes
// it, so usage recorded against it is metered.
async function ownedExecution(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("proxy-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("proxy-exec"), agentId: agent.metadata!.id }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));
  return execution.metadata!.id;
}

async function ownedSession(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("ckpt-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const instanceId = agent.status?.defaultInstanceId ?? "";
  const session = await clients.sessionCommand.create(makeSession({ org, name: uniqueName("ckpt-session"), agentInstanceId: instanceId }));
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));
  return session.metadata!.id;
}

async function ownedWorkflowExecution(org: string): Promise<string> {
  const workflow = await clients.workflowCommand.create(makeWorkflow({ org, name: uniqueName("cc-flow") }));
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  const execution = await clients.workflowExecutionCommand.create(
    makeWorkflowExecution({ org, name: uniqueName("cc-exec"), workflowId: workflow.metadata!.id }),
  );
  fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: execution.metadata!.id }));
  return execution.metadata!.id;
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

async function usageReport(org: string) {
  return clients.billingQuery.getBillingUsageReport({
    orgId: org,
    startTime: timestampFromDate(new Date(Date.now() - 3600_000)),
    endTime: timestampFromDate(new Date(Date.now() + 3600_000)),
  });
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

    it("[proxy.model-registry.anonymous-401] [proxy.edge.unknown-path-denied] the registry needs a bearer and unknown paths are denied at the edge", async (ctx) => {
      skipIfEdgeBypassed(ctx);
      expect((await proxyFetch("/v1/proxy/model-registry", { token: null as unknown as undefined })).status).toBe(401);
      const denied = await proxyFetch("/actuator/env", { token: null as unknown as undefined });
      expect([401, 403]).toContain(denied.status);
    });
  });

  describe("llm lane", () => {
    it("[proxy.llm.anthropic.relays-sse-and-injects-provider-key] [proxy.llm.headers.hop-by-hop-stripped] an Anthropic stream is relayed byte for byte with the platform key injected upstream", async () => {
      const { org } = await fundedOrg();
      const executionId = await ownedExecution(org);
      await control.llm.enqueue({
        kind: "anthropic",
        body: anthropicText("relayed", { inputTokens: 11, outputTokens: 3 }),
        headers: { "request-id": "req_conf_1", "x-fake-upstream-request-id": "infra_1", "keep-alive": "timeout=5" },
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
      expect(response.headers.get("keep-alive")).not.toBe("timeout=5");
      const body = await response.text();
      expect(body).toContain("event: message_start");
      expect(body).toContain('"text":"relayed"');
      expect(body).toContain("event: message_stop");

      const upstream = (await control.llm.requests()).at(-1);
      expect(upstream?.provider).toBe("anthropic");
      expect(upstream?.headers["x-api-key"]).toBe("sk-ant-conformance-platform-key");
      expect(upstream?.headers["anthropic-version"]).toBe("2023-06-01");
      expect(upstream?.headers["authorization"], "the caller's Stigmer bearer never reaches the provider").toBeUndefined();
    });

    it("[proxy.llm.openai.injects-bearer-and-include-usage] an OpenAI chat completion reaches the upstream with the platform bearer and stream_options.include_usage injected", async () => {
      const { org } = await fundedOrg();
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
      expect(upstream?.headers["authorization"]).toBe("Bearer sk-conformance-openai-platform-key");
      expect((upstream?.body as { stream_options?: { include_usage?: boolean } }).stream_options?.include_usage).toBe(true);
    });

    it("[proxy.llm.usage.anthropic-sse-usage-lands-in-ledger] [proxy.llm.usage.openai-final-chunk-usage-lands] usage extracted from both providers' wire lands on the org's usage report", async () => {
      const { org } = await fundedOrg();
      const executionId = await ownedExecution(org);
      const before = await usageReport(org);

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

      // Usage reporting is asynchronous to the relayed stream; poll briefly.
      const deadline = Date.now() + 15_000;
      let after = await usageReport(org);
      while (after.llmCallCount < before.llmCallCount + 3 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        after = await usageReport(org);
      }
      expect(after.llmCallCount).toBe(before.llmCallCount + 3);
      expect(after.executionCount).toBe(1);
    });

    it("[proxy.llm.usage.mcp-scope-authorized-not-metered] an MCP-server scope is authorized but records no usage", async () => {
      const { org } = await fundedOrg();
      const mcp = await clients.mcpServerCommand.create(makeMcpServer({ org, name: uniqueName("mcp") }));
      fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: mcp.metadata!.id }));
      const before = await usageReport(org);
      await control.llm.enqueue({ kind: "anthropic", body: anthropicText("mcp", { inputTokens: 9, outputTokens: 9 }) });
      const response = await proxyFetch("/v1/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        scope: { [MCP_SERVER_HEADER]: mcp.metadata!.id },
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", stream: true, messages: [] }),
      });
      expect(response.status).toBe(200);
      await response.text();
      await new Promise((r) => setTimeout(r, 1500));
      expect((await usageReport(org)).llmCallCount).toBe(before.llmCallCount);
    });

    it("[proxy.llm.scope.workflow-execution-can-edit] a workflow-execution scope the caller can edit is relayed", async () => {
      const { org } = await fundedOrg();
      const workflowExecutionId = await ownedWorkflowExecution(org);
      await control.llm.enqueue({ kind: "anthropic", body: anthropicText("wf") });
      const response = await proxyFetch("/v1/proxy/llm/anthropic/v1/messages", {
        method: "POST",
        scope: { [WORKFLOW_EXECUTION_HEADER]: workflowExecutionId },
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", stream: true, messages: [] }),
      });
      expect(response.status).toBe(200);
      await response.text();
    });

    it("[proxy.llm.unknown-provider-400] an unknown provider answers 400 without touching the upstream", async () => {
      const { org } = await fundedOrg();
      const executionId = await ownedExecution(org);
      const response = await proxyFetch("/v1/proxy/llm/mistral/v1/chat", { method: "POST", scope: { [EXECUTION_HEADER]: executionId }, body: "{}" });
      expect(response.status).toBe(400);
      expect(await control.llm.requests()).toEqual([]);
    });

    it("[proxy.llm.scope.foreign-execution-403] a scope naming an execution the caller cannot edit answers 403 and never reaches the upstream", async () => {
      const { org } = await fundedOrg();
      const executionId = await ownedExecution(org);
      const token = await mintOutsiderToken();
      const response = await anthropicCall(executionId, {}, token);
      expect(response.status).toBe(403);
      expect(await control.llm.requests()).toEqual([]);
    });

    it("[proxy.llm.scope.missing-scope-header-403-when-required] [proxy.llm.authn.no-bearer-401] [proxy.llm.authn.foreign-or-expired-token-401] [proxy.llm.authn.x-api-key-header-accepted] the edge's authentication and require-scope arms", async (ctx) => {
      skipIfEdgeBypassed(ctx);
      const { org } = await fundedOrg();
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

    it("[proxy.llm.upstream.platform-auth-rewritten-503] [proxy.llm.upstream.platform-billing-rewritten-503] platform-attributed upstream failures are rewritten to 503 with the sentinel and x-should-retry false", async () => {
      const { org } = await fundedOrg();
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
        expect(response.status, `${c.provider} ${c.status}`).toBe(503);
        expect(response.headers.get("x-should-retry"), `${c.provider} ${c.status}`).toBe("false");
        expect(response.headers.get("content-type")).toMatch(/application\/json/);
        expect(await response.text()).toContain(PLATFORM_CAPACITY_SENTINEL);
      }
    });

    it("[proxy.llm.upstream.other-errors-relayed-verbatim] a non-platform upstream error is relayed with its status and body", async () => {
      const { org } = await fundedOrg();
      const executionId = await ownedExecution(org);
      await control.llm.enqueue({ kind: "error", status: 404, body: { type: "error", error: { type: "not_found_error", message: "model not found" } } });
      const notFound = await anthropicCall(executionId);
      expect(notFound.status).toBe(404);
      expect(await notFound.text()).toContain("model not found");
      await control.llm.enqueue({ kind: "error", status: 429, body: { error: { type: "rate_limit_error", message: "slow down" } } });
      const plain429 = await anthropicCall(executionId);
      expect(plain429.status, "a plain 429 is transient and passes through").toBe(429);
    });

    it("[proxy.llm.upstream.aborted-mid-stream-truncates-and-records-partial-usage] an upstream cut mid-stream ends the relayed stream early and records the usage seen so far", async () => {
      const { org } = await fundedOrg();
      const executionId = await ownedExecution(org);
      const before = await usageReport(org);
      // message_start (input tokens) and one content_block_start arrive; the
      // socket dies before message_delta carries output tokens.
      await control.llm.enqueue({ kind: "abort-mid-stream", body: anthropicText("cut", { inputTokens: 40, outputTokens: 40 }), afterEvents: 2 });
      const response = await anthropicCall(executionId);
      const text = await response.text().catch(() => "");
      expect(text).not.toContain("event: message_stop");
      const deadline = Date.now() + 10_000;
      let after = await usageReport(org);
      while (after.llmCallCount < before.llmCallCount + 1 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        after = await usageReport(org);
      }
      expect(after.llmCallCount, "Java records the partial call — the input tokens it saw — rather than dropping it").toBe(before.llmCallCount + 1);
    });
  });

  describe("cursor lanes", () => {
    it("[proxy.cursor.host-allow-list-403] a host outside the allow-list answers 403", async () => {
      const response = await proxyFetch("/v1/proxy/cursor/evil.example.com/v1/models", { method: "GET" });
      expect(response.status).toBe(403);
    });

    it("[proxy.cursor.scope.foreign-execution-403] a scoped Cursor call on a foreign execution answers 403", async () => {
      const { org } = await fundedOrg();
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

    it("[proxy.cursor.pool-exhausted-503-connect-body] with no Cursor account for the org, an authorized call answers 503 with the Connect-shaped body", async () => {
      const { org } = await fundedOrg();
      const executionId = await ownedExecution(org);
      const response = await proxyFetch("/v1/proxy/cursor/api2.cursor.sh/aiserver.v1.AgentService/Run", {
        method: "POST",
        scope: { [EXECUTION_HEADER]: executionId },
        headers: { "content-type": "application/proto" },
        body: "",
      });
      expect(response.status).toBe(503);
      const body = (await response.json()) as { code: string; message: string };
      expect(body.code).toBe("unavailable");
      expect(body.message).not.toBe("");
    });

    it("[proxy.cursor-bidi.missing-token-refused-stream] [proxy.cursor-bidi.authn-failure-401-code-16] [proxy.cursor-bidi.fga-denied-403-code-7] the bidi handshake refuses the three ways it must", async () => {
      if (target.cursorBidiBaseUrl === undefined) throw new Error("cursorBidiBaseUrl missing on a sideChannelProxy target");
      const bidi = target.cursorBidiBaseUrl();
      const { org } = await fundedOrg();
      const executionId = await ownedExecution(org);

      const missing = await bidiHandshake(bidi, {});
      expect(missing.kind).toBe("reset");
      expect(missing.rstCode).toBe(HTTP2_REFUSED_STREAM);

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
    it("[proxy.artifact.presign-by-key-shape-and-permission] artifact presigns are authorized by the execution id inside the key; attachments need only authentication", async () => {
      const { org } = await fundedOrg();
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
      const attachment = await proxyFetch("/v1/proxy/artifacts/presigned-upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: `attachments/${uniqueName("att")}/in.txt`, content_type: "text/plain" }),
      });
      expect(attachment.status).toBe(200);
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
      const { org } = await fundedOrg();
      const executionId = await ownedExecution(org);
      const badKeys = ["", `artifacts/${executionId}/../escape`, `artifacts/${executionId}//double`, "other/prefix/x", `artifacts/${executionId}/${"k".repeat(1100)}`, `artifacts/${executionId}/bad char`];
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
      const { org } = await fundedOrg();
      const sessionId = await ownedSession(org);
      const threadId = `thread-${sessionId}`;
      const checkpointId = uniqueName("ckpt");
      const document = { thread_id: threadId, checkpoint_ns: "", checkpoint_id: checkpointId, checkpoint: { v: 1, ts: "now" }, metadata: { step: 1 } };

      const put = await proxyFetch("/v1/proxy/checkpoints/checkpoint", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(document) });
      // A bodiless ok(): Java answered 204 on one hermetic run and 200 on the
      // next for the identical request, so the contract pinned is "2xx, no
      // body" — recorded on the inventory row; C6 answers 200.
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

// A fresh outsider's bearer: minted through the bootstrap PlatformClient the
// same way CloudTarget.provisionIdentity mints, but returning the token itself
// because the HTTP lanes need the raw bearer rather than gRPC clients.
async function mintOutsiderToken(): Promise<string> {
  const address = process.env[CLOUD_ENV.address] ?? "";
  const clientId = process.env[CLOUD_ENV.platformClientId] ?? "";
  const clientSecret = process.env[CLOUD_ENV.platformClientSecret] ?? "";
  if (address === "" || clientId === "" || clientSecret === "") {
    throw new Error("the proxy suite needs CLOUD_ENV.platformClientId/Secret to mint an outsider");
  }
  return mintCloudUserToken(address, { clientId, clientSecret }, uniqueName("conf-proxy-outsider"));
}
