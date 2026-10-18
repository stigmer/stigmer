// Rename conformance — a resource keeps its id when its slug changes, and its
// old slug keeps leading to it for reading for 30 days.
// Domain: conformance suites.
//
// One table over the seven open-source kinds a person may rename (agent,
// vault, routine, channel, channel app, OAuth app, eval), each pinned the
// same way:
//   - rename keeps the id, and a read by the old slug answers the resource
//     by its new slug;
//   - a create of the old slug is refused ALREADY_EXISTS with SLUG_RESERVED,
//     and the resource takes the old slug back;
//   - a write that names the old slug without the id is refused
//     FAILED_PRECONDITION with SLUG_RENAMED, whose words never name the new
//     slug, because the refusal is answered before the write authorizes its
//     target. An update authorizes its metadata.id, so a target whose
//     authorizer enforces refuses one without an id at Authorize, before
//     its slug is read; the vault's arm (it has no apply) expects that
//     refusal there. An eval has neither create nor apply: a push names its
//     slug and is the kind's create and its write at once, so a push naming
//     the old slug is the write arm, refused with SLUG_RENAMED, and the
//     create arm expects that same refusal (nobody takes the held slug).
// Then the references that named a renamed resource (a session's, a
// routine's and a channel's agent, a parent's subagent, a channel's app)
// come back with its new slug, and an apply carrying the id finds the
// resource by it, while the same file in another organization makes its
// own. The hold's end is the server's own test (its clock is a parameter,
// backend/services/stigmer-server/src/pipeline/steps/__tests__/rename.test.ts).
// Edition-unconditional: no Temporal, no runner.
import { Code } from "@connectrpc/connect";
import type { ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeSlackChannel } from "../support/channels";
import { makeAgent } from "../support/agents";
import { makeSlackChannelApp } from "../support/channelapps";
import { uniqueName } from "../support/naming";
import { makeOAuthApp } from "../support/oauthapps";
import { makeRoutine } from "../support/routines";
import { makeSession } from "../support/sessions";
import { oneCaseEvalArchive } from "../support/evals";
import { makeSharedVault } from "../support/vaults";
import { makeEnvironment } from "../support/environments";
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

interface Named {
  readonly id: string;
  readonly slug: string;
}

function namedOf(resource: { metadata?: { id: string; slug: string } }): Named {
  return { id: resource.metadata!.id, slug: resource.metadata!.slug };
}

function reasonOf(error: ConnectError) {
  return error.findDetails(ErrorInfoSchema)[0];
}

// What the table needs of one renamable kind.
interface RenamableKind {
  // The arm's title; its tag is literal, as the RPC contract reads tags.
  readonly title: string;
  readonly writeTitle: string;
  readonly noun: string;
  // Makes one in `org` named `name`, deleted at the end of the arm.
  create(org: string, name: string): Promise<Named>;
  rename(id: string, slug: string): Promise<Named>;
  readByReference(org: string, slug: string): Promise<Named>;
  // A write naming `slug` and no id: apply where the kind has one, else update.
  writeBySlug(org: string, slug: string): Promise<unknown>;
  // Which RPC writeBySlug sends. An update names its target by
  // resource.metadata.id, so one without an id is refused with
  // INVALID_ARGUMENT before anything is read, on every target; apply and
  // push find their target by slug and answer SLUG_RENAMED.
  readonly writeVerb: "apply" | "update" | "push";
  // How a create of the old slug is refused: SLUG_RESERVED where the kind
  // has a create of its own, SLUG_RENAMED where its create is the push that
  // also writes (an eval).
  readonly oldSlugCreateReason: "SLUG_RESERVED" | "SLUG_RENAMED";
}

async function agentInOrg(
  org: string,
  name: string,
  subagents?: string[],
): Promise<Named> {
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name, ...(subagents !== undefined ? { subagents } : {}) }),
  );
  const id = agent.metadata!.id;
  fixtures.defer(() =>
    clients.agentCommand.delete({ value: id }).catch(() => undefined),
  );
  return namedOf(agent);
}

