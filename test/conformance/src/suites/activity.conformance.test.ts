// Conformance suite for the Activity query domain.
// Domain: activity — the cross-resource recents feed behind the console's
// sidebar (ActivityQueryController.listRecentActivity).
//
// Drives the RPC through the raw proto stubs and asserts the cross-edition
// contract (stigmer#461): the RPC answers (the OSS server historically
// returned UNIMPLEMENTED), entries are projected sidebar summaries — not full
// resources — sorted newest-first by last meaningful update, trimmed to
// page_size, and runtime-originated sessions (channel / share / guest /
// schedule labels) are excluded for every caller.
//
// Scope: sessions only. This slice's targets run with no Temporal, so
// workflow executions cannot be seeded here; the cross-kind merge and phase
// projection are pinned by the Go handler's store-level tests (OSS) and the
// cloud handler's step tests. Ordering is asserted on CREATION timestamps
// only: both editions stamp statusAudit.updatedAt at create, but which later
// mutations bump it differs by design (the cloud bumps on session memory
// persist — a runtime path this slice cannot drive; updateSubject bumps only
// the spec audit in both editions and must NOT reorder recents).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

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

// Separates consecutive creates so their statusAudit.updatedAt stamps are
// strictly ordered on every target's clock resolution. This is timestamp
// separation, not waiting for async work.
const separateTimestamps = () => new Promise((resolve) => setTimeout(resolve, 25));

async function provisionAgentInstance(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const agentInstanceId = agent.status?.defaultInstanceId;
  if (agentInstanceId === undefined || agentInstanceId === "") {
    throw new Error("agent create did not provision a default instance id");
  }
  return agentInstanceId;
}

async function createSession(
  org: string,
  agentInstanceId: string,
  opts: { subject?: string; labels?: Record<string, string> } = {},
): Promise<string> {
  const session = await clients.sessionCommand.create(
    makeSession({ org, name: uniqueName("session"), agentInstanceId, ...opts }),
  );
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));
  return session.metadata!.id;
}

describe("Activity conformance — listRecentActivity", () => {
  it("lists created sessions newest-first as projected sidebar entries", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);

    const first = await createSession(org, agentInstanceId, { subject: "Plan the migration" });
    await separateTimestamps();
    const second = await createSession(org, agentInstanceId, { subject: "Review the PR" });
    await separateTimestamps();
    const third = await createSession(org, agentInstanceId, { subject: "Ship the release" });

    const response = await clients.activityQuery.listRecentActivity({ pageSize: 100, org });
    const ids = response.entries.map((entry) => entry.id);

    // Containment + relative order, not exact equality: the recents feed is
    // caller-scoped, not fixture-scoped, so unrelated entries may interleave.
    const [thirdPos = -1, secondPos = -1, firstPos = -1] = [third, second, first].map((id) => ids.indexOf(id));
    expect([thirdPos, secondPos, firstPos], `all three sessions must be listed; got ids: ${ids.join(", ")}`).not.toContain(-1);
    expect(thirdPos).toBeLessThan(secondPos);
    expect(secondPos).toBeLessThan(firstPos);

    const entry = response.entries.find((candidate) => candidate.id === third)!;
    expect(entry.type).toBe("session");
    expect(entry.subject).toBe("Ship the release");
    expect(entry.status, "sessions carry no status token").toBe("");
    expect(entry.updatedAt, "entries must carry the sort timestamp").toBeDefined();
  });

  it("maps the auto-created sentinel subject to the display placeholder", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);

    const id = await createSession(org, agentInstanceId, { subject: "Auto-created session" });

    const response = await clients.activityQuery.listRecentActivity({ pageSize: 100, org });
    const entry = response.entries.find((candidate) => candidate.id === id);

    expect(entry, "the session must be listed").toBeDefined();
    expect(entry!.subject, "the pending-subject sentinel must render as the placeholder").toBe("Untitled session");
  });

  it("excludes runtime-origin sessions (personal sessions only)", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);

    const channelSession = await createSession(org, agentInstanceId, {
      subject: "Channel conversation",
      labels: { "stigmer.ai/channel-id": "ach_conformance" },
    });
    const scheduleSession = await createSession(org, agentInstanceId, {
      subject: "Schedule run",
      labels: { "stigmer.ai/schedule-id": "sch_conformance" },
    });
    const consoleSession = await createSession(org, agentInstanceId, { subject: "Console session" });

    const response = await clients.activityQuery.listRecentActivity({ pageSize: 100, org });
    const ids = response.entries.map((entry) => entry.id);

    expect(ids).toContain(consoleSession);
    expect(ids, "channel-originated sessions must not appear in recents").not.toContain(channelSession);
    expect(ids, "schedule-originated sessions must not appear in recents").not.toContain(scheduleSession);
  });

  it("trims to page_size, keeping the newest entries", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);

    await createSession(org, agentInstanceId, { subject: "older" });
    await separateTimestamps();
    const newest = await createSession(org, agentInstanceId, { subject: "newest" });

    const response = await clients.activityQuery.listRecentActivity({ pageSize: 1, org });

    // Exactness is safe here: prior tests' fixtures are deleted in afterEach,
    // so this caller-scoped feed contains only this test's two sessions.
    expect(response.entries).toHaveLength(1);
    expect(response.entries[0]?.id, "the trimmed page must keep the newest entry").toBe(newest);
  });
});
