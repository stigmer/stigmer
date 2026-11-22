// Conformance suite for the host app's own tools (SessionSpec.custom_tools).
// Domain: agentic / session — a session declares tools its host app answers,
// the agent calls one mid-turn, and the host answers through
// SessionCommandController.answerCustomToolUse or Managed Agents'
// user.custom_tool_result.
//
// Every run is scripted on the mock LLM, on each engine the target runs
// (support/engine-arms.ts): the model calls the declared tool by the name its
// engine offers it under (the bare name on the Stigmer harness,
// mcp__stigmer-host__<name> on Claude), and closes once it reads the answer.
//
// Asserted contract:
// - A session refuses a declaration the shared check refuses (a built-in's
//   name), as INVALID_ARGUMENT naming the rule.
// - A call whose input matches is one agent.custom_tool_use under the
//   declared name with the call's input, and the session goes idle with
//   requires_action naming it; the turn's fold lists it as a custom call
//   waiting on the host, never as an ask.
// - answerCustomToolUse records one user.custom_tool_result; the turn
//   resumes and the model reads the answer as the call's result, and an
//   is_error answer as an error: on Claude the tool result is marked one;
//   the Stigmer harness's provider adapter sends a tool result's text alone,
//   so there the text starts "Error: ", as the engine's own tools fail. The same answer sent again is success with
//   nothing new; a different one is FAILED_PRECONDITION.
// - confirmToolUse never answers a custom call, and answerCustomToolUse never
//   answers an approval's: each is NOT_FOUND.
// - A call whose input does not match is refused to the model, which reads
//   why, and nothing waits or reaches the log as a custom call.
// - Anthropic's SDK answers through the Managed Agents lane with a
//   user.custom_tool_result, and the turn completes.
// - Only the conversation's owner answers: a participant is refused
//   PERMISSION_DENIED (where the target enforces per-resource grants).
import { Code, ConnectError } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { agentRefOf, makeAgent } from "../support/agents";
import { awaitRequiresAction, sessionLog } from "../support/answers";
import { engineArms, type EngineArm } from "../support/engine-arms";
import { managedAgentsClient } from "../support/managed-agents";
import { uniqueName } from "../support/naming";
import { awaitPhase, awaitTerminal, makeAgentExecution, requireLlmProxy, sessionIdOf } from "../support/runs";
import { makeSession } from "../support/sessions";
import { grantTriple } from "../support/grants";
import { turnById } from "../support/turn";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

const { capabilities } = createTarget();

const FORM = {
  name: "show_registration_form",
  description: "Open the service registration form beside the chat, prefilled, and return what the person registered.",
  inputSchema: { type: "object", properties: { service: { type: "string" } }, required: ["service"], additionalProperties: false },
};

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

/** The name the arm's engine offers the declared tool under. */
function modelName(arm: EngineArm): string {
  return arm.word === "claude" ? `mcp__stigmer-host__${FORM.name}` : FORM.name;
}

/** A unique call id the arm's model uses. */
function callId(label: string): string {
  return `toolu_${uniqueName(label).replace(/-/g, "_")}`;
}

/** A run of a fresh agent on `arm` whose session declares the form, its model calling it with `input`, then closing. */
async function runWithForm(
  arm: EngineArm,
  id: string,
  input: Record<string, unknown>,
  using: ConformanceClients = clients,
): Promise<{ readonly runId: string; readonly org: string; readonly tenancy: Awaited<ReturnType<TargetProfile["provisionTenancy"]>> }> {
  const tenancy = await target.provisionTenancy();
  const { org } = tenancy;
  const agent = await using.agentCommand.create(makeAgent({ org, name: uniqueName("agent-custom-tools") }));
  fixtures.defer(() => using.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
  const task = uniqueName("Register the payments service");
  arm.script(mock, task, [{ kind: "call", id, name: modelName(arm), input }, { kind: "text", text: "Done." }]);
  const created = await using.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("run-custom-tools"),
      agentRef: agentRefOf(agent),
      message: task,
      sessionSpec: { ...(arm.harness !== undefined ? { harness: arm.harness } : {}), customTools: [FORM] },
    }),
  );
  const runId = created.metadata!.id;
  fixtures.defer(() => using.agentExecutionCommand.delete({ value: runId }).catch(() => undefined));
  return { runId, org, tenancy };
}

