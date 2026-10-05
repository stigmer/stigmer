// Conformance suite for versioned resources on one version machinery.
// Domain: agentic / agent (versions), with the arms the shared machinery
// changed for workflows and skills.
//
// Agents are versioned the way workflows are: every write whose stored spec
// the agent never had records a new immutable version under its content hash;
// a write reproducing an earlier spec points back at that version; an
// unchanged write records none. A tag is a mutable, single-holder name for one
// version, set at apply time or moved with tagVersion.
//
// Asserted contract:
// - an update records a version, an unchanged apply records none, and an
//   A→B→A apply repoints without a duplicate row (the current version is the
//   older one);
// - getByReference resolves the head, a hash and a tag;
// - listVersions marks exactly the head's version current;
// - getVersion serves any version's full spec, NotFound for one the agent
//   never had;
// - tagVersion moves a tag and clears its prior holder (behind the
//   versionTagging capability, the workflow arms' posture);
// - a deleted agent's history is gone with it;
// - every surface that starts a conversation honours the version its agent
//   reference names: a schedule and a channel store it, and a share hands
//   it to the hosted page on its profile; a session started on that
//   reference (what a channel or a share does for each conversation) pins
//   the version it names, not the current one. A schedule's fire on it is
//   the execution suite's (schedule-firing);
// - a version whose tag moved reports the tag it holds now, for an agent, a
//   workflow and a skill alike; an unchanged re-apply naming a new tag moves
//   it to the head, and a repoint naming no tag shows the tag the version
//   holds (agents and workflows).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { AGENT_API_VERSION, AGENT_KIND, agentRefOf, makeAgent, makeAgentSpec } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeAgentShare } from "../support/agentshares";
import { uniqueName } from "../support/naming";
import { makeSchedule } from "../support/schedules";
import { makeSession } from "../support/sessions";
import { makeSkillArtifact } from "../support/skills";
import { makeWorkflow } from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
const capabilities = createTarget().capabilities;
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

/** Instructions distinct per label and long enough for the spec's rule. */
function said(label: string): string {
  return `Agent instructions, ${label}.`;
}

async function applyAgent(org: string, name: string, label: string, version?: { tag?: string; message?: string }) {
  const agent = await clients.agentCommand.apply({
    apiVersion: AGENT_API_VERSION,
    kind: AGENT_KIND,
    metadata: { name, org, ...(version !== undefined ? { version } : {}) },
    spec: makeAgentSpec({ instructions: said(label) }),
  });
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

describe("Agent versions — what a write records", () => {
  it("[rpc:AgentCommandController.apply] [rpc:AgentQueryController.listVersions] an update records a version; an unchanged apply records none", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");

    const v1 = await applyAgent(org, name, "v1");
    expect(v1.status?.versionHash, "create records the first version").toMatch(/^[a-f0-9]{64}$/);
    await applyAgent(org, name, "v1");
    let history = await clients.agentQuery.listVersions({ org, slug: v1.metadata!.slug });
    expect(history.totalCount, "an unchanged apply records no version").toBe(1);

    const v2 = await applyAgent(org, name, "v2");
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);
    expect(v2.metadata?.version?.previousVersionId).toBe(v1.status?.versionHash);
    history = await clients.agentQuery.listVersions({ org, slug: v1.metadata!.slug });
    expect(history.totalCount).toBe(2);
    expect(history.versions[0]?.versionHash, "newest first").toBe(v2.status?.versionHash);
    expect(history.versions.filter((entry) => entry.isCurrent).map((entry) => entry.versionHash)).toEqual([
      v2.status?.versionHash,
    ]);
  });

  it("[rpc:AgentQueryController.listVersions] re-applying a prior spec repoints the head without a duplicate row (A→B→A)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");

    const a = await applyAgent(org, name, "A");
    await applyAgent(org, name, "B");
    const back = await applyAgent(org, name, "A");
    expect(back.status?.versionHash).toBe(a.status?.versionHash);

    const history = await clients.agentQuery.listVersions({ org, slug: a.metadata!.slug });
    expect(history.totalCount, "rollback appends no row").toBe(2);
    expect(history.versions.filter((entry) => entry.isCurrent).map((entry) => entry.versionHash)).toEqual([
      a.status?.versionHash,
    ]);
  });
});

