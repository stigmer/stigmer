/**
 * Composed-server round-trips for the Plugin kind: a real server over a
 * temp SQLite store, raw Connect clients, archives written by the server's
 * own writer from the library's fixture builders, and the server's one
 * outbound fetch replaced at the composition's test seam so the install's
 * sign-in probe never leaves the process.
 *
 * Pins the install contract of a plugin that is one thing: an install
 * writes the plugin and nothing else (no skill, agent or server row
 * appears), and its status lists what the archive holds (skills, agents,
 * MCP server entries, the variables they read, the hooks), so two plugins
 * carrying a skill of the same name both install; a server whose tool
 * segment would hold `__` refuses before any write; an `ai.stigmer/` folder
 * is a warning and is not read; a re-push of the same digest at the same
 * level writes nothing, and at another level reuses the recorded sign-in
 * answers without asking the server again; a URL-only server answering an
 * OAuth challenge is completed with `sign_in.oauth_only`, the
 * `Authorization: Bearer ${<SERVER>_ACCESS_TOKEN}` header and the variable,
 * declared as a required secret, while one that answers without a
 * challenge is installed as written. Delete is refused while an agent of
 * the organization lists the plugin and allowed once none does;
 * updateVisibility moves the plugin alone. The archive a plugin was
 * installed from is served back by key, inline and over the transfer lane,
 * and a key outside the plugin store is not found; refusals of the archive,
 * the package and a name whose slug breaks the slug rules write nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { create as createMessage } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claudePlugin,
  cursorPlugin,
  withFile,
} from "@stigmer/plugin-package/testing";
import type { PluginFixture } from "@stigmer/plugin-package/testing";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});
const ORG = "acme";
// The id the server minted for ORG: rows store the organization by id.
let ORG_ID: string;

/**
 * Server addresses the fake answers: literal loopback hosts, so the
 * guarded fetch's egress check needs no DNS. Each path is one server's
 * behaviour; every probe is counted by URL.
 */
const PROBE_ORIGIN = "http://127.0.0.1:9";
const OAUTH_PATH = "/oauth-mcp";
const OPEN_PATH = "/open-mcp";
const probes = new Map<string, number>();

/**
 * The fake under the guarded fetch: a 401 with an OAuth challenge for the
 * OAuth server, a 200 for the open one; anything else is not a probe and
 * goes to the real fetch.
 */
const fakeFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== PROBE_ORIGIN) {
    return fetch(input, init);
  }
  probes.set(url.pathname, (probes.get(url.pathname) ?? 0) + 1);
  if (url.pathname === OAUTH_PATH) {
    return Promise.resolve(
      new Response(null, {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${PROBE_ORIGIN}/.well-known/oauth-protected-resource"`,
        },
      }),
    );
  }
  return Promise.resolve(
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
};

let server: ComposedServer;
let plugins: Client<typeof PluginCommandController>;
let pluginQuery: Client<typeof PluginQueryController>;
let agents: Client<typeof AgentCommandController>;
let agentQuery: Client<typeof AgentQueryController>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "plugin-domain-test-"));
  // An ephemeral port needs no reservation: the transfer lane mints its
  // capability URLs for the port the listener actually binds
  // (boot/skill-transfer-origin.ts, stigmer#1386).
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
    fetchImpl: fakeFetch,
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  ORG_ID = organizationId(await seedOrganizations(transport, [ORG]), ORG);
  plugins = createClient(PluginCommandController, transport);
  pluginQuery = createClient(PluginQueryController, transport);
  agents = createClient(AgentCommandController, transport);
  agentQuery = createClient(AgentQueryController, transport);
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

/** How many rows of `kind` the store holds: an install must not change it for any kind but plugin. */
async function rowCount(kind: ApiResourceKind): Promise<number> {
  return (await server.store.listResources(kind)).length;
}

/** A plugin's reference, as an agent lists it. */
function pluginRef(slug: string) {
  return createMessage(ApiResourceReferenceSchema, {
    org: ORG,
    kind: ApiResourceKind.plugin,
    slug,
  });
}

/** A user's own agent that lists plugin `plugin`. */
function agentListing(plugin: string, agent: string): Agent {
  return createMessage(AgentSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: createMessage(ApiResourceMetadataSchema, {
      org: ORG,
      name: agent,
    }),
    spec: createMessage(AgentSpecSchema, {
      instructions: "You work with the plugin's skills and servers.",
      plugins: [pluginRef(plugin)],
    }),
  });
}

