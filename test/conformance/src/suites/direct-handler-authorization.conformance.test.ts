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
//     posture (DD-007 not-found arm; the Java edition answers
//     PERMISSION_DENIED on these lanes, an artifact of its missing load
//     steps — divergence ruled and recorded at the Stage-4 gate);
//   - the load-first family (updateSubject, the artifact trio, the MCP
//     connect trio) keeps its handler-owned NotFound copy for unknown
//     ids, outsider or not — the load fires before the check (#224).
//
// Single-user targets skip: one implicit caller, isolation untestable by
// construction (the organization suite's outsider precedent).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { createTarget, type TargetProfile } from "../targets";
import { FixtureTracker } from "../harness/fixtures";
import { expectGrpcCode } from "../contract/errors";
import { collectStream } from "../support/collect-stream";
import { makeAgent } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeMcpServer } from "../support/mcpservers";
import { makeSession } from "../support/sessions";
import { makeWorkflow } from "../support/workflows";
import { uniqueName } from "../support/naming";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

function multiTenantOnly(): boolean {
  return target.capabilities.multiTenant;
}

async function outsiderClients(): Promise<ConformanceClients> {
  if (target.provisionIdentity === undefined) {
    throw new Error(
      `target "${target.name}" declares multiTenant but provides no provisionIdentity()`,
    );
  }
  return target.provisionIdentity();
}

describe("direct-handler authorization — outsider denials (multi-tenant only)", () => {
  it("session updateSubject refuses an outsider with the annotation copy; the subject survives", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

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

  it("workflow getVersion refuses an outsider with the annotation copy (the ruled Java-gap divergence)", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

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
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

    const server = await clients.mcpServerCommand.create(
      makeMcpServer({ org, name: uniqueName("authz-mcp") }),
    );
    fixtures.defer(() =>
      clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }),
    );
    const id = server.metadata!.id;

    const lanes: ReadonlyArray<[string, () => Promise<unknown>, string]> = [
      [
        "connect",
        () => outsider.mcpServerCommand.connect({ mcpServerId: id, org }),
        "unauthorized to connect to mcp server",
      ],
      [
        "startConnect",
        () => outsider.mcpServerCommand.startConnect({ mcpServerId: id, org }),
        "unauthorized to connect to mcp server",
      ],
      [
        "initiateOAuthConnect",
        () =>
          outsider.mcpServerCommand.initiateOAuthConnect({
            mcpServerId: id,
            org,
          }),
        "unauthorized to initiate oauth connect for mcp server",
      ],
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
    for (const [lane, op, copy] of lanes) {
      const denied = await expectGrpcCode(
        op,
        Code.PermissionDenied,
        `outsider ${lane} on a foreign server`,
      );
      expect(denied.rawMessage, `${lane} annotation copy`).toBe(copy);
    }
  });

  it("the channel install pair refuses an outsider with its annotation copy (C2 close-out — the arm both editions declare)", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("authz-channel-agent") }),
    );
    fixtures.defer(() =>
      clients.agentCommand.delete({ value: agent.metadata!.id }),
    );
    const channel = await clients.agentChannelCommand.create(
      makeSlackAgentChannel(org, uniqueName("authz-channel"), agent.metadata!.slug),
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

  it("the authorize-first read lanes answer NOT_FOUND for unknown ids — the ruled uniform Q1 posture", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const outsider = await outsiderClients();

    await expectGrpcCode(
      () =>
        outsider.workflowExecutionQuery.getEventLog({
          executionId: "wfe_01conformancemissing",
        }),
      Code.NotFound,
      "outsider getEventLog on an unknown execution",
    );
    await expectGrpcCode(
      () =>
        collectStream((signal) =>
          outsider.workflowExecutionQuery.subscribe(
            { executionId: "wfe_01conformancemissing" },
            { signal },
          ),
        ),
      Code.NotFound,
      "outsider subscribe on an unknown workflow execution",
    );
    await expectGrpcCode(
      () =>
        collectStream((signal) =>
          outsider.workflowExecutionQuery.subscribeEvents(
            { executionId: "wfe_01conformancemissing" },
            { signal },
          ),
        ),
      Code.NotFound,
      "outsider subscribeEvents on an unknown workflow execution",
    );
    await expectGrpcCode(
      () =>
        collectStream((signal) =>
          outsider.agentExecutionQuery.subscribe(
            { value: "aexec_01conformancemissing" },
            { signal },
          ),
        ),
      Code.NotFound,
      "outsider subscribe on an unknown agent execution",
    );
    await expectGrpcCode(
      () =>
        outsider.agentExecutionQuery.getArtifactDownloadUrl({
          executionId: "aexec_01conformancemissing",
          storageKey: "artifacts/aexec_01conformancemissing/f.txt",
        }),
      Code.NotFound,
      "outsider getArtifactDownloadUrl on an unknown execution",
    );
    await expectGrpcCode(
      () =>
        outsider.agentExecutionQuery.getArtifactContent({
          executionId: "aexec_01conformancemissing",
          storageKey: "artifacts/aexec_01conformancemissing/f.txt",
        }),
      Code.NotFound,
      "outsider getArtifactContent on an unknown execution",
    );
  });
});
