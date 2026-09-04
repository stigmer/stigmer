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
// Both cloud editions serve behind the same `cloud` target type, so the
// suite cannot tell them apart by target name — and three arms below pin
// behavior on which the editions DIVERGE by ruling, not by drift (the
// per-method dispositions in docs/authorization-coverage.md):
//
//   - workflow getVersion: this server evaluates the annotation; the Java
//     edition declares it but never evaluates it (stigmer-cloud#562,
//     accept-until-cutover) — there is no refusal to assert on Java until
//     the flip, and pinning the permissive answer would enshrine the gap;
//   - initiateOAuthConnect: this server authorizes before the lane's
//     precondition; Java checks the auth-block precondition FIRST and
//     answers an outsider FAILED_PRECONDITION;
//   - unknown ids on the authorize-first family: this server's uniform
//     NOT_FOUND vs the Java edition's PERMISSION_DENIED — an artifact of
//     its missing load steps, ruled at the Stage-4 gate.
//
// The contract under test is declared explicitly via
// STIGMER_CONFORMANCE_DIRECT_HANDLER_AUTHZ_CONTRACT ("java-baseline" |
// "annotation-enforced", default "java-baseline" — the nightly hermetic
// Java lane runs unchanged; composition readouts set "annotation-enforced").
// The STIGMER_CONFORMANCE_BILLING_DENIAL_CONTRACT precedent: each arm is
// enforced strictly, so a composition regressing to a Java gap, or Java
// changing its bytes, turns this suite red.
//
// Single-user targets skip: one implicit caller, isolation untestable by
// construction (the organization suite's outsider precedent).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { createTarget, type TargetProfile } from "../targets";
import { FixtureTracker } from "../harness/fixtures";
import { expectGrpcCode, grpcCodeOf } from "../contract/errors";
import { collectStream } from "../support/collect-stream";
import { makeAgent } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeMcpServer } from "../support/mcpservers";
import { makeSession } from "../support/sessions";
import { makeWorkflow } from "../support/workflows";
import { uniqueName } from "../support/naming";

const AUTHZ_CONTRACT_ENV = "STIGMER_CONFORMANCE_DIRECT_HANDLER_AUTHZ_CONTRACT";
type AuthzContract = "java-baseline" | "annotation-enforced";

function resolveAuthzContract(): AuthzContract {
  const raw = process.env[AUTHZ_CONTRACT_ENV] ?? "java-baseline";
  if (raw !== "java-baseline" && raw !== "annotation-enforced") {
    throw new Error(
      `${AUTHZ_CONTRACT_ENV} must be "java-baseline" or "annotation-enforced" when set; got "${raw}"`,
    );
  }
  return raw;
}

const authzContract = resolveAuthzContract();

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
    // The Java edition never evaluates this annotation (stigmer-cloud#562,
    // accept-until-cutover): an outsider's read SUCCEEDS there. That is a
    // recorded gap, not a contract — so under the Java baseline there is
    // nothing to pin, and asserting the permissive answer would turn the
    // gap into one. The arm resumes for Java the day #562 closes at the flip.
    if (authzContract === "java-baseline") return ctx.skip();
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

    // initiateOAuthConnect is the one connect lane the editions order
    // differently. This server authorizes before the lane's precondition
    // (the annotation copy). Java checks that the server carries an auth
    // block FIRST, so an outsider on a server without one is refused by the
    // precondition — its copy pinned so a reorder on either side shows.
    const initiate = () =>
      outsider.mcpServerCommand.initiateOAuthConnect({ mcpServerId: id, org });
    if (authzContract === "annotation-enforced") {
      const denied = await expectGrpcCode(
        initiate,
        Code.PermissionDenied,
        "outsider initiateOAuthConnect on a foreign server",
      );
      expect(denied.rawMessage, "initiateOAuthConnect annotation copy").toBe(
        "unauthorized to initiate oauth connect for mcp server",
      );
    } else {
      const refused = await expectGrpcCode(
        initiate,
        Code.FailedPrecondition,
        "outsider initiateOAuthConnect on a foreign server (Java precondition-first)",
      );
      expect(refused.rawMessage, "initiateOAuthConnect precondition copy").toBe(
        `MCP server '${id}' does not have an auth block configured`,
      );
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

  it("the authorize-first read lanes' unknown-id answer — the ruled uniform Q1 NOT_FOUND here, PERMISSION_DENIED on the Java baseline", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const outsider = await outsiderClients();
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
    // abort would hide the lanes after it (the shape that left five of
    // these six unobserved on the Java baseline for a month).
    const observed: Record<string, string> = {};
    for (const [lane, op] of lanes) {
      observed[lane] = Code[await grpcCodeOf(op, `outsider ${lane} on an unknown execution`)];
    }
    const expectedCode = authzContract === "annotation-enforced" ? "NotFound" : "PermissionDenied";
    expect(observed).toEqual(
      Object.fromEntries(lanes.map(([lane]) => [lane, expectedCode])),
    );
  });
});