const KINDS: readonly RenamableKind[] = [
  {
    title: "[rpc:AgentCommandController.rename] an agent",
    writeTitle:
      "[rpc:AgentCommandController.rename] [rpc:AgentCommandController.apply] an agent's",
    noun: "Agent",
    writeVerb: "apply",
    oldSlugCreateReason: "SLUG_RESERVED",
    create: (org, name) => agentInOrg(org, name),
    rename: async (id, slug) =>
      namedOf(await clients.agentCommand.rename({ resourceId: id, slug })),
    readByReference: async (org, slug) =>
      namedOf(await clients.agentQuery.getByReference({ org, slug })),
    writeBySlug: (org, slug) =>
      clients.agentCommand.apply({
        ...makeAgent({ org, name: slug }),
        metadata: { name: slug, org, slug },
      }),
  },
  {
    title: "[rpc:VaultCommandController.rename] a vault",
    writeTitle:
      "[rpc:VaultCommandController.rename] [rpc:VaultCommandController.update] a vault's",
    noun: "Vault",
    writeVerb: "update",
    oldSlugCreateReason: "SLUG_RESERVED",
    create: async (org, name) => {
      const vault = await clients.vaultCommand.create(
        makeSharedVault({ org, name }),
      );
      fixtures.defer(() =>
        clients.vaultCommand
          .delete({ resourceId: vault.metadata!.id })
          .catch(() => undefined),
      );
      return namedOf(vault);
    },
    rename: async (id, slug) =>
      namedOf(await clients.vaultCommand.rename({ resourceId: id, slug })),
    readByReference: async (org, slug) =>
      namedOf(await clients.vaultQuery.getByReference({ org, slug })),
    writeBySlug: (org, slug) =>
      clients.vaultCommand.update({ resource: {
        ...makeSharedVault({ org, name: slug }),
        metadata: { name: slug, org, slug },
      }, updateMask: { paths: ["*"] } }),
  },
  {
    title: "[rpc:RoutineCommandController.rename] a routine",
    writeTitle:
      "[rpc:RoutineCommandController.rename] [rpc:RoutineCommandController.apply] a routine's",
    noun: "Routine",
    writeVerb: "apply",
    oldSlugCreateReason: "SLUG_RESERVED",
    create: async (org, name) => {
      const agent = await agentInOrg(org, uniqueName("sched-agent"));
      const routine = await clients.routineCommand.create(
        makeRoutine(org, name, agent.slug, { enabled: false }),
      );
      fixtures.defer(() =>
        clients.routineCommand
          .delete({ value: routine.metadata!.id })
          .catch(() => undefined),
      );
      return namedOf(routine);
    },
    rename: async (id, slug) =>
      namedOf(await clients.routineCommand.rename({ resourceId: id, slug })),
    readByReference: async (org, slug) =>
      namedOf(await clients.routineQuery.getByReference({ org, slug })),
    writeBySlug: async (org, slug) => {
      const agent = await agentInOrg(org, uniqueName("sched-agent"));
      return clients.routineCommand.apply({
        ...makeRoutine(org, slug, agent.slug, { enabled: false }),
        metadata: { name: slug, org, slug },
      });
    },
  },
  {
    title: "[rpc:ChannelCommandController.rename] a channel",
    writeTitle:
      "[rpc:ChannelCommandController.rename] [rpc:ChannelCommandController.apply] a channel's",
    noun: "Channel",
    writeVerb: "apply",
    oldSlugCreateReason: "SLUG_RESERVED",
    create: async (org, name) => {
      const agent = await agentInOrg(org, uniqueName("chan-agent"));
      const channel = await clients.channelCommand.create(
        makeSlackChannel(org, name, agent.slug),
      );
      fixtures.defer(() =>
        clients.channelCommand
          .delete({ value: channel.metadata!.id })
          .catch(() => undefined),
      );
      return namedOf(channel);
    },
    rename: async (id, slug) =>
      namedOf(await clients.channelCommand.rename({ resourceId: id, slug })),
    readByReference: async (org, slug) =>
      namedOf(await clients.channelQuery.getByReference({ org, slug })),
    writeBySlug: async (org, slug) => {
      const agent = await agentInOrg(org, uniqueName("chan-agent"));
      return clients.channelCommand.apply({
        ...makeSlackChannel(org, slug, agent.slug),
        metadata: { name: slug, org, slug },
      });
    },
  },
  {
    title: "[rpc:EnvironmentCommandController.rename] an environment",
    writeTitle:
      "[rpc:EnvironmentCommandController.rename] [rpc:EnvironmentCommandController.apply] an environment's",
    noun: "Environment",
    writeVerb: "apply",
    oldSlugCreateReason: "SLUG_RESERVED",
    create: async (org, name) => {
      const environment = await clients.environmentCommand.create(makeEnvironment(org, name));
      fixtures.defer(() =>
        clients.environmentCommand.delete({ value: environment.metadata!.id }).catch(() => undefined),
      );
      return namedOf(environment);
    },
    rename: async (id, slug) =>
      namedOf(await clients.environmentCommand.rename({ resourceId: id, slug })),
    readByReference: async (org, slug) =>
      namedOf(await clients.environmentQuery.getByReference({ org, slug })),
    writeBySlug: (org, slug) =>
      clients.environmentCommand.apply({
        ...makeEnvironment(org, slug),
        metadata: { name: slug, org, slug },
      }),
  },
  {
    title: "[rpc:ChannelAppCommandController.rename] a channel app",
    writeTitle:
      "[rpc:ChannelAppCommandController.rename] [rpc:ChannelAppCommandController.apply] a channel app's",
    noun: "Channel app",
    writeVerb: "apply",
    oldSlugCreateReason: "SLUG_RESERVED",
    create: async (org, name) => {
      const app = await clients.channelAppCommand.create(
        makeSlackChannelApp(org, name),
      );
      fixtures.defer(() =>
        clients.channelAppCommand
          .delete({ resourceId: app.metadata!.id })
          .catch(() => undefined),
      );
      return namedOf(app);
    },
    rename: async (id, slug) =>
      namedOf(await clients.channelAppCommand.rename({ resourceId: id, slug })),
    readByReference: async (org, slug) =>
      namedOf(await clients.channelAppQuery.getByReference({ org, slug })),
    writeBySlug: (org, slug) =>
      clients.channelAppCommand.apply({
        ...makeSlackChannelApp(org, slug),
        metadata: { name: slug, org, slug },
      }),
  },
  {
    title: "[rpc:OAuthAppCommandController.rename] an OAuth app",
    writeTitle:
      "[rpc:OAuthAppCommandController.rename] [rpc:OAuthAppCommandController.apply] an OAuth app's",
    noun: "OAuth app",
    writeVerb: "apply",
    oldSlugCreateReason: "SLUG_RESERVED",
    create: async (org, name) => {
      const app = await clients.oauthAppCommand.create(makeOAuthApp(org, name));
      fixtures.defer(() =>
        clients.oauthAppCommand
          .delete({ resourceId: app.metadata!.id })
          .catch(() => undefined),
      );
      return namedOf(app);
    },
    rename: async (id, slug) =>
      namedOf(await clients.oauthAppCommand.rename({ resourceId: id, slug })),
    readByReference: async (org, slug) =>
      namedOf(await clients.oauthAppQuery.getByReference({ org, slug })),
    writeBySlug: (org, slug) =>
      clients.oauthAppCommand.apply({
        ...makeOAuthApp(org, slug),
        metadata: { name: slug, org, slug },
      }),
  },
  {
    title: "[rpc:EvalCommandController.rename] an eval",
    writeTitle:
      "[rpc:EvalCommandController.rename] [rpc:EvalCommandController.push] an eval's",
    noun: "Eval",
    writeVerb: "push",
    oldSlugCreateReason: "SLUG_RENAMED",
    create: async (org, name) => {
      const pushed = await clients.evalCommand.push({
        org,
        slug: name,
        artifact: oneCaseEvalArchive(`What does ${name} cover?`),
      });
      fixtures.defer(() =>
        clients.evalCommand
          .delete({ value: pushed.metadata!.id })
          .catch(() => undefined),
      );
      return namedOf(pushed);
    },
    rename: async (id, slug) =>
      namedOf(await clients.evalCommand.rename({ resourceId: id, slug })),
    readByReference: async (org, slug) =>
      namedOf(await clients.evalQuery.getByReference({ org, slug })),
    writeBySlug: (org, slug) =>
      clients.evalCommand.push({
        org,
        slug,
        artifact: oneCaseEvalArchive("A changed folder."),
      }),
  },
];

