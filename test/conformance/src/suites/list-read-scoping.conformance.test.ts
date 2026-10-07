// List-read scoping conformance.
//
// The ISOLATION arms the instrument never had: every prior list test
// asserts containment ("my rows are present"); these assert the inverse —
// an OUTSIDER's list/search/activity NEVER contains the owner's rows.
// Both multi-tenant editions must pass identically: the open-source
// server through its built-in ListReadScope driver, the hosted
// composition through the ListReadScope driver over FGA ListObjects —
// the arms are the shared contract.
//
// One lane per consumer family (the seam's per-lane logic is pinned in
// the OSS unit suites; this is the wire-level tenant-isolation contract):
// session.list (the restrict verb, no org intersection, once walked page
// by page so a token is shown to carry no authority), apikey.findAll
// (the direct-read tail), credential.list (the org-intersecting family),
// search + recent activity (the enumeration verb), and the
// check-shaped lane (the listByChannel channel gate) refusing an outsider
// with its byte-pinned Java copy.
//
// The arms run on the target's ENFORCING LANE (targets/target.ts): the
// cloud's primary, and on the managed local targets an open-source sibling
// in the OIDC posture, whose built-in ListReadScope answers every lane
// below — so the same seven arms are the cross-edition contract on the
// cloud and on both open-source store drivers. Where a target lends no
// lane the arms skip VISIBLY with its reason. Guest sibling-visitor
// isolation cannot ride this suite (guest lanes are unreachable from
// conformance); it is pinned by the cloud driver's unit
// matrix and the committed live proof.
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
import { expectGrpcCode } from "../contract/errors";
import { makeAgent, agentRefOf } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeCredential } from "../support/credentials";
import { makeSession } from "../support/sessions";
import { uniqueName } from "../support/naming";

let target: TargetProfile;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
// The lane's founder — the OWNER whose rows the outsider must not see.
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

async function ownerAgent(org: string) {
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("iso-agent") }),
  );
  fixtures.defer(() =>
    clients.agentCommand.delete({ value: agent.metadata!.id }),
  );
  return agent;
}

describe("list-read scoping — outsider isolation (on the enforcing lane)", () => {
  it("[rpc:SessionQueryController.list] session.list: the owner's session is ABSENT from the outsider's list", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    const agent = await ownerAgent(org);
    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("iso-session"),
        agentRef: agentRefOf(agent),
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

  it("[rpc:SessionQueryController.list] session.list paged: the owner's walk is whole, the outsider's walk of the owner's org is empty", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    const agent = await ownerAgent(org);
    const seeded = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const session = await clients.sessionCommand.create(
        makeSession({
          org,
          name: uniqueName("iso-paged"),
          agentRef: agentRefOf(agent),
          subject: "paged isolation probe",
        }),
      );
      fixtures.defer(() =>
        clients.sessionCommand.delete({ value: session.metadata!.id }),
      );
      seeded.add(session.metadata!.id);
    }

    // Every page re-runs the scope, so a token carries no authority: the
    // outsider may follow tokens through short or empty pages, never onto
    // a row.
    async function walk(as: ConformanceClients): Promise<string[]> {
      const ids: string[] = [];
      let pageToken = "";
      for (let pages = 0; pages < 10; pages++) {
        const page = await as.sessionQuery.list({ org, pageSize: 1, pageToken });
        ids.push(...page.entries.map((s) => s.metadata!.id));
        pageToken = page.nextPageToken;
        if (pageToken === "") return ids;
      }
      throw new Error("session.list walk did not end within 10 pages");
    }

    const mine = await walk(clients);
    expect(mine, "the owner's walk has no duplicate").toHaveLength(seeded.size);
    expect(new Set(mine), "the owner's walk has no gap").toEqual(seeded);

    const theirs = await walk(outsider);
    expect(theirs, "the outsider's walk surfaces none of the owner's sessions").toEqual([]);
  });

  it("[rpc:ApiKeyQueryController.findAll] apikey.findAll: the owner's key is ABSENT from the outsider's list", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

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

  it("[rpc:CredentialQueryController.list] credential.list: the organization's credential is ABSENT from the outsider's org-scoped list", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    // The organization's own credential, not a person's: a person's is
    // listed to that person alone before any read scope asks, so only an
    // organization's credential puts the read scope itself under test.
    const credential = await clients.credentialCommand.create(
      makeCredential({ org, name: uniqueName("iso-cred"), owner: "org" }),
    );
    fixtures.defer(() =>
      clients.credentialCommand.delete({
        resourceId: credential.metadata!.id,
      }),
    );

    const mine = await clients.credentialQuery.list({ org });
    expect(
      mine.items.map((c) => c.metadata?.id),
      "the owner (an admin) must see the organization's credential",
    ).toContain(credential.metadata!.id);

    // The outsider names the OWNER's org explicitly — the org filter is
    // caller-supplied and must never substitute for authorization.
    const theirs = await outsider.credentialQuery.list({ org });
    expect(
      theirs.items.map((c) => c.metadata?.id),
      "outsider list must not contain the organization's credential",
    ).not.toContain(credential.metadata!.id);
  });

  it("[rpc:SearchService.search] search: the owner's resource never surfaces for the outsider, even naming the owner's org", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

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

  it("[rpc:ActivityQueryController.listRecentActivity] recent activity: the owner's session is ABSENT from the outsider's recents", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    const agent = await ownerAgent(org);
    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("iso-recents"),
        agentRef: agentRefOf(agent),
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

  it("[rpc:SessionQueryController.listByChannel] session.listByChannel: the channel gate refuses an outsider with its byte-pinned copy", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

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
});
