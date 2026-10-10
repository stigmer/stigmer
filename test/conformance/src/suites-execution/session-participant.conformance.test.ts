// A conversation's Participant sends a message and the agent answers it — the
// execution-class proof of the session's participant role.
// Domain: agentic / session + run (who may add a turn to a conversation).
//
// The contract: sharing a conversation as Participant lets a person read it
// and send messages; Viewer only reads (the run gate's arms pin the refusal).
// A participant's turn runs in the conversation's own workspace, as its
// creator, so the runner serving it reports as the creator, whose run
// controls they are; the turn records no person, so it uses no one's own
// logins, only the vaults the conversation names. Pinned over the wire:
//
//   - a member granted Participant on the founder's conversation adds a turn
//     that COMPLETES with the agent's answer, which only a runner able to
//     report on the run can land;
//   - that turn records no person: RunStatus.credentials.person is empty,
//     while the founder's own turn in the same conversation records the
//     founder;
//   - a participant cannot waive the owners' approvals: a turn that sets
//     auto_approve_all is refused PermissionDenied before anything runs.
//
// A role on one conversation is a per-resource grant, so the arm runs only
// where the edition's grant scope admits one (the hosted edition); an
// open-source target skips VISIBLY with that reason.
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  anthropicText,
  type MockLlmProxy,
} from "@stigmer/test-support/mock-llm";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { FixtureTracker } from "../harness/fixtures";
import type { ConformanceClients } from "../harness/clients";
import { agentRefOf, makeAgent } from "../support/agents";
import { policyTriple } from "../support/iampolicies";
import { uniqueName } from "../support/naming";
import {
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  sessionIdOf,
} from "../support/runs";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
} from "../targets";

let target: TargetProfile;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  enforcing = await enforcingLaneOf(target);
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
  if (!target.capabilities.perResourceGrants) {
    ctx.skip(
      "the edition grants roles on organizations only, so no one can be given a role on one conversation",
    );
  }
  if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
  return enforcing.lane;
}

function expectCompleted(final: Run): void {
  expect(
    final.status?.phase,
    `execution ${final.metadata?.id} should complete; reached ${RunPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(RunPhase.RUN_COMPLETED);
}

async function runTurn(
  using: ConformanceClients,
  reader: ConformanceClients,
  input: Parameters<typeof makeAgentExecution>[0],
): Promise<Run> {
  const execution = await using.agentExecutionCommand.create(
    makeAgentExecution(input),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() =>
    reader.agentExecutionCommand
      .delete({ value: executionId })
      .catch(() => undefined),
  );
  return awaitTerminal(reader, executionId);
}

describe("a conversation's participant sends a message", () => {
  it("[rpc:RunCommandController.create] a participant's turn completes, and records no person", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const founder = lane.clients;
    const context = await target.provisionTenancy();
    const member = await lane.provisionMember(context);

    const agentInput = makeAgent({
      org: context.org,
      name: uniqueName("participant-agent"),
    });
    agentInput.metadata = {
      ...agentInput.metadata,
      visibility: ApiResourceVisibility.visibility_org,
    };
    const agent = await founder.agentCommand.create(agentInput);
    fixtures.defer(() =>
      founder.agentCommand
        .delete({ value: agent.metadata!.id })
        .catch(() => undefined),
    );

    // The founder's own first turn opens the conversation.
    mock.enqueue(anthropicText("Hello from the founder's turn."));
    const first = await runTurn(founder, founder, {
      org: context.org,
      name: uniqueName("founder-turn"),
      agentRef: agentRefOf(agent),
      autoApproveAll: true,
    });
    expectCompleted(first);
    expect(first.status?.credentials?.person).toBe(
      await lane.accountIdOf(founder),
    );
    const sessionId = sessionIdOf(first);
    fixtures.defer(() =>
      founder.sessionCommand
        .delete({ value: sessionId })
        .catch(() => undefined),
    );

    await founder.iamPolicyCommand.create(
      policyTriple(
        { kind: "identity_account", id: await lane.accountIdOf(member) },
        "participant",
        { kind: "session", id: sessionId },
      ),
    );

    // Approving stays the owners': a participant's auto-approving turn is
    // refused before anything runs, so the scripted answer below is still
    // the next turn's.
    const waived = await member.agentExecutionCommand
      .create(
        makeAgentExecution({
          org: context.org,
          name: uniqueName("participant-auto-approve"),
          sessionId,
          message: "Approve everything for me.",
          autoApproveAll: true,
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => ConnectError.from(error),
      );
    expect(waived?.code, "a participant cannot auto-approve").toBe(Code.PermissionDenied);

    mock.enqueue(anthropicText("Hello from the participant's turn."));
    const second = await runTurn(member, founder, {
      org: context.org,
      name: uniqueName("participant-turn"),
      sessionId,
      message: "A question from a participant.",
    });
    expectCompleted(second);
    expect(mock.remaining(), "both scripted turns were consumed").toBe(0);
    // No one's own logins: the turn records no person.
    expect(second.status?.credentials?.person ?? "").toBe("");
  });
});
