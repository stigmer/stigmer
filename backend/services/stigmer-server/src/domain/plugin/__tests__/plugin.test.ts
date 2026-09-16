/**
 * Composed-server round-trips for the Plugin kind: a real server over a
 * temp SQLite store, raw Connect clients, archives written by the server's
 * own writer from the library's fixture builders. Pins the install
 * contract the conformance suite proves per edition: a Cursor plugin with
 * skills, a sub-agent and an MCP server materialises exactly those
 * members with both labels; an MCP-only plugin materialises no agent; a
 * re-push of the same archive writes nothing; a client's edit, re-push or
 * delete of a member is refused naming the plugin while the plugin's own
 * upgrade drops what the archive dropped; uninstall removes every member
 * and is refused while a user's own agent still references one; a slug an
 * unmanaged resource holds refuses the install; a bad overlay refuses
 * before any write. A second composition, under an authorizer that denies
 * `can_write_reserved_labels`, pins the reserved-label refusal the
 * open-source posture allows by design.
 */
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { create as createMessage } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cursorPlugin,
  openPlugin,
  withFile,
} from "@stigmer/plugin-package/testing";
import type { PluginFixture } from "@stigmer/plugin-package/testing";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import {
  AgentSpecSchema,
  McpServerUsageSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginState } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import { createLogger } from "../../../boot/logger.js";
import {
  PLUGIN_LABEL,
  PLUGIN_VERSION_LABEL,
} from "../../../pipeline/apiresource-labels.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});
const ORG = "acme";

let server: ComposedServer;
let plugins: Client<typeof PluginCommandController>;
let pluginQuery: Client<typeof PluginQueryController>;
let agents: Client<typeof AgentCommandController>;
let agentQuery: Client<typeof AgentQueryController>;
let skills: Client<typeof SkillCommandController>;
let skillQuery: Client<typeof SkillQueryController>;
let mcpServers: Client<typeof McpServerCommandController>;
let mcpServerQuery: Client<typeof McpServerQueryController>;
let dir: string;

async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "plugin-domain-test-"));
  const grpcPort = await reserveFreePort();
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      GRPC_PORT: String(grpcPort),
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
    }),
    logger: silentLogger,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  plugins = createClient(PluginCommandController, transport);
  pluginQuery = createClient(PluginQueryController, transport);
  agents = createClient(AgentCommandController, transport);
  agentQuery = createClient(AgentQueryController, transport);
  skills = createClient(SkillCommandController, transport);
  skillQuery = createClient(SkillQueryController, transport);
  mcpServers = createClient(McpServerCommandController, transport);
  mcpServerQuery = createClient(McpServerQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const encoder = new TextEncoder();

/** A fixture map as the archive the CLI would push: the server's own deterministic writer. */
function archiveOf(fixture: PluginFixture): Uint8Array {
  return writeArchive(
    [...fixture.entries()].map(([filePath, content]) => ({
      path: filePath,
      bytes: typeof content === "string" ? encoder.encode(content) : content,
    })),
  );
}

let counter = 0;
function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** A Cursor plugin with one skill, one sub-agent and one HTTP server: the thermos shape. */
function thermosLike(
  name: string,
  options: { readonly skill?: string; readonly extraSkill?: string } = {},
): PluginFixture {
  const skill = options.skill ?? `${name}-review`;
  return cursorPlugin({
    name,
    version: "1.2.0",
    description: "Code review with a thermonuclear standard",
    skills: [
      {
        name: skill,
        description: "Review code thoroughly",
        body: "# Review\nRead everything.",
      },
      ...(options.extraSkill === undefined
        ? []
        : [
            {
              name: options.extraSkill,
              description: "Another skill",
              body: "# More\nAnd more.",
            },
          ]),
    ],
    agents: [
      {
        file: "reviewer",
        frontmatter: {
          name: `${name}-reviewer`,
          description: "Reviews pull requests",
          model: "sonnet",
        },
        body: "You review pull requests with care and name every risk you see.",
      },
    ],
    mcpServers: {
      [`${name}-github`]: {
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      },
    },
    variables: {
      GITHUB_TOKEN: {
        type: "string",
        title: "GitHub token",
        description: "A personal access token",
      },
    },
    required: ["GITHUB_TOKEN"],
  });
}

async function expectCode(
  promise: Promise<unknown>,
  code: Code,
  contains?: string,
): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    const connectError = error as ConnectError;
    expect(connectError.code, connectError.rawMessage).toBe(code);
    if (contains !== undefined) {
      expect(connectError.rawMessage).toContain(contains);
    }
    return connectError;
  }
  throw new Error(`expected ${Code[code]}, the call succeeded`);
}

