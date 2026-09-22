// Direct-handler authorization conformance (C2 Stage 4, 20260827.10).
//
// The config-annotated methods served by DIRECT handlers evaluate their
// annotations since Stage 4 (docs/authorization-coverage.md carries the
// per-method dispositions). This suite pins the OUTSIDER contract on the
// multi-tenant edition — a second provisioned identity with no grants on
// the owner's resources:
//
//   - a write/read against an EXISTING foreign resource refuses
//     PERMISSION_DENIED with the method's byte-pinned annotation
//     error_msg (the copy doubles as the descriptor-mismatch guard), and
//     a denied write is side-effect free;
//   - an UNKNOWN id on the authorize-first family answers NOT_FOUND via
//     the authorizer's deny-path existence probe — the ruled UNIFORM Q1
//     posture (DD-007 not-found arm);
//   - the load-first family (updateSubject, the artifact trio, the MCP
//     connect trio) keeps its handler-owned NotFound copy for unknown
//     ids, outsider or not — the load fires before the check (#224).
//
// Three arms below sit where the retired Java edition once diverged by
// ruling (the per-method dispositions in docs/authorization-coverage.md);
// each is plain contract now, enforced strictly so a regression to the old
// gap turns the suite red:
//
//   - workflow getVersion evaluates its annotation and refuses an outsider
//     (Java declared the annotation but never evaluated it, stigmer-cloud#562);
//   - initiateOAuthConnect authorizes BEFORE the lane's auth-block
//     precondition (Java checked the precondition first);
//   - unknown ids on the authorize-first family answer the uniform NOT_FOUND
//     (Java answered PERMISSION_DENIED, an artifact of its missing load steps).
//
// Until stigmer#1023 the suite selected a contract per implementation behind
// the target (an env knob, stigmer#972, then TargetProfile.implementation,
// stigmer#1014); with one implementation left there is nothing to select.
//
// The arms run on the target's ENFORCING LANE (targets/target.ts): the
// cloud's primary, and on the managed local targets an open-source sibling
// in the OIDC posture, whose built-in Authorizer answers `authorizeDirect`
// the same way — so the outsider contract is one contract on the cloud and
// on both open-source store drivers. Where a target lends no lane the arms
// skip VISIBLY with its reason.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
} from "../targets";
import { FixtureTracker } from "../harness/fixtures";
import { expectGrpcCode, grpcCodeOf } from "../contract/errors";
import { collectStream } from "../support/collect-stream";
import { makeAgent } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeMcpServer } from "../support/mcpservers";
import { makeSession } from "../support/sessions";
import { makeWorkflow } from "../support/workflows";
import { uniqueName } from "../support/naming";

let target: TargetProfile;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
// The lane's founder — the OWNER of every resource the outsider is refused.
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  enforcing = await enforcingLaneOf(target);
  clients = enforcing.lane?.clients ?? target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
  if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
  return enforcing.lane;
}

