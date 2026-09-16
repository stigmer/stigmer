// Conformance suite for the Plugin domain.
// Domain: agentic / plugin — the unit of install. A plugin is pushed as the
// archive of a plugin folder (Agent Plugins, Cursor, Claude Code or Codex
// layout); the server materialises its skills, MCP servers, agent and
// workflows in the organization as the installing caller, each labelled
// with the plugin's id and the archive digest, and derives membership from
// those labels on read. The contract pinned here, on every edition:
//   - install materialises exactly the members the package describes, and an
//     MCP-only package materialises no agent;
//   - a re-push of the same archive is a no-op (one version, members untouched);
//   - an upgrade removes what the new archive dropped and keeps the agent valid;
//   - members are the plugin's to redefine: a client update, delete, level
//     change or re-push of one is FAILED_PRECONDITION naming the plugin, while
//     operational RPCs on them still answer;
//   - a slug an unmanaged resource or another plugin holds refuses the install
//     with ALREADY_EXISTS naming the holder;
//   - delete removes every member and the head, is refused while a user's own
//     agent references a member, and a fresh install works afterwards;
//   - the version ladder (latest, digest, manifest-version tag) and the
//     history read like a skill's; a bad archive, package or overlay refuses
//     before any write;
//   - visibility flows to every member at install and on updateVisibility.
//
// Out of scope here: the reserved-label refusal under an enforcing authorizer
// (the open-source posture allows by design; the server's composed test proves
// it under a denying authorizer, and the cloud target will when its pin
// advances), and the HTTP transfer lane's round trip (the skill suite proves
// the shared slots).
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  AgentSpecSchema,
  McpServerUsageSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginState } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import {
  mcpOnly,
  pluginArchive,
  thermosLike,
  withFile,
} from "../support/plugins";
import { zipFiles } from "../support/skills";
import { createTarget, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

let target: TargetProfile;
let clients: ConformanceClients;
// One tenancy for the file: every name is unique, and a plugin's cascade
// delete is the fixture cleanup, so the org itself needs no per-test reset.
let tenancy: TenancyContext;
const fixtures = new FixtureTracker();

const PLUGIN_LABEL = "stigmer.ai/plugin";
const PLUGIN_VERSION_LABEL = "stigmer.ai/plugin-version";

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  tenancy = await target.provisionTenancy();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  if (tenancy !== undefined) {
    await target.cleanupTenancy(tenancy);
  }
  await target?.teardown();
});

function org(): string {
  return tenancy.org;
}

async function install(
  archive: Uint8Array,
  opts: { track?: boolean; visibility?: ApiResourceVisibility } = {},
) {
  const plugin = await clients.pluginCommand.push({
    org: org(),
    artifact: archive,
    visibility: opts.visibility,
  });
  if (opts.track ?? true) {
    // Deleting the plugin cascades to every member, so one deferral covers the
    // whole install; a plugin already gone is a clean fixture.
    fixtures.defer(() =>
      clients.pluginCommand.delete({ value: plugin.metadata!.id }).then(
        () => undefined,
        () => undefined,
      ),
    );
  }
  return plugin;
}

function ref(kind: ApiResourceKind, slug: string, version = "") {
  return create(ApiResourceReferenceSchema, {
    org: org(),
    kind,
    slug,
    version,
  });
}

async function memberLabels(
  kind: ApiResourceKind,
  id: string,
): Promise<Record<string, string>> {
  switch (kind) {
    case ApiResourceKind.skill:
      return (await clients.skillQuery.get({ value: id })).metadata!.labels;
    case ApiResourceKind.mcp_server:
      return (await clients.mcpServerQuery.get({ value: id })).metadata!.labels;
    case ApiResourceKind.agent:
      return (await clients.agentQuery.get({ value: id })).metadata!.labels;
    case ApiResourceKind.workflow:
      return (await clients.workflowQuery.get({ value: id })).metadata!.labels;
    default:
      throw new Error(`not a member kind: ${ApiResourceKind[kind]}`);
  }
}

async function memberGone(kind: ApiResourceKind, id: string): Promise<void> {
  await expectGrpcCode(
    () => memberLabels(kind, id),
    Code.NotFound,
    `${ApiResourceKind[kind]} ${id} should be gone`,
  );
}