describe("Plugin push — materialisation", () => {
  it("installs a Cursor plugin as one skill, one MCP server and one agent, each labelled with the plugin id and digest", async () => {
    const name = uniqueName("thermos");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });

    expect(installed.metadata?.id).toMatch(/^plg_/);
    expect(installed.metadata?.slug).toBe(name);
    expect(installed.spec?.name).toBe(name);
    expect(installed.spec?.version).toBe("1.2.0");
    expect(installed.status?.state).toBe(PluginState.READY);
    expect(installed.status?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(installed.status?.materialized).toMatchObject({
      skills: 1,
      mcpServers: 1,
      agents: 1,
      workflows: 0,
    });
    // The sub-agent's model hint is recorded, never applied.
    expect(installed.status?.warnings.map((w) => w.kind)).toContain(
      "model-hint-unresolved",
    );

    const members = await pluginQuery.listMembers({
      value: installed.metadata!.id,
    });
    expect(
      members.members.map((m) => `${ApiResourceKind[m.kind]}:${m.slug}`),
    ).toEqual([
      `skill:${name}-review`,
      `mcp_server:${name}-github`,
      `agent:${name}`,
    ]);

    const digest = installed.status!.digest;
    for (const member of members.members) {
      const labels =
        member.kind === ApiResourceKind.skill
          ? (await skillQuery.get({ value: member.id })).metadata!.labels
          : member.kind === ApiResourceKind.mcp_server
            ? (await mcpServerQuery.get({ value: member.id })).metadata!.labels
            : (await agentQuery.get({ value: member.id })).metadata!.labels;
      expect(labels[PLUGIN_LABEL]).toBe(installed.metadata!.id);
      expect(labels[PLUGIN_VERSION_LABEL]).toBe(digest);
    }

    const agent = await agentQuery.getByReference(
      createMessage(ApiResourceReferenceSchema, {
        org: ORG,
        kind: ApiResourceKind.agent,
        slug: name,
      }),
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
    expect(agent.spec?.subAgents[0]?.mcpAccess.map((a) => a.mcpServer)).toEqual(
      [`${name}-github`],
    );

    const serverResource = await mcpServerQuery.getByReference(
      createMessage(ApiResourceReferenceSchema, {
        org: ORG,
        kind: ApiResourceKind.mcp_server,
        slug: `${name}-github`,
      }),
    );
    expect(serverResource.spec?.env["GITHUB_TOKEN"]).toMatchObject({
      isSecret: true,
      optional: false,
    });
  });

  it("installs an MCP-only plugin as its servers and no agent", async () => {
    const name = uniqueName("github");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(
        openPlugin({
          name,
          version: "0.1.0",
          // The open format's word for the transport is `streamable-http`.
          mcpServers: {
            [name]: {
              type: "streamable-http",
              url: "https://example.com/mcp",
              headers: { Authorization: "Bearer ${TOKEN}" },
            },
          },
        }),
      ),
    });
    expect(installed.status?.materialized).toMatchObject({
      skills: 0,
      mcpServers: 1,
      agents: 0,
    });
    const members = await pluginQuery.listMembers({
      value: installed.metadata!.id,
    });
    expect(members.members.map((m) => ApiResourceKind[m.kind])).toEqual([
      "mcp_server",
    ]);
  });

  it("re-pushing the same archive writes nothing: same digest, one version, members untouched", async () => {
    const name = uniqueName("idem");
    const first = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    const skillBefore = await skillQuery.getByReference(
      createMessage(ApiResourceReferenceSchema, {
        org: ORG,
        kind: ApiResourceKind.skill,
        slug: `${name}-review`,
      }),
    );
    const second = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.status?.digest).toBe(first.status?.digest);
    const versions = await pluginQuery.listVersions({ org: ORG, slug: name });
    expect(versions.totalCount).toBe(1);
    expect(versions.versions[0]?.tag).toBe("1.2.0");
    const skillAfter = await skillQuery.getByReference(
      createMessage(ApiResourceReferenceSchema, {
        org: ORG,
        kind: ApiResourceKind.skill,
        slug: `${name}-review`,
      }),
    );
    expect(skillAfter.status?.audit?.specAudit?.updatedAt).toEqual(
      skillBefore.status?.audit?.specAudit?.updatedAt,
    );
  });

  it("an upgrade that drops a skill removes it and keeps the agent valid; the version history grows", async () => {
    const name = uniqueName("upgrade");
    const first = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name, { extraSkill: `${name}-extra` })),
    });
    expect(first.status?.materialized?.skills).toBe(2);

    const second = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    expect(second.status?.materialized?.skills).toBe(1);
    expect(second.status?.digest).not.toBe(first.status?.digest);

    await expectCode(
      skillQuery.getByReference(
        createMessage(ApiResourceReferenceSchema, {
          org: ORG,
          kind: ApiResourceKind.skill,
          slug: `${name}-extra`,
        }),
      ),
      Code.NotFound,
    );
    const agent = await agentQuery.getByReference(
      createMessage(ApiResourceReferenceSchema, {
        org: ORG,
        kind: ApiResourceKind.agent,
        slug: name,
      }),
    );
    expect(agent.spec?.skillRefs.map((r) => r.slug)).toEqual([
      `${name}-review`,
    ]);
    const versions = await pluginQuery.listVersions({ org: ORG, slug: name });
    expect(versions.totalCount).toBe(2);
    expect(
      versions.versions.filter((v) => v.isCurrent).map((v) => v.digest),
    ).toEqual([second.status?.digest]);
  });

  it("getByReference resolves latest, the digest and the manifest version tag", async () => {
    const name = uniqueName("ref");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    for (const version of ["", "latest", installed.status!.digest, "1.2.0"]) {
      const resolved = await pluginQuery.getByReference(
        createMessage(ApiResourceReferenceSchema, {
          org: ORG,
          kind: ApiResourceKind.plugin,
          slug: name,
          version,
        }),
      );
      expect(resolved.status?.digest, version).toBe(installed.status?.digest);
    }
  });
});

