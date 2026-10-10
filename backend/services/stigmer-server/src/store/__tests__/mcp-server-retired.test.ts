/**
 * Pins the driver-neutral half of the MCP server kind's removal
 * (../mcp-server-retired.ts) over rows built the way an earlier release
 * wrote them (retired-mcp-server-rows.ts), the retired fields by wire
 * number:
 *   - the facts: a plugin, a server (its plugin read from the install's
 *     label through the frozen envelope, none for a hand-added one) and a
 *     member skill (an unlabelled skill is none);
 *   - an agent's server usages (AgentSpec field 4) become references to the
 *     plugin that installed the server, each plugin listed once whatever
 *     names it; a hand-added server is dropped with a warning naming the
 *     agent, the server and `stigmer mcp add`; a usage naming nothing is
 *     dropped silently;
 *   - a skill reference to a plugin's skill becomes the plugin, other
 *     skills stay; a hook source naming a plugin (HookSource field 1)
 *     becomes the plugin and leaves the hooks, an inline hook stays;
 *   - an agent a plugin composed loses both plugin labels and its
 *     sub-agents, keeps its instructions and other labels, and lists the
 *     plugin;
 *   - tool lists (the agent's and a sub-agent's, allowed and disallowed)
 *     name a plugin server as a turn does, `mcp__plugin_<plugin>_<server>`,
 *     the tool suffix kept; a sub-agent's reference to a plugin's skill is
 *     dropped; a tool list is renamed only by the agent's own
 *     organization's servers;
 *   - a changed agent heads a new version: the recomputed spec hash, the
 *     previous one named, the retirement message; a second pass leaves it;
 *     an agent with no plugin parts, or no spec, is left (undefined);
 *   - a session's usages and plugin skills become its plugins, and a
 *     session pinned to a changed agent moves to the new version (never
 *     one pinned to no version, never one already on it);
 *   - a policy naming a removed server or plugin skill, as resource or
 *     principal, is one the step deletes; others are not;
 *   - bytes that do not decode throw, and the step's error names the row.
 * The drivers' migration tests pin the SQL around these functions.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { canonicalSpecHash } from "../../pipeline/steps/spec-hash.js";
import {
  RETIREMENT_VERSION_MESSAGE,
  RetirementFacts,
  memberSkillFactsOf,
  migrateAgentRow,
  migrateSessionRow,
  pluginFactsOf,
  policyNamesRetired,
  renamedToolEntry,
  serverFactsOf,
  unreadableRowError,
} from "../mcp-server-retired.js";
import { policyRow } from "./retired-instance-rows.js";
import {
  PLUGIN_LABEL,
  PLUGIN_VERSION_LABEL,
  pluginRef,
  pluginRow,
  recordingLogger,
  retiredAgentRow,
  retiredServerRow,
  retiredSessionRow,
  serverRef,
  skillRef,
  skillRow,
} from "./retired-mcp-server-rows.js";

const ORG = "org_01jz0000000000000000000000";
const OTHER_ORG = "org_01jz0000000000000000000001";
const OLD = "a".repeat(64);
const NEW_PREFIX = "mcp__plugin_GH_Tools_github";

/** One organization holding a plugin with a server and a skill, and a hand-added server. */
function facts(): RetirementFacts {
  const result = new RetirementFacts();
  result.addPlugin({
    id: "plg_gh",
    org: ORG,
    slug: "gh-tools",
    name: "GH Tools",
  });
  result.addPlugin({ id: "plg_docs", org: ORG, slug: "docs", name: "docs" });
  result.addServer({
    id: "mcp_gh",
    org: ORG,
    slug: "github",
    name: "github",
    pluginId: "plg_gh",
  });
  result.addServer({
    id: "mcp_docs",
    org: ORG,
    slug: "docs-search",
    name: "search",
    pluginId: "plg_docs",
  });
  result.addServer({
    id: "mcp_notes",
    org: ORG,
    slug: "notes",
    name: "notes",
    pluginId: undefined,
  });
  result.addMemberSkill({
    id: "skl_review",
    org: ORG,
    slug: "pr-review",
    pluginId: "plg_gh",
  });
  result.addMemberSkill({
    id: "skl_lint",
    org: ORG,
    slug: "pr-lint",
    pluginId: "plg_gh",
  });
  return result;
}