/** The text of the tool result the arm's model read for `toolCallId`, from the requests after the pause; undefined for none. */
function readByModel(arm: EngineArm, toolCallId: string): { text: string; isError: boolean } | undefined {
  for (const request of [...arm.loopRequests(mock)].reverse()) {
    const messages = (request.body as { messages?: { role?: string; content?: unknown }[] }).messages ?? [];
    for (const message of messages) {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content as Record<string, unknown>[]) {
        if (block["type"] !== "tool_result" || block["tool_use_id"] !== toolCallId) continue;
        const content = block["content"];
        const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => String((c as { text?: unknown }).text ?? "")).join("") : "";
        return { text, isError: block["is_error"] === true };
      }
    }
  }
  return undefined;
}

describe("a session declares the host app's own tools", () => {
  it("[rpc:SessionCommandController.create] refuses a declaration the shared check refuses, naming the rule", async () => {
    const { org } = await target.provisionTenancy();
    const err = await clients.sessionCommand
      .create(makeSession({ org, name: uniqueName("custom-tools-bad"), customTools: [{ ...FORM, name: "Bash" }] }))
      .then(() => undefined, (e: unknown) => ConnectError.from(e));
    expect(err?.code).toBe(Code.InvalidArgument);
    expect(err?.rawMessage).toContain("The name of custom tool 'Bash' is a built-in tool's");
  });
});

for (const arm of engineArms(capabilities)) {
  describe(`the host app's own tools on the ${arm.word} engine`, () => {
    it("[rpc:SessionCommandController.answerCustomToolUse] a call waits as the host's; the answer resumes the turn and the model reads it once", async () => {
      const id = callId("custom_ok");
      const { runId } = await runWithForm(arm, id, { service: "payments" });
      const gated = await awaitPhase(clients, runId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "waiting for the host" });
      const sessionId = sessionIdOf(gated);
      fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }).catch(() => undefined));
      const [useId] = await awaitRequiresAction(clients, sessionId, 1);
      expect(useId, "the idle names the call").toBe(`${runId}.${id}`);

      const uses = (await sessionLog(clients, sessionId)).filter((e) => e.event.case === "agentCustomToolUse");
      expect(uses.map((e) => e.event.case === "agentCustomToolUse" && [e.event.value.id, e.event.value.name, e.event.value.input])).toEqual([
        [useId, FORM.name, { service: "payments" }],
      ]);
      const turn = await turnById(clients, sessionId, runId);
      expect(turn.asks, "a custom call is never an ask").toEqual([]);
      expect(turn.customToolUses.map((use) => [use.id, use.name, use.state, use.custom])).toEqual([[useId, FORM.name, "waiting_on_host", true]]);

      const answered = await clients.sessionCommand.answerCustomToolUse({ sessionId, customToolUseId: useId!, content: [{ type: "text", text: "registered as svc_payments" }] });
      const replayed = await clients.sessionCommand.answerCustomToolUse({ sessionId, customToolUseId: useId!, content: [{ type: "text", text: "registered as svc_payments" }] });
      expect(replayed.event.value?.id, "the replay answers the recorded event").toBe(answered.event.value?.id);
      await expectGrpcCode(
        () => clients.sessionCommand.answerCustomToolUse({ sessionId, customToolUseId: useId!, content: [{ type: "text", text: "another answer" }] }),
        Code.FailedPrecondition,
        "a different answer",
      );

      const final = await awaitTerminal(clients, runId);
      expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
      expect(readByModel(arm, id), "the model reads the host's answer").toEqual({ text: "registered as svc_payments", isError: false });
      const results = (await sessionLog(clients, sessionId)).filter((e) => e.event.case === "userCustomToolResult");
      expect(results, "one answer recorded").toHaveLength(1);
      const done = (await turnById(clients, sessionId, runId)).customToolUses;
      expect(done, "nothing waits once answered").toEqual([]);
    });

    it("[rpc:SessionCommandController.answerCustomToolUse] an is_error answer reaches the model as an error; neither answer method answers the other's call", async () => {
      const id = callId("custom_err");
      const { runId } = await runWithForm(arm, id, { service: "billing" });
      const sessionId = sessionIdOf(await awaitPhase(clients, runId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "waiting for the host" }));
      fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }).catch(() => undefined));
      const [useId] = await awaitRequiresAction(clients, sessionId, 1);

      await expectGrpcCode(() => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: useId!, result: "allow" }), Code.NotFound, "an approval of a custom call");
      await expectGrpcCode(
        () => clients.sessionCommand.answerCustomToolUse({ sessionId, customToolUseId: `${runId}.toolu_nothing`, content: [{ type: "text", text: "x" }] }),
        Code.NotFound,
        "an answer to no custom call",
      );

      await clients.sessionCommand.answerCustomToolUse({ sessionId, customToolUseId: useId!, content: [{ type: "text", text: "The person closed the form." }], isError: true });
      expect((await awaitTerminal(clients, runId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
      expect(readByModel(arm, id)).toEqual(
        arm.word === "claude" ? { text: "The person closed the form.", isError: true } : { text: "Error: The person closed the form.", isError: false },
      );
    });

    it("a call whose input does not match is refused to the model, and nothing waits", async () => {
      const id = callId("custom_bad");
      const { runId } = await runWithForm(arm, id, { repo: "acme/x" });
      const final = await awaitTerminal(clients, runId);
      expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
      const read = readByModel(arm, id);
      if (arm.word === "claude") expect(read?.isError, "the refusal is an error").toBe(true);
      expect(read?.text).toContain("The input does not match show_registration_form's input schema");
      const sessionId = sessionIdOf(final);
      fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }).catch(() => undefined));
      expect((await sessionLog(clients, sessionId)).filter((e) => e.event.case === "agentCustomToolUse")).toEqual([]);
    });
  });
}

