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
// own credential at dispatch and carries it on the engine's run input; the runner
// presents it on every RPC about that run; and the built-in verifier admits
// its bearer AS THE RUN'S HUMAN. What follows over the wire, and is pinned here:
//
//   - a MEMBER's run, served by a runner keyed with the OPERATOR's key,
//     completes, its status writes land, and the runner titles its session
//     as the member (stigmer#1137 was every such run failing INTERNAL);
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
//   - a run's credential works in its run's organization: the operator's run
//     credential is refused on the operator's own row in a second
//     organization, and a key the operator limited to that second
//     organization cannot swap itself through the exchange for the run's
//     credential, so a credential limited to one organization never widens
//     itself through a run;
//   - the runner's MCP children act as the person who asked. An MCP server
//     is an organization's blueprint, an admin's to author; a member brings
//     their own credential to it. A member's connect of an admin-authored,
//     org-visible server that declares a credential SUCCEEDS with the
//     fixture's tools: the connect's attempt records the member and the
//     connect token admits the runner as the member for the values fetch
//     from the member's My vault (stigmer#1137's connect half).
//     A key the run's agent declares is filled from the TURN SENDER's My
//     vault when the conversation includes it: a member's turn on the
//     founder's org-visible agent plans and fetches the
//     member's saved value, never the founder's saved after it (stigmer#1198:
//     a person's own logins and secrets serve only their own runs). (The
//     sharper form, a teammate's turn in someone else's session, needs a
//     per-session viewer grant, which open source's organization-only grant
//     scope refuses; the server's resolver unit arms pin that the person is
//     the turn's recorded person.) A run reads only the vaults its
//     conversation chose: an agent carries none, so a usable team vault
//     serves a member's run only once the conversation lists it. A user
//     signed in through a PlatformClient is no person of their run, so
//     their run reads no My vault, even their own and even when the
//     conversation includes it: only the conversation's vaults serve it
//     (an integrator keeps such a user's keys in a vault it names). A schedule's
//     vault stops serving its fires once the account that attached it may
//     no longer use it. A member's run with memory
//     on, whose agent calls `remember`, writes a Memory whose subject is the
//     member and whose provenance session is the run's, which the operator —
//     an organization owner — cannot list (stigmer#1147: the stdio child
//     presented no credential, and every capture was refused).
//
// Deliberately out of scope, with the reason:
//   - the credential refused AFTER its run is terminal: the grace is ten
//     wall-clock minutes measured from the row's completed_at, not
//     observable over the wire in a test's budget; the verifier's unit arms
//     pin it with an injectable clock;
//   - "the runner made no exchange call": the runner's own unit arm on
//     acquireScopedRunnerToken pins the short-circuit; a conformance arm
//     reads outcomes, never a server log;
//   - the discovery's McpServer metadata read: it rides the runner's own
//     credential, an organization admin's under the chart's install, whom
//     the model makes an owner of every McpServer in the organization. No
//     arm here tells that key from the member's connect token — every
//     server a member may connect is one both may read — so which key the
//     read rides is the runner's own units' to pin, not this suite's.
//
// The arms run on the target's ENFORCING LANE (targets/target.ts): on the
// execution targets an open-source sibling in the OIDC posture WITH its own
// engine and a runner keyed with the founder's API key
// (harness/enforcing-execution-lane.ts), on both store drivers by the
// storage seam. They gate on CapabilityFlags.runnerActsAsRunCreator: the
// cloud-execution target's runner is an embedded runner acting as the
// primary user, a different shape whose proof is the composition's own.
import { Code } from "@connectrpc/connect";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ScheduleFireOutcome } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import {
  anthropicText,
  anthropicToolUse,
  type AnthropicMessageBody,
} from "@stigmer/test-support/llm-wire";
import { ECHO_TOOL_NAME } from "../harness/mcp-server";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { type AgentRefInit, agentRefOf, makeAgent } from "../support/agents";
import {
  awaitTerminal,
  makeAgentExecution,
  requireMcpFixture,
  sessionIdOf,
} from "../support/runs";
import { makeApiKey, plaintextKeyOf } from "../support/apikeys";
import { makeSchedule } from "../support/schedules";
import { makeSessionSpec } from "../support/sessions";
import { organizationRole } from "../support/iampolicies";
import {
  createPlatformClient,
  deletePlatformClient,
  mintUserToken,
} from "../support/platformclients";
import { makeSharedVault, myVaultTarget, setSecretsInput, vaultTarget } from "../support/vaults";
import { RunValueOrigin, agentSourceOf, fetchRunValues, runSourcesOf, sourcesFor } from "../support/run-values";
import { pollUntil } from "../support/run-poll";
import { makeHttpMcpServer } from "../support/mcpservers";
import {
  enableMyMemory,
  enableOrganizationMemory,
  MEMORY_CAP,
} from "../support/memories";
import { uniqueName } from "../support/naming";
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

