// Conformance suite for the Plugin domain.
// Domain: agentic / plugin — the unit of install, and the only home of an
// MCP server. A plugin is pushed as the archive of a plugin folder (Agent
// Plugins, Cursor, Claude Code or Codex layout); the server reads what the
// archive holds into the plugin's own status and stores the plugin as ONE
// row. A turn that lists the plugin gets every part of it, named under the
// plugin. The contract pinned here, on every edition:
//   - install writes the plugin and nothing else: its status lists the
//     skills, agents, MCP server entries, the variables they read and the
//     hooks; no skill, agent or MCP server row appears beside it, and the
//     organization's search finds the plugin alone;
//   - two plugins that carry a skill of the same name both install, each
//     listing its own;
//   - a Claude plugin's hooks that run land on status.hooks as written, the
//     ones that do not are named in its warnings, its settings' main agent
//     is an ordinary plugin agent with a warning, and its agents' tool lists
//     keep Claude Code's names (`mcp__plugin_<plugin>_<server>__<tool>`,
//     `Agent(<plugin>:<agent>)`);
//   - an `ai.stigmer/` folder is warned about and never read;
//   - a re-push of the same archive is a no-op (one version, the row
//     untouched); an upgrade replaces the lists and grows the history;
//   - the version ladder (latest, digest, manifest-version tag) and the
//     history read like a skill's;
//   - updateVisibility moves the plugin alone;
//   - delete is refused while an agent of the organization lists the plugin,
//     naming the agent, and a fresh install works afterwards;
//   - a bad archive or package, a name whose derived slug no reference could
//     hold, and a server whose tool names could not be told apart refuse
//     before any write.
//
// Out of scope here: the install-time sign-in probe
// (plugin-sign-in-probe.conformance.test.ts), signing in to a plugin's
// server (plugin-oauth.conformance.test.ts), listing a server's tools
// (suites-execution/plugin-tools.conformance.test.ts), and what a turn does
// with a listed plugin (the execution class).
import { Code } from "@connectrpc/connect";
import { HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import {
  claudeLike,
  claudePlugin,
  cursorPlugin,
  mcpOnly,
  pluginArchive,
  thermosLike,
  toolServerSegment,
  VENDORED_CURSOR_PLUGINS,
  vendoredPlugin,
  withFile,
} from "../support/plugins";
import { createTarget, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

let target: TargetProfile;
let clients: ConformanceClients;
// One tenancy for the file: every name is unique, and each plugin's delete
// is the fixture cleanup, so the org itself needs no per-test reset.
let tenancy: TenancyContext;
const fixtures = new FixtureTracker();

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
  opts: { track?: boolean; visibility?: ApiResourceVisibility; org?: string } = {},
) {
  const plugin = await clients.pluginCommand.push({
    org: opts.org ?? org(),
    artifact: archive,
    visibility: opts.visibility,
  });
  if (opts.track ?? true) {
    // A plugin already gone is a clean fixture.
    fixtures.defer(() =>
      clients.pluginCommand.delete({ value: plugin.metadata!.id }).then(
        () => undefined,
        () => undefined,
      ),
    );
  }
  return plugin;
}

function ref(kind: ApiResourceKind, slug: string, version = "", inOrg = org()) {
  return { org: inOrg, kind, slug, version };
}

describe("Plugin conformance — install writes one row", () => {
  it("[rpc:PluginCommandController.push] [rpc:PluginQueryController.get] installs a Cursor plugin as the plugin alone: its status lists the skill, the agent, the server and the variable it reads", async () => {
    // A tenancy of its own, so the search below sees this install alone.
    const own = await target.provisionTenancy();
    try {
      const name = uniqueName("plg-thermos");
      const plugin = await install(pluginArchive(thermosLike(name)), { org: own.org });

      expect(plugin.metadata?.id).toMatch(/^plg_/);
      expect(plugin.metadata?.slug).toBe(name);
      expect(plugin.spec?.version).toBe("1.2.0");
      expect(plugin.status?.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(plugin.status?.artifactStorageKey).toBe(`plugins/${plugin.status?.digest}.zip`);

      const status = plugin.status!;
      expect(status.skills.map((s) => [s.name, s.description, s.path])).toEqual([
        [`${name}-review`, "Review code thoroughly", `skills/${name}-review`],
      ]);
      expect(status.agents.map((a) => [a.name, a.description, a.instructions, a.skills])).toEqual([
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
        expect(github.transport.value.url).toBe("https://api.github.test/mcp/");
        expect(github.transport.value.headers).toEqual({ Authorization: "Bearer ${GITHUB_TOKEN}" });
      }
      expect(Object.keys(status.env)).toEqual(["GITHUB_TOKEN"]);
      expect(status.env["GITHUB_TOKEN"]).toMatchObject({ isSecret: true, optional: false });
      // The agent's model hint is recorded, never applied.
      expect(status.warnings.map((w) => w.kind)).toContain("model-hint-unresolved");

      const read = await clients.pluginQuery.get({ value: plugin.metadata!.id });
      expect(read.status?.skills.map((s) => s.name)).toEqual([`${name}-review`]);
      expect(read.status?.agents.map((a) => a.name)).toEqual(["reviewer"]);
      expect(read.status?.mcpServers.map((s) => s.name)).toEqual(["github"]);

      // Nothing beside the plugin: no skill row, no agent row.
      await expectGrpcCode(
        () => clients.skillQuery.getByReference(ref(ApiResourceKind.skill, `${name}-review`, "", own.org)),
        Code.NotFound,
        "the plugin's skill is no skill row",
      );
      for (const slug of [name, "reviewer"]) {
        await expectGrpcCode(
          () => clients.agentQuery.getByReference(ref(ApiResourceKind.agent, slug, "", own.org)),
          Code.NotFound,
          `no agent row '${slug}'`,
        );
      }
      const listed = await clients.search.search({
        kinds: [ApiResourceKind.skill, ApiResourceKind.agent, ApiResourceKind.plugin],
        org: own.org,
      });
      expect(listed.entries.map((e) => [ApiResourceKind[e.kind], e.id])).toEqual([
        ["plugin", plugin.metadata!.id],
      ]);
    } finally {
      await fixtures.cleanup();
      await target.cleanupTenancy(own);
    }
  });

  it("[rpc:PluginCommandController.push] installs an MCP-only package as its server, with no skill and no agent", async () => {
    const name = uniqueName("plg-mcp");
    const plugin = await install(pluginArchive(mcpOnly(name)));
    expect(plugin.status?.skills).toEqual([]);
    expect(plugin.status?.agents).toEqual([]);
    expect(plugin.status?.mcpServers.map((s) => [s.name, s.transport.case, s.env])).toEqual([
      ["api", "http", ["TOKEN"]],
    ]);
    expect(plugin.status?.env["TOKEN"]).toMatchObject({ isSecret: true, optional: false });
  });

  it("[rpc:PluginCommandController.push] installs two plugins that carry a skill of the same name, each listing its own", async () => {
    const first = await install(pluginArchive(thermosLike(uniqueName("plg-twin"), { skill: "review" })));
    const second = await install(pluginArchive(thermosLike(uniqueName("plg-twin"), { skill: "review" })));
    expect(second.metadata?.id).not.toBe(first.metadata?.id);
    expect(first.status?.skills.map((s) => s.name)).toEqual(["review"]);
    expect(second.status?.skills.map((s) => s.name)).toEqual(["review"]);
  });

  it("[rpc:PluginCommandController.push] records a Claude plugin's hooks on its status, its settings' main agent as an ordinary agent, and its agents' tool lists in Claude Code's names", async () => {
    const name = uniqueName("plg-hooks");
    const plugin = await install(
      pluginArchive(
        claudePlugin({
          name,
          version: "1.0.0",
          description: "Guards shell commands",
          skills: [{ name: `${name}-guard`, description: "Guard", body: "# Guard" }],
          mcpServers: {
            db: { command: "npx", args: ["-y", "db-mcp"] },
          },
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/guard.py"',
                    if: "Bash(git push *)",
                    timeout: 5,
                  },
                ],
              },
            ],
            Stop: [{ hooks: [{ type: "command", command: "summary" }] }],
          },
          settings: { agent: "lead" },
          agents: [
            {
              file: "lead",
              frontmatter: {
                description: "Leads.",
                tools: `Read, Agent(${name}:helper), mcp__plugin_${name}_db__query`,
              },
              body: "You lead the work and delegate to the helper.",
            },
            {
              file: "helper",
              frontmatter: { description: "Helps.", tools: ["Read", "Grep"] },
            },
          ],
        }),
      ),
    );

    const hooks = plugin.status?.hooks;
    expect(hooks?.format).toBe(HookFormat.CLAUDE_CODE);
    expect(hooks?.groups.map((g) => [g.event, g.matcher])).toEqual([["PreToolUse", "Bash"]]);
    expect(hooks?.groups[0]?.handlers.map((h) => [h.command, h.condition, h.timeoutSeconds, h.failClosed])).toEqual([
      ['python3 "${CLAUDE_PLUGIN_ROOT}/hooks/guard.py"', "Bash(git push *)", 5, false],
    ]);
    const warnings = plugin.status?.warnings.map((w) => w.kind) ?? [];
    expect(warnings).toContain("hook-event-not-run");
    expect(warnings).toContain("settings-agent-not-applied");

    expect(plugin.status?.mcpServers.map((s) => [s.name, s.transport.case])).toEqual([["db", "stdio"]]);
    const agents = Object.fromEntries((plugin.status?.agents ?? []).map((a) => [a.name, a]));
    expect(Object.keys(agents).sort()).toEqual(["helper", "lead"]);
    expect(agents["lead"]?.instructions).toBe("You lead the work and delegate to the helper.");
    expect(agents["lead"]?.tools).toEqual(["Read", `Agent(${name}:helper)`, `mcp__${toolServerSegment(name, "db")}__query`]);
    expect(agents["helper"]?.tools).toEqual(["Read", "Grep"]);
  });

  it("[rpc:PluginCommandController.push] installs a Claude Code plugin: userConfig becomes a required secret its npx stdio server reads", async () => {
    const name = uniqueName("plg-claude");
    const plugin = await install(pluginArchive(claudeLike(name)));
    expect(plugin.status?.skills.map((s) => s.name)).toEqual([`${name}-notes`]);
    expect(plugin.status?.mcpServers.map((s) => [s.name, s.transport.case, s.env])).toEqual([
      ["notes", "stdio", ["NOTES_TOKEN"]],
    ]);
    const notes = plugin.status?.mcpServers[0];
    if (notes?.transport.case === "stdio") {
      expect([notes.transport.value.command, notes.transport.value.args]).toEqual(["npx", ["-y", "notes-mcp"]]);
    }
    expect(plugin.status?.env["NOTES_TOKEN"]).toMatchObject({ isSecret: true, optional: false });
  });

  it("[rpc:PluginCommandController.push] warns about an ai.stigmer/ folder and does not read it", async () => {
    const name = uniqueName("plg-folder");
    const plugin = await install(
      pluginArchive(
        withFile(
          cursorPlugin({ name }),
          "ai.stigmer/agent.yaml",
          `apiVersion: agentic.stigmer.ai/v1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  instructions: Ten characters or more of instructions.\n`,
        ),
      ),
    );
    expect(plugin.status?.warnings.map((w) => `${w.kind}:${w.path}`)).toContain("stigmer-folder-ignored:ai.stigmer/");
    expect(plugin.status?.agents).toEqual([]);
    await expectGrpcCode(
      () => clients.agentQuery.getByReference(ref(ApiResourceKind.agent, name)),
      Code.NotFound,
      "the folder composes no agent",
    );
  });

  it("[rpc:PluginCommandController.push] [rpc:PluginQueryController.listVersions] re-pushing the same archive is a no-op: same digest, one version, the row untouched", async () => {
    const name = uniqueName("plg-idem");
    const archive = pluginArchive(thermosLike(name));
    const first = await install(archive);
    const stored = await clients.pluginQuery.get({ value: first.metadata!.id });

    const second = await install(archive, { track: false });
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.status?.digest).toBe(first.status?.digest);
    expect(await clients.pluginQuery.get({ value: first.metadata!.id })).toEqual(stored);

    const versions = await clients.pluginQuery.listVersions({ org: org(), slug: name });
    expect(versions.totalCount).toBe(1);
    expect(versions.versions[0]?.tag).toBe("1.2.0");
    expect(versions.versions[0]?.isCurrent).toBe(true);
  });

  it("[rpc:PluginCommandController.push] [rpc:PluginQueryController.listVersions] an upgrade replaces the lists and grows the history", async () => {
    const name = uniqueName("plg-up");
    const first = await install(pluginArchive(thermosLike(name, { extraSkill: `${name}-extra` })));
    expect(first.status?.skills.map((s) => s.name).sort()).toEqual([`${name}-extra`, `${name}-review`]);

    const second = await install(pluginArchive(thermosLike(name)), { track: false });
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.status?.digest).not.toBe(first.status?.digest);
    expect(second.status?.skills.map((s) => s.name)).toEqual([`${name}-review`]);

    const versions = await clients.pluginQuery.listVersions({ org: org(), slug: name });
    expect(versions.totalCount).toBe(2);
    expect(versions.versions.filter((v) => v.isCurrent).map((v) => v.digest)).toEqual([second.status?.digest]);
  });

  it("[rpc:PluginCommandController.push] [rpc:PluginCommandController.updateVisibility] installs at the requested level, and updateVisibility moves the plugin alone: an agent that lists it keeps its level and definition", async () => {
    const name = uniqueName("plg-vis");
    const plugin = await install(pluginArchive(thermosLike(name)), {
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(plugin.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    const mine = await clients.agentCommand.create(makeAgent({ org: org(), name: `${name}-user`, plugins: [name] }));
    fixtures.defer(() => clients.agentCommand.delete({ value: mine.metadata!.id }));

    const moved = await clients.pluginCommand.updateVisibility({
      resourceId: plugin.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(moved.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    expect(moved.status?.digest).toBe(plugin.status?.digest);
    expect(moved.status?.skills).toEqual(plugin.status?.skills);

    const agentAfter = await clients.agentQuery.get({ value: mine.metadata!.id });
    expect(agentAfter.metadata?.visibility).toBe(mine.metadata?.visibility);
    expect(agentAfter.status?.audit?.specAudit?.updatedAt).toEqual(mine.status?.audit?.specAudit?.updatedAt);
    expect((await clients.pluginQuery.listVersions({ org: org(), slug: name })).totalCount).toBe(1);
  });
});

describe("Plugin conformance — version resolution", () => {
  it("[rpc:PluginQueryController.getByReference] getByReference resolves latest, the digest and the manifest-version tag to the head", async () => {
    const name = uniqueName("plg-ref");
    const plugin = await install(pluginArchive(thermosLike(name)));
    for (const version of ["", "latest", plugin.status!.digest, "1.2.0"]) {
      const resolved = await clients.pluginQuery.getByReference(ref(ApiResourceKind.plugin, name, version));
      expect(resolved.status?.digest, `version '${version}'`).toBe(plugin.status?.digest);
    }
  });

  it("[rpc:PluginQueryController.getByReference] returns NotFound for an unknown version and an unknown slug", async () => {
    const name = uniqueName("plg-ref");
    await install(pluginArchive(thermosLike(name)));
    await expectGrpcCode(
      () => clients.pluginQuery.getByReference(ref(ApiResourceKind.plugin, name, "9.9.9")),
      Code.NotFound,
      "unknown version",
    );
    await expectGrpcCode(
      () => clients.pluginQuery.getByReference(ref(ApiResourceKind.plugin, uniqueName("plg-missing"))),
      Code.NotFound,
      "unknown slug",
    );
  });

  it("[rpc:PluginQueryController.get] get rejects an empty id and answers NotFound for a missing one", async () => {
    await expectGrpcCode(() => clients.pluginQuery.get({ value: "" }), Code.InvalidArgument, "empty id");
    await expectGrpcCode(() => clients.pluginQuery.get({ value: "plg_missing" }), Code.NotFound, "missing id");
  });

  it("[rpc:PluginCommandController.push] [rpc:PluginQueryController.getByReference] installs a version the tag pattern rejects with a warning and no tag", async () => {
    const name = uniqueName("plg-untaggable");
    const fixture = withFile(
      thermosLike(name),
      ".cursor-plugin/plugin.json",
      JSON.stringify({
        name,
        version: "1.2.0+build.7",
        description: "Code review with a thermonuclear standard",
        skills: "./skills/",
        agents: "./agents/",
        mcpServers: "./mcp.json",
        variables: {
          type: "object",
          properties: {
            GITHUB_TOKEN: { type: "string", title: "GitHub token", description: "A personal access token" },
          },
          required: ["GITHUB_TOKEN"],
        },
      }),
    );
    const plugin = await install(pluginArchive(fixture));
    expect(plugin.status?.warnings.map((w) => w.kind)).toContain("version-not-taggable");
    const versions = await clients.pluginQuery.listVersions({ org: org(), slug: name });
    expect(versions.versions[0]?.tag).toBe("");
    // The reference contract itself refuses the string: a version that is not
    // latest, a digest or a tag can never name a version.
    await expectGrpcCode(
      () => clients.pluginQuery.getByReference(ref(ApiResourceKind.plugin, name, "1.2.0+build.7")),
      Code.InvalidArgument,
      "not a version reference",
    );
  });
});

describe("[rpc:PluginCommandController.delete] Plugin conformance — delete", () => {
  it("removes the plugin; a fresh install of the same archive works afterwards under a new id", async () => {
    const name = uniqueName("plg-remove");
    const archive = pluginArchive(thermosLike(name));
    const plugin = await install(archive, { track: false });

    const deleted = await clients.pluginCommand.delete({ value: plugin.metadata!.id });
    expect(deleted.metadata?.id).toBe(plugin.metadata?.id);
    await expectGrpcCode(() => clients.pluginQuery.get({ value: plugin.metadata!.id }), Code.NotFound, "head gone");

    const again = await install(archive);
    expect(again.metadata?.id).not.toBe(plugin.metadata?.id);
    expect(again.status?.digest).toBe(plugin.status?.digest);
  });

  it("is refused while an agent lists the plugin, naming the agent, and succeeds once none does", async () => {
    const name = uniqueName("plg-used");
    const plugin = await install(pluginArchive(thermosLike(name)), { track: false });
    const mine = await clients.agentCommand.create(makeAgent({ org: org(), name: `${name}-user`, plugins: [name] }));
    // The listing is filed under the plugin's organization.
    expect(mine.spec?.plugins.map((r) => [r.kind, r.org, r.slug])).toEqual([
      [ApiResourceKind.plugin, plugin.metadata?.org, name],
    ]);

    const error = await expectGrpcCode(
      () => clients.pluginCommand.delete({ value: plugin.metadata!.id }),
      Code.FailedPrecondition,
      "listed plugin",
    );
    expect(error.rawMessage).toContain(
      `plugin '${name}' is still used by agent '${mine.metadata!.slug}'; remove it from their plugins first`,
    );
    await clients.pluginQuery.get({ value: plugin.metadata!.id });

    mine.spec!.plugins = [];
    await clients.agentCommand.update(mine);
    await clients.pluginCommand.delete({ value: plugin.metadata!.id });
    await clients.agentCommand.delete({ value: mine.metadata!.id });
    await expectGrpcCode(() => clients.pluginQuery.get({ value: plugin.metadata!.id }), Code.NotFound, "head gone");
  });

  it("delete of a missing id returns NotFound and an empty id is InvalidArgument", async () => {
    await expectGrpcCode(() => clients.pluginCommand.delete({ value: "plg_missing" }), Code.NotFound, "missing id");
    await expectGrpcCode(() => clients.pluginCommand.delete({ value: "" }), Code.InvalidArgument, "empty id");
  });
});

describe("[rpc:PluginCommandController.push] Plugin conformance — refusals before any write", () => {
  it("refuses a package the library refuses, with its sentences, and writes nothing", async () => {
    const name = uniqueName("plg-badurl");
    const broken = pluginArchive(
      withFile(
        thermosLike(name),
        "mcp.json",
        JSON.stringify({ mcpServers: { github: { type: "http", url: "https://${HOST}/mcp" } } }),
      ),
    );
    const error = await expectGrpcCode(
      () => clients.pluginCommand.push({ org: org(), artifact: broken }),
      Code.InvalidArgument,
      "library refusal",
    );
    expect(error.rawMessage).toContain("plugin cannot be installed, 1 problem found");
    expect(error.rawMessage).toContain("has a variable in its 'url'");
    await expectGrpcCode(
      () => clients.pluginQuery.getByReference(ref(ApiResourceKind.plugin, name)),
      Code.NotFound,
      "nothing was written",
    );
  });

  it("refuses a server whose tool names could not be told apart from a tool name, naming it", async () => {
    const name = uniqueName("plg-segment");
    const error = await expectGrpcCode(
      () =>
        clients.pluginCommand.push({
          org: org(),
          artifact: pluginArchive(
            cursorPlugin({ name, mcpServers: { db__x: { command: "npx", args: ["-y", "@acme/db-mcp"] } } }),
          ),
        }),
      Code.InvalidArgument,
      "a segment holding two underscores in a row",
    );
    expect(error.rawMessage).toContain(
      `MCP server 'db__x' of plugin '${name}' would name its tools 'mcp__${toolServerSegment(name, "db__x")}__<tool>'`,
    );
    await expectGrpcCode(
      () => clients.pluginQuery.getByReference(ref(ApiResourceKind.plugin, name)),
      Code.NotFound,
      "nothing was written",
    );
  });

  it("refuses a plugin whose 64-character name derives a slug no reference could hold, naming the name", async () => {
    // The open format admits names up to 64 characters; a slug holds 63.
    const base = uniqueName("plg-long");
    const name = base + "a".repeat(64 - base.length);
    const error = await expectGrpcCode(
      () => clients.pluginCommand.push({ org: org(), artifact: pluginArchive(thermosLike(name)) }),
      Code.InvalidArgument,
      "64-character plugin name",
    );
    expect(error.rawMessage).toContain(`the plugin name '${name}' derives the slug`);
    expect(error.rawMessage).toContain("(64 characters)");
    expect(error.rawMessage).toContain("rename the plugin");
  });

  it("refuses bytes that are not an archive, an empty request, and both artifact sources at once", async () => {
    await expectGrpcCode(
      () => clients.pluginCommand.push({ org: org(), artifact: new TextEncoder().encode("not a zip") }),
      Code.InvalidArgument,
      "not a zip",
    );
    await expectGrpcCode(() => clients.pluginCommand.push({ org: org() }), Code.InvalidArgument, "no source");
    await expectGrpcCode(
      () => clients.pluginCommand.push({ org: org(), artifact: new Uint8Array(4), artifactUploadRef: "sau_x" }),
      Code.InvalidArgument,
      "both sources",
    );
  });
});

describe("Plugin conformance — the transfer lane", () => {
  it("[rpc:PluginCommandController.createArtifactUploadUrl] [rpc:PluginCommandController.push] installs from a staged upload exactly as from inline bytes", async (ctx) => {
    if (!target.capabilities.skillArtifactTransferLane) return ctx.skip();
    const name = uniqueName("plg-staged");
    const archive = pluginArchive(thermosLike(name));
    const minted = await clients.pluginCommand.createArtifactUploadUrl({
      org: org(),
      sizeBytes: BigInt(archive.length),
    });
    expect(minted.url).toMatch(/^https?:\/\//);
    expect(minted.artifactUploadRef).not.toBe("");
    const put = await fetch(minted.url, {
      method: "PUT",
      body: Buffer.from(archive),
      headers: { "content-type": "application/zip" },
    });
    expect(put.ok, `staging PUT succeeds (HTTP ${put.status})`).toBe(true);

    const plugin = await clients.pluginCommand.push({ org: org(), artifactUploadRef: minted.artifactUploadRef });
    fixtures.defer(() =>
      clients.pluginCommand.delete({ value: plugin.metadata!.id }).then(
        () => undefined,
        () => undefined,
      ),
    );
    expect(plugin.status?.skills.map((s) => s.name)).toEqual([`${name}-review`]);

    // Content addressing must not care how the bytes travelled.
    const inline = await clients.pluginCommand.push({ org: org(), artifact: archive });
    expect(inline.status?.digest).toBe(plugin.status?.digest);
    expect((await clients.pluginQuery.listVersions({ org: org(), slug: name })).totalCount).toBe(1);
  });
});

describe("Plugin conformance — the archive, for the runner to mount", () => {
  it("[rpc:PluginQueryController.getArtifact] returns the exact bytes that were installed", async () => {
    const archive = pluginArchive(thermosLike(uniqueName("plg-archive")));
    const plugin = await install(archive);
    const res = await clients.pluginQuery.getArtifact({ artifactStorageKey: plugin.status!.artifactStorageKey });
    expect(Buffer.from(res.artifact).equals(Buffer.from(archive)), "the archive verbatim").toBe(true);
  });

  it("[rpc:PluginQueryController.getArtifact] refuses an empty key, an unknown one, and a key outside the plugin store", async () => {
    await expectGrpcCode(
      () => clients.pluginQuery.getArtifact({ artifactStorageKey: "" }),
      Code.InvalidArgument,
      "getArtifact empty key",
    );
    await expectGrpcCode(
      () => clients.pluginQuery.getArtifact({ artifactStorageKey: `plugins/${"0".repeat(64)}.zip` }),
      Code.NotFound,
      "getArtifact unknown key",
    );
    await expectGrpcCode(
      () => clients.pluginQuery.getArtifact({ artifactStorageKey: `skills/${"0".repeat(64)}.zip` }),
      Code.NotFound,
      "getArtifact on another kind's key",
    );
  });

  it("[rpc:PluginQueryController.getArtifactDownloadUrl] serves the exact installed bytes over HTTP", async (ctx) => {
    if (!target.capabilities.skillArtifactTransferLane) return ctx.skip();
    const archive = pluginArchive(thermosLike(uniqueName("plg-download")));
    const plugin = await install(archive);
    const minted = await clients.pluginQuery.getArtifactDownloadUrl({
      artifactStorageKey: plugin.status!.artifactStorageKey,
    });
    expect(minted.url).toMatch(/^https?:\/\//);
    expect(minted.sizeBytes, "the mint reports the stored size").toBe(BigInt(archive.length));
    const resp = await fetch(minted.url);
    expect(resp.status).toBe(200);
    expect(new Uint8Array(await resp.arrayBuffer()), "HTTP bytes equal the installed archive").toEqual(archive);
  });
});

describe("Plugin conformance — the vendored Cursor plugins", () => {
  // The published catalogue's shapes, read from disk: five install as the
  // library describes them, `salesforce` is refused with the library's own
  // sentence. Slugs are the plugins' real names, so this block provisions
  // its own tenancy and the fixture cleanup removes every install.
  it("[rpc:PluginCommandController.push] installs five, each listing what it holds, and refuses the sixth with the library's sentence", async () => {
    const { org: vendorOrg } = await target.provisionTenancy();
    try {
      for (const name of VENDORED_CURSOR_PLUGINS) {
        const archive = pluginArchive(vendoredPlugin(name));
        if (name === "salesforce") {
          const error = await expectGrpcCode(
            () => clients.pluginCommand.push({ org: vendorOrg, artifact: archive }),
            Code.InvalidArgument,
            "salesforce",
          );
          expect(error.rawMessage).toContain("has a variable in its 'url'");
          continue;
        }
        const plugin = await install(archive, { org: vendorOrg });
        expect(plugin.metadata?.slug, name).toBe(name);
        const status = plugin.status;
        const parts =
          (status?.skills.length ?? 0) +
          (status?.agents.length ?? 0) +
          (status?.mcpServers.length ?? 0) +
          (status?.hooks?.groups.length ?? 0);
        expect(parts, `${name} lists what it holds`).toBeGreaterThan(0);
      }
    } finally {
      await fixtures.cleanup();
      await target.cleanupTenancy({ org: vendorOrg });
    }
  });
});