describe("the host app's own tools on the Managed Agents lane", () => {
  it("Anthropic's SDK answers with a user.custom_tool_result, and the turn completes", async () => {
    const [arm] = engineArms(capabilities);
    const id = callId("custom_lane");
    const { runId, org } = await runWithForm(arm!, id, { service: "lane" });
    const sessionId = sessionIdOf(await awaitPhase(clients, runId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "waiting for the host" }));
    fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }).catch(() => undefined));
    const [useId] = await awaitRequiresAction(clients, sessionId, 1);

    const key = await clients.apiKeyCommand.create({ apiVersion: "iam.stigmer.ai/v1", kind: "ApiKey", metadata: { name: uniqueName("custom-tools-key"), org }, spec: {} });
    fixtures.defer(() => clients.apiKeyCommand.delete({ value: key.metadata?.id ?? "" }).catch(() => undefined));
    const sdk = managedAgentsClient(target.managedAgentsBaseUrl(), { apiKey: key.spec?.keyHash ?? "" });
    const sent = await sdk.beta.sessions.events.send(sessionId, {
      events: [{ type: "user.custom_tool_result", custom_tool_use_id: useId!, content: [{ type: "text", text: "registered via the lane" }] }],
    });
    expect(sent.data?.map((event) => event.type)).toEqual(["user.custom_tool_result"]);

    expect((await awaitTerminal(clients, runId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(readByModel(arm!, id)).toEqual({ text: "registered via the lane", isError: false });
  });
});

describe("who answers the host app's own tools", () => {
  it("[rpc:SessionCommandController.answerCustomToolUse] a participant is refused; the owner answers", async (ctx) => {
    if (!target.capabilities.perResourceGrants) ctx.skip("the edition grants roles on organizations only, so no one can be given a role on one conversation");
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
    const lane = enforcing.lane!;
    const founder = lane.clients;
    const [arm] = engineArms(capabilities);
    const id = callId("custom_owner");
    const { runId, tenancy } = await runWithForm(arm!, id, { service: "owned" }, founder);
    const sessionId = sessionIdOf(await awaitPhase(founder, runId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "waiting for the host" }));
    fixtures.defer(() => founder.sessionCommand.delete({ value: sessionId }).catch(() => undefined));
    const [useId] = await awaitRequiresAction(founder, sessionId, 1);

    const member = await lane.provisionMember(tenancy);
    await founder.grantCommand.create(grantTriple({ kind: "identity_account", id: await lane.accountIdOf(member) }, "participant", { kind: "session", id: sessionId }));
    await expectGrpcCode(
      () => member.sessionCommand.answerCustomToolUse({ sessionId, customToolUseId: useId!, content: [{ type: "text", text: "not mine to give" }] }),
      Code.PermissionDenied,
      "a participant's answer",
    );

    await founder.sessionCommand.answerCustomToolUse({ sessionId, customToolUseId: useId!, content: [{ type: "text", text: "the owner's answer" }] });
    expect((await awaitTerminal(founder, runId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });
});
