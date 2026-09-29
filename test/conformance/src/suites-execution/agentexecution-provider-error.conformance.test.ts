// Conformance suite for provider-error ATTRIBUTION on a failed AgentExecution:
// when the model call behind the platform proxy fails, whose fault does
// status.error say it is?
// Domain: agentic / agentexecution — the failure copy a customer reads.
//
// In proxy mode the platform holds the provider key, so a provider billing or
// capacity fault is the PLATFORM's fault: the customer's credits were never
// charged and there is nothing for them to fix at the provider. The runner's
// classifier (shared/model-error.ts) rewrites such a failure to the stable
// LLM_PLATFORM_CAPACITY code with platform-attributed wording, and Anthropic's
// own console prose ("Plans & Billing", "credit balance is too low") must never
// reach the customer — the stigmer/stigmer#330 incident, where it did.
//
// Two shapes are scripted byte-exact on the mock (DD-001; the Go offline
// suite's provider_error_attribution_offline_test.go):
// - the proxy's own rewrite — a 503 carrying the STIGMER_PLATFORM_MODEL_CAPACITY
//   sentinel in a provider-native envelope and the `x-should-retry: false` hint
//   both SDKs honor, so a single turn fails the run fast;
// - the raw Anthropic billing 400 a version-skewed proxy would relay verbatim,
//   where the runner-side classifier is the defense in depth.
// Both must land as the same platform-attributed error, on status.error AND
// in every transcript message.
//
// Two more arms are classified by their HTTP status, not their text: a
// provider 401 on the platform's key, and a 401 on an organization's own key
// (the body the cloud proxy authors for a call it served on that key, whose
// message carries the organization-key sentinel). A status reaches the
// classifier only if its walk down the error's `cause` chain gets past every
// MiddlewareError LangChain wraps it in, one per model-call middleware of the
// turn, to the provider SDK's error (stigmer/stigmer#1450). A 401 is not
// retried, and both are scripted `persistent` so the turn's call, not a side
// call, is the one that fails the run.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// Lockstep with the runner's PLATFORM_CAPACITY_SENTINEL (shared/model-error.ts)
// and stigmer-cloud's PlatformProviderErrorClassifier.SENTINEL_CODE: the code
// the proxy's rewrite carries in its message text.
const PLATFORM_CAPACITY_SENTINEL = "STIGMER_PLATFORM_MODEL_CAPACITY";
// The stable code the runner's classifier stamps on the failure.
const PLATFORM_CAPACITY_CODE = "LLM_PLATFORM_CAPACITY";
// Lockstep with the runner's ORGANIZATION_PROVIDER_KEY_SENTINEL
// (shared/model-error.ts) and the cloud proxy's organization-key error body:
// the call was served on the organization's own provider key.
const ORGANIZATION_PROVIDER_KEY_SENTINEL = "STIGMER_ORGANIZATION_PROVIDER_KEY";
// The stable code a rejected key is classified as, by its 401.
const AUTHENTICATION_CODE = "LLM_AUTHENTICATION_ERROR";

// Anthropic's envelope for a rejected key.
const ANTHROPIC_AUTHENTICATION_BODY = {
  type: "error",
  error: { type: "authentication_error", message: "invalid x-api-key" },
};

// The same failure as the cloud proxy relays it from an organization's own key.
const ORGANIZATION_KEY_AUTHENTICATION_BODY = {
  type: "error",
  error: {
    type: "authentication_error",
    message: `invalid x-api-key (served on your organization's own Anthropic key) [code: ${ORGANIZATION_PROVIDER_KEY_SENTINEL}]`,
  },
};

// The body the cloud proxy authors when the platform's own provider key is
// rejected upstream — the runner-facing half of that contract.
function platformCapacityBody(provider: "anthropic"): unknown {
  const message =
    `The Stigmer platform's model capacity for ${provider} is temporarily unavailable. ` +
    "This is a platform-side issue — your organization's credits were not charged for this call. " +
    `[code: ${PLATFORM_CAPACITY_SENTINEL}]`;
  return { type: "error", error: { type: "api_error", message } };
}

// Anthropic's exact out-of-credits envelope from the #330 incident.
const ANTHROPIC_BILLING_BODY = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message:
      "Your credit balance is too low to access the Anthropic API. " +
      "Please go to Plans & Billing to upgrade or purchase credits.",
  },
};