// The placeholder the server's auto-created sessions start with; the titling
// activity replaces it.
const UNTITLED_SESSION_SUBJECT = "Auto-created session";

// The exchange's refusal under the enforcing posture, byte-pinned in the
// server's runnerauth constants; the arm asserts the sentence, not just the
// code, because the code alone is what a can_view refusal would also answer.
const NOT_RUNS_PERSON_MESSAGE =
  "a run credential is minted only for the person whose run it is";

// The exchange's refusal of a credential bound to another organization than
// the run's, byte-pinned in the server's credential binding (a read
// refusal answers the Authorize step's own copy, so only the code is
// asserted there).
const BOUND_ELSEWHERE_MESSAGE =
  "this credential is bound to another organization";

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
      const mock = enforcing.lane?.llmProxy?.();
      mock?.releaseHolds();
      // An arm can end while its run has not yet reached the model, and the
      // next arm's run would then take a script that is not its own. Wait,
      // bounded and best-effort, for every scripted turn to be claimed: an
      // arm whose create was refused started no run, and reset() drops its
      // turn.
      const claimDeadline = Date.now() + 15_000;
      while (mock !== undefined && mock.remaining() > 0 && Date.now() < claimDeadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      await fixtures.cleanup();
      mock?.reset();
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

    // A run dispatched by `by` on `agent`, scripted on the lane's runner with
    // `script` — one text turn unless an arm needs a tool call first (the mock
    // answers the runner's background title call out of band, so a run costs
    // exactly its scripted turns).
    async function dispatchRun(
      mock: MockLlmProxy,
      by: ConformanceClients,
      org: string,
      agentRef: AgentRefInit,
      label: string,
      script: AnthropicMessageBody[] = [
        anthropicText(`Hello from the ${label} run.`),
      ],
    ): Promise<Run> {
      for (const turn of script) mock.enqueue(turn);
      const created = await by.agentExecutionCommand.create(
        makeAgentExecution({
          org,
          name: uniqueName(label),
          agentRef,
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
        scope: { case: "runId", value: executionId },
      });
      expect(
        minted.runnerScopedToken,
        "the exchange mints for the run's own person",
      ).not.toBe("");
      expect(minted.tokenType).toBe("Bearer");
      return minted.runnerScopedToken;
    }

    // Saves secrets into `by`'s own My vault in `org` (created on the first
    // write); the person deletes it at teardown, since nobody else may.
    async function saveToMyVault(
      by: ConformanceClients,
      org: string,
      secrets: Record<string, string>,
    ): Promise<string> {
      const mine = await by.vaultCommand.setSecrets(
        setSecretsInput(myVaultTarget(org), secrets),
      );
      fixtures.defer(() =>
        by.vaultCommand
          .delete({ resourceId: mine.metadata!.id })
          .catch(() => undefined),
      );
      return mine.metadata!.id;
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
        agentRefOf(agent),
        "member",
      );
      const founderRun = await dispatchRun(
        mock,
        people.founder,
        people.org,
        agentRefOf(agent),
        "operator",
      );

      const [memberFinal, founderFinal] = await Promise.all([
        awaitTerminal(people.member, memberRun.metadata!.id),
        awaitTerminal(people.founder, founderRun.metadata!.id),
      ]);
      expect(
        memberFinal.status?.phase,
        `the member's run: ${memberFinal.status?.error}`,
      ).toBe(RunPhase.RUN_COMPLETED);
      expect(
        memberFinal.status?.completedAt,
        "the runner's terminal write stamps completed_at",
      ).toBeTruthy();
      expect(
        founderFinal.status?.phase,
        `the operator's run: ${founderFinal.status?.error}`,
      ).toBe(RunPhase.RUN_COMPLETED);
      expect(
        mock.consumed(),
        "both runs consumed exactly their scripted turn",
      ).toBe(2);

      // The titling activity ran AS THE MEMBER: it read the member's run and
      // wrote the member's session, which the operator's key alone could not.
      const session = await awaitTitled(
        people.member,
        sessionIdOf(memberFinal),
      );
      expect(session.spec?.subject).not.toBe(UNTITLED_SESSION_SUBJECT);
    });

    it("[rpc:RunCommandController.updateStatus] an API key alone is not a delegate: the operator's key on the member's run is refused", async (ctx) => {
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
        agentRefOf(agent),
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
            runId: run.metadata!.id,
            status: { phase: RunPhase.RUN_IN_PROGRESS },
          }),
        Code.PermissionDenied,
        "the operator's API key writing status on the member's run",
      );

      await awaitTerminal(people.member, run.metadata!.id);
    });

    it("[rpc:PlatformQueryController.getRunnerScopedToken] the exchange is a mint gate: a missing run is NOT_FOUND, another person's run is PERMISSION_DENIED, one's own run mints a credential that IS oneself", async (ctx) => {
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
        agentRefOf(agent),
        "member",
      );
      const founderRun = await dispatchRun(
        mock,
        people.founder,
        people.org,
        agentRefOf(agent),
        "operator",
      );

      await expectGrpcCode(
        () =>
          people.member.platformQuery.getRunnerScopedToken({
            scope: {
              case: "runId",
              value: `aex_${uniqueName("missing")}`,
            },
          }),
        Code.NotFound,
        "a run that does not exist",
      );

      const refused = await expectGrpcCode(
        () =>
          people.member.platformQuery.getRunnerScopedToken({
            scope: { case: "runId", value: founderRun.metadata!.id },
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

    it("[rpc:PlatformQueryController.getRunnerScopedToken] a run credential is its human, not a wildcard: refused on another person's run, admitted on the same person's other run (the recorded reach)", async (ctx) => {
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
        agentRefOf(agent),
        "member-x",
      );
      const runY = await dispatchRun(
        mock,
        people.member,
        people.org,
        agentRefOf(agent),
        "member-y",
      );
      const founderRun = await dispatchRun(
        mock,
        people.founder,
        people.org,
        agentRefOf(agent),
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

    it("[rpc:PlatformQueryController.getRunnerScopedToken] a run's credential works in its run's organization: refused on the person's row in another, and a key limited to the other cannot swap itself for it", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);
      const elsewhere = await lane.provisionTenancy();
      fixtures.defer(() => lane.cleanupTenancy(elsewhere));
      const agent = await createAgent(
        people,
        ApiResourceVisibility.visibility_org,
        "ras-bound",
      );
      const agentElsewhere = await people.founder.agentCommand.create(
        makeAgent({ org: elsewhere.org, name: uniqueName("ras-bound-other") }),
      );
      fixtures.defer(() =>
        people.founder.agentCommand.delete({
          value: agentElsewhere.metadata!.id,
        }),
      );
      const run = await dispatchRun(
        mock,
        people.founder,
        people.org,
        agentRefOf(agent),
        "operator",
      );

      const asRun = lane.clientsPresenting(
        await runCredentialOf(people.founder, run.metadata!.id),
      );
      const inside = await asRun.agentQuery.get({ value: agent.metadata!.id });
      expect(
        inside.metadata?.id,
        "the run credential reads its run's organization",
      ).toBe(agent.metadata!.id);
      await expectGrpcCode(
        () => asRun.agentQuery.get({ value: agentElsewhere.metadata!.id }),
        Code.PermissionDenied,
        "the run credential reading the person's own agent in another organization",
      );

      const key = await people.founder.apiKeyCommand.create({
        ...makeApiKey({
          name: uniqueName("ras-bound-key"),
          org: elsewhere.org,
        }),
        spec: { boundOrg: elsewhere.org },
      });
      fixtures.defer(() =>
        people.founder.apiKeyCommand.delete({ value: key.metadata!.id }),
      );
      const swap = await expectGrpcCode(
        () =>
          lane
            .clientsPresenting(plaintextKeyOf(key))
            .platformQuery.getRunnerScopedToken({
              scope: { case: "runId", value: run.metadata!.id },
            }),
        Code.PermissionDenied,
        "a key limited to another organization asking for the run's credential",
      );
      expect(swap.rawMessage).toContain(BOUND_ELSEWHERE_MESSAGE);

      await awaitTerminal(people.founder, run.metadata!.id);
    });

    it("[rpc:McpServerCommandController.connect] a member's connect of an admin-authored server with their own credential succeeds: the connect's attempt records the member, and the connect token admits the runner as the member for the values fetch", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);
      const mcpTools = requireMcpFixture(target);

      // The founder (the organization's owner, so an admin) authors an
      // ORG-VISIBLE server that declares a credential — authoring an MCP
      // server is the organization's blueprint bar, and a member holds
      // `can_connect` on an org-visible row and on no private one. The
      // member saves the credential in their own My vault in the
      // organization; the connect reads it from THERE, as the member,
      // through the connect token — the read this arm proves.
      await saveToMyVault(people.member, people.org, {
        RAS_REQUIRED_KEY: "member-credential",
      });
      const input = makeHttpMcpServer({
        org: people.org,
        name: uniqueName("ras-credentialed"),
        url: mcpTools.url(),
        env: {
          RAS_REQUIRED_KEY: {
            description: "a required credential",
            isSecret: true,
          },
        },
      });
      input.metadata = {
        ...input.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      };
      const server = await people.founder.mcpServerCommand.create(input);
      fixtures.defer(() =>
        people.founder.mcpServerCommand.delete({
          resourceId: server.metadata!.id,
        }),
      );

      // A refused fetch fails discovery loudly, so SUCCEEDED with the
      // fixture's tool is the proof the value was fetched as the member.
      const connected = await people.member.mcpServerCommand.connect({
        mcpServerId: server.metadata!.id,
        org: people.org,
      });
      expect(
        connected.status?.connectStatus?.phase,
        `the member's connect: ${connected.status?.connectStatus?.failureMessage ?? ""}`,
      ).toBe(ConnectPhase.succeeded);
      expect(
        (connected.status?.discoveredCapabilities?.tools ?? []).map(
          (t) => t.name,
        ),
      ).toEqual([ECHO_TOOL_NAME]);
      expect(mock.requests(), "a connect asks no model").toEqual([]);
    });

    it("[rpc:McpServerCommandController.connect] a member's connect reads the member's own saved credential, never the founder's saved after it", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);
      const mcpTools = requireMcpFixture(target);

      // Both people save the credential the server declares, the founder
      // LAST: a lookup that took the organization's newest My vault would
      // hand the member the founder's. The server templates the credential
      // into a header, so the fixture shows on the wire whose value the
      // connect carried.
      for (const [client, value] of [
        [people.member, "member-credential"],
        [people.founder, "founder-credential"],
      ] as const) {
        await saveToMyVault(client, people.org, { RAS_REQUIRED_KEY: value });
      }
      const input = makeHttpMcpServer({
        org: people.org,
        name: uniqueName("ras-credential-header"),
        url: mcpTools.url(),
        headers: { "X-Ras-Credential": "${RAS_REQUIRED_KEY}" },
        env: {
          RAS_REQUIRED_KEY: {
            description: "a required credential",
            isSecret: true,
          },
        },
      });
      input.metadata = {
        ...input.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      };
      const server = await people.founder.mcpServerCommand.create(input);
      fixtures.defer(() =>
        people.founder.mcpServerCommand.delete({
          resourceId: server.metadata!.id,
        }),
      );

      mcpTools.resetCaptured();
      const connected = await people.member.mcpServerCommand.connect({
        mcpServerId: server.metadata!.id,
        org: people.org,
      });
      expect(
        connected.status?.connectStatus?.phase,
        `the member's connect: ${connected.status?.connectStatus?.failureMessage ?? ""}`,
      ).toBe(ConnectPhase.succeeded);
      const carried = mcpTools
        .capturedRequests()
        .map((request) => request.headers["x-ras-credential"])
        .filter((value) => value !== undefined);
      expect(
        carried.length,
        "the discovery reached the fixture",
      ).toBeGreaterThan(0);
      expect(new Set(carried)).toEqual(new Set(["member-credential"]));
    });

    it("[rpc:RunCommandController.create] a key the agent declares is filled from the turn sender's My vault when the conversation includes it, never the agent author's saved after it", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);

      // Both people save the key the agent declares, the founder (the agent's
      // author) LAST: a fill that took the organization's newest My vault,
      // or the author's, would hand the member the founder's. The founder
      // also saves a key only they hold: its absence from the member's plan
      // and fetch is the proof that no key came from the founder's My vault.
      const memberVaultId = await saveToMyVault(people.member, people.org, {
        RAS_BRIDGE_KEY: "member-value",
      });
      await saveToMyVault(people.founder, people.org, {
        RAS_BRIDGE_KEY: "founder-value",
        RAS_FOUNDER_ONLY_KEY: "founder-only",
      });
      const input = makeAgent({
        org: people.org,
        name: uniqueName("ras-bridge-agent"),
        env: {
          RAS_BRIDGE_KEY: { isSecret: false },
          RAS_FOUNDER_ONLY_KEY: { isSecret: false, optional: true },
        },
      });
      input.metadata = {
        ...input.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      };
      const agent = await people.founder.agentCommand.create(input);
      fixtures.defer(() =>
        people.founder.agentCommand.delete({ value: agent.metadata!.id }),
      );

      // The turn's shell call is held so the run stays live while its values
      // are fetched with its own credential (the member's run, so the member
      // mints it); the agent's shell proves the same end to end.
      mock.enqueue(
        anthropicToolUse("call_bridge", "execute", {
          command:
            'echo "BRIDGE=[$RAS_BRIDGE_KEY] FOUNDER_ONLY=[$RAS_FOUNDER_ONLY_KEY]"',
        }),
        { delayMs: 30_000 },
      );
      mock.enqueue(anthropicText("Done."));
      const created = await people.member.agentExecutionCommand.create(
        makeAgentExecution({
          org: people.org,
          name: uniqueName("ras-bridge"),
          agentRef: agentRefOf(agent),
          includeMyVault: true,
          autoApproveAll: true,
        }),
      );
      fixtures.defer(async () => {
        mock.releaseHolds();
        await awaitTerminal(people.member, created.metadata!.id);
        await people.member.agentExecutionCommand.delete({
          value: created.metadata!.id,
        });
      });

      const sources = await runSourcesOf(people.member, created.metadata!.id);
      expect(
        sourcesFor(sources, "RAS_FOUNDER_ONLY_KEY"),
        "nothing is planned from the agent author's My vault",
      ).toEqual([]);
      const bridge = agentSourceOf(sources, "RAS_BRIDGE_KEY");
      expect(bridge?.origin, "the declared key is the turn sender's").toBe(
        RunValueOrigin.MY_VAULT,
      );
      expect(bridge?.vaultId).toBe(memberVaultId);
      const runner = lane.clientsPresenting(
        await runCredentialOf(people.member, created.metadata!.id),
      );
      const fetched = await fetchRunValues(runner, created.metadata!.id);
      expect(fetched.agent.RAS_BRIDGE_KEY).toBe("member-value");
      expect(
        fetched.agent.RAS_FOUNDER_ONLY_KEY,
        "the founder's own key never reaches the member's run",
      ).toBeUndefined();

      mock.releaseHolds();
      const settled = await awaitTerminal(people.member, created.metadata!.id);
      expect(
        settled.status?.phase,
        `the member's run: ${settled.status?.error}`,
      ).toBe(RunPhase.RUN_COMPLETED);
      const shell = mock
        .scriptedRequests()
        .map((request) => JSON.stringify(request.body))
        .join("\n");
      expect(shell, "the member's run received the member's value").toContain(
        "BRIDGE=[member-value] FOUNDER_ONLY=[]",
      );
      expect(shell, "the founder's values never reached it").not.toMatch(
        /founder-value|founder-only/,
      );
    });

    it("[rpc:RunCommandController.create] a run reads only the vaults its conversation chose: an agent carries none", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);

      // The founder (an admin) keeps the team's key in a shared vault every
      // member may use, and authors an org-visible agent that declares it.
      const team = await people.founder.vaultCommand.create(
        makeSharedVault({ org: people.org, name: uniqueName("ras-team") }),
      );
      fixtures.defer(() =>
        people.founder.vaultCommand.delete({ resourceId: team.metadata!.id }),
      );
      await people.founder.vaultCommand.setSecrets(
        setSecretsInput(vaultTarget(people.org, team.metadata!.id), {
          RAS_TEAM_KEY: "team-value",
        }),
      );
      await people.founder.vaultCommand.updateVisibility({
        resourceId: team.metadata!.id,
        visibility: ApiResourceVisibility.visibility_org,
      });
      const input = makeAgent({
        org: people.org,
        name: uniqueName("ras-team-agent"),
        env: { RAS_TEAM_KEY: {} },
      });
      input.metadata = {
        ...input.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      };
      const agent = await people.founder.agentCommand.create(input);
      fixtures.defer(() =>
        people.founder.agentCommand.delete({ value: agent.metadata!.id }),
      );

      // A conversation that names only the member's own My vault never
      // reaches the team's vault, however usable: the create refuses.
      await expectGrpcCode(
        () =>
          people.member.agentExecutionCommand.create(
            makeAgentExecution({
              org: people.org,
              name: uniqueName("ras-team-unpicked"),
              agentRef: agentRefOf(agent),
              includeMyVault: true,
            }),
          ),
        Code.FailedPrecondition,
        "a member's run on a conversation that did not pick the team's vault",
      );

      // Picked by the conversation, the vault serves the member's run.
      mock.enqueue(anthropicText("Working..."), { delayMs: 30_000 });
      const created = await people.member.agentExecutionCommand.create(
        makeAgentExecution({
          org: people.org,
          name: uniqueName("ras-team-picked"),
          agentRef: agentRefOf(agent),
          sessionSpec: makeSessionSpec({
            subject: "team vault picked",
            vaults: [team.metadata!.slug],
          }),
        }),
      );
      fixtures.defer(async () => {
        mock.releaseHolds();
        await awaitTerminal(people.member, created.metadata!.id);
        await people.member.agentExecutionCommand.delete({
          value: created.metadata!.id,
        });
      });
      const teamSource = agentSourceOf(
        await runSourcesOf(people.member, created.metadata!.id),
        "RAS_TEAM_KEY",
      );
      expect(teamSource?.origin).toBe(RunValueOrigin.VAULT);
      expect(teamSource?.vaultId).toBe(team.metadata!.id);
    });

    it("[rpc:RunCommandController.create] a PlatformClient user's run reads no My vault, their own included, even when the conversation includes it: only its vaults serve the run", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      if (!target.capabilities.platformClientTokens) {
        return ctx.skip("this target's enforcing lane mints no PlatformClient user tokens");
      }
      const people = await provisionPeople(lane);
      const client = await createPlatformClient(people.founder, {
        org: people.org,
        name: uniqueName("ras-pc"),
        signInRole: IamRole.member,
      });
      fixtures.defer(() => deletePlatformClient(people.founder, client.id));
      const user = lane.clientsPresenting(
        await mintUserToken(people.founder, client.credentials, uniqueName("ras-pc-user")),
      );

      // The user may keep a My vault (the first write creates it), and the
      // founder keeps the integrator's copy of the key in a shared vault
      // every member may use, on an agent that requires it.
      const userVaultId = await saveToMyVault(user, people.org, {
        RAS_PC_KEY: "user-own-value",
      });
      const team = await people.founder.vaultCommand.create(
        makeSharedVault({ org: people.org, name: uniqueName("ras-pc-customer") }),
      );
      fixtures.defer(() =>
        people.founder.vaultCommand.delete({ resourceId: team.metadata!.id }),
      );
      await people.founder.vaultCommand.setSecrets(
        setSecretsInput(vaultTarget(people.org, team.metadata!.id), {
          RAS_PC_KEY: "customer-vault-value",
        }),
      );
      await people.founder.vaultCommand.updateVisibility({
        resourceId: team.metadata!.id,
        visibility: ApiResourceVisibility.visibility_org,
      });
      const input = makeAgent({
        org: people.org,
        name: uniqueName("ras-pc-agent"),
        env: { RAS_PC_KEY: {} },
      });
      input.metadata = {
        ...input.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      };
      const agent = await people.founder.agentCommand.create(input);
      fixtures.defer(() =>
        people.founder.agentCommand.delete({ value: agent.metadata!.id }),
      );

      // Including My vault reaches nothing: the key only there is missing.
      const refused = await expectGrpcCode(
        () =>
          user.agentExecutionCommand.create(
            makeAgentExecution({
              org: people.org,
              name: uniqueName("ras-pc-mine"),
              agentRef: agentRefOf(agent),
              sessionSpec: makeSessionSpec({
                subject: "platform client user, My vault included",
                includeMyVault: true,
              }),
            }),
          ),
        Code.FailedPrecondition,
        "a PlatformClient user's run whose key is only in their own My vault",
      );
      expect(refused.rawMessage).toContain("RAS_PC_KEY");

      // Listed by the conversation, the shared vault serves the run, and the
      // user's own My vault still contributes nothing.
      mock.enqueue(anthropicText("Working..."), { delayMs: 30_000 });
      const created = await user.agentExecutionCommand.create(
        makeAgentExecution({
          org: people.org,
          name: uniqueName("ras-pc-listed"),
          agentRef: agentRefOf(agent),
          sessionSpec: makeSessionSpec({
            subject: "platform client user, customer vault listed",
            includeMyVault: true,
            vaults: [team.metadata!.slug],
          }),
        }),
      );
      fixtures.defer(async () => {
        mock.releaseHolds();
        await awaitTerminal(user, created.metadata!.id);
        await user.agentExecutionCommand.delete({ value: created.metadata!.id });
      });
      const sources = await runSourcesOf(user, created.metadata!.id);
      const source = agentSourceOf(sources, "RAS_PC_KEY");
      expect(source?.origin, "the key comes from the listed vault").toBe(RunValueOrigin.VAULT);
      expect(source?.vaultId).toBe(team.metadata!.id);
      expect(
        sources.some((entry) => entry.vaultId === userVaultId),
        "nothing is planned from the user's own My vault",
      ).toBe(false);
    });

    it("[rpc:ScheduleCommandController.trigger] a schedule's vault stops serving its fires once the account that attached it may no longer use it", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const tenancy: TenancyContext = await lane.provisionTenancy();
      fixtures.defer(() => lane.cleanupTenancy(tenancy));
      const org = tenancy.org;

      // An admin of the organization (not its owner, so the role can be
      // taken away) authors an agent and a schedule, and attaches a PRIVATE
      // shared vault the founder made: an admin may use it.
      const admin = await lane.provisionWithRole(tenancy, "admin");
      const adminId = await lane.accountIdOf(admin);
      const team = await lane.clients.vaultCommand.create(
        makeSharedVault({ org, name: uniqueName("ras-sched-vault") }),
      );
      fixtures.defer(() =>
        lane.clients.vaultCommand.delete({ resourceId: team.metadata!.id }),
      );
      await lane.clients.vaultCommand.setSecrets(
        setSecretsInput(vaultTarget(org, team.metadata!.id), {
          RAS_SCHEDULE_KEY: "schedule-value",
        }),
      );
      const agent = await admin.agentCommand.create(
        makeAgent({
          org,
          name: uniqueName("ras-sched-agent"),
          env: { RAS_SCHEDULE_KEY: {} },
        }),
      );
      fixtures.defer(() =>
        lane.clients.agentCommand.delete({ value: agent.metadata!.id }),
      );
      const schedule = await admin.scheduleCommand.create(
        makeSchedule(org, uniqueName("ras-sched"), agent.metadata!.slug, {
          vaults: [team.metadata!.slug],
        }),
      );
      fixtures.defer(() =>
        lane.clients.scheduleCommand
          .delete({ value: schedule.metadata!.id })
          .catch(() => undefined),
      );
      expect(schedule.status?.vaultAttachers?.[team.metadata!.id]).toBe(
        adminId,
      );

      mock.enqueue(anthropicText("Scheduled work."));
      const allowed = await lane.clients.scheduleCommand.trigger({
        value: schedule.metadata!.id,
      });
      expect(
        allowed.outcome,
        `the attacher may use the vault: ${allowed.refusalReason}`,
      ).toBe(ScheduleFireOutcome.STARTED);
      fixtures.defer(async () => {
        await awaitTerminal(lane.clients, allowed.runId).catch(() => undefined);
        await lane.clients.agentExecutionCommand
          .delete({ value: allowed.runId })
          .catch(() => undefined);
      });

      // The admin becomes a member: no longer one who may use the private
      // vault. The next fire refuses, naming the vault.
      await lane.clients.iamPolicyCommand.create(
        organizationRole(adminId, "member", org),
      );
      await lane.clients.iamPolicyCommand.delete(
        organizationRole(adminId, "admin", org),
      );
      const refused = await pollUntil(
        () =>
          lane.clients.scheduleCommand.trigger({
            value: schedule.metadata!.id,
          }),
        (result) => result.outcome !== ScheduleFireOutcome.STARTED,
        (last, timeoutMs) =>
          `the schedule still fired ${timeoutMs}ms after its attacher lost use of the vault (outcome ${last?.outcome})`,
      );
      expect(refused.runId).toBe("");
      expect(refused.refusalReason).toContain(
        "may no longer be used by the account that attached it",
      );
    });

    it("a member's run with memory on proposes a memory that is the member's: the stdio remember child acts as the run's person, and the operator cannot list it", async (ctx) => {
      const { lane, mock } = laneOrSkip(ctx);
      const people = await provisionPeople(lane);

      // Memory is a double opt-in where callers are persons (stigmer#1387):
      // the organization's switch, which an admin turns on (the founder owns
      // the organization), and the switch of the person the memory is about,
      // which only that person turns on.
      await enableOrganizationMemory(people.founder, people.org);
      await enableMyMemory(people.member);
      const agent = await createAgent(
        people,
        ApiResourceVisibility.visibility_org,
        "ras-remembering",
      );

      // The agent proposes one fact through `remember`, then answers. The
      // remember tool is the runner-synthesized stdio child, which now holds
      // the run's credential — without it every capture is refused as
      // nobody's on a server that signs people in.
      const fact = "Prefers concise answers with code examples.";
      const run = await dispatchRun(
        mock,
        people.member,
        people.org,
        agentRefOf(agent),
        "member-remember",
        [
          anthropicToolUse("toolu_remember", "remember", { fact }),
          anthropicText("I have suggested that as a memory."),
        ],
      );
      const settled = await awaitTerminal(people.member, run.metadata!.id);
      expect(
        settled.status?.phase,
        `the remembering run: ${settled.status?.error}`,
      ).toBe(RunPhase.RUN_COMPLETED);
      expect(mock.consumed(), "the tool turn and the answer").toBe(2);

      // The memory model is subject-only: the person a memory is ABOUT is its
      // one principal. The member lists exactly the fact the run proposed,
      // stamped with the member as subject and the run's session as provenance
      // — the server derived both from the credential, nothing the child said.
      const mine = await people.member.memoryQuery.list({
        org: people.org,
        pageInfo: { num: 1, size: MEMORY_CAP },
      });
      expect(mine.items.map((m) => m.spec?.content)).toEqual([fact]);
      const memory = mine.items[0]!;
      fixtures.defer(() =>
        people.member.memoryCommand.delete({ value: memory.metadata!.id }),
      );
      expect(memory.spec?.subjectIdentityAccountId).toBe(people.memberId);
      expect(memory.spec?.provenance?.sessionId).toBe(sessionIdOf(settled));
      expect(memory.spec?.provenance?.runId).toBe(run.metadata!.id);

      // The operator — an organization owner, whose key the runner holds —
      // is not the memory's subject and sees nothing.
      const operatorSees = await people.founder.memoryQuery.list({
        org: people.org,
        pageInfo: { num: 1, size: MEMORY_CAP },
      });
      expect(operatorSees.items).toEqual([]);
    });
  },
);