describe("Plugin conformance — install", () => {
  it("materialises a Cursor plugin as one skill, one MCP server and one agent, each labelled with the plugin id and digest", async () => {
    const name = uniqueName("plg-thermos");
    const plugin = await install(pluginArchive(thermosLike(name)));

    expect(plugin.metadata?.id).toMatch(/^plg_/);
    expect(plugin.metadata?.slug).toBe(name);
    expect(plugin.spec?.version).toBe("1.2.0");
    expect(plugin.status?.state).toBe(PluginState.READY);
    expect(plugin.status?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(plugin.status?.materialized).toMatchObject({
      skills: 1,
      mcpServers: 1,
      agents: 1,
      workflows: 0,
    });
    expect(plugin.status?.warnings.map((w) => w.kind)).toContain(
      "model-hint-unresolved",
    );

    const { members } = await clients.pluginQuery.listMembers({
      value: plugin.metadata!.id,
    });
    expect(members.map((m) => `${ApiResourceKind[m.kind]}:${m.slug}`)).toEqual([
      `skill:${name}-review`,
      `mcp_server:${name}-github`,
      `agent:${name}`,
    ]);
    for (const member of members) {
      const labels = await memberLabels(member.kind, member.id);
      expect(labels[PLUGIN_LABEL], `${member.slug} names its plugin`).toBe(
        plugin.metadata!.id,
      );
      expect(
        labels[PLUGIN_VERSION_LABEL],
        `${member.slug} carries the digest`,
      ).toBe(plugin.status!.digest);
    }

    const agent = await clients.agentQuery.getByReference(
      ref(ApiResourceKind.agent, name),
    );
    expect(agent.spec?.skillRefs.map((r) => r.slug)).toEqual([
      `${name}-review`,
    ]);
    expect(
      agent.spec?.mcpServerUsages.map((u) => u.mcpServerRef?.slug),
    ).toEqual([`${name}-github`]);
    expect(agent.spec?.subAgents.map((s) => s.name)).toEqual([
      `${name}-reviewer`,
    ]);
    expect(agent.spec?.subAgents[0]?.modelOverride).toBe("");

    const server = await clients.mcpServerQuery.getByReference(
      ref(ApiResourceKind.mcp_server, `${name}-github`),
    );
    expect(server.spec?.env["GITHUB_TOKEN"]).toMatchObject({
      isSecret: true,
      optional: false,
    });
  });

  it("materialises an MCP-only package as its server and no agent", async () => {
    const name = uniqueName("plg-mcp");
    const plugin = await install(pluginArchive(mcpOnly(name)));
    expect(plugin.status?.materialized).toMatchObject({
      skills: 0,
      mcpServers: 1,
      agents: 0,
      workflows: 0,
    });
    const { members } = await clients.pluginQuery.listMembers({
      value: plugin.metadata!.id,
    });
    expect(members.map((m) => ApiResourceKind[m.kind])).toEqual(["mcp_server"]);
    await expectGrpcCode(
      () => clients.agentQuery.getByReference(ref(ApiResourceKind.agent, name)),
      Code.NotFound,
      "an MCP-only plugin has no agent",
    );
  });

  it("re-pushing the same archive is a no-op: same digest, one version, members untouched", async () => {
    const name = uniqueName("plg-idem");
    const archive = pluginArchive(thermosLike(name));
    const first = await install(archive);
    const skillBefore = await clients.skillQuery.getByReference(
      ref(ApiResourceKind.skill, `${name}-review`),
    );

    const second = await install(archive, { track: false });
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.status?.digest).toBe(first.status?.digest);

    const versions = await clients.pluginQuery.listVersions({
      org: org(),
      slug: name,
    });
    expect(versions.totalCount).toBe(1);
    expect(versions.versions[0]?.tag).toBe("1.2.0");
    expect(versions.versions[0]?.isCurrent).toBe(true);

    const skillAfter = await clients.skillQuery.getByReference(
      ref(ApiResourceKind.skill, `${name}-review`),
    );
    expect(skillAfter.status?.versionHash).toBe(
      skillBefore.status?.versionHash,
    );
    expect(skillAfter.status?.audit?.specAudit?.updatedAt).toEqual(
      skillBefore.status?.audit?.specAudit?.updatedAt,
    );
  });

  it("an upgrade that drops a skill removes it, keeps the agent valid, and grows the history", async () => {
    const name = uniqueName("plg-up");
    const first = await install(
      pluginArchive(thermosLike(name, { extraSkill: `${name}-extra` })),
    );
    expect(first.status?.materialized?.skills).toBe(2);
    const extra = await clients.skillQuery.getByReference(
      ref(ApiResourceKind.skill, `${name}-extra`),
    );

    const second = await install(pluginArchive(thermosLike(name)), {
      track: false,
    });
    expect(second.status?.materialized?.skills).toBe(1);
    expect(second.status?.digest).not.toBe(first.status?.digest);

    await memberGone(ApiResourceKind.skill, extra.metadata!.id);
    const agent = await clients.agentQuery.getByReference(
      ref(ApiResourceKind.agent, name),
    );
    expect(agent.spec?.skillRefs.map((r) => r.slug)).toEqual([
      `${name}-review`,
    ]);

    const versions = await clients.pluginQuery.listVersions({
      org: org(),
      slug: name,
    });
    expect(versions.totalCount).toBe(2);
    expect(
      versions.versions.filter((v) => v.isCurrent).map((v) => v.digest),
    ).toEqual([second.status?.digest]);
  });

  it("installs at the requested visibility and moves every member with updateVisibility", async () => {
    const name = uniqueName("plg-vis");
    const plugin = await install(pluginArchive(thermosLike(name)), {
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(plugin.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_org,
    );

    const moved = await clients.pluginCommand.updateVisibility({
      resourceId: plugin.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(moved.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_private,
    );
    const { members } = await clients.pluginQuery.listMembers({
      value: plugin.metadata!.id,
    });
    for (const member of members) {
      const level =
        member.kind === ApiResourceKind.skill
          ? (await clients.skillQuery.get({ value: member.id })).metadata
              ?.visibility
          : member.kind === ApiResourceKind.mcp_server
            ? (await clients.mcpServerQuery.get({ value: member.id })).metadata
                ?.visibility
            : (await clients.agentQuery.get({ value: member.id })).metadata
                ?.visibility;
      expect(level, `${member.slug} follows the plugin's level`).toBe(
        ApiResourceVisibility.visibility_private,
      );
    }
  });
});

describe("Plugin conformance — version resolution", () => {
  it("getByReference resolves latest, the digest and the manifest-version tag to the head", async () => {
    const name = uniqueName("plg-ref");
    const plugin = await install(pluginArchive(thermosLike(name)));
    for (const version of ["", "latest", plugin.status!.digest, "1.2.0"]) {
      const resolved = await clients.pluginQuery.getByReference(
        ref(ApiResourceKind.plugin, name, version),
      );
      expect(resolved.status?.digest, `version '${version}'`).toBe(
        plugin.status?.digest,
      );
    }
  });

  it("returns NotFound for an unknown version and an unknown slug", async () => {
    const name = uniqueName("plg-ref");
    await install(pluginArchive(thermosLike(name)));
    await expectGrpcCode(
      () =>
        clients.pluginQuery.getByReference(
          ref(ApiResourceKind.plugin, name, "9.9.9"),
        ),
      Code.NotFound,
      "unknown version",
    );
    await expectGrpcCode(
      () =>
        clients.pluginQuery.getByReference(
          ref(ApiResourceKind.plugin, uniqueName("plg-missing")),
        ),
      Code.NotFound,
      "unknown slug",
    );
  });

  it("get rejects an empty id and answers NotFound for a missing one", async () => {
    await expectGrpcCode(
      () => clients.pluginQuery.get({ value: "" }),
      Code.InvalidArgument,
      "empty id",
    );
    await expectGrpcCode(
      () => clients.pluginQuery.get({ value: "plg_missing" }),
      Code.NotFound,
      "missing id",
    );
  });
});

describe("Plugin conformance — members are the plugin's to redefine", () => {
  it("refuses a client update, delete and level change of a member, naming the plugin", async () => {
    const name = uniqueName("plg-managed");
    const plugin = await install(pluginArchive(thermosLike(name)));
    const { members } = await clients.pluginQuery.listMembers({
      value: plugin.metadata!.id,
    });
    const agentMember = members.find((m) => m.kind === ApiResourceKind.agent)!;
    const serverMember = members.find(
      (m) => m.kind === ApiResourceKind.mcp_server,
    )!;

    const agent = await clients.agentQuery.get({ value: agentMember.id });
    agent.spec!.description = "edited by a client";
    const updateError = await expectGrpcCode(
      () => clients.agentCommand.update(agent),
      Code.FailedPrecondition,
      "client update",
    );
    expect(updateError.rawMessage).toContain(
      `agent '${name}' is managed by plugin '${name}'`,
    );

    await expectGrpcCode(
      () => clients.mcpServerCommand.delete({ resourceId: serverMember.id }),
      Code.FailedPrecondition,
      "client delete",
    );
    await expectGrpcCode(
      () =>
        clients.agentCommand.updateVisibility({
          resourceId: agentMember.id,
          visibility: ApiResourceVisibility.visibility_private,
        }),
      Code.FailedPrecondition,
      "client level change",
    );
    // An operational read still answers.
    const server = await clients.mcpServerQuery.get({ value: serverMember.id });
    expect(server.metadata?.slug).toBe(`${name}-github`);
  });

  it("refuses a client re-push of a managed skill under the same name", async () => {
    const name = uniqueName("plg-skillpush");
    await install(pluginArchive(thermosLike(name)));
    const rogue = zipFiles({
      "SKILL.md": `---\nname: ${name}-review\ndescription: hijack\n---\n# Mine now`,
    });
    const error = await expectGrpcCode(
      () => clients.skillCommand.push({ org: org(), artifact: rogue }),
      Code.FailedPrecondition,
      "managed skill re-push",
    );
    expect(error.rawMessage).toContain(
      `skill '${name}-review' is managed by plugin '${name}'`,
    );
  });

  it("refuses to install over a slug an unmanaged resource holds, naming it", async () => {
    const name = uniqueName("plg-collide");
    const skillName = `${name}-review`;
    const mine = await clients.skillCommand.push({
      org: org(),
      artifact: zipFiles({
        "SKILL.md": `---\nname: ${skillName}\ndescription: mine\n---\n# Mine`,
      }),
    });
    fixtures.defer(() =>
      clients.skillCommand.delete({ value: mine.metadata!.id }),
    );
    const error = await expectGrpcCode(
      () =>
        clients.pluginCommand.push({
          org: org(),
          artifact: pluginArchive(thermosLike(name)),
        }),
      Code.AlreadyExists,
      "unmanaged holder",
    );
    expect(error.rawMessage).toContain(
      `'${skillName}' exists in org '${org()}' and is not managed by a plugin`,
    );
    await expectGrpcCode(
      () =>
        clients.pluginQuery.getByReference(ref(ApiResourceKind.plugin, name)),
      Code.NotFound,
      "nothing was written",
    );
  });

  it("refuses to install a slug another plugin holds, naming that plugin", async () => {
    const first = uniqueName("plg-holder");
    const second = uniqueName("plg-claimant");
    const shared = `${first}-shared`;
    await install(pluginArchive(thermosLike(first, { skill: shared })));
    const error = await expectGrpcCode(
      () =>
        clients.pluginCommand.push({
          org: org(),
          artifact: pluginArchive(thermosLike(second, { skill: shared })),
        }),
      Code.AlreadyExists,
      "another plugin's member",
    );
    expect(error.rawMessage).toContain(
      `'${shared}' is held by plugin '${first}'`,
    );
  });
});

describe("Plugin conformance — delete", () => {
  it("removes every member and the head; a fresh install of the same archive works afterwards", async () => {
    const name = uniqueName("plg-remove");
    const archive = pluginArchive(thermosLike(name));
    const plugin = await install(archive, { track: false });
    const { members } = await clients.pluginQuery.listMembers({
      value: plugin.metadata!.id,
    });
    expect(members).toHaveLength(3);

    const deleted = await clients.pluginCommand.delete({
      value: plugin.metadata!.id,
    });
    expect(deleted.metadata?.id).toBe(plugin.metadata?.id);
    await expectGrpcCode(
      () => clients.pluginQuery.get({ value: plugin.metadata!.id }),
      Code.NotFound,
      "head gone",
    );
    for (const member of members) {
      await memberGone(member.kind, member.id);
    }

    const again = await install(archive);
    expect(again.status?.state).toBe(PluginState.READY);
    expect(again.metadata?.id).not.toBe(plugin.metadata?.id);
  });

  it("is refused while a user's own agent references a member, and succeeds once it is detached", async () => {
    const name = uniqueName("plg-used");
    const plugin = await install(pluginArchive(thermosLike(name)), {
      track: false,
    });
    const mine = await clients.agentCommand.create(
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: create(ApiResourceMetadataSchema, {
          org: org(),
          name: `${name}-composer`,
        }),
        spec: create(AgentSpecSchema, {
          instructions: "You compose over the plugin's tools.",
          mcpServerUsages: [
            create(McpServerUsageSchema, {
              mcpServerRef: create(ApiResourceReferenceSchema, {
                org: org(),
                kind: ApiResourceKind.mcp_server,
                slug: `${name}-github`,
              }),
            }),
          ],
        }),
      }),
    );
    const error = await expectGrpcCode(
      () => clients.pluginCommand.delete({ value: plugin.metadata!.id }),
      Code.FailedPrecondition,
      "referenced member",
    );
    expect(error.rawMessage).toContain(
      `plugin '${name}' is still used by agent '${name}-composer'`,
    );

    await clients.agentCommand.delete({ value: mine.metadata!.id });
    await clients.pluginCommand.delete({ value: plugin.metadata!.id });
    await expectGrpcCode(
      () => clients.pluginQuery.get({ value: plugin.metadata!.id }),
      Code.NotFound,
      "head gone",
    );
  });

  it("delete of a missing id returns NotFound and an empty id is InvalidArgument", async () => {
    await expectGrpcCode(
      () => clients.pluginCommand.delete({ value: "plg_missing" }),
      Code.NotFound,
      "missing id",
    );
    await expectGrpcCode(
      () => clients.pluginCommand.delete({ value: "" }),
      Code.InvalidArgument,
      "empty id",
    );
  });
});

describe("Plugin conformance — refusals before any write", () => {
  it("refuses a package the library refuses, with its sentences, and writes nothing", async () => {
    const name = uniqueName("plg-badurl");
    const broken = pluginArchive(
      withFile(
        thermosLike(name),
        "mcp.json",
        JSON.stringify({
          mcpServers: {
            [`${name}-github`]: { type: "http", url: "https://${HOST}/mcp" },
          },
        }),
      ),
    );
    const error = await expectGrpcCode(
      () => clients.pluginCommand.push({ org: org(), artifact: broken }),
      Code.InvalidArgument,
      "library refusal",
    );
    expect(error.rawMessage).toContain(
      "plugin cannot be installed, 1 problem found",
    );
    expect(error.rawMessage).toContain("has a variable in its 'url'");
    await expectGrpcCode(
      () =>
        clients.pluginQuery.getByReference(ref(ApiResourceKind.plugin, name)),
      Code.NotFound,
      "nothing was written",
    );
  });

  it("refuses an agent overlay with an unknown field or a foreign name, naming the document", async () => {
    const name = uniqueName("plg-overlay");
    const unknownField = pluginArchive(
      thermosLike(name, {
        agentOverlay: `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  instructions: Ten characters or more of instructions.\n  favourite_colour: blue\n`,
      }),
    );
    const first = await expectGrpcCode(
      () => clients.pluginCommand.push({ org: org(), artifact: unknownField }),
      Code.InvalidArgument,
      "unknown field",
    );
    expect(first.rawMessage).toContain(
      "overlay document 'ai.stigmer/agent.yaml'",
    );

    const foreignName = pluginArchive(
      thermosLike(name, {
        agentOverlay: `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: somebody-else\nspec:\n  instructions: Ten characters or more of instructions.\n`,
      }),
    );
    const second = await expectGrpcCode(
      () => clients.pluginCommand.push({ org: org(), artifact: foreignName }),
      Code.InvalidArgument,
      "foreign name",
    );
    expect(second.rawMessage).toContain("names 'somebody-else'");
  });

  it("applies an agent overlay wholesale when it names the plugin", async () => {
    const name = uniqueName("plg-authored");
    const plugin = await install(
      pluginArchive(
        thermosLike(name, {
          agentOverlay: `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  description: authored\n  instructions: The author's own instructions for this agent.\n`,
        }),
      ),
    );
    expect(plugin.status?.state).toBe(PluginState.READY);
    const agent = await clients.agentQuery.getByReference(
      ref(ApiResourceKind.agent, name),
    );
    expect(agent.spec?.instructions).toBe(
      "The author's own instructions for this agent.",
    );
    expect(agent.metadata?.labels[PLUGIN_LABEL]).toBe(plugin.metadata?.id);
  });

  it("refuses bytes that are not an archive, an empty request, and both artifact sources at once", async () => {
    await expectGrpcCode(
      () =>
        clients.pluginCommand.push({
          org: org(),
          artifact: new TextEncoder().encode("not a zip"),
        }),
      Code.InvalidArgument,
      "not a zip",
    );
    await expectGrpcCode(
      () => clients.pluginCommand.push({ org: org() }),
      Code.InvalidArgument,
      "no source",
    );
    await expectGrpcCode(
      () =>
        clients.pluginCommand.push({
          org: org(),
          artifact: new Uint8Array(4),
          artifactUploadRef: "sau_x",
        }),
      Code.InvalidArgument,
      "both sources",
    );
  });
});