/**
 * A Cursor plugin with one skill, one sub-agent, an HTTP server that says
 * how it authenticates (never probed) and a hook: the thermos shape.
 */
function thermosLike(
  name: string,
  options: { readonly skill?: string } = {},
): PluginFixture {
  return cursorPlugin({
    name,
    version: "1.2.0",
    description: "Code review with a thermonuclear standard",
    skills: [
      {
        name: options.skill ?? `${name}-review`,
        description: "Review code thoroughly",
        body: "# Review\nRead everything.",
      },
    ],
    agents: [
      {
        file: "reviewer",
        frontmatter: {
          name: "reviewer",
          description: "Reviews pull requests",
          model: "sonnet",
          skills: [options.skill ?? `${name}-review`],
        },
        body: "You review pull requests with care and name every risk you see.",
      },
    ],
    mcpServers: {
      github: {
        type: "http",
        url: `${PROBE_ORIGIN}/github`,
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
    hooks: {
      preToolUse: [{ command: "./hooks/guard.sh" }],
    },
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

describe("Plugin push — one row", () => {
  it("writes the plugin and nothing else; its status lists the skills, agents, servers, variables and hooks", async () => {
    const before = {
      skill: await rowCount(ApiResourceKind.skill),
      agent: await rowCount(ApiResourceKind.agent),
      plugin: await rowCount(ApiResourceKind.plugin),
    };
    const name = uniqueName("thermos");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });

    expect(installed.metadata?.id).toMatch(/^plg_/);
    expect(installed.metadata?.slug).toBe(name);
    expect(installed.spec?.version).toBe("1.2.0");
    expect(installed.status?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(installed.status?.artifactStorageKey).toBe(
      `plugins/${installed.status?.digest}.zip`,
    );

    const status = installed.status!;
    expect(status.skills.map((s) => [s.name, s.description, s.path])).toEqual([
      [`${name}-review`, "Review code thoroughly", `skills/${name}-review`],
    ]);
    expect(
      status.agents.map((a) => [
        a.name,
        a.description,
        a.instructions,
        a.skills,
      ]),
    ).toEqual([
      [
        "reviewer",
        "Reviews pull requests",
        "You review pull requests with care and name every risk you see.",
        [`${name}-review`],
      ],
    ]);
    expect(status.mcpServers).toHaveLength(1);
    const github = status.mcpServers[0]!;
    expect(github.name).toBe("github");
    expect(github.env).toEqual(["GITHUB_TOKEN"]);
    expect(github.signIn).toBeUndefined();
    expect(github.transport.case).toBe("http");
    if (github.transport.case === "http") {
      expect(github.transport.value.url).toBe(`${PROBE_ORIGIN}/github`);
      expect(github.transport.value.headers).toEqual({
        Authorization: "Bearer ${GITHUB_TOKEN}",
      });
    }
    expect(Object.keys(status.env)).toEqual(["GITHUB_TOKEN"]);
    expect(status.env["GITHUB_TOKEN"]?.optional).toBe(false);
    expect(status.hooks?.format).toBe(HookFormat.CURSOR);
    expect(status.hooks?.groups.map((g) => g.event)).toEqual(["preToolUse"]);
    // The sub-agent's model hint is recorded, never applied.
    expect(status.warnings.map((w) => w.kind)).toContain(
      "model-hint-unresolved",
    );
    // A server that names its key is the author speaking about
    // authentication: it is never asked.
    expect(probes.get("/github")).toBeUndefined();

    expect(await rowCount(ApiResourceKind.skill)).toBe(before.skill);
    expect(await rowCount(ApiResourceKind.agent)).toBe(before.agent);
    expect(await rowCount(ApiResourceKind.plugin)).toBe(before.plugin + 1);

    const read = await pluginQuery.get({ value: installed.metadata!.id });
    expect(read.status?.skills.map((s) => s.name)).toEqual([`${name}-review`]);
    expect(read.status?.agents.map((a) => a.name)).toEqual(["reviewer"]);
  });

  it("installs two plugins that carry a skill of the same name, each listing its own", async () => {
    const first = uniqueName("twin");
    const second = uniqueName("twin");
    const a = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(first, { skill: "review" })),
    });
    const b = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(second, { skill: "review" })),
    });
    expect(a.metadata?.id).not.toBe(b.metadata?.id);
    expect(a.status?.skills.map((s) => s.name)).toEqual(["review"]);
    expect(b.status?.skills.map((s) => s.name)).toEqual(["review"]);
  });

  it("records a Claude plugin's hooks and the variables they read, and keeps its agents' tool lists in Claude Code's names", async () => {
    const name = uniqueName("scanner");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(
        claudePlugin({
          name,
          userConfig: {
            WEBHOOK: { type: "string", sensitive: true, required: true },
          },
          mcpServers: {
            db: { command: "npx", args: ["-y", "@acme/db-mcp"] },
          },
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command: "node",
                    args: ["notify.js", "${user_config.WEBHOOK}"],
                    timeout: 5,
                  },
                ],
              },
            ],
          },
          agents: [
            {
              file: "lead",
              frontmatter: {
                description: "Leads the scan.",
                tools: `Read, Agent(${name}:explore), mcp__plugin_${name}_db__query`,
              },
              body: "You lead the scan and delegate the exploring.",
            },
          ],
        }),
      ),
    });

    const status = installed.status!;
    expect(status.hooks?.format).toBe(HookFormat.CLAUDE_CODE);
    expect(
      status.hooks?.groups.map((g) => ({
        event: g.event,
        matcher: g.matcher,
        handlers: g.handlers.map((h) => [h.command, h.args, h.timeoutSeconds]),
      })),
    ).toEqual([
      {
        event: "PreToolUse",
        matcher: "Bash",
        handlers: [["node", ["notify.js", "${user_config.WEBHOOK}"], 5]],
      },
    ]);
    expect(status.env["WEBHOOK"]).toMatchObject({
      isSecret: true,
      optional: false,
    });
    expect(status.mcpServers.map((s) => [s.name, s.transport.case])).toEqual([
      ["db", "stdio"],
    ]);
    expect(status.agents.map((a) => [a.name, a.tools])).toEqual([
      [
        "lead",
        ["Read", `Agent(${name}:explore)`, `mcp__plugin_${name}_db__query`],
      ],
    ]);
  });

  it("warns about an ai.stigmer/ folder and does not read it", async () => {
    const name = uniqueName("folder");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(
        withFile(
          cursorPlugin({ name }),
          "ai.stigmer/agent.yaml",
          `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  instructions: Ten characters or more of instructions.\n`,
        ),
      ),
    });
    expect(
      installed.status?.warnings.map((w) => `${w.kind}:${w.path}`),
    ).toContain("stigmer-folder-ignored:ai.stigmer/");
    expect(installed.status?.agents).toEqual([]);
    await expectCode(
      agentQuery.getByReference(
        createMessage(ApiResourceReferenceSchema, {
          org: ORG,
          kind: ApiResourceKind.agent,
          slug: name,
        }),
      ),
      Code.NotFound,
    );
  });

  it("re-pushing the same archive at the same level writes nothing: same digest, one version, the audit untouched", async () => {
    const name = uniqueName("idem");
    const first = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    const stored = await pluginQuery.get({ value: first.metadata!.id });
    const second = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.status?.digest).toBe(first.status?.digest);
    expect(await pluginQuery.get({ value: first.metadata!.id })).toEqual(
      stored,
    );
    expect(second.status?.audit?.specAudit?.updatedAt).toEqual(
      first.status?.audit?.specAudit?.updatedAt,
    );
    const versions = await pluginQuery.listVersions({ org: ORG, slug: name });
    expect(versions.totalCount).toBe(1);
    expect(versions.versions[0]?.tag).toBe("1.2.0");
  });

  it("an upgrade replaces the lists and grows the version history; getByReference resolves latest, the digest and the tag", async () => {
    const name = uniqueName("upgrade");
    const first = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name, { skill: "first" })),
    });
    const second = await plugins.push({
      org: ORG,
      artifact: archiveOf(
        withFile(
          thermosLike(name, { skill: "second" }),
          ".cursor-plugin/plugin.json",
          JSON.stringify({
            name,
            version: "1.3.0",
            skills: "./skills/",
            agents: "./agents/",
            mcpServers: "./mcp.json",
            hooks: "./hooks/hooks.json",
          }),
        ),
      ),
    });
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.status?.digest).not.toBe(first.status?.digest);
    expect(second.status?.skills.map((s) => s.name)).toEqual(["second"]);
    const versions = await pluginQuery.listVersions({ org: ORG, slug: name });
    expect(versions.totalCount).toBe(2);
    expect(
      versions.versions.filter((v) => v.isCurrent).map((v) => v.digest),
    ).toEqual([second.status?.digest]);
    for (const version of ["", "latest", second.status!.digest, "1.3.0"]) {
      const resolved = await pluginQuery.getByReference(
        createMessage(ApiResourceReferenceSchema, {
          org: ORG,
          kind: ApiResourceKind.plugin,
          slug: name,
          version,
        }),
      );
      expect(resolved.status?.digest, version).toBe(second.status?.digest);
    }
    const old = await pluginQuery.getByReference(
      createMessage(ApiResourceReferenceSchema, {
        org: ORG,
        kind: ApiResourceKind.plugin,
        slug: name,
        version: "1.2.0",
      }),
    );
    expect(old.status?.skills.map((s) => s.name)).toEqual(["first"]);
  });

  it("serves the archive back by key, inline and over the transfer lane; a key outside the plugin store is not found", async () => {
    const name = uniqueName("served");
    const artifact = archiveOf(thermosLike(name));
    const installed = await plugins.push({ org: ORG, artifact });

    const key = installed.status!.artifactStorageKey;
    const inline = await pluginQuery.getArtifact({ artifactStorageKey: key });
    expect(new Uint8Array(inline.artifact)).toEqual(new Uint8Array(artifact));
    const minted = await pluginQuery.getArtifactDownloadUrl({
      artifactStorageKey: key,
    });
    expect(minted.sizeBytes).toBe(BigInt(artifact.length));
    const response = await fetch(minted.url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array(artifact),
    );

    await expectCode(
      pluginQuery.getArtifact({ artifactStorageKey: "plugins/deadbeef.zip" }),
      Code.NotFound,
      "plugin artifact not found",
    );
    await expectCode(
      pluginQuery.getArtifactDownloadUrl({
        artifactStorageKey: key.replace("plugins/", "skills/"),
      }),
      Code.NotFound,
      "plugin artifact not found",
    );
    for (const climbing of [
      `plugins/../${key}`,
      `plugins/./${key.slice("plugins/".length)}`,
    ]) {
      await expectCode(
        pluginQuery.getArtifact({ artifactStorageKey: climbing }),
        Code.NotFound,
        "plugin artifact not found",
      );
    }
  });
});

