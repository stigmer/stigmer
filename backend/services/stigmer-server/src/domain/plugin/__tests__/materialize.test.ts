/**
 * Pins the pure half of a push — what the plan says a package becomes,
 * before any write: the composed agent's instructions (the versioned
 * template, snapshot-pinned), the agent's usages naming servers by SLUG,
 * sub-agents with no tool lists inheriting the agent's whole toolset, a
 * Claude plugin's lists rewritten to Stigmer's names (its own servers and
 * agents) with unstorable entries dropped and an emptied sub-agent left
 * out, the settings' main agent running the main thread, the hooks riding
 * the plan to the status, the composed agent referencing its own plugin's
 * Claude Code-format hooks and declaring the variables they read (never a
 * Cursor-format plugin's, which alone is warned as not run yet),
 * `model_override` staying empty while the hint becomes a warning,
 * a built-in name becoming a warning, an MCP-only package planning no
 * agent, the `mcpServers` key-to-slug rule, a skill archive rooted at its
 * SKILL.md with the plugin's labels on the request, a version the tag
 * pattern rejects becoming a warning, an overlay that redefines the
 * transport refused, the composed agent declaring its tools' variables
 * (OAuth targets excluded, an authored agent left as written), and each
 * planned member's system flag read from its overlay and never from a
 * skill. The member rules themselves (the slug decision, convergence, the
 * dropped set) are members.test.ts's.
 */
import { describe, expect, it } from "vitest";