describe("direct-handler authorization — outsider denials (on the enforcing lane)", () => {
  it("session updateSubject refuses an outsider with the annotation copy; the subject survives", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("authz-agent") }),
    );
    fixtures.defer(() =>
      clients.agentCommand.delete({ value: agent.metadata!.id }),
    );
    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("authz-session"),
        agentInstanceId: agent.status!.defaultInstanceId,
        subject: "owner's subject",
      }),
    );
    fixtures.defer(() =>
      clients.sessionCommand.delete({ value: session.metadata!.id }),
    );

    const denied = await expectGrpcCode(
      () =>
        outsider.sessionCommand.updateSubject({
          id: session.metadata!.id,
          subject: "hijacked",
        }),
      Code.PermissionDenied,
      "outsider updateSubject on a foreign session",
    );
    expect(denied.rawMessage).toBe("unauthorized to update session subject");
    // The denied write left the row untouched.
    const after = await clients.sessionQuery.get({
      value: session.metadata!.id,
    });
    expect(after.spec?.subject).toBe("owner's subject");
  });

  it("workflow getVersion refuses an outsider with the annotation copy", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    const workflow = await clients.workflowCommand.create(
      makeWorkflow({ org, name: uniqueName("authz-wf") }),
    );
    fixtures.defer(() =>
      clients.workflowCommand.delete({ value: workflow.metadata!.id }),
    );

    const denied = await expectGrpcCode(
      () =>
        outsider.workflowQuery.getVersion({
          workflowId: workflow.metadata!.id,
          versionHash: workflow.status!.versionHash,
        }),
      Code.PermissionDenied,
      "outsider getVersion on a foreign workflow",
    );
    expect(denied.rawMessage).toBe("unauthorized to get workflow version");
  });

  it("the MCP connect lanes refuse an outsider with their annotation copies", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    const server = await clients.mcpServerCommand.create(
      makeMcpServer({ org, name: uniqueName("authz-mcp") }),
    );
    fixtures.defer(() =>
      clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }),
    );
    const id = server.metadata!.id;

    // Ordering pin on the two engine-backed lanes: connect and startConnect
    // load and authorize BEFORE they check the engine (connect.ts,
    // start-connect.ts), the authorize-before-precondition order the run gate
    // and initiateOAuthConnect keep, so an outsider hears the denial on every
    // target — a Temporal-less server included, where the engine arm used to
    // answer FAILED_PRECONDITION first and disclose engine state.
    for (const [name, op] of [
      [
        "connect",
        () => outsider.mcpServerCommand.connect({ mcpServerId: id, org }),
      ],
      [
        "startConnect",
        () => outsider.mcpServerCommand.startConnect({ mcpServerId: id, org }),
      ],
    ] as const) {
      const refused = await expectGrpcCode(
        op,
        Code.PermissionDenied,
        `outsider ${name} on a foreign server`,
      );
      expect(refused.rawMessage, `${name} annotation copy`).toBe(
        "unauthorized to connect to mcp server",
      );
    }

    const rpcs: ReadonlyArray<[string, () => Promise<unknown>, string]> = [
      [
        "getOAuthGrantStatus",
        () =>
          outsider.mcpServerQuery.getOAuthGrantStatus({ resourceId: id, org }),
        "unauthorized to view oauth status for mcp server",
      ],
      [
        "disconnectOAuth",
        () =>
          outsider.mcpServerCommand.disconnectOAuth({ resourceId: id, org }),
        "unauthorized to disconnect oauth for mcp server",
      ],
    ];
    for (const [rpc, op, copy] of rpcs) {
      const denied = await expectGrpcCode(
        op,
        Code.PermissionDenied,
        `outsider ${rpc} on a foreign server`,
      );
      expect(denied.rawMessage, `${rpc} annotation copy`).toBe(copy);
    }

    // initiateOAuthConnect authorizes BEFORE the lane's auth-block
    // precondition: an outsider on a server without an auth block is refused
    // by the annotation, not by the precondition. Pinned by code AND copy so a
    // reorder of the two steps shows here (the retired Java edition checked
    // the precondition first and answered FAILED_PRECONDITION).
    const denied = await expectGrpcCode(
      () =>
        outsider.mcpServerCommand.initiateOAuthConnect({
          mcpServerId: id,
          org,
        }),
      Code.PermissionDenied,
      "outsider initiateOAuthConnect on a foreign server",
    );
    expect(denied.rawMessage, "initiateOAuthConnect annotation copy").toBe(
      "unauthorized to initiate oauth connect for mcp server",
    );
  });

  it("the channel install pair refuses an outsider with its annotation copy (C2 close-out — the arm both editions declare)", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("authz-channel-agent") }),
    );
    fixtures.defer(() =>
      clients.agentCommand.delete({ value: agent.metadata!.id }),
    );
    const channel = await clients.agentChannelCommand.create(
      makeSlackAgentChannel(
        org,
        uniqueName("authz-channel"),
        agent.metadata!.slug,
      ),
    );
    fixtures.defer(() =>
      clients.agentChannelCommand.delete({ value: channel.metadata!.id }),
    );

    const initiateDenied = await expectGrpcCode(
      () =>
        outsider.agentChannelCommand.initiateInstall({
          resourceId: channel.metadata!.id,
        }),
      Code.PermissionDenied,
      "outsider initiateInstall on a foreign channel",
    );
    expect(initiateDenied.rawMessage).toBe(
      "unauthorized to install agent channel",
    );
    const completeDenied = await expectGrpcCode(
      () =>
        outsider.agentChannelCommand.completeInstall({
          resourceId: channel.metadata!.id,
          state: "outsider-state",
          code: "outsider-code",
        }),
      Code.PermissionDenied,
      "outsider completeInstall on a foreign channel",
    );
    expect(completeDenied.rawMessage).toBe(
      "unauthorized to install agent channel",
    );
  });

  it("the authorize-first read lanes answer an outsider's unknown id with the ruled uniform Q1 NOT_FOUND", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const outsider = await lane.provisionIdentity();
    const missingWorkflowExecution = "wfe_01conformancemissing";
    const missingAgentExecution = "aexec_01conformancemissing";
    const missingArtifactKey = `artifacts/${missingAgentExecution}/f.txt`;

    const lanes: ReadonlyArray<[string, () => Promise<unknown>]> = [
      [
        "workflowExecution.getEventLog",
        () =>
          outsider.workflowExecutionQuery.getEventLog({
            executionId: missingWorkflowExecution,
          }),
      ],
      [
        "workflowExecution.subscribe",
        () =>
          collectStream((signal) =>
            outsider.workflowExecutionQuery.subscribe(
              { executionId: missingWorkflowExecution },
              { signal },
            ),
          ),
      ],
      [
        "workflowExecution.subscribeEvents",
        () =>
          collectStream((signal) =>
            outsider.workflowExecutionQuery.subscribeEvents(
              { executionId: missingWorkflowExecution },
              { signal },
            ),
          ),
      ],
      [
        "agentExecution.subscribe",
        () =>
          collectStream((signal) =>
            outsider.agentExecutionQuery.subscribe(
              { value: missingAgentExecution },
              { signal },
            ),
          ),
      ],
      [
        "agentExecution.getArtifactDownloadUrl",
        () =>
          outsider.agentExecutionQuery.getArtifactDownloadUrl({
            executionId: missingAgentExecution,
            storageKey: missingArtifactKey,
          }),
      ],
      [
        "agentExecution.getArtifactContent",
        () =>
          outsider.agentExecutionQuery.getArtifactContent({
            executionId: missingAgentExecution,
            storageKey: missingArtifactKey,
          }),
      ],
    ];

    // Observe every lane, THEN assert the whole table: a first-mismatch
    // abort would hide the lanes after it (the shape that once left five of
    // these six unobserved for a month).
    const observed: Record<string, string> = {};
    for (const [lane, op] of lanes) {
      observed[lane] =
        Code[await grpcCodeOf(op, `outsider ${lane} on an unknown execution`)];
    }
    expect(observed).toEqual(
      Object.fromEntries(lanes.map(([lane]) => [lane, "NotFound"])),
    );
  });
});