describe("Plugin members are the plugin's to redefine", () => {
  it("refuses a client update, delete and visibility change of a member, naming the plugin", async () => {
    const name = uniqueName("managed");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    const members = await pluginQuery.listMembers({
      value: installed.metadata!.id,
    });
    const agentMember = members.members.find(
      (m) => m.kind === ApiResourceKind.agent,
    )!;
    const serverMember = members.members.find(
      (m) => m.kind === ApiResourceKind.mcp_server,
    )!;

    const agent = await agentQuery.get({ value: agentMember.id });
    agent.spec!.description = "edited by a client";
    await expectCode(
      agents.update(agent),
      Code.FailedPrecondition,
      `agent '${name}' is managed by plugin '${name}'`,
    );
    await expectCode(
      mcpServers.delete({ resourceId: serverMember.id }),
      Code.FailedPrecondition,
      `MCP server '${name}-github' is managed by plugin '${name}'`,
    );
    await expectCode(
      agents.updateVisibility({ resourceId: agentMember.id, visibility: 3 }),
      Code.FailedPrecondition,
      "is managed by plugin",
    );
  });

  it("refuses a client re-push of a managed skill under the same name", async () => {
    const name = uniqueName("skillpush");
    await plugins.push({ org: ORG, artifact: archiveOf(thermosLike(name)) });
    const rogue = writeArchive([
      {
        path: "SKILL.md",
        bytes: encoder.encode(
          `---\nname: ${name}-review\ndescription: hijack\n---\n# Mine now`,
        ),
      },
    ]);
    await expectCode(
      skills.push({ org: ORG, artifact: rogue }),
      Code.FailedPrecondition,
      `skill '${name}-review' is managed by plugin '${name}'`,
    );
  });

  it("refuses to install over a slug an unmanaged resource holds, naming it", async () => {
    const name = uniqueName("collide");
    const skillName = `${name}-review`;
    await skills.push({
      org: ORG,
      artifact: writeArchive([
        {
          path: "SKILL.md",
          bytes: encoder.encode(
            `---\nname: ${skillName}\ndescription: mine\n---\n# Mine`,
          ),
        },
      ]),
    });
    await expectCode(
      plugins.push({ org: ORG, artifact: archiveOf(thermosLike(name)) }),
      Code.AlreadyExists,
      `'${skillName}' exists in org '${ORG}' and is not managed by a plugin`,
    );
  });

  it("refuses to install a slug another plugin holds, naming that plugin", async () => {
    const first = uniqueName("holder");
    const second = uniqueName("claimant");
    const shared = `${first}-shared`;
    await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(first, { skill: shared })),
    });
    await expectCode(
      plugins.push({
        org: ORG,
        artifact: archiveOf(thermosLike(second, { skill: shared })),
      }),
      Code.AlreadyExists,
      `'${shared}' is held by plugin '${first}'`,
    );
  });
});