type AgentRowOptions = Parameters<typeof retiredAgentRow>[0];

function agent(
  options: Omit<AgentRowOptions, "metadata"> & {
    readonly metadata?: AgentRowOptions["metadata"];
  },
): Uint8Array {
  return retiredAgentRow({
    status: { versionHash: OLD },
    ...options,
    metadata: {
      id: "agt_1",
      org: ORG,
      slug: "reviewer",
      name: "reviewer",
      ...options.metadata,
    },
    spec: {
      instructions: "Review every pull request with care.",
      ...options.spec,
    },
  });
}

function migrated(
  data: Uint8Array,
): ReturnType<typeof fromBinary<typeof AgentSchema>> {
  const result = migrateAgentRow(data, facts(), recordingLogger());
  expect(result).toBeDefined();
  return fromBinary(AgentSchema, result!.data);
}

function slugs(refs: readonly { slug: string }[] | undefined): string[] {
  return (refs ?? []).map((ref) => ref.slug);
}

describe("the facts the step reads", () => {
  it("reads a plugin row", () => {
    expect(
      pluginFactsOf(
        pluginRow({
          id: "plg_gh",
          org: ORG,
          slug: "gh-tools",
          name: "GH Tools",
        }),
      ),
    ).toEqual({
      id: "plg_gh",
      org: ORG,
      slug: "gh-tools",
      name: "GH Tools",
    });
  });

  it("reads a server row through the frozen envelope, its plugin from the install's label", () => {
    const installed = retiredServerRow({
      metadata: {
        id: "mcp_gh",
        org: ORG,
        slug: "github",
        name: "github",
        labels: { [PLUGIN_LABEL]: "plg_gh" },
      },
    });
    expect(serverFactsOf(installed)).toEqual({
      id: "mcp_gh",
      org: ORG,
      slug: "github",
      name: "github",
      pluginId: "plg_gh",
    });
    const hand = retiredServerRow({
      metadata: { id: "mcp_notes", org: ORG, slug: "notes", name: "notes" },
    });
    expect(serverFactsOf(hand).pluginId).toBeUndefined();
  });

  it("reads a skill a plugin installed, and none for a skill someone wrote", () => {
    const member = skillRow({
      id: "skl_review",
      org: ORG,
      slug: "pr-review",
      labels: { [PLUGIN_LABEL]: "plg_gh", [PLUGIN_VERSION_LABEL]: "sha256:x" },
    });
    expect(memberSkillFactsOf(member)).toEqual({
      id: "skl_review",
      org: ORG,
      slug: "pr-review",
      pluginId: "plg_gh",
    });
    expect(
      memberSkillFactsOf(
        skillRow({ id: "skl_own", org: ORG, slug: "house-style" }),
      ),
    ).toBeUndefined();
  });

  it("collects the ids that leave and each plugin server's tool rename", () => {
    const all = facts();
    expect(all.serverIds()).toEqual(
      new Set(["mcp_gh", "mcp_docs", "mcp_notes"]),
    );
    expect(all.memberSkillIds()).toEqual(new Set(["skl_review", "skl_lint"]));
    expect(all.toolRenames(ORG)).toEqual(
      new Map([
        ["mcp__github", NEW_PREFIX],
        ["mcp__docs-search", "mcp__plugin_docs_search"],
      ]),
    );
    expect(all.toolRenames("org_elsewhere")).toEqual(new Map());
  });

  it("throws on bytes that do not decode", () => {
    const junk = new Uint8Array([0xff, 0xff, 0xff]);
    expect(() => pluginFactsOf(junk)).toThrow();
    expect(() => serverFactsOf(junk)).toThrow();
    expect(() => memberSkillFactsOf(junk)).toThrow();
  });
});

describe("renamedToolEntry", () => {
  const renames = new Map([["mcp__github", NEW_PREFIX]]);

  it.each([
    ["mcp__github", NEW_PREFIX],
    ["mcp__github__create_issue", `${NEW_PREFIX}__create_issue`],
    ["mcp__github__*", `${NEW_PREFIX}__*`],
    ["mcp__notes__read", "mcp__notes__read"],
    ["mcp__github-enterprise__x", "mcp__github-enterprise__x"],
    ["mcp__*", "mcp__*"],
    ["Bash(git *)", "Bash(git *)"],
  ])("%s becomes %s", (entry, expected) => {
    expect(renamedToolEntry(entry, renames)).toBe(expected);
  });
});