describe("Plugin push — sign-in probe", () => {
  it("completes a URL-only server that answers an OAuth challenge, and leaves one that does not as written", async () => {
    const name = uniqueName("signin");
    const fixture = cursorPlugin({
      name,
      mcpServers: {
        linear: { type: "http", url: `${PROBE_ORIGIN}${OAUTH_PATH}` },
        docs: { type: "http", url: `${PROBE_ORIGIN}${OPEN_PATH}` },
      },
    });
    const oauthBefore = probes.get(OAUTH_PATH) ?? 0;
    const openBefore = probes.get(OPEN_PATH) ?? 0;
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(fixture),
    });
    expect(probes.get(OAUTH_PATH)).toBe(oauthBefore + 1);
    expect(probes.get(OPEN_PATH)).toBe(openBefore + 1);

    const byName = new Map(
      installed.status!.mcpServers.map((entry) => [entry.name, entry]),
    );
    const linear = byName.get("linear")!;
    expect(linear.signIn?.oauthOnly).toBe(true);
    expect(linear.env).toEqual(["LINEAR_ACCESS_TOKEN"]);
    expect(linear.transport.case).toBe("http");
    if (linear.transport.case === "http") {
      expect(linear.transport.value.headers).toEqual({
        Authorization: "Bearer ${LINEAR_ACCESS_TOKEN}",
      });
    }
    expect(installed.status?.env["LINEAR_ACCESS_TOKEN"]).toMatchObject({
      isSecret: true,
      optional: false,
    });

    const docs = byName.get("docs")!;
    expect(docs.signIn).toBeUndefined();
    expect(docs.env).toEqual([]);
    if (docs.transport.case === "http") {
      expect(docs.transport.value.headers).toEqual({});
    }
    expect(Object.keys(installed.status!.env)).toEqual(["LINEAR_ACCESS_TOKEN"]);

    // The same archive at another level installs again, from the answers
    // the plugin already records: no server is asked twice.
    const moved = await plugins.push({
      org: ORG,
      artifact: archiveOf(fixture),
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(moved.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_private,
    );
    expect(probes.get(OAUTH_PATH)).toBe(oauthBefore + 1);
    expect(probes.get(OPEN_PATH)).toBe(openBefore + 1);
    expect(
      moved.status?.mcpServers.find((s) => s.name === "linear")?.signIn
        ?.oauthOnly,
    ).toBe(true);
  });
});

