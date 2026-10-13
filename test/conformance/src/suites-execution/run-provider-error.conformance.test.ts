// Conformance suite for provider-error ATTRIBUTION on a failed Run:
// when the model call behind the platform proxy fails, whose fault does
// status.error say it is?
// Domain: agentic / agentexecution — the failure copy a customer reads.
//
// Every model call the platform proxy serves runs on a key the organization
// owns, so a provider billing fault is the organization's own provider
// account, never Stigmer's. The arm scripts Anthropic's exact out-of-credits
// envelope from the stigmer/stigmer#330 incident, marked with the
// organization-key sentinel the way the cloud proxy relays a failure on the
// organization's key, byte-exact on the mock. The runner's classifier
// (shared/model-error.ts) must land it as LLM_PROVIDER_BILLING worded as the
// organization's own Anthropic key, with Anthropic's own prose ("Plans &
// Billing") only quoted after that wording, on status.error, and never
// worded as the Stigmer platform.
//
// Two more arms are classified by their HTTP status, not their text: a
// provider 401 behind the proxy, and a 401 on an organization's own key
// (the body the cloud proxy authors for a call it served on that key, whose
// message carries the organization-key sentinel). A status reaches the
// classifier only if its walk down the error's `cause` chain gets past every
// MiddlewareError LangChain wraps it in, one per model-call middleware of the
// turn, to the provider SDK's error (stigmer/stigmer#1450). Neither a 400
// nor a 401 is retried, and every arm is scripted `persistent` so the turn's
// call, not a side call, is the one that fails the run.
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import { uniqueName } from "../support/naming";
import { turnOfRun } from "../support/turn";
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

// Lockstep with the runner's ORGANIZATION_PROVIDER_KEY_SENTINEL
// (shared/model-error.ts) and the cloud proxy's organization-key error body:
// the call was served on the organization's own provider key.
const ORGANIZATION_PROVIDER_KEY_SENTINEL = "STIGMER_ORGANIZATION_PROVIDER_KEY";
// The stable code a rejected key is classified as, by its 401.
const AUTHENTICATION_CODE = "LLM_AUTHENTICATION_ERROR";
// The stable code an exhausted provider account is classified as.
const PROVIDER_BILLING_CODE = "LLM_PROVIDER_BILLING";

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

// Anthropic's exact out-of-credits envelope from the #330 incident, as the
// cloud proxy relays it from an organization's own key: the provider's
// message kept, the organization-key sentinel appended.
const ORGANIZATION_KEY_BILLING_BODY = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message:
      "Your credit balance is too low to access the Anthropic API. " +
      "Please go to Plans & Billing to upgrade or purchase credits. " +
      `[code: ${ORGANIZATION_PROVIDER_KEY_SENTINEL}]`,
  },
};

// How long a rejected turn may take to become RUN_FAILED. A 400 or a 401
// fails in one round trip (LangChain's AsyncCaller retries neither); the
// budget is the Go arm's (3 minutes), kept for a slow runner start.
const FAILURE_BUDGET_MS = 180_000;
const FAILURE_ARM_TIMEOUT_MS = FAILURE_BUDGET_MS + 30_000;

async function runToFailure(): Promise<Run> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-provider-error") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex-provider-error"), agentRef: agentRefOf(agent) }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

  const final = await awaitTerminal(clients, executionId, { timeoutMs: FAILURE_BUDGET_MS });
  expect(
    final.status?.phase,
    `a rejected model call must fail the execution; error=${JSON.stringify(final.status?.error ?? "")}`,
  ).toBe(RunPhase.RUN_FAILED);
  return final;
}

describe("Run provider-error attribution (proxy mode)", () => {
  it("Anthropic's out-of-credit 400 on the organization's own key is the organization's own Anthropic account, never Stigmer's", async () => {
    mock.enqueueError(400, { body: ORGANIZATION_KEY_BILLING_BODY, persistent: true });

    const final = await runToFailure();

    const error = final.status?.error ?? "";
    expect(error, `the stable provider-billing code (status.error was: ${error})`).toContain(PROVIDER_BILLING_CODE);
    expect(error, "the failure is the organization's own Anthropic account").toContain(
      "Your organization's own Anthropic key is out of credits or over quota. " +
        "Add credits to that provider account, or update the key in Settings → Provider keys. Provider message: ",
    );
    // Anthropic's console prose is quoted after the classifier's wording, never in its place.
    const quoted = error.indexOf("Provider message: ");
    expect(error.indexOf("Plans & Billing"), "Anthropic's prose appears only quoted").toBeGreaterThan(quoted);
    expect(error, "never worded as the platform").not.toContain("Stigmer platform");
    expect(error, "the LangChain wrapper class never labels the user-visible error").not.toContain("MiddlewareError");
    for (const text of await transcriptTextsOf(final)) {
      expect(text, "the wrapper tag must not leak into the transcript").not.toContain("MiddlewareError");
    }
  }, FAILURE_ARM_TIMEOUT_MS);

  it("a provider 401 behind the proxy is classified by its status, never labelled by the LangChain wrapper", async () => {
    mock.enqueueError(401, { body: ANTHROPIC_AUTHENTICATION_BODY, persistent: true });

    const final = await runToFailure();

    await expectClassifiedByStatus(final);
  }, FAILURE_ARM_TIMEOUT_MS);

  it("a 401 on the organization's own key is attributed to that key", async () => {
    mock.enqueueError(401, { body: ORGANIZATION_KEY_AUTHENTICATION_BODY, persistent: true });

    const final = await runToFailure();

    await expectClassifiedByStatus(final);
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
async function expectClassifiedByStatus(final: Run): Promise<void> {
  const error = final.status?.error ?? "";
  expect(error, `the status-classified code (status.error was: ${error})`).toContain(AUTHENTICATION_CODE);
  expect(error, "the LangChain wrapper class never labels the user-visible error").not.toContain("MiddlewareError");
  expect(error, "LangChain's troubleshooting link never reaches the customer").not.toContain("Troubleshooting URL");
  for (const text of await transcriptTextsOf(final)) {
    expect(text, "the wrapper tag must not leak into the transcript").not.toContain("MiddlewareError");
  }
}

// Every text the turn's transcript shows: its messages, thinking and notes,
// and the errors the log reported for it.
async function transcriptTextsOf(final: Run): Promise<string[]> {
  const turn = await turnOfRun(clients, final);
  return [
    ...turn.items.flatMap((item) => (item.kind === "tool_use" || item.kind === "compacted" ? [] : [item.text])),
    ...turn.errors.map((error) => error.message),
  ];
}