import {
  inMemoryPluginFiles,
  readPluginPackage,
} from "@stigmer/plugin-package";
import type { PluginPackage } from "@stigmer/plugin-package";
import {
  claudePlugin,
  cursorPlugin,
  openPlugin,
} from "@stigmer/plugin-package/testing";
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
  SYSTEM_LABEL,
} from "../../../pipeline/apiresource-labels.js";
import {
  DEFAULT_AGENT_INSTRUCTIONS_VERSION,
  renderDefaultAgentInstructions,
} from "../materialize/default-agent-instructions.js";
import type { PluginIdentity } from "../materialize/identity.js";
import { McpServerOverlayError } from "../materialize/mcp-servers.js";
import { planMaterialization } from "../materialize/plan.js";
import { ToolListEmptiedError } from "../materialize/tool-lists.js";

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

  it("names servers by slug in the agent's usages; sub-agents without lists carry none and inherit them", () => {
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
    // No list anywhere: the agent may use every tool, and each sub-agent
    // inherits that whole set, the plugin's server included.
    expect(agent.spec?.tools).toEqual([]);
    expect(agent.spec?.disallowedTools).toEqual([]);
    expect(
      agent.spec?.subAgents.map((s) => [s.tools, s.disallowedTools]),
    ).toEqual([
      [[], []],
      [[], []],
    ]);
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
      GITHUB_TOKEN: expect.objectContaining({
        isSecret: true,
        optional: false,
      }),
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
    expect(withOAuth.mcpServers[0]!.resource.spec?.env).toHaveProperty(
      "GITHUB_TOKEN",
    );
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

describe("planned members: the system flag", () => {
  const pkg = read(thermos);

  it("reads system content from the overlay's labels, never from a skill's request", () => {
    const authored = create(AgentSchema, {
      metadata: { name: "thermos", labels: { [SYSTEM_LABEL]: "true" } },
      spec: create(AgentSpecSchema, { instructions: "You read thermostats." }),
    });
    const plan = planMaterialization(
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
    const byKind = new Map(plan.members.map((m) => [m.kind, m.system]));
    expect(byKind.get(ApiResourceKind.agent)).toBe(true);
    expect(byKind.get(ApiResourceKind.skill)).toBe(false);
    expect(byKind.get(ApiResourceKind.mcp_server)).toBe(false);
  });

  it("plans no system content when no overlay declares it", () => {
    const plan = planMaterialization(
      pkg,
      inMemoryPluginFiles(thermos),
      { workflows: [], mcpServers: [] },
      IDENTITY,
      "",
    );
    expect(plan.members.every((m) => m.system === false)).toBe(true);
  });
});

describe("a Claude plugin's tool lists, main agent and hooks", () => {
  const plan = (fixture: PluginFixture) =>
    planMaterialization(
      read(fixture),
      inMemoryPluginFiles(fixture),
      { workflows: [], mcpServers: [] },
      IDENTITY,
      "",
    );
  // Shaped like Anthropic's claude-security: plugin-scoped agent types and
  // a Claude-only workflow tool, plus the plugin's own server by its Claude name.
  const scanner = (extra: Parameters<typeof claudePlugin>[0] = {}) =>
    claudePlugin({
      name: "security-scanner",
      mcpServers: {
        db_tools: { command: "npx", args: ["-y", "@acme/db-mcp"] },
      },
      agents: [
        {
          file: "lead",
          frontmatter: {
            description: "Leads a scan.",
            model: "opus",
            tools:
              "Read, Bash, Agent(security-scanner:explore, security-scanner:verify), Workflow(security-scanner:scan), " +
              "mcp__plugin_security-scanner_db_tools__query, mcp__claude_ai_Slack__post, LS",
          },
          body: "You lead the security scan and delegate.",
        },
        {
          file: "explore",
          frontmatter: {
            description: "Explores.",
            tools: ["mcp__claude_ai_Slack__post"],
          },
        },
        {
          file: "verify",
          frontmatter: {
            description: "Verifies.",
            disallowedTools: "mcp__plugin_security-scanner_db_tools, Write",
          },
        },
      ],
      ...extra,
    });

  it("rewrites the plugin's own server and agents to Stigmer's names and keeps Claude-only tools", () => {
    const agent = plan(scanner()).agent!.resource.spec!;
    const lead = agent.subAgents.find((s) => s.name === "lead")!;
    // explore is left out (its tools list empties), so its type keeps the
    // plugin-scoped name rather than naming a sub-agent the agent lacks.
    expect(lead.tools).toEqual([
      "Read",
      "Bash",
      "Agent(security-scanner:explore, verify)",
      "Workflow(security-scanner:scan)",
      "mcp__dbtools__query",
      "LS",
    ]);
    const verify = agent.subAgents.find((s) => s.name === "verify")!;
    expect([verify.tools, verify.disallowedTools]).toEqual([
      [],
      ["mcp__dbtools", "Write"],
    ]);
    expect(agent.tools).toEqual([]);
  });

  it("drops an entry the contract cannot store, and leaves out a sub-agent whose tools list empties", () => {
    const planned = plan(scanner());
    expect(planned.agent!.resource.spec!.subAgents.map((s) => s.name)).toEqual([
      "lead",
      "verify",
    ]);
    expect(
      planned.warnings
        .filter(
          (w) =>
            w.kind === "tool-list-entry-dropped" ||
            w.kind === "sub-agent-not-installed",
        )
        .map((w) => `${w.kind}:${w.path}`),
    ).toEqual([
      "tool-list-entry-dropped:agents/explore.md",
      "sub-agent-not-installed:agents/explore.md",
      "tool-list-entry-dropped:agents/lead.md",
    ]);
    expect(
      planned.warnings.find((w) => w.kind === "sub-agent-not-installed")
        ?.message,
    ).toBe(
      "sub-agent 'explore' is not installed: every entry of its 'tools' list was dropped, and an empty list would give it every tool",
    );
    expect(
      planned.warnings.find(
        (w) =>
          w.path === "agents/lead.md" && w.kind === "tool-list-entry-dropped",
      )?.message,
    ).toBe(
      "agent 'lead' lists 'mcp__claude_ai_Slack__post' in 'tools', which is not a tool name Stigmer can store; the entry is dropped",
    );
  });

  it("runs the settings' main agent as the agent: its body verbatim, its lists, not also a sub-agent", () => {
    const planned = plan(
      scanner({ settings: { agent: "security-scanner:lead" } }),
    );
    const spec = planned.agent!.resource.spec!;
    expect(spec.instructions).toBe("You lead the security scan and delegate.");
    expect(spec.tools).toEqual([
      "Read",
      "Bash",
      "Agent(security-scanner:explore, verify)",
      "Workflow(security-scanner:scan)",
      "mcp__dbtools__query",
      "LS",
    ]);
    expect(spec.subAgents.map((s) => s.name)).toEqual(["verify"]);
    expect(spec.mcpServerUsages.map((u) => u.mcpServerRef?.slug)).toEqual([
      "dbtools",
    ]);
    expect(planned.warnings.map((w) => `${w.kind}:${w.path}`)).toContain(
      "model-hint-unresolved:agents/lead.md",
    );
    expect(
      planned.warnings.find((w) => w.kind === "model-hint-unresolved")?.message,
    ).toMatch(/^main agent 'lead' names model 'opus'/);
  });

  it("keeps an agent whose disallowedTools loses every entry, with its entries dropped and nothing narrowed away", () => {
    const planned = plan(
      claudePlugin({
        name: "kit",
        settings: { agent: "lead" },
        agents: [
          {
            file: "lead",
            frontmatter: {
              description: "Leads.",
              disallowedTools: "mcp__claude_ai_Slack__post",
            },
          },
          {
            file: "helper",
            frontmatter: {
              description: "Helps.",
              disallowedTools: ["mcp__claude_ai_Slack__post"],
            },
          },
        ],
      }),
    );
    const spec = planned.agent!.resource.spec!;
    expect([spec.tools, spec.disallowedTools]).toEqual([[], []]);
    expect(spec.subAgents.map((s) => [s.name, s.disallowedTools])).toEqual([
      ["helper", []],
    ]);
    expect(planned.warnings.map((w) => `${w.kind}:${w.path}`)).toEqual(
      expect.arrayContaining([
        "tool-list-entry-dropped:agents/lead.md",
        "tool-list-entry-dropped:agents/helper.md",
      ]),
    );
    expect(planned.warnings.map((w) => w.kind)).not.toContain(
      "sub-agent-not-installed",
    );
  });

  it("refuses the install when the main agent's tools list empties", () => {
    expect(() => plan(scanner({ settings: { agent: "explore" } }))).toThrow(
      new ToolListEmptiedError("explore", ["mcp__claude_ai_Slack__post"]),
    );
    expect(() => plan(scanner({ settings: { agent: "explore" } }))).toThrow(
      "main agent 'explore' keeps none of the tools its 'tools' list names ('mcp__claude_ai_Slack__post'); an agent whose list empties would get every tool, so the plugin is not installed",
    );
  });

  it("keeps an authored agent.yaml over the settings, with a warning", () => {
    const fixture = scanner({
      settings: { agent: "lead" },
      files: { "ai.stigmer/agent.yaml": "kind: Agent\n" },
    });
    const authored = create(AgentSchema, {
      spec: create(AgentSpecSchema, {
        instructions: "Authored instructions here.",
      }),
    });
    const planned = planMaterialization(
      read(fixture),
      inMemoryPluginFiles(fixture),
      {
        workflows: [],
        mcpServers: [],
        agent: { path: "ai.stigmer/agent.yaml", resource: authored },
      },
      IDENTITY,
      "",
    );
    expect(planned.agent!.resource.spec?.instructions).toBe(
      "Authored instructions here.",
    );
    expect(
      planned.warnings.find((w) => w.kind === "settings-agent-not-applied"),
    ).toMatchObject({
      path: "ai.stigmer/agent.yaml",
      message:
        "the plugin's settings name 'lead' as the main agent, but 'ai.stigmer/agent.yaml' defines the agent, so the settings are not applied",
    });
  });

  it("carries the hooks on the plan, and plans no member for a plugin that is only hooks", () => {
    const hooks = {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "guard" }] },
      ],
    };
    const planned = plan(claudePlugin({ hooks }));
    expect(planned.members).toEqual([]);
    expect(planned.agent).toBeUndefined();
    expect(planned.hooks).toEqual({
      format: "claude-code",
      groups: [
        {
          event: "PreToolUse",
          matcher: "Bash",
          handlers: [{ command: "guard", args: [], failClosed: false }],
        },
      ],
    });
    expect(plan(claudePlugin()).hooks).toBeUndefined();
  });

  it("warns only for Cursor-format hooks that they are recorded and not run yet", () => {
    const warnedOf = (fixture: PluginFixture) =>
      plan(fixture)
        .warnings.filter((w) => w.kind === "hooks-not-run-yet")
        .map((w) => w.message);
    expect(
      warnedOf(
        cursorPlugin({
          hooks: { preToolUse: [{ command: "./guard.sh" }] },
        }),
      ),
    ).toEqual([
      "the plugin's tool-call hooks are in Cursor's format, which Stigmer records but does not run yet, so none of them checks a call",
    ]);
    expect(
      warnedOf(
        claudePlugin({
          hooks: {
            PreToolUse: [{ hooks: [{ type: "command", command: "guard" }] }],
          },
        }),
      ),
    ).toEqual([]);
    expect(warnedOf(claudePlugin())).toEqual([]);
  });

  it("has the composed agent run its own plugin's Claude Code hooks, unversioned, and declare the variables they read", () => {
    const planned = plan(
      claudePlugin({
        skills: [{ name: "howto", description: "How to", body: "# How" }],
        userConfig: {
          WEBHOOK: {
            type: "string",
            description: "Where to post",
            required: true,
          },
        },
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node",
                  args: [
                    "notify.js",
                    "${user_config.WEBHOOK}",
                    "${user_config.UNDECLARED}",
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
    const spec = planned.agent!.resource.spec!;
    expect(spec.hooks.map((h) => h.source)).toEqual([
      {
        case: "plugin",
        value: expect.objectContaining({
          org: IDENTITY.org,
          kind: ApiResourceKind.plugin,
          slug: IDENTITY.slug,
          version: "",
        }) as unknown,
      },
    ]);
    expect(spec.env["WEBHOOK"]).toMatchObject({
      description: "Where to post",
      isSecret: false,
      optional: false,
    });
    expect(spec.env["UNDECLARED"]).toMatchObject({
      isSecret: true,
      optional: false,
    });
  });

  it("gives a Cursor-format plugin's agent no hook reference, and composes no agent for a plugin that is only hooks", () => {
    const cursor = plan(
      cursorPlugin({
        skills: [{ name: "howto", description: "How to", body: "# How" }],
        hooks: { preToolUse: [{ command: "./guard.sh" }] },
      }),
    );
    expect(cursor.agent!.resource.spec!.hooks).toEqual([]);
    const hooksOnly = plan(
      claudePlugin({
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: "guard" }] }],
        },
      }),
    );
    expect(hooksOnly.agent).toBeUndefined();
  });

  it("names hooks and settings among what Stigmer reads when it ignores a component", () => {
    const planned = plan(cursorPlugin({ files: { "rules/a.mdc": "rule" } }));
    expect(
      planned.warnings.find((w) => w.kind === "component-ignored")?.message,
    ).toBe(
      "rules at 'rules/' is not installed; Stigmer reads skills, MCP servers, sub-agents, hooks, a Claude plugin's settings and the ai.stigmer/ overlay",
    );
  });
});
