// List-read scoping conformance (20260830.01.sp.list-read-scoping).
//
// The ISOLATION arms the instrument never had: every prior list test
// asserts containment ("my rows are present"); these assert the inverse —
// an OUTSIDER's list/search/activity NEVER contains the owner's rows.
// Both multi-tenant editions must pass identically: the Java edition
// through listAuthorizedResourceIds, the composition through the
// ListReadScope driver over FGA ListObjects — the arms are the shared
// contract, so the hermetic Java target validates them before the
// composition is measured against them.
//
// One lane per consumer family (the seam's per-lane logic is pinned in
// the OSS unit suites; this is the wire-level tenant-isolation contract):
// session.list (the restrict verb, no org intersection), apikey.findAll
// (the direct-read tail), environment.list (the org-intersecting family),
// search + recent activity (the enumeration verb), and the Q8
// check-shaped lanes (the listByChannel channel gate, workflow
// listVersions) refusing an outsider with their byte-pinned Java copy.
//
// Single-user targets skip: one implicit caller, isolation untestable by
// construction (the organization suite's outsider precedent). Guest
// sibling-visitor isolation cannot ride this suite (guest lanes are
// unreachable from conformance — the C2 R6 ruling); it is pinned by the
// cloud driver's unit matrix and the committed live proof.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { createTarget, type TargetProfile } from "../targets";
import { FixtureTracker } from "../harness/fixtures";
import { expectGrpcCode } from "../contract/errors";
import { makeAgent } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeEnvironment } from "../support/environments";
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

async function ownerAgent(org: string) {
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("iso-agent") }),
  );
  fixtures.defer(() =>
    clients.agentCommand.delete({ value: agent.metadata!.id }),
  );
  return agent;
}

describe("list-read scoping — outsider isolation (multi-tenant only)", () => {
  it("session.list: the owner's session is ABSENT from the outsider's list", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

    const agent = await ownerAgent(org);
    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("iso-session"),
        agentInstanceId: agent.status!.defaultInstanceId,
        subject: "isolation probe",
      }),
    );
    fixtures.defer(() =>
      clients.sessionCommand.delete({ value: session.metadata!.id }),
    );

    // Containment first — the arm must be probing a REAL row.
    const mine = await clients.sessionQuery.list({});
    expect(
      mine.entries.map((s) => s.metadata?.id),
      "owner must see the seeded session",
    ).toContain(session.metadata!.id);

    const theirs = await outsider.sessionQuery.list({});
    expect(
      theirs.entries.map((s) => s.metadata?.id),
      "outsider list must not contain the owner's session",
    ).not.toContain(session.metadata!.id);
  });

  it("apikey.findAll: the owner's key is ABSENT from the outsider's list", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

    const key = await clients.apiKeyCommand.create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: uniqueName("iso-key"), org },
      spec: {},
    });
    fixtures.defer(() =>
      clients.apiKeyCommand.delete({ value: key.metadata!.id }),
    );

    const mine = await clients.apiKeyQuery.findAll({});
    expect(
      mine.entries.map((k) => k.metadata?.id),
      "owner must see the minted key",
    ).toContain(key.metadata!.id);

    const theirs = await outsider.apiKeyQuery.findAll({});
    expect(
      theirs.entries.map((k) => k.metadata?.id),
      "outsider findAll must not contain the owner's key",
    ).not.toContain(key.metadata!.id);
  });

  it("environment.list: the owner's environment is ABSENT from the outsider's org-scoped list", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

    const environment = await clients.environmentCommand.create(
      makeEnvironment({ org, name: uniqueName("iso-env") }),
    );
    fixtures.defer(() =>
      clients.environmentCommand.delete({
        resourceId: environment.metadata!.id,
      }),
    );

    const mine = await clients.environmentQuery.list({ org });
    expect(
      mine.items.map((e) => e.metadata?.id),
      "owner must see the created environment",
    ).toContain(environment.metadata!.id);

    // The outsider names the OWNER's org explicitly — the org filter is
    // caller-supplied and must never substitute for authorization.
    const theirs = await outsider.environmentQuery.list({ org });
    expect(
      theirs.items.map((e) => e.metadata?.id),
      "outsider list must not contain the owner's environment",
    ).not.toContain(environment.metadata!.id);
  });

  it("search: the owner's resource never surfaces for the outsider, even naming the owner's org", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

    const probe = uniqueName("isoprobe");
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: probe }),
    );
    fixtures.defer(() =>
      clients.agentCommand.delete({ value: agent.metadata!.id }),
    );

    const mine = await clients.search.search({ query: probe, org });
    expect(
      mine.entries.map((e) => e.id),
      "owner must find the probe agent",
    ).toContain(agent.metadata!.id);

    const theirs = await outsider.search.search({ query: probe, org });
    expect(
      theirs.entries.map((e) => e.id),
      "outsider search must not surface the owner's agent",
    ).not.toContain(agent.metadata!.id);
  });

  it("recent activity: the owner's session is ABSENT from the outsider's recents", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

    const agent = await ownerAgent(org);
    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("iso-recents"),
        agentInstanceId: agent.status!.defaultInstanceId,
        subject: "recents probe",
      }),
    );
    fixtures.defer(() =>
      clients.sessionCommand.delete({ value: session.metadata!.id }),
    );

    const mine = await clients.activityQuery.listRecentActivity({
      org,
      pageSize: 100,
    });
    expect(
      mine.entries.map((e) => e.id),
      "owner must see the session in recents",
    ).toContain(session.metadata!.id);

    const theirs = await outsider.activityQuery.listRecentActivity({
      org,
      pageSize: 100,
    });
    expect(
      theirs.entries.map((e) => e.id),
      "outsider recents must not contain the owner's session",
    ).not.toContain(session.metadata!.id);
  });

  it("session.listByChannel: the channel gate refuses an outsider with the Java copy (Q8)", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

    const agent = await ownerAgent(org);
    const channel = await clients.agentChannelCommand.create(
      makeSlackAgentChannel(
        org,
        uniqueName("iso-channel"),
        agent.metadata!.slug,
      ),
    );
    fixtures.defer(() =>
      clients.agentChannelCommand.delete({ value: channel.metadata!.id }),
    );

    const denied = await expectGrpcCode(
      () =>
        outsider.sessionQuery.listByChannel({
          channelId: channel.metadata!.id,
        }),
      Code.PermissionDenied,
      "outsider listByChannel on a foreign channel",
    );
    expect(denied.rawMessage).toBe("unauthorized to list channel conversations");
  });

  it("workflow.listVersions refuses an outsider with the Java copy (Q8)", async (ctx) => {
    if (!multiTenantOnly()) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const outsider = await outsiderClients();

    const workflow = await clients.workflowCommand.create(
      makeWorkflow({ org, name: uniqueName("iso-wf") }),
    );
    fixtures.defer(() =>
      clients.workflowCommand.delete({ value: workflow.metadata!.id }),
    );

    const denied = await expectGrpcCode(
      () =>
        outsider.workflowQuery.listVersions({
          slug: workflow.metadata!.slug,
          org,
        }),
      Code.PermissionDenied,
      "outsider listVersions on a foreign workflow",
    );
    expect(denied.rawMessage).toBe(
      "unauthorized to view workflow version history",
    );
  });
});
