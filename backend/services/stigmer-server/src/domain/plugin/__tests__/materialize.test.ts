/**
 * Pins the pure half of a push — what the plan says a package becomes,
 * before any write: the composed agent's instructions (the versioned
 * template, snapshot-pinned), a sub-agent's mcp_access naming server
 * SLUGS while `model_override` stays empty and the hint becomes a warning,
 * a built-in name becoming a warning, an MCP-only package planning no
 * agent, the `mcpServers` key-to-slug rule, a skill archive rooted at its
 * SKILL.md with the plugin's labels on the request, a version the tag
 * pattern rejects becoming a warning, an overlay that redefines the
 * transport refused, the composed agent declaring its tools' variables
 * (OAuth targets excluded, an authored agent left as written), and the
 * convergence and drop rules over members.
 */
import { describe, expect, it } from "vitest";

import {
  inMemoryPluginFiles,
  readPluginPackage,
} from "@stigmer/plugin-package";
import type { PluginPackage } from "@stigmer/plugin-package";
import { cursorPlugin, openPlugin } from "@stigmer/plugin-package/testing";
import type { PluginFixture } from "@stigmer/plugin-package/testing";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  McpServerAuthSchema,
  McpServerSpecSchema,
  StdioServerConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { inflateEntry } from "../../../archive/inflate.js";
import { openArchive } from "../../../archive/open.js";
import {
  PLUGIN_LABEL,
  PLUGIN_VERSION_LABEL,
} from "../../../pipeline/apiresource-labels.js";
import {
  DEFAULT_AGENT_INSTRUCTIONS_VERSION,
  renderDefaultAgentInstructions,
} from "../materialize/default-agent-instructions.js";
import type { PluginIdentity } from "../materialize/identity.js";
import { McpServerOverlayError } from "../materialize/mcp-servers.js";
import { planMaterialization } from "../materialize/plan.js";
import { droppedMembers, membersConverge } from "../members.js";
import type { Member } from "../members.js";

const IDENTITY: PluginIdentity = {
  org: "acme",
  id: "plg_1",
  slug: "thermos",
  name: "thermos",
  digest: "d".repeat(64),
  visibility: ApiResourceVisibility.visibility_org,
};

function read(fixture: PluginFixture): PluginPackage {
  const outcome = readPluginPackage(inMemoryPluginFiles(fixture));
  if (!outcome.ok) {
    throw new Error(outcome.errors.map((e) => e.message).join("\n"));
  }
  return outcome.plugin;
}

const thermos = cursorPlugin({
  name: "thermos",
  version: "1.2.0",
  description: "Code review with a thermonuclear standard",
  skills: [
    {
      name: "thermo-review",
      description: "Review code thoroughly",
      body: "# Review",
      files: { "references/checklist.md": "- read it all" },
    },
  ],
  agents: [
    {
      file: "reviewer",
      frontmatter: {
        name: "reviewer",
        description: "Reviews",
        model: "sonnet",
      },
      body: "You review pull requests with care.",
    },
    {
      file: "explore",
      frontmatter: { name: "explore", description: "Shadows a built-in" },
      body: "You explore the repository far and wide.",
    },
  ],
  mcpServers: {
    my_github: {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    },
  },
  variables: { GITHUB_TOKEN: { type: "string", title: "Token" } },
  required: ["GITHUB_TOKEN"],
});

describe("renderDefaultAgentInstructions", () => {
  it("renders the versioned template for the package", () => {
    expect(DEFAULT_AGENT_INSTRUCTIONS_VERSION).toBe(1);
    expect(renderDefaultAgentInstructions(read(thermos))).toBe(
      [
        "You are thermos: Code review with a thermonuclear standard",
        "",
        "Your skills:",
        "- thermo-review: Review code thoroughly",
        "",
        "Your tools come from these MCP servers:",
        "- my_github",
        "",
        "Before acting on a task a skill covers, read that skill and follow it. " +
          "Use the tools your servers provide rather than guessing at their results. " +
          "When you finish, state what you did and what you could not do.",
      ].join("\n"),
    );
  });
});