describe("migrateAgentRow", () => {
  it("turns a usage of a plugin's server into the plugin and drops the retired field", () => {
    const result = migrated(agent({ serverUsages: [serverRef("github")] }));
    expect(
      result.spec?.plugins.map((ref) => [ref.kind, ref.org, ref.slug]),
    ).toEqual([[ApiResourceKind.plugin, ORG, "gh-tools"]]);
    expect((result.spec as { $unknown?: unknown }).$unknown).toBeUndefined();
  });

  it("lists each plugin once, after the plugins the agent already listed, whatever names it", () => {
    const result = migrated(
      agent({
        spec: {
          plugins: [pluginRef("docs", "")],
          skillRefs: [skillRef("pr-review"), skillRef("pr-lint", ORG)],
        },
        serverUsages: [
          serverRef("github"),
          serverRef("docs-search"),
          serverRef("github", ORG),
        ],
        pluginHooks: [pluginRef("gh-tools", ORG)],
      }),
    );
    expect(slugs(result.spec?.plugins)).toEqual(["docs", "gh-tools"]);
    expect(result.spec?.skillRefs).toEqual([]);
  });

  it("drops a hand-added server with a warning that names the way back", () => {
    const logger = recordingLogger();
    const result = migrateAgentRow(
      agent({ serverUsages: [serverRef("notes")] }),
      facts(),
      logger,
    );
    expect(result).toBeDefined();
    const spec = fromBinary(AgentSchema, result!.data).spec;
    expect(spec?.plugins).toEqual([]);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]!.fields).toMatchObject({
      agent: `${ORG}/reviewer`,
      server: "notes",
    });
    expect(String(logger.warnings[0]!.fields?.["fix"])).toContain(
      "stigmer mcp add notes",
    );
    expect(logger.infos).toHaveLength(1);
    expect(logger.infos[0]!.fields).toMatchObject({
      agent: `${ORG}/reviewer`,
      plugins: [],
    });
  });

  it("drops a usage naming no server, and one naming another organization's server, without a warning", () => {
    const logger = recordingLogger();
    const result = migrateAgentRow(
      agent({
        serverUsages: [serverRef("gone"), serverRef("github", OTHER_ORG)],
      }),
      facts(),
      logger,
    );
    expect(result).toBeDefined();
    expect(fromBinary(AgentSchema, result!.data).spec?.plugins).toEqual([]);
    expect(logger.warnings).toEqual([]);
  });

  it("turns a reference to a plugin's skill into the plugin and keeps the agent's own skills", () => {
    const result = migrated(
      agent({
        spec: { skillRefs: [skillRef("house-style"), skillRef("pr-review")] },
      }),
    );
    expect(slugs(result.spec?.skillRefs)).toEqual(["house-style"]);
    expect(slugs(result.spec?.plugins)).toEqual(["gh-tools"]);
  });

  it("turns a hook source naming a plugin into the plugin and keeps an inline hook", () => {
    const result = migrated(
      agent({
        spec: {
          hooks: [
            {
              source: {
                case: "inline",
                value: { format: HookFormat.CLAUDE_CODE },
              },
            },
          ],
        },
        pluginHooks: [pluginRef("gh-tools", ""), pluginRef("unknown", ORG)],
      }),
    );
    expect(result.spec?.hooks.map((hook) => hook.source.case)).toEqual([
      "inline",
    ]);
    expect(slugs(result.spec?.plugins)).toEqual(["gh-tools"]);
  });

  it("makes an agent a plugin composed an ordinary agent that lists its plugin", () => {
    const result = migrated(
      agent({
        metadata: {
          slug: "gh-tools",
          labels: {
            [PLUGIN_LABEL]: "plg_gh",
            [PLUGIN_VERSION_LABEL]: "sha256:old",
            team: "platform",
          },
        },
        spec: {
          instructions: "The plugin's main agent, composed at install.",
          subAgents: [
            { name: "triager", instructions: "Triage every new issue." },
          ],
        },
      }),
    );
    expect(result.metadata?.labels).toEqual({ team: "platform" });
    expect(result.spec?.subAgents).toEqual([]);
    expect(result.spec?.instructions).toBe(
      "The plugin's main agent, composed at install.",
    );
    expect(slugs(result.spec?.plugins)).toEqual(["gh-tools"]);
  });

  it("names a plugin server's tools as a turn does, in every tool list, and drops a sub-agent's plugin skill", () => {
    const result = migrated(
      agent({
        spec: {
          tools: ["mcp__github__create_issue", "mcp__notes__*", "Read"],
          disallowedTools: ["mcp__github__delete_repo", "mcp__docs-search"],
          subAgents: [
            {
              name: "triager",
              instructions: "Triage every new issue.",
              tools: ["mcp__github__*"],
              disallowedTools: ["mcp__github__close_issue"],
              skillRefs: [skillRef("pr-review"), skillRef("house-style")],
            },
          ],
        },
      }),
    );
    expect(result.spec?.tools).toEqual([
      `${NEW_PREFIX}__create_issue`,
      "mcp__notes__*",
      "Read",
    ]);
    expect(result.spec?.disallowedTools).toEqual([
      `${NEW_PREFIX}__delete_repo`,
      "mcp__plugin_docs_search",
    ]);
    const subAgent = result.spec?.subAgents[0];
    expect(subAgent?.tools).toEqual([`${NEW_PREFIX}__*`]);
    expect(subAgent?.disallowedTools).toEqual([`${NEW_PREFIX}__close_issue`]);
    expect(slugs(subAgent?.skillRefs)).toEqual(["house-style"]);
    // A rename alone attaches no plugin: the agent listed none of its parts.
    expect(result.spec?.plugins).toEqual([]);
  });

  it("renames a tool list only by the agent's own organization's servers", () => {
    // Another organization installed a plugin whose server has the same
    // slug; this organization's `github` server was added by hand. The
    // agent's disallowed entry must not take the other plugin's name.
    const all = facts();
    all.addPlugin({
      id: "plg_other",
      org: OTHER_ORG,
      slug: "dev-kit",
      name: "dev-kit",
    });
    all.addServer({
      id: "mcp_other",
      org: OTHER_ORG,
      slug: "notes",
      name: "notes",
      pluginId: "plg_other",
    });
    const result = migrateAgentRow(
      agent({ spec: { disallowedTools: ["mcp__notes__delete_page"] } }),
      all,
      recordingLogger(),
    );
    const spec =
      result === undefined
        ? undefined
        : fromBinary(AgentSchema, result.data).spec;
    expect(spec?.disallowedTools ?? ["mcp__notes__delete_page"]).toEqual([
      "mcp__notes__delete_page",
    ]);
  });

  it("heads a new version: the recomputed hash, the previous one named, the retirement message", () => {
    const result = migrateAgentRow(
      agent({ serverUsages: [serverRef("github")] }),
      facts(),
      recordingLogger(),
    );
    expect(result).toBeDefined();
    const decoded = fromBinary(AgentSchema, result!.data);
    const hash = canonicalSpecHash(AgentSpecSchema, decoded.spec!);
    expect(result!.versionHash).toBe(hash);
    expect(hash).not.toBe(OLD);
    expect(decoded.status?.versionHash).toBe(hash);
    expect(decoded.metadata?.version).toMatchObject({
      id: hash,
      previousVersionId: OLD,
      message: RETIREMENT_VERSION_MESSAGE,
    });
    // A second pass finds nothing left to change.
    expect(
      migrateAgentRow(result!.data, facts(), recordingLogger()),
    ).toBeUndefined();
  });

  it("leaves an agent with no plugin parts, and one with no spec", () => {
    expect(
      migrateAgentRow(
        agent({
          spec: {
            skillRefs: [skillRef("house-style")],
            tools: ["mcp__notes__*", "Read"],
          },
        }),
        facts(),
        recordingLogger(),
      ),
    ).toBeUndefined();
    const bare = toBinary(
      AgentSchema,
      create(AgentSchema, { metadata: { id: "agt_bare", org: ORG } }),
    );
    expect(migrateAgentRow(bare, facts(), recordingLogger())).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() =>
      migrateAgentRow(
        new Uint8Array([0xff, 0xff, 0xff]),
        facts(),
        recordingLogger(),
      ),
    ).toThrow();
  });
});