describe("Plugin delete", () => {
  it("removes every member and the head; a fresh install of the same archive works afterwards", async () => {
    const name = uniqueName("remove");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    const members = await pluginQuery.listMembers({
      value: installed.metadata!.id,
    });
    expect(members.members).toHaveLength(3);

    await plugins.delete({ value: installed.metadata!.id });

    await expectCode(
      pluginQuery.get({ value: installed.metadata!.id }),
      Code.NotFound,
    );
    for (const member of members.members) {
      const lookup =
        member.kind === ApiResourceKind.skill
          ? skillQuery.get({ value: member.id })
          : member.kind === ApiResourceKind.mcp_server
            ? mcpServerQuery.get({ value: member.id })
            : agentQuery.get({ value: member.id });
      await expectCode(lookup, Code.NotFound);
    }
    const again = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    expect(again.status?.state).toBe(PluginState.READY);
    expect(again.metadata?.id).not.toBe(installed.metadata?.id);
  });

  it("is refused while a user's own agent references a member, and succeeds once it is detached", async () => {
    const name = uniqueName("referenced");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    const mine = await agents.create(
      createMessage(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: createMessage(ApiResourceMetadataSchema, {
          org: ORG,
          name: `${name}-composer`,
        }),
        spec: createMessage(AgentSpecSchema, {
          instructions: "You compose over the plugin's tools.",
          mcpServerUsages: [
            createMessage(McpServerUsageSchema, {
              mcpServerRef: createMessage(ApiResourceReferenceSchema, {
                org: ORG,
                kind: ApiResourceKind.mcp_server,
                slug: `${name}-github`,
              }),
            }),
          ],
        }),
      }),
    );
    await expectCode(
      plugins.delete({ value: installed.metadata!.id }),
      Code.FailedPrecondition,
      `plugin '${name}' is still used by agent '${name}-composer'`,
    );
    await agents.delete({ value: mine.metadata!.id });
    await plugins.delete({ value: installed.metadata!.id });
    await expectCode(
      pluginQuery.get({ value: installed.metadata!.id }),
      Code.NotFound,
    );
  });
});

describe("Plugin push — refusals before any write", () => {
  it("refuses a package the library refuses, with its sentences", async () => {
    const name = uniqueName("badurl");
    const broken = cursorPlugin({
      name,
      mcpServers: { [name]: { type: "http", url: "https://${HOST}/mcp" } },
    });
    const error = await expectCode(
      plugins.push({ org: ORG, artifact: archiveOf(broken) }),
      Code.InvalidArgument,
      "plugin cannot be installed, 1 problem found",
    );
    expect(error.rawMessage).toContain("has a variable in its 'url'");
    await expectCode(
      pluginQuery.getByReference(
        createMessage(ApiResourceReferenceSchema, {
          org: ORG,
          kind: ApiResourceKind.plugin,
          slug: name,
        }),
      ),
      Code.NotFound,
    );
  });

  it("refuses an agent overlay with an unknown field, naming the document", async () => {
    const name = uniqueName("overlay");
    const fixture = withFile(
      thermosLike(name),
      "ai.stigmer/agent.yaml",
      `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  instructions: Ten characters or more of instructions.\n  favourite_colour: blue\n`,
    );
    await expectCode(
      plugins.push({ org: ORG, artifact: archiveOf(fixture) }),
      Code.InvalidArgument,
      "overlay document 'ai.stigmer/agent.yaml'",
    );
  });

  it("refuses an agent overlay that names another resource", async () => {
    const name = uniqueName("overlayname");
    const fixture = withFile(
      thermosLike(name),
      "ai.stigmer/agent.yaml",
      `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: somebody-else\nspec:\n  instructions: Ten characters or more of instructions.\n`,
    );
    await expectCode(
      plugins.push({ org: ORG, artifact: archiveOf(fixture) }),
      Code.InvalidArgument,
      "names 'somebody-else'",
    );
  });

  it("refuses bytes that are not an archive", async () => {
    await expectCode(
      plugins.push({ org: ORG, artifact: encoder.encode("not a zip") }),
      Code.InvalidArgument,
      "failed to read plugin archive",
    );
  });

  it("applies an agent overlay wholesale when it names the plugin", async () => {
    const name = uniqueName("overlayok");
    const fixture = withFile(
      thermosLike(name),
      "ai.stigmer/agent.yaml",
      `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  description: authored\n  instructions: The author's own instructions for this agent.\n`,
    );
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(fixture),
    });
    expect(installed.status?.state).toBe(PluginState.READY);
    const agent = await agentQuery.getByReference(
      createMessage(ApiResourceReferenceSchema, {
        org: ORG,
        kind: ApiResourceKind.agent,
        slug: name,
      }),
    );
    expect(agent.spec?.instructions).toBe(
      "The author's own instructions for this agent.",
    );
    expect(agent.metadata?.labels[PLUGIN_LABEL]).toBe(installed.metadata?.id);
  });
});