describe("Agent versions — reading them", () => {
  it("[rpc:AgentQueryController.getByReference] resolves the head, a hash and a tag", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");
    const v1 = await applyAgent(org, name, "v1", { tag: "stable" });
    const slug = v1.metadata!.slug;
    await applyAgent(org, name, "v2");

    expect((await clients.agentQuery.getByReference({ org, slug })).spec?.instructions).toBe(said("v2"));
    const byHash = await clients.agentQuery.getByReference({ org, slug, version: v1.status!.versionHash });
    expect(byHash.spec?.instructions).toBe(said("v1"));
    const byTag = await clients.agentQuery.getByReference({ org, slug, version: "stable" });
    expect(byTag.status?.versionHash).toBe(v1.status?.versionHash);
    await expectGrpcCode(
      () => clients.agentQuery.getByReference({ org, slug, version: "no-such-tag" }),
      Code.NotFound,
      "unknown tag",
    );
  });

  it("[rpc:AgentQueryController.getVersion] serves the current and an archived version's full spec, NotFound for one the agent never had", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");
    const v1 = await applyAgent(org, name, "v1", { message: "the first cut" });
    const v2 = await applyAgent(org, name, "v2");
    const agentId = v1.metadata!.id;

    const current = await clients.agentQuery.getVersion({ agentId, versionHash: v2.status!.versionHash });
    expect(current.isCurrent).toBe(true);
    expect(current.specSnapshot?.instructions).toBe(said("v2"));

    const prior = await clients.agentQuery.getVersion({ agentId, versionHash: v1.status!.versionHash });
    expect(prior.isCurrent).toBe(false);
    expect(prior.specSnapshot?.instructions).toBe(said("v1"));
    expect(prior.message).toBe("the first cut");

    await expectGrpcCode(
      () => clients.agentQuery.getVersion({ agentId, versionHash: "0".repeat(64) }),
      Code.NotFound,
      "a version the agent never had",
    );
  });

  it("[rpc:AgentCommandController.delete] a deleted agent's history is gone with it", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");
    const created = await clients.agentCommand.apply(makeAgent({ org, name, instructions: said("v1") }));
    const { id, slug } = created.metadata!;
    await clients.agentCommand.apply(makeAgent({ org, name, instructions: said("v2") }));

    await clients.agentCommand.delete({ value: id });

    await expectGrpcCode(() => clients.agentQuery.listVersions({ org, slug }), Code.NotFound, "listVersions after delete");
    await expectGrpcCode(
      () => clients.agentQuery.getVersion({ agentId: id, versionHash: created.status!.versionHash }),
      Code.NotFound,
      "getVersion after delete",
    );
  });
});

describe("Agent versions — tags", () => {
  it.skipIf(!capabilities.versionTagging)("[rpc:AgentCommandController.tagVersion] moves a tag to another version, clearing the prior holder, and reconciles the head", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");
    const v1 = await applyAgent(org, name, "v1");
    const v2 = await applyAgent(org, name, "v2");
    const agentId = v1.metadata!.id;
    const slug = v1.metadata!.slug;

    let head = await clients.agentCommand.tagVersion({ agentId, versionHash: v1.status!.versionHash, tag: "stable" });
    expect(head.metadata?.version?.tag, "tagging an archived version leaves the head untagged").toBe("");
    head = await clients.agentCommand.tagVersion({ agentId, versionHash: v2.status!.versionHash, tag: "stable" });
    expect(head.metadata?.version?.tag).toBe("stable");

    const history = await clients.agentQuery.listVersions({ org, slug });
    expect(history.versions.filter((entry) => entry.tag === "stable").map((entry) => entry.versionHash)).toEqual([
      v2.status?.versionHash,
    ]);
    const prior = await clients.agentQuery.getByReference({ org, slug, version: v1.status!.versionHash });
    expect(prior.metadata?.version?.tag, "the prior holder reports no tag").toBe("");
  });

  it.skipIf(!capabilities.versionTagging)("[rpc:AgentCommandController.tagVersion] reports a well-formed but unknown version hash as NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await applyAgent(org, uniqueName("agent"), "v1");
    await expectGrpcCode(
      () => clients.agentCommand.tagVersion({ agentId: created.metadata!.id, versionHash: "0".repeat(64), tag: "stable" }),
      Code.NotFound,
      "unknown version hash",
    );
  });

  it("[rpc:AgentCommandController.apply] an unchanged apply naming a new tag moves it, recording no version", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");
    const v1 = await applyAgent(org, name, "v1");

    const retagged = await applyAgent(org, name, "v1", { tag: "prod" });

    expect(retagged.status?.versionHash).toBe(v1.status?.versionHash);
    expect(retagged.metadata?.version?.tag).toBe("prod");
    const history = await clients.agentQuery.listVersions({ org, slug: v1.metadata!.slug });
    expect(history.totalCount, "an unchanged apply records no version").toBe(1);
    expect(history.versions.map((entry) => entry.tag)).toEqual(["prod"]);
  });

  it("[rpc:AgentCommandController.apply] a repoint (A→B→A) naming the tag moves it back; one naming none shows the tag the version holds", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");
    const v1 = await applyAgent(org, name, "v1", { tag: "stable" });
    await applyAgent(org, name, "v2", { tag: "stable" });

    const back = await applyAgent(org, name, "v1", { tag: "stable" });
    expect(back.status?.versionHash).toBe(v1.status?.versionHash);
    expect(back.metadata?.version?.tag).toBe("stable");
    const history = await clients.agentQuery.listVersions({ org, slug: v1.metadata!.slug });
    expect(history.totalCount).toBe(2);
    expect(history.versions.filter((entry) => entry.tag === "stable").map((entry) => entry.versionHash)).toEqual([
      v1.status?.versionHash,
    ]);

    await applyAgent(org, name, "v2");
    const untagged = await applyAgent(org, name, "v1");
    expect(untagged.metadata?.version?.tag, "head and history agree on the tag").toBe("stable");
  });
});