describe("migrateSessionRow", () => {
  const NEW = "f".repeat(64);
  const repinned = new Map([["agt_1", NEW]]);

  function session(
    options: Partial<Parameters<typeof retiredSessionRow>[0]>,
  ): Uint8Array {
    return retiredSessionRow({
      metadata: { id: "ses_1", org: ORG, slug: "ses-1" },
      ...options,
      spec: { subject: "Triage", ...options.spec },
    });
  }

  it("turns server usages and plugin skills into plugins, each once, keeping the session's own skills", () => {
    const result = migrateSessionRow(
      session({
        spec: { skillRefs: [skillRef("pr-review"), skillRef("house-style")] },
        serverUsages: [
          serverRef("github"),
          serverRef("notes"),
          serverRef("docs-search"),
        ],
      }),
      facts(),
      new Map(),
    );
    expect(result).toBeDefined();
    const spec = fromBinary(SessionSchema, result!).spec;
    expect(slugs(spec?.plugins)).toEqual(["gh-tools", "docs"]);
    expect(slugs(spec?.skillRefs)).toEqual(["house-style"]);
    expect(spec?.subject).toBe("Triage");
    expect(
      (spec as { $unknown?: unknown } | undefined)?.$unknown,
    ).toBeUndefined();
  });

  it("re-pins a session on a changed agent's previous version to the new one", () => {
    const result = migrateSessionRow(
      session({ status: { agentId: "agt_1", agentVersionHash: OLD } }),
      facts(),
      repinned,
    );
    expect(result).toBeDefined();
    expect(fromBinary(SessionSchema, result!).status?.agentVersionHash).toBe(
      NEW,
    );
  });

  it("leaves a session pinned to no version, one already on the new version, and one on an unchanged agent", () => {
    for (const status of [
      { agentId: "agt_1", agentVersionHash: "" },
      { agentId: "agt_1", agentVersionHash: NEW },
      { agentId: "agt_2", agentVersionHash: OLD },
    ]) {
      expect(
        migrateSessionRow(session({ status }), facts(), repinned),
        JSON.stringify(status),
      ).toBeUndefined();
    }
  });

  it("leaves a session with no plugin parts", () => {
    expect(
      migrateSessionRow(
        session({ spec: { skillRefs: [skillRef("house-style")] } }),
        facts(),
        repinned,
      ),
    ).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() =>
      migrateSessionRow(new Uint8Array([0xff, 0xff, 0xff]), facts(), repinned),
    ).toThrow();
  });
});