describe("Plugin push — refusals before any write", () => {
  it("refuses a server whose tool names could not be told apart, naming it", async () => {
    const name = uniqueName("segment");
    await expectCode(
      plugins.push({
        org: ORG,
        artifact: archiveOf(
          cursorPlugin({
            name,
            mcpServers: {
              db__x: { command: "npx", args: ["-y", "@acme/db-mcp"] },
            },
          }),
        ),
      }),
      Code.InvalidArgument,
      `MCP server 'db__x' of plugin '${name}' would name its tools 'mcp__plugin_${name.replace(/[^A-Za-z0-9_-]/g, "_")}_db__x__<tool>'`,
    );
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

  it("refuses bytes that are not an archive", async () => {
    await expectCode(
      plugins.push({ org: ORG, artifact: encoder.encode("not a zip") }),
      Code.InvalidArgument,
      "failed to read plugin archive",
    );
  });

  it("refuses a plugin whose name derives a slug too long for a reference, naming the name", async () => {
    // The open format admits 64 characters; a slug holds at most 63.
    const prefix = uniqueName("long");
    const name = prefix + "a".repeat(64 - prefix.length);
    await expectCode(
      plugins.push({ org: ORG, artifact: archiveOf(thermosLike(name)) }),
      Code.InvalidArgument,
      `the plugin name '${name}' derives the slug '${name}' (64 characters), which is not a valid slug`,
    );
  });
});

describe("Plugin delete and visibility", () => {
  it("is refused while an agent lists the plugin, naming it, and allowed once none does", async () => {
    const name = uniqueName("listed");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    const mine = await agents.create(agentListing(name, `${name}-user`));
    // The guard matches the plugin by the organization id the reference
    // rule files the listing under.
    expect(mine.spec?.plugins.map((ref) => [ref.org, ref.slug])).toEqual([
      [ORG_ID, name],
    ]);

    await expectCode(
      plugins.delete({ value: installed.metadata!.id }),
      Code.FailedPrecondition,
      `plugin '${name}' is still used by agent '${name}-user'; remove it from their plugins first`,
    );
    await pluginQuery.get({ value: installed.metadata!.id });

    mine.spec!.plugins = [];
    await agents.update(mine);
    const deleted = await plugins.delete({ value: installed.metadata!.id });
    expect(deleted.metadata?.id).toBe(installed.metadata?.id);
    await expectCode(
      pluginQuery.get({ value: installed.metadata!.id }),
      Code.NotFound,
    );

    // A fresh install of the same archive works afterwards, under a new id.
    const again = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    expect(again.metadata?.id).not.toBe(installed.metadata?.id);
  });

  it("updateVisibility moves the plugin alone: an agent that lists it keeps its level and its definition", async () => {
    const name = uniqueName("level");
    const installed = await plugins.push({
      org: ORG,
      artifact: archiveOf(thermosLike(name)),
    });
    expect(installed.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_org,
    );
    const mine = await agents.create(agentListing(name, `${name}-user`));
    const skillsBefore = await rowCount(ApiResourceKind.skill);

    const moved = await plugins.updateVisibility({
      resourceId: installed.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(moved.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_private,
    );
    expect(moved.status?.digest).toBe(installed.status?.digest);
    expect(moved.status?.skills).toEqual(installed.status?.skills);

    const agentAfter = await agentQuery.get({ value: mine.metadata!.id });
    expect(agentAfter.metadata?.visibility).toBe(mine.metadata?.visibility);
    expect(agentAfter.status?.audit?.specAudit?.updatedAt).toEqual(
      mine.status?.audit?.specAudit?.updatedAt,
    );
    expect(agentAfter.status?.audit?.statusAudit?.updatedAt).toEqual(
      mine.status?.audit?.statusAudit?.updatedAt,
    );
    expect(await rowCount(ApiResourceKind.skill)).toBe(skillsBefore);
    const versions = await pluginQuery.listVersions({ org: ORG, slug: name });
    expect(versions.totalCount).toBe(1);

    await agents.delete({ value: mine.metadata!.id });
  });
});