describe("a renamed resource keeps its id, and its old slug leads to it", () => {
  for (const kind of KINDS) {
    it(`${kind.title} keeps its id; its old slug leads to it, is refused to a create with ${kind.oldSlugCreateReason}, and is taken back by a rename`, async () => {
      const { org } = await target.provisionTenancy();
      const before = await kind.create(org, uniqueName("rename-old"));
      const after = uniqueName("rename-new");

      const renamed = await kind.rename(before.id, after);
      expect(renamed).toEqual({ id: before.id, slug: after });
      expect(
        await kind.readByReference(org, before.slug),
        "the old slug leads to the resource, named by its new slug",
      ).toEqual({
        id: before.id,
        slug: after,
      });
      expect(await kind.readByReference(org, after)).toEqual({
        id: before.id,
        slug: after,
      });

      const refused = await expectGrpcCode(
        () => kind.create(org, before.slug),
        kind.oldSlugCreateReason === "SLUG_RESERVED" ? Code.AlreadyExists : Code.FailedPrecondition,
        "a create of the slug another resource was just renamed from",
      );
      expect(reasonOf(refused)?.reason).toBe(kind.oldSlugCreateReason);
      expect(reasonOf(refused)?.domain).toBe("stigmer.ai");
      expect(reasonOf(refused)?.metadata).toEqual({ slug: before.slug });

      expect(
        await kind.rename(before.id, before.slug),
        "the resource takes its old slug back",
      ).toEqual(before);
    });

    it(`${kind.writeTitle} old slug, named by a write without the id, is refused ${kind.writeVerb === "update" ? "as an update with no id" : "with SLUG_RENAMED, whose words never name the new slug"}`, async () => {
      const { org } = await target.provisionTenancy();
      const before = await kind.create(org, uniqueName("stale-file"));
      const after = uniqueName("fresh-name");
      await kind.rename(before.id, after);

      if (kind.writeVerb === "update") {
        const refused = await expectGrpcCode(
          () => kind.writeBySlug(org, before.slug),
          Code.InvalidArgument,
          "an update without an id, refused before its slug is read",
        );
        expect(refused.rawMessage).toContain("resource.metadata.id is required");
        expect(
          await kind.readByReference(org, after),
          "nothing was written",
        ).toEqual({ id: before.id, slug: after });
        return;
      }
      const refused = await expectGrpcCode(
        () => kind.writeBySlug(org, before.slug),
        Code.FailedPrecondition,
        "a write by the renamed-away slug",
      );
      expect(reasonOf(refused)?.reason).toBe("SLUG_RENAMED");
      expect(reasonOf(refused)?.metadata).toEqual({ slug: before.slug });
      expect(refused.rawMessage).toBe(
        `${kind.noun} '${before.slug}' was renamed; it still leads to the same ${kind.noun.toLowerCase().replace("oauth", "OAuth")} for reading. Write to it by its current slug or its id`,
      );
      expect(refused.rawMessage).not.toContain(after);
    });
  }
});