describe("policyNamesRetired", () => {
  const servers = new Set(["mcp_gh"]);
  const skills = new Set(["skl_review"]);

  it.each([
    [
      "a removed server as resource",
      "identity_account:acc_1",
      "mcp_server:mcp_gh",
      true,
    ],
    [
      "a removed server as principal",
      "mcp_server:mcp_gh",
      "organization:org_1",
      true,
    ],
    [
      "a plugin's skill as resource",
      "identity_account:acc_1",
      "skill:skl_review",
      true,
    ],
    [
      "a plugin's skill as principal",
      "skill:skl_review",
      "organization:org_1",
      true,
    ],
    ["a skill someone wrote", "identity_account:acc_1", "skill:skl_own", false],
    [
      "a server id under another kind",
      "identity_account:acc_1",
      "agent:mcp_gh",
      false,
    ],
    ["an agent", "identity_account:acc_1", "agent:agt_1", false],
  ])("%s: %s", (_label, principal, resource, expected) => {
    const data = policyRow({
      id: "pol_1",
      principal,
      relation: "owner",
      resource,
    });
    expect(policyNamesRetired(data, servers, skills)).toBe(expected);
  });

  it("throws on bytes that do not decode", () => {
    expect(() =>
      policyNamesRetired(new Uint8Array([0xff, 0xff, 0xff]), servers, skills),
    ).toThrow();
  });
});

describe("unreadableRowError", () => {
  it("names the kind and the row, and keeps the cause", () => {
    const cause = new Error("premature EOF");
    const error = unreadableRowError("agent", "agt_bad", cause);
    expect(error.message).toBe(
      "agent 'agt_bad' cannot be read to retire the MCP server kind: Error: premature EOF",
    );
    expect(error.cause).toBe(cause);
  });
});