describe("planMaterialization", () => {
  const pkg = read(thermos);
  const plan = planMaterialization(
    pkg,
    inMemoryPluginFiles(thermos),
    { workflows: [], mcpServers: [] },
    IDENTITY,
    "first",
  );

  it("plans one skill, one server and one agent, in materialisation order", () => {
    expect(
      plan.members.map((m) => `${ApiResourceKind[m.kind]}:${m.slug}`),
    ).toEqual(["skill:thermo-review", "mcp_server:mygithub", "agent:thermos"]);
    expect(plan.tag).toBe("1.2.0");
  });

  it("writes the skill's archive rooted at SKILL.md and stamps the plugin's labels on the request", () => {
    const skill = plan.skills[0]!;
    expect(skill.request.labels).toEqual({
      [PLUGIN_LABEL]: "plg_1",
      [PLUGIN_VERSION_LABEL]: "d".repeat(64),
    });
    expect(skill.request.tag).toBe("1.2.0");
    expect(skill.request.message).toBe("first");
    const { entries } = openArchive(skill.request.artifact);
    expect(entries.map((e) => e.name)).toEqual([
      "SKILL.md",
      "references/checklist.md",
    ]);
    expect(
      new TextDecoder().decode(inflateEntry(entries[0]!.entry, 1 << 20)),
    ).toContain("name: thermo-review");
  });

  it("names servers by slug everywhere a sub-agent or usage refers to them", () => {
    expect(plan.mcpServers[0]).toMatchObject({
      name: "my_github",
      slug: "mygithub",
    });
    expect(
      plan.mcpServers[0]!.resource.spec?.env["GITHUB_TOKEN"],
    ).toMatchObject({ isSecret: true, optional: false });
    const agent = plan.agent!.resource;
    expect(
      agent.spec?.mcpServerUsages.map((u) => u.mcpServerRef?.slug),
    ).toEqual(["mygithub"]);
    expect(
      agent.spec?.subAgents.map((s) => s.mcpAccess.map((a) => a.mcpServer)),
    ).toEqual([["mygithub"], ["mygithub"]]);
  });

  it("records a model hint and a built-in name as warnings and never sets model_override", () => {
    expect(
      plan.agent!.resource.spec?.subAgents.map((s) => s.modelOverride),
    ).toEqual(["", ""]);
    expect(plan.warnings.map((w) => `${w.kind}:${w.path}`)).toEqual(
      expect.arrayContaining([
        "model-hint-unresolved:agents/reviewer.md",
        "sub-agent-name-builtin:agents/explore.md",
      ]),
    );
  });

  it("plans no agent for an MCP-only package", () => {
    const mcpOnly = openPlugin({
      name: "github",
      mcpServers: {
        github: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    });
    const onlyPlan = planMaterialization(
      read(mcpOnly),
      inMemoryPluginFiles(mcpOnly),
      { workflows: [], mcpServers: [] },
      IDENTITY,
      "",
    );
    expect(onlyPlan.agent).toBeUndefined();
    expect(onlyPlan.members.map((m) => ApiResourceKind[m.kind])).toEqual([
      "mcp_server",
    ]);
  });

  it("warns and leaves the tag empty when the manifest version does not fit the tag pattern", () => {
    const built = cursorPlugin({
      name: "b",
      version: "1.0.0+build.7",
      skills: [{ name: "s" }],
    });
    const builtPlan = planMaterialization(
      read(built),
      inMemoryPluginFiles(built),
      { workflows: [], mcpServers: [] },
      IDENTITY,
      "",
    );
    expect(builtPlan.tag).toBe("");
    expect(builtPlan.warnings.map((w) => w.kind)).toContain(
      "version-not-taggable",
    );
    expect(builtPlan.skills[0]!.request.tag).toBe("");
  });

  it("declares the servers' variables on the composed agent so a session asks for them", () => {
    expect(plan.agent!.resource.spec?.env).toEqual({
      GITHUB_TOKEN: expect.objectContaining({ isSecret: true, optional: false }),
    });
  });

  it("leaves an OAuth-managed target out of the agent's declarations", () => {
    const overlay = create(McpServerSchema, {
      spec: create(McpServerSpecSchema, {
        auth: create(McpServerAuthSchema, { targetEnvVar: "GITHUB_TOKEN" }),
      }),
    });
    const withOAuth = planMaterialization(
      pkg,
      inMemoryPluginFiles(thermos),
      {
        workflows: [],
        mcpServers: [
          {
            path: "ai.stigmer/mcp-servers/my_github.yaml",
            server: "my_github",
            resource: overlay,
          },
        ],
      },
      IDENTITY,
      "",
    );
    // The server still declares it (the connect flow reads it there); the
    // agent does not, because the value comes from a managed environment.
    expect(withOAuth.mcpServers[0]!.resource.spec?.env).toHaveProperty("GITHUB_TOKEN");
    expect(withOAuth.agent!.resource.spec?.env).toEqual({});
  });

  it("takes an authored agent as written, declarations included", () => {
    const authored = create(AgentSchema, {
      spec: create(AgentSpecSchema, {
        instructions: "The author's own instructions for this agent.",
      }),
    });
    const withOverlay = planMaterialization(
      pkg,
      inMemoryPluginFiles(thermos),
      {
        agent: { path: "ai.stigmer/agent.yaml", resource: authored },
        workflows: [],
        mcpServers: [],
      },
      IDENTITY,
      "",
    );
    expect(withOverlay.agent!.resource.spec?.env).toEqual({});
  });

  it("refuses a server overlay that redefines the transport", () => {
    const overlay = create(McpServerSchema, {
      spec: create(McpServerSpecSchema, {
        serverType: {
          case: "stdio",
          value: create(StdioServerConfigSchema, { command: "npx" }),
        },
      }),
    });
    expect(() =>
      planMaterialization(
        pkg,
        inMemoryPluginFiles(thermos),
        {
          workflows: [],
          mcpServers: [
            {
              path: "ai.stigmer/mcp-servers/my_github.yaml",
              server: "my_github",
              resource: overlay,
            },
          ],
        },
        IDENTITY,
        "",
      ),
    ).toThrow(McpServerOverlayError);
  });
});

describe("members: convergence and drops", () => {
  const digest = "d".repeat(64);
  const stored: Member[] = [
    {
      kind: ApiResourceKind.skill,
      id: "skl_1",
      slug: "thermo-review",
      name: "thermo-review",
      version: digest,
    },
    {
      kind: ApiResourceKind.agent,
      id: "agt_1",
      slug: "thermos",
      name: "thermos",
      version: digest,
    },
  ];
  const planned = [
    {
      kind: ApiResourceKind.skill,
      slug: "thermo-review",
      name: "thermo-review",
    },
    { kind: ApiResourceKind.agent, slug: "thermos", name: "thermos" },
  ];

  it("converges only when every planned member is present and stamped with the digest", () => {
    expect(membersConverge(stored, planned, digest)).toBe(true);
    expect(membersConverge(stored, planned, "e".repeat(64))).toBe(false);
    expect(membersConverge(stored.slice(1), planned, digest)).toBe(false);
    expect(
      membersConverge(
        [...stored, { ...stored[0]!, slug: "extra", id: "skl_2" }],
        planned,
        digest,
      ),
    ).toBe(false);
  });

  it("drops the members the plan no longer names", () => {
    expect(droppedMembers(stored, planned.slice(1)).map((m) => m.slug)).toEqual(
      ["thermo-review"],
    );
    expect(droppedMembers(stored, planned)).toEqual([]);
  });
});