describe("a reference that named a renamed resource comes back with its new slug", () => {
  it("[rpc:AgentCommandController.rename] [rpc:ChannelAppCommandController.rename] [rpc:SessionQueryController.get] [rpc:RoutineQueryController.get] [rpc:ChannelQueryController.get] [rpc:AgentQueryController.get] a session's, a routine's and a channel's agent, a parent's subagent and a channel's app", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentInOrg(org, uniqueName("renamed-agent"));
    const parent = await agentInOrg(org, uniqueName("parent"), [agent.slug]);
    const app = await clients.channelAppCommand.create(
      makeSlackChannelApp(org, uniqueName("renamed-app")),
    );
    fixtures.defer(() =>
      clients.channelAppCommand
        .delete({ resourceId: app.metadata!.id })
        .catch(() => undefined),
    );
    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("chat"),
        agentRef: { org, slug: agent.slug },
      }),
    );
    fixtures.defer(() =>
      clients.sessionCommand
        .delete({ value: session.metadata!.id })
        .catch(() => undefined),
    );
    const routine = await clients.routineCommand.create(
      makeRoutine(org, uniqueName("sched"), agent.slug, { enabled: false }),
    );
    fixtures.defer(() =>
      clients.routineCommand
        .delete({ value: routine.metadata!.id })
        .catch(() => undefined),
    );
    const channel = await clients.channelCommand.create(
      makeSlackChannel(org, uniqueName("chan"), agent.slug, {
        appRefSlug: app.metadata!.slug,
      }),
    );
    fixtures.defer(() =>
      clients.channelCommand
        .delete({ value: channel.metadata!.id })
        .catch(() => undefined),
    );

    const agentSlug = uniqueName("agent-renamed");
    const appSlug = uniqueName("app-renamed");
    await clients.agentCommand.rename({
      resourceId: agent.id,
      slug: agentSlug,
    });
    await clients.channelAppCommand.rename({
      resourceId: app.metadata!.id,
      slug: appSlug,
    });

    expect(
      (await clients.sessionQuery.get({ value: session.metadata!.id })).spec
        ?.agentRef,
    ).toMatchObject({ id: agent.id, slug: agentSlug });
    const fired = await clients.routineQuery.get({
      value: routine.metadata!.id,
    });
    expect(
      fired.spec?.agent?.agentRef,
    ).toMatchObject({ id: agent.id, slug: agentSlug });
    const read = await clients.channelQuery.get({
      value: channel.metadata!.id,
    });
    expect(read.spec?.agentRef).toMatchObject({
      id: agent.id,
      slug: agentSlug,
    });
    expect(read.spec?.type.case === "slack" ? read.spec.type.value.appRef : undefined).toMatchObject({
      id: app.metadata!.id,
      slug: appSlug,
    });
    const parentRead = await clients.agentQuery.get({ value: parent.id });
    expect(parentRead.spec?.subagents[0]).toMatchObject({
      id: agent.id,
      slug: agentSlug,
    });
  });
});

