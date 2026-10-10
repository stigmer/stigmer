// Direct-handler authorization conformance.
//
// The config-annotated methods served by DIRECT handlers evaluate their
// annotations (docs/authorization-coverage.md carries the per-method
// dispositions). This suite pins the OUTSIDER contract on the
// multi-tenant edition — a second provisioned identity with no grants on
// the owner's resources:
//
//   - a write/read against an EXISTING foreign resource refuses
//     PERMISSION_DENIED with the method's byte-pinned annotation
//     error_msg (the copy doubles as the descriptor-mismatch guard), and
//     a denied write is side-effect free;
//   - an UNKNOWN id on the authorize-first family answers NOT_FOUND via
//     the authorizer's deny-path existence probe — the UNIFORM not-found
//     posture;
//   - the load-first family (updateSubject, a plugin's tools listing) keeps
//     its handler-owned NotFound copy for unknown ids, outsider or not — the
//     load fires before the check (#224).
//
// Two arms below sit where the retired Java edition once diverged by
// ruling (the per-method dispositions in docs/authorization-coverage.md);
// each is plain contract now, enforced strictly so a regression to the old
// gap turns the suite red:
//
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
import { makeAgent, agentRefOf } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { oneServerPlugin, pushPlugin } from "../support/plugins";
import { makeSession } from "../support/sessions";
import { makeSharedVault, vaultTarget } from "../support/vaults";
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
  it("[rpc:SessionCommandController.updateSubject] session updateSubject refuses an outsider with the annotation copy; the subject survives", async (ctx) => {
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
        agentRef: agentRefOf(agent),
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

  it("[rpc:PluginCommandController.listTools] a plugin's tools listing refuses an outsider with its annotation copy before the engine is asked, and answers an unknown plugin NotFound", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    // A server whose header names its key is never probed at install, so
    // the push asks no network.
    const plugin = await pushPlugin(
      clients,
      fixtures,
      org,
      oneServerPlugin({
        name: uniqueName("authz-plugin"),
        server: {
          url: "https://mcp.vendor.test/mcp",
          headers: { Authorization: "Bearer ${VENDOR_TOKEN}" },
        },
      }),
    );
    const pluginId = plugin.metadata!.id;

    // Ordering pin: the listing loads the plugin and authorizes BEFORE it
    // checks the engine (domain/plugin/list-tools.ts), the
    // authorize-before-precondition order the run gate keeps, so an
    // outsider hears the denial on every target, a Temporal-less server
    // included, and learns nothing about the engine or the plugin's servers.
    for (const server of ["tools", "no-such-server"]) {
      const refused = await expectGrpcCode(
        () => outsider.pluginCommand.listTools({ pluginId, server, org }),
        Code.PermissionDenied,
        `outsider listTools of server '${server}' on a foreign plugin`,
      );
      expect(refused.rawMessage, "listTools annotation copy").toBe(
        "unauthorized to list plugin tools",
      );
    }

    // Load-first: an unknown plugin is the handler's NotFound, outsider or not.
    const missing = await expectGrpcCode(
      () =>
        outsider.pluginCommand.listTools({
          pluginId: "plg_direct_handler_missing",
          server: "tools",
          org,
        }),
      Code.NotFound,
      "outsider listTools on an unknown plugin",
    );
    expect(missing.rawMessage).toBe(
      "plugin not found: plg_direct_handler_missing",
    );
  });

  it("[rpc:VaultCommandController.startSignIn] [rpc:VaultCommandController.createConnectLink] a sign-in and a Connect link refuse an outsider naming someone else's shared vault, before any login server is asked", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();
    const vault = await clients.vaultCommand.create(makeSharedVault({ org, name: uniqueName("authz-vault") }));
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: vault.metadata!.id }));
    const vaultId = vault.metadata!.id;
    // A Git host with no login app: were authorization to come second, the
    // answer would be the no-login refusal, not the denial.
    const address = "git.conformance.test";

    const signIn = await expectGrpcCode(
      () => outsider.vaultCommand.startSignIn({ vault: vaultTarget(org, vaultId), address }),
      Code.PermissionDenied,
      "outsider startSignIn into a foreign shared vault",
    );
    expect(signIn.rawMessage).toBe("unauthorized to save a sign-in in this vault");

    const link = await expectGrpcCode(
      () =>
        outsider.vaultCommand.createConnectLink({
          org,
          vaultId,
          address,
          returnUrl: "https://integrator.test/back",
        }),
      Code.PermissionDenied,
      "outsider createConnectLink on a foreign shared vault",
    );
    expect(link.rawMessage).toBe("unauthorized to make a Connect link for this vault");
  });

  it("[rpc:AgentChannelCommandController.initiateInstall] [rpc:AgentChannelCommandController.completeInstall] the channel install pair refuses an outsider with its annotation copy (the arm both editions declare)", async (ctx) => {
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

  it("[rpc:RunQueryController.getArtifactContent] [rpc:RunQueryController.getArtifactDownloadUrl] [rpc:RunQueryController.subscribe] the authorize-first read lanes answer an outsider's unknown id with the uniform NOT_FOUND", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const outsider = await lane.provisionIdentity();
    const missingAgentExecution = "aexec_01conformancemissing";
    const missingArtifactKey = `artifacts/${missingAgentExecution}/f.txt`;

    const lanes: ReadonlyArray<[string, () => Promise<unknown>]> = [
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
            runId: missingAgentExecution,
            storageKey: missingArtifactKey,
          }),
      ],
      [
        "agentExecution.getArtifactContent",
        () =>
          outsider.agentExecutionQuery.getArtifactContent({
            runId: missingAgentExecution,
            storageKey: missingArtifactKey,
          }),
      ],
    ];

    // Observe every lane, THEN assert the whole table: a first-mismatch
    // abort would hide the lanes after it (the shape that once left most of
    // these lanes unobserved for a month).
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
