// The runner acts as the run's human subject — the execution-class proof, on a
// server that enforces who may report on a run.
// Domain: agentic / agentexecution + platform (the runner's credential lane).
//
// The contract: on a self-hosted server with sign-in on, ONE long-lived runner
// serves every person's runs and holds one operator's API key as its process
// credential (the Helm chart's install). Under an enforcing authorizer,
// reporting on a run is `can_edit` on the execution, which the run's human
// holds — so a runner that acted as its key's holder could report on the
// operator's runs and on nobody else's. Instead the server mints each run its
// own credential at dispatch and carries it on the workflow input; the runner
// presents it on every RPC about that run; and the built-in verifier admits
// its bearer AS THE RUN'S HUMAN. What follows over the wire, and is pinned here:
//
//   - a MEMBER's run, served by a runner keyed with the OPERATOR's key,
//     completes, its status writes land, and the runner titles its session
//     as the member (stigmer#1137 was every such run failing INTERNAL);
//   - the rows the runner writes for a run — the `agent_call` child's
//     Session and AgentExecution — carry the member's stamp, and an outsider
//     is refused them;
//   - an API key alone is not a delegate: the operator's key on the member's
//     run is refused;
//   - the exchange is a mint gate: a run's credential is minted only for the
//     run's own person (a missing row is NOT_FOUND, anyone else is
//     PERMISSION_DENIED), and what it mints IS that person;
//   - a credential is its human, not a wildcard: the member's run X
//     credential is refused on the operator's run Y — and, as the recorded
//     reach the model gives a credential today (a credential is the human
//     for every RPC while its run lives; a narrowing of a runner-class caller
//     to its execution's family is a later entry's), it is admitted on the
//     member's OWN run Y, pinned so that narrowing turns this arm red on
//     purpose;
//   - a workflow that calls an agent runs to terminal under enforcement, and
//     the child the runner created carries the workflow lineage labels and
//     the member's stamp.
//
// Deliberately out of scope, with the reason:
//   - a workflow calling an agent the member CANNOT VIEW. The workflow-bound
//     runner is admitted on the child's run-gate checks (the cloud's
//     `workflow_sandbox` admission, mirrored), so the child IS created; the
//     child's own run then reads the agent's blueprint and instance as the
//     member and is refused `can_view`, and the workflow fails. Whether that
//     child should be able to read the blueprint it runs is a question of
//     the model's reach, open in both editions, and not one this suite
//     settles by pinning either outcome;
//   - the credential refused AFTER its run is terminal: the grace is ten
//     wall-clock minutes measured from the row's completed_at, not
//     observable over the wire in a test's budget; the verifier's unit arms
//     pin it with an injectable clock;
//   - the memory row a `remember` call writes: on open source the memory
//     tool is a stdio child that presents no credential yet (stigmer#1147);
//   - an Artifact the runner writes: it does so only for a workflow task
//     output above the promotion threshold, which no fixture produces; the
//     child rows already prove the stamp;
//   - "the runner made no exchange call": the runner's own unit arm on
//     acquireScopedRunnerToken pins the short-circuit; a conformance arm
//     reads outcomes, never a server log;
//   - a credentialed MCP connect under the OIDC posture (stigmer#1137's
//     connect half; its own change).
//
// The arms run on the target's ENFORCING LANE (targets/target.ts): on the
// execution targets an open-source sibling in the OIDC posture WITH its own
// engine and a runner keyed with the founder's API key
// (harness/enforcing-execution-lane.ts), on both store drivers by the
// storage seam. They gate on CapabilityFlags.runnerActsAsRunCreator: the
// cloud-execution target's runner is an embedded runner acting as the
// primary user, a different shape whose proof is the composition's own.
import { Code } from "@connectrpc/connect";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  ExecutionPhase as WorkflowExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { anthropicText } from "../harness/llm-wire";
import type { MockLlmProxy } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution } from "../support/agentexecutions";
import { makeApiKey, plaintextKeyOf } from "../support/apikeys";
import { pollUntil } from "../support/execution-poll";
import { uniqueName } from "../support/naming";
import {
  AGENT_CALL_AFTER_TASK_NAME,
  makeAgentCallWorkflow,
} from "../support/workflows";
import {
  awaitTaskStatus,
  awaitTerminal as awaitWorkflowTerminal,
  makeWorkflowExecution,
} from "../support/workflowexecutions";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";