describe("Agent versions — run surfaces", () => {
  // Each arm saves v1 under the tag `stable`, then v2 as the current
  // version, so a surface that ignored the version would land on v2.
  async function taggedAgent(org: string) {
    const name = uniqueName("agent");
    const v1 = await applyAgent(org, name, "v1", { tag: "stable" });
    const v2 = await applyAgent(org, name, "v2");
    expect(v2.status?.versionHash, "the author's save is a new version").not.toBe(v1.status?.versionHash);
    return { v1, v2 };
  }

  async function pinOfSessionOn(org: string, agentRef: { org: string; slug: string; version: string }) {
    const session = await clients.sessionCommand.create(makeSession({ org, name: uniqueName("session"), agentRef }));
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }).catch(() => undefined));
    return session.status?.agentVersionHash;
  }

  it("[rpc:ScheduleCommandController.create] a schedule whose agent reference names a version is accepted and keeps it", async () => {
    const { org } = await target.provisionTenancy();
    const { v1 } = await taggedAgent(org);
    const schedule = makeSchedule(org, uniqueName("schedule"), v1.metadata!.slug);
    const invocation = schedule.spec!.target!.value as { agentRef: { version?: string } };
    invocation.agentRef.version = v1.status!.versionHash;

    const created = await clients.scheduleCommand.create(schedule);
    fixtures.defer(() => clients.scheduleCommand.delete({ value: created.metadata!.id }));

    const invoked = created.spec?.target;
    expect(invoked?.case).toBe("agent");
    expect(invoked?.case === "agent" ? invoked.value.agentRef?.version : undefined).toBe(v1.status?.versionHash);
  });

  it("[rpc:AgentChannelCommandController.create] a channel whose agent reference names a version keeps it, and a conversation started on it pins that version", async () => {
    const { org } = await target.provisionTenancy();
    const { v1 } = await taggedAgent(org);

    const channel = await clients.agentChannelCommand.create(
      makeSlackAgentChannel(org, uniqueName("channel"), v1.metadata!.slug, { agentRefVersion: "stable" }),
    );
    fixtures.defer(() => clients.agentChannelCommand.delete({ value: channel.metadata!.id }));
    const stored = channel.spec?.agentRef;
    expect(stored?.version).toBe("stable");

    expect(await pinOfSessionOn(org, { org: stored!.org, slug: stored!.slug, version: stored!.version })).toBe(
      v1.status?.versionHash,
    );
  });

  it("[rpc:AgentShareCommandController.create] [rpc:AgentShareQueryController.getSharedProfile] a share whose agent reference names a version hands it to the hosted page, and a conversation started on it pins that version", async () => {
    const { org } = await target.provisionTenancy();
    const { v1 } = await taggedAgent(org);

    const share = await clients.agentShareCommand.create(
      makeAgentShare(org, v1.metadata!.slug, { agentRefVersion: "stable" }),
    );
    fixtures.defer(() => clients.agentShareCommand.delete({ value: share.metadata!.id }));
    const profile = await clients.agentShareQuery.getSharedProfile({ shareId: share.metadata!.id });
    const ref = profile.agentRef;
    expect(ref?.version, "the profile carries the share's version").toBe("stable");

    expect(await pinOfSessionOn(org, { org: ref!.org, slug: ref!.slug, version: ref!.version })).toBe(
      v1.status?.versionHash,
    );
  });

  it("[rpc:SessionCommandController.create] a reference with no version pins the current version (the default every surface starts on)", async () => {
    const { org } = await target.provisionTenancy();
    const { v1, v2 } = await taggedAgent(org);

    expect(await pinOfSessionOn(org, { ...agentRefOf(v1), version: "" })).toBe(v2.status?.versionHash);
  });
});