describe("an apply carrying the id finds the resource by it", () => {
  it("[rpc:AgentCommandController.apply] the agent is updated, not copied, and its slug changes only through rename; the same file in another organization makes its own", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentInOrg(org, uniqueName("exported"));
    const editedSlug = uniqueName("edited");
    const exported = {
      ...makeAgent({
        org,
        name: agent.slug,
        instructions: "Edited after the export, in the file.",
      }),
      metadata: { id: agent.id, name: agent.slug, org, slug: editedSlug },
    };

    const applied = await clients.agentCommand.apply(exported);
    expect(applied.metadata?.id).toBe(agent.id);
    expect(applied.metadata?.slug, "rename is the slug's one door").toBe(
      agent.slug,
    );
    expect(applied.spec?.instructions).toBe(
      "Edited after the export, in the file.",
    );

    const elsewhere = await target.provisionTenancy();
    const copied = await clients.agentCommand.apply({
      ...exported,
      metadata: { ...exported.metadata, org: elsewhere.org },
    });
    fixtures.defer(() =>
      clients.agentCommand
        .delete({ value: copied.metadata!.id })
        .catch(() => undefined),
    );
    expect(copied.metadata?.id).not.toBe(agent.id);
    expect(copied.metadata?.slug).toBe(editedSlug);
  });
});