// Read once at collection time to gate the describe (constructing a target is
// side-effect-free; setup() is what boots processes).
const collectionTarget = createTarget();
const runnerActsAsRunCreator =
  collectionTarget.capabilities.runnerActsAsRunCreator;

// The lineage labels the runner's agent_call activity stamps on the child it
// creates (activities/call-agent.ts); pinned bytes, the server keys the
// child's environment resolution on them.
const WORKFLOW_EXECUTION_ID_LABEL = "stigmer.ai/workflow-execution-id";
const WORKFLOW_TASK_LABEL = "stigmer.ai/workflow-task";

// The placeholder the runner's agent_call activity and the server's
// auto-created sessions start with; the titling activity replaces it.
const UNTITLED_SESSION_SUBJECT = "Auto-created session";

// The exchange's refusal under the enforcing posture, byte-pinned in the
// server's runnerauth constants; the arm asserts the sentence, not just the
// code, because the code alone is what a can_view refusal would also answer.
const NOT_RUNS_PERSON_MESSAGE =
  "a run credential is minted only for the person whose run it is";

describe.skipIf(!runnerActsAsRunCreator)(
  "runner as the run's subject — a member's run served by the operator-keyed runner (on the enforcing execution lane)",
  () => {
    let target: TargetProfile;
    let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
    const fixtures = new FixtureTracker();

    beforeAll(async () => {
      target = createTarget();
      await target.setup();
      enforcing = await enforcingLaneOf(target);
    });

    afterEach(async () => {
      await fixtures.cleanup();
      enforcing.lane?.llmProxy?.().reset();
    });

    afterAll(async () => {
      await target?.teardown();
    });

    // The lane with a runner behind it, or a visible skip with the target's
    // reason. A lane on a runnerActsAsRunCreator target without a mock is a
    // harness gap, thrown — never a silent pass.
    function laneOrSkip(ctx: { skip: (note?: string) => never }): {
      lane: EnforcingLane;
      mock: MockLlmProxy;
    } {
      if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
      const lane = enforcing.lane;
      if (lane.llmProxy === undefined) {
        throw new Error(
          `target "${target.name}" declares runnerActsAsRunCreator but its enforcing lane has no runner (no llmProxy)`,
        );
      }
      return { lane, mock: lane.llmProxy() };
    }

    // The people of one arm: the founder (the OPERATOR whose key the runner
    // holds, and the owner of the organization), a member holding exactly
    // `member` there, and an outsider holding nothing.
    interface People {
      readonly org: string;
      readonly founder: ConformanceClients;
      readonly member: ConformanceClients;
      readonly memberId: string;
    }

    async function provisionPeople(lane: EnforcingLane): Promise<People> {
      const tenancy: TenancyContext = await lane.provisionTenancy();
      fixtures.defer(() => lane.cleanupTenancy(tenancy));
      const member = await lane.provisionMember(tenancy);
      return {
        org: tenancy.org,
        founder: lane.clients,
        member,
        memberId: await lane.accountIdOf(member),
      };
    }

    // An agent the founder owns, at the given visibility; the member can run
    // an org-visible one and cannot see a private one.
    async function createAgent(
      people: People,
      visibility: ApiResourceVisibility,
      label: string,
    ) {
      const input = makeAgent({ org: people.org, name: uniqueName(label) });
      input.metadata = { ...input.metadata, visibility };
      const agent = await people.founder.agentCommand.create(input);
      fixtures.defer(() =>
        people.founder.agentCommand.delete({ value: agent.metadata!.id }),
      );
      return agent;
    }

    // A run dispatched by `by` on `agentId`, scripted with one text turn on the
    // lane's runner (the mock answers the runner's background title call out of
    // band, so a run costs exactly one queued turn).
    async function dispatchRun(
      mock: MockLlmProxy,
      by: ConformanceClients,
      org: string,
      agentId: string,
      label: string,
    ): Promise<AgentExecution> {
      mock.enqueue(anthropicText(`Hello from the ${label} run.`));
      const created = await by.agentExecutionCommand.create(
        makeAgentExecution({
          org,
          name: uniqueName(label),
          agentId,
          message: "Say hello.",
          autoApproveAll: true,
        }),
      );
      fixtures.defer(() =>
        by.agentExecutionCommand.delete({ value: created.metadata!.id }),
      );
      return created;
    }

    // The runner titles a session after its first run completes, as the run's
    // human, in an activity the server fires and does not await — so the
    // title is polled, never assumed present at the terminal phase.
    function awaitTitled(
      by: ConformanceClients,
      sessionId: string,
    ): Promise<Session> {
      return pollUntil(
        () => by.sessionQuery.get({ value: sessionId }),
        (session) =>
          (session.spec?.subject ?? "") !== "" &&
          session.spec?.subject !== UNTITLED_SESSION_SUBJECT,
        (last, timeoutMs) =>
          `session ${sessionId} was not titled within ${timeoutMs}ms (subject: "${last?.spec?.subject ?? "(none)"}")`,
      );
    }

    // The run credential of `executionId`, minted for its own person through the
    // exchange — the door the arms use to hold a credential without a runner.
    async function runCredentialOf(
      by: ConformanceClients,
      executionId: string,
    ): Promise<string> {
      const minted = await by.platformQuery.getRunnerScopedToken({
        scope: { case: "agentExecutionId", value: executionId },
      });
      expect(
        minted.runnerScopedToken,
        "the exchange mints for the run's own person",
      ).not.toBe("");
      expect(minted.tokenType).toBe("Bearer");
      return minted.runnerScopedToken;
    }

    // A founder-owned, org-visible workflow whose first task calls `agentSlug`,
    // run by the member; resolves once the downstream task completed, which is
    // the proof the child ran to terminal and the workflow continued.
    async function runAgentCallWorkflow(
      mock: MockLlmProxy,
      people: People,
      agentSlug: string,
      label: string,
    ) {
      const input = makeAgentCallWorkflow({
        org: people.org,
        name: uniqueName(label),
        agentSlug,
        message: "Say hello.",
      });
      input.metadata = {
        ...input.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      };
      const workflow = await people.founder.workflowCommand.create(input);
      fixtures.defer(() =>
        people.founder.workflowCommand.delete({ value: workflow.metadata!.id }),
      );

      mock.enqueue(anthropicText(`Hello from the ${label} child.`));
      const execution = await people.member.workflowExecutionCommand.create(
        makeWorkflowExecution({
          org: people.org,
          name: uniqueName(label),
          workflowId: workflow.metadata!.id,
        }),
      );
      fixtures.defer(() =>
        people.member.workflowExecutionCommand.delete({
          value: execution.metadata!.id,
        }),
      );

      await awaitTaskStatus(
        people.member,
        execution.metadata!.id,
        AGENT_CALL_AFTER_TASK_NAME,
        WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
      );
      const settled = await awaitWorkflowTerminal(
        people.member,
        execution.metadata!.id,
      );
      expect(
        settled.status?.phase,
        `the ${label} workflow completes under enforcement`,
      ).toBe(WorkflowExecutionPhase.EXECUTION_COMPLETED);
      return settled;
    }

    // The child the runner created for a workflow execution, found the way a
    // console finds it: listed as the member (the list is scoped to what the
    // caller may view) and matched on the lineage label.
    async function childExecutionOf(
      by: ConformanceClients,
      org: string,
      workflowExecutionId: string,
    ): Promise<AgentExecution> {
      const listed = await by.agentExecutionQuery.list({ org });
      const child = listed.entries.find(
        (entry) =>
          entry.metadata?.labels[WORKFLOW_EXECUTION_ID_LABEL] ===
          workflowExecutionId,
      );
      if (child === undefined) {
        throw new Error(
          `no agent execution labeled ${WORKFLOW_EXECUTION_ID_LABEL}=${workflowExecutionId} is visible to the member ` +
            `(${listed.entries.length} listed)`,
        );
      }
      fixtures.defer(() =>
        by.agentExecutionCommand.delete({ value: child.metadata!.id }),
      );
      return child;
    }

    it("a member's run completes on a runner keyed with the operator's key, and its session is titled as the member", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);
      const agent = await createAgent(
        people,
        ApiResourceVisibility.visibility_org,
        "ras-agent",
      );

      const memberRun = await dispatchRun(
        mock,
        people.member,
        people.org,
        agent.metadata!.id,
        "member",
      );
      const founderRun = await dispatchRun(
        mock,
        people.founder,
        people.org,
        agent.metadata!.id,
        "operator",
      );

      const [memberFinal, founderFinal] = await Promise.all([
        awaitTerminal(people.member, memberRun.metadata!.id),
        awaitTerminal(people.founder, founderRun.metadata!.id),
      ]);
      expect(
        memberFinal.status?.phase,
        `the member's run: ${memberFinal.status?.error}`,
      ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
      expect(
        memberFinal.status?.completedAt,
        "the runner's terminal write stamps completed_at",
      ).toBeTruthy();
      expect(
        founderFinal.status?.phase,
        `the operator's run: ${founderFinal.status?.error}`,
      ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
      expect(
        mock.consumed(),
        "both runs consumed exactly their scripted turn",
      ).toBe(2);

      // The titling activity ran AS THE MEMBER: it read the member's run and
      // wrote the member's session, which the operator's key alone could not.
      const session = await awaitTitled(
        people.member,
        memberFinal.spec?.sessionId ?? "",
      );
      expect(session.spec?.subject).not.toBe(UNTITLED_SESSION_SUBJECT);
    });

    it("an API key alone is not a delegate: the operator's key on the member's run is refused", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);
      const agent = await createAgent(
        people,
        ApiResourceVisibility.visibility_org,
        "ras-key",
      );
      const run = await dispatchRun(
        mock,
        people.member,
        people.org,
        agent.metadata!.id,
        "member",
      );

      // Any key of the founder shows it — the runner's own is one such key.
      const key = plaintextKeyOf(
        await people.founder.apiKeyCommand.create(
          makeApiKey({ org: people.org, name: uniqueName("ras-operator-key") }),
        ),
      );
      const keyClients = lane.clientsPresenting(key);

      await expectGrpcCode(
        () =>
          keyClients.agentExecutionCommand.updateStatus({
            executionId: run.metadata!.id,
            status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
          }),
        Code.PermissionDenied,
        "the operator's API key writing status on the member's run",
      );

      await awaitTerminal(people.member, run.metadata!.id);
    });

    it("the exchange is a mint gate: a missing run is NOT_FOUND, another person's run is PERMISSION_DENIED, one's own run mints a credential that IS oneself", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);
      const agent = await createAgent(
        people,
        ApiResourceVisibility.visibility_org,
        "ras-mint",
      );
      const memberRun = await dispatchRun(
        mock,
        people.member,
        people.org,
        agent.metadata!.id,
        "member",
      );
      const founderRun = await dispatchRun(
        mock,
        people.founder,
        people.org,
        agent.metadata!.id,
        "operator",
      );

      await expectGrpcCode(
        () =>
          people.member.platformQuery.getRunnerScopedToken({
            scope: {
              case: "agentExecutionId",
              value: `aex_${uniqueName("missing")}`,
            },
          }),
        Code.NotFound,
        "a run that does not exist",
      );

      const refused = await expectGrpcCode(
        () =>
          people.member.platformQuery.getRunnerScopedToken({
            scope: { case: "agentExecutionId", value: founderRun.metadata!.id },
          }),
        Code.PermissionDenied,
        "the member asking for the operator's run credential",
      );
      expect(refused.rawMessage).toContain(NOT_RUNS_PERSON_MESSAGE);

      const credential = await runCredentialOf(
        people.member,
        memberRun.metadata!.id,
      );
      const me = await lane
        .clientsPresenting(credential)
        .identityAccountQuery.whoAmI({});
      expect(
        me.metadata?.id,
        "the run credential admits its bearer as the run's person",
      ).toBe(people.memberId);

      await Promise.all([
        awaitTerminal(people.member, memberRun.metadata!.id),
        awaitTerminal(people.founder, founderRun.metadata!.id),
      ]);
    });

    it("a run credential is its human, not a wildcard: refused on another person's run, admitted on the same person's other run (the recorded reach)", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);
      const agent = await createAgent(
        people,
        ApiResourceVisibility.visibility_org,
        "ras-reach",
      );
      const runX = await dispatchRun(
        mock,
        people.member,
        people.org,
        agent.metadata!.id,
        "member-x",
      );
      const runY = await dispatchRun(
        mock,
        people.member,
        people.org,
        agent.metadata!.id,
        "member-y",
      );
      const founderRun = await dispatchRun(
        mock,
        people.founder,
        people.org,
        agent.metadata!.id,
        "operator",
      );

      const asRunX = lane.clientsPresenting(
        await runCredentialOf(people.member, runX.metadata!.id),
      );

      await expectGrpcCode(
        () =>
          asRunX.agentExecutionQuery.get({ value: founderRun.metadata!.id }),
        Code.PermissionDenied,
        "run X's credential reading the operator's run",
      );

      // The reach the model gives a credential today: it is the member for
      // every RPC while run X lives, the member's other run included. A
      // later narrowing of a runner-class caller to its execution's family
      // turns this arm red, which is the point of pinning it.
      const sameHuman = await asRunX.agentExecutionQuery.get({
        value: runY.metadata!.id,
      });
      expect(sameHuman.metadata?.id).toBe(runY.metadata!.id);

      await Promise.all([
        awaitTerminal(people.member, runX.metadata!.id),
        awaitTerminal(people.member, runY.metadata!.id),
        awaitTerminal(people.founder, founderRun.metadata!.id),
      ]);
    });

    it("a workflow calling an agent runs to terminal under enforcement, and the child rows the runner wrote are the member's", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);
      const outsider = await lane.provisionIdentity();
      const agent = await createAgent(
        people,
        ApiResourceVisibility.visibility_org,
        "ras-callee",
      );

      const settled = await runAgentCallWorkflow(
        mock,
        people,
        agent.metadata!.slug,
        "ras-agent-call",
      );

      const child = await childExecutionOf(
        people.member,
        people.org,
        settled.metadata!.id,
      );
      expect(child.metadata?.labels[WORKFLOW_EXECUTION_ID_LABEL]).toBe(
        settled.metadata!.id,
      );
      expect(
        child.metadata?.labels[WORKFLOW_TASK_LABEL],
        "the task name rides the second lineage label",
      ).toBeTruthy();
      expect(child.status?.phase, `the child: ${child.status?.error}`).toBe(
        ExecutionPhase.EXECUTION_COMPLETED,
      );

      // The runner created the child AND its session as the member: the
      // stamp is the member's account, the same actor the parent carries.
      expect(
        child.status?.audit?.specAudit?.createdBy?.id,
        "the child execution's creator",
      ).toBe(people.memberId);
      expect(
        settled.status?.audit?.specAudit?.createdBy?.id,
        "the parent's creator, for the record",
      ).toBe(people.memberId);
      const childSession = await people.member.sessionQuery.get({
        value: child.spec?.sessionId ?? "",
      });
      expect(
        childSession.status?.audit?.specAudit?.createdBy?.id,
        "the child session's creator",
      ).toBe(people.memberId);
      fixtures.defer(() =>
        people.member.sessionCommand.delete({
          value: childSession.metadata!.id,
        }),
      );

      // An outsider is refused both rows, and does not see the child in a list.
      await expectGrpcCode(
        () => outsider.agentExecutionQuery.get({ value: child.metadata!.id }),
        Code.PermissionDenied,
        "an outsider reading the member's child execution",
      );
      await expectGrpcCode(
        () => outsider.sessionQuery.get({ value: childSession.metadata!.id }),
        Code.PermissionDenied,
        "an outsider reading the member's child session",
      );
      const outsiderSees = await outsider.agentExecutionQuery.list({
        org: people.org,
      });
      expect(outsiderSees.entries.map((e) => e.metadata?.id)).not.toContain(
        child.metadata!.id,
      );
    });
  },
);