/**
 * The reserved-label refusal where an authorizer enforces. The open-source
 * built-in authorizer allows `can_write_reserved_labels` by design, so the
 * default composition above cannot show the refusal; this composition
 * registers an authorizer that denies exactly that permission and allows
 * everything else, the posture a hosted edition takes. An archive whose
 * overlay carries a `stigmer.ai/*` label is refused before a byte is
 * written, and a plain overlay under the same authorizer still installs —
 * so the sanitiser asks the platform capability and nothing broader.
 */
describe("Plugin push under an authorizer that enforces reserved labels", () => {
  let enforcingDir: string;
  let enforcing: ComposedServer;
  let enforcingPlugins: Client<typeof PluginCommandController>;
  let enforcingQuery: Client<typeof PluginQueryController>;
  const observed: AuthzCheck[] = [];

  beforeAll(async () => {
    enforcingDir = mkdtempSync(path.join(tmpdir(), "plugin-domain-enforcing-"));
    const grpcPort = await reserveFreePort();
    const authorizer: Authorizer = {
      authorize(_caller, check) {
        if (check.permission === IamPermission.can_write_reserved_labels) {
          observed.push(check);
          return Promise.resolve({
            kind: "deny",
            reason: "reserved labels are the platform's",
          });
        }
        return Promise.resolve({ kind: "allow" });
      },
    };
    enforcing = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        GRPC_PORT: String(grpcPort),
        DB_PATH: path.join(enforcingDir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(enforcingDir, "artifacts"),
        STORAGE_PATH: path.join(enforcingDir, "storage"),
      }),
      logger: silentLogger,
      host: "127.0.0.1",
      extensions: [{ name: "reserved-labels-enforced", authorizer }],
    });
    const port = await enforcing.start();
    const transport: Transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
    enforcingPlugins = createClient(PluginCommandController, transport);
    enforcingQuery = createClient(PluginQueryController, transport);
  });

  afterAll(async () => {
    await enforcing.shutdown();
    rmSync(enforcingDir, { recursive: true, force: true });
  });

  it("refuses an archive whose overlay carries a reserved label, naming the document and the key, and writes nothing", async () => {
    const name = uniqueName("plg-forged");
    const forged = withFile(
      thermosLike(name),
      "ai.stigmer/agent.yaml",
      [
        "apiVersion: agentic.stigmer.ai/v1",
        "kind: Agent",
        "metadata:",
        `  name: ${name}`,
        "  labels:",
        "    stigmer.ai/plugin: plg_somebody_else",
        "spec:",
        "  instructions: Long enough instructions for the forged agent.",
        "",
      ].join("\n"),
    );
    const error = await expectCode(
      enforcingPlugins.push({ org: ORG, artifact: archiveOf(forged) }),
      Code.InvalidArgument,
    );
    expect(error.rawMessage).toContain(
      "cannot be set by a plugin (ai.stigmer/agent.yaml: stigmer.ai/plugin)",
    );
    expect(observed.map((c) => c.permission)).toEqual([
      IamPermission.can_write_reserved_labels,
    ]);
    await expectCode(
      enforcingQuery.getByReference(
        createMessage(ApiResourceReferenceSchema, {
          org: ORG,
          kind: ApiResourceKind.plugin,
          slug: name,
        }),
      ),
      Code.NotFound,
    );
  });

  it("installs a plain overlay under the same authorizer: the platform stamps its own labels through the in-process origin", async () => {
    const name = uniqueName("plg-honest");
    const installed = await enforcingPlugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    expect(installed.status?.state).toBe(PluginState.READY);
    const { members } = await enforcingQuery.listMembers({
      value: installed.metadata!.id,
    });
    expect(members).toHaveLength(3);
  });
});