// How long a rejected turn may take to become EXECUTION_FAILED. A 400 fails in
// one round trip. A 503 does not: the runner's agent loop wraps the model call
// in LangChain's AsyncCaller, which retries 5xx six times with exponential
// backoff — the proxy's `x-should-retry: false` hint stops the provider SDK's
// own retries, not LangChain's — so the platform-capacity arm legitimately
// spends over a minute in IN_PROGRESS before the classifier sees the FINAL
// failure. That is also why the 503 is scripted `persistent`: a real capacity
// fault answers every retry, and the classifier reads the last error — a
// single-shot 503 would leave the retries hitting the mock's own exhaustion
// 500 and attribute THAT instead. The budget is the Go arm's (3 minutes).
const FAILURE_BUDGET_MS = 180_000;
const FAILURE_ARM_TIMEOUT_MS = FAILURE_BUDGET_MS + 30_000;

async function runToFailure(): Promise<AgentExecution> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-provider-error") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex-provider-error"), agentId: agent.metadata!.id }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

  const final = await awaitTerminal(clients, executionId, { timeoutMs: FAILURE_BUDGET_MS });
  expect(
    final.status?.phase,
    `a rejected model call must fail the execution; error=${JSON.stringify(final.status?.error ?? "")}`,
  ).toBe(ExecutionPhase.EXECUTION_FAILED);
  return final;
}

// The full attribution contract: platform code and wording present, provider
// billing prose and the LangChain wrapper tag absent — on status.error and on
// every message in the transcript.
function expectPlatformAttributed(final: AgentExecution): void {
  const error = final.status?.error ?? "";
  expect(error, `the stable platform-capacity code (status.error was: ${error})`).toContain(PLATFORM_CAPACITY_CODE);
  expect(error, "the failure is attributed to the platform").toContain("platform-side issue");
  expect(error, "the customer is told their credits are intact").toContain("credits were not charged");
  expect(error, "the LangChain wrapper class never labels the user-visible error").not.toContain("MiddlewareError");
  expect(error, "Anthropic's console prose never reaches the customer").not.toContain("Plans & Billing");
  for (const message of final.status?.messages ?? []) {
    expect(message.content, "provider billing prose must not leak into the transcript").not.toContain("Plans & Billing");
    expect(message.content, "the wrapper tag must not leak into the transcript").not.toContain("MiddlewareError");
  }
}

describe("AgentExecution provider-error attribution (proxy mode)", () => {
  it("a platform-capacity 503 fails the run attributed to the platform: LLM_PLATFORM_CAPACITY, credits not charged, no provider prose", async () => {
    mock.enqueueError(503, {
      headers: { "x-should-retry": "false" },
      body: platformCapacityBody("anthropic"),
      persistent: true,
    });

    const final = await runToFailure();

    expectPlatformAttributed(final);
    expect(mock.consumed(), "one scripted turn; the retries hit the persistent fault, not the queue").toBe(1);
  }, FAILURE_ARM_TIMEOUT_MS);

  it("a raw provider billing 400 behind the proxy is attributed to the platform, never to the customer's credit balance", async () => {
    mock.enqueueError(400, { body: ANTHROPIC_BILLING_BODY });

    const final = await runToFailure();

    expectPlatformAttributed(final);
    expect(final.status?.error ?? "", "the incident's tell-tale phrase is gone").not.toContain("credit balance is too low");
  }, FAILURE_ARM_TIMEOUT_MS);

  it("a provider 401 behind the proxy is classified by its status, never labelled by the LangChain wrapper", async () => {
    mock.enqueueError(401, { body: ANTHROPIC_AUTHENTICATION_BODY, persistent: true });

    const final = await runToFailure();

    expectClassifiedByStatus(final);
  }, FAILURE_ARM_TIMEOUT_MS);

  it("a 401 on the organization's own key is attributed to that key", async () => {
    mock.enqueueError(401, { body: ORGANIZATION_KEY_AUTHENTICATION_BODY, persistent: true });

    const final = await runToFailure();

    expectClassifiedByStatus(final);
    const error = final.status?.error ?? "";
    expect(error, `the failure is the organization's key (status.error was: ${error})`).toContain(
      "rejected your organization's own key",
    );
    expect(error, "never worded as the platform").not.toContain("Stigmer platform");
  }, FAILURE_ARM_TIMEOUT_MS);
});

// A failure the runner can only classify by its HTTP status: the stable code
// present, and neither the wrapper class nor LangChain's troubleshooting link
// on status.error or in the transcript.
function expectClassifiedByStatus(final: AgentExecution): void {
  const error = final.status?.error ?? "";
  expect(error, `the status-classified code (status.error was: ${error})`).toContain(AUTHENTICATION_CODE);
  expect(error, "the LangChain wrapper class never labels the user-visible error").not.toContain("MiddlewareError");
  expect(error, "LangChain's troubleshooting link never reaches the customer").not.toContain("Troubleshooting URL");
  for (const message of final.status?.messages ?? []) {
    expect(message.content, "the wrapper tag must not leak into the transcript").not.toContain("MiddlewareError");
  }
}