describe("Version tags after a move, on every versioned kind", () => {
  it("[rpc:WorkflowCommandController.apply] a workflow's unchanged re-apply naming a new tag moves it to the head, recording no version", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");
    const v1 = await clients.workflowCommand.apply(makeWorkflow({ org, name, taskVar: "v1" }));
    fixtures.defer(() => clients.workflowCommand.delete({ value: v1.metadata!.id }));

    const retagged = await clients.workflowCommand.apply(makeWorkflow({ org, name, taskVar: "v1", tag: "prod" }));

    expect(retagged.status?.versionHash).toBe(v1.status?.versionHash);
    expect(retagged.metadata?.version?.tag).toBe("prod");
    const history = await clients.workflowQuery.listVersions({ org, slug: v1.metadata!.slug });
    expect(history.totalCount).toBe(1);
    expect(history.versions.map((entry) => entry.tag), "the head and the history agree").toEqual(["prod"]);
  });

  it("[rpc:WorkflowCommandController.apply] [rpc:WorkflowQueryController.getByReference] a workflow version whose tag moved reports the tag it holds now; a repoint naming the tag moves it back", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");
    const v1 = await clients.workflowCommand.apply(makeWorkflow({ org, name, taskVar: "v1", tag: "stable" }));
    fixtures.defer(() => clients.workflowCommand.delete({ value: v1.metadata!.id }));
    const slug = v1.metadata!.slug;
    await clients.workflowCommand.apply(makeWorkflow({ org, name, taskVar: "v2", tag: "stable" }));

    const archived = await clients.workflowQuery.getByReference({ org, slug, version: v1.status!.versionHash });
    expect(archived.metadata?.version?.tag, "the moved tag is no longer v1's").toBe("");

    const back = await clients.workflowCommand.apply(makeWorkflow({ org, name, taskVar: "v1", tag: "stable" }));
    expect(back.status?.versionHash).toBe(v1.status?.versionHash);
    expect(back.metadata?.version?.tag).toBe("stable");
    const history = await clients.workflowQuery.listVersions({ org, slug });
    expect(history.totalCount).toBe(2);
    expect(history.versions.filter((entry) => entry.tag === "stable").map((entry) => entry.versionHash)).toEqual([
      v1.status?.versionHash,
    ]);
  });

  it("[rpc:SkillQueryController.getByReference] a skill version whose tag moved reports the tag it holds now", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");
    const v1 = await clients.skillCommand.push({ org, artifact: makeSkillArtifact({ name, body: "# v1" }), tag: "stable" });
    fixtures.defer(() => clients.skillCommand.delete({ value: v1.metadata!.id }));
    await clients.skillCommand.push({ org, artifact: makeSkillArtifact({ name, body: "# v2" }), tag: "stable" });

    const archived = await clients.skillQuery.getByReference({ org, slug: v1.metadata!.slug, version: v1.status!.versionHash });
    expect(archived.status?.versionHash).toBe(v1.status?.versionHash);
    expect(archived.spec?.tag, "the moved tag is no longer v1's").toBe("");
  });

  it("[rpc:AgentQueryController.getByReference] an agent version whose tag moved reports the tag it holds now", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");
    const v1 = await applyAgent(org, name, "v1", { tag: "stable" });
    await applyAgent(org, name, "v2", { tag: "stable" });

    const archived = await clients.agentQuery.getByReference({
      org,
      slug: v1.metadata!.slug,
      version: v1.status!.versionHash,
    });
    expect(archived.metadata?.version?.tag).toBe("");
  });
});
