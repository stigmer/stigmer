/**
 * Pins planPluginStatus, the pure function install records a plugin's
 * status from: the package's skills, agents and MCP server entries in the
 * contract's shape; `env` holding every variable a server or a hook reads
 * (as declared, or a required secret when a hook's name is undeclared,
 * and never a declared variable nothing reads); the agents' tool lists
 * checked entry by entry, an unstorable entry dropped with a warning and
 * an agent whose `tools` list loses every entry left out (an empty list
 * would widen it to every tool); a model hint and a settings main agent
 * recorded as warnings and not applied; an agent's skills kept only when
 * the plugin carries them; a version that cannot be a tag; an ignored
 * component; and the refusal of a server whose tool segment
 * `plugin_<plugin>_<server>` would hold `__` or end in `_`, while a name
 * holding a single `_` installs; and the eval suite the archive's files
 * carry, as `evals` (absent when they carry none), which raises no
 * warning of the plan's own.
 *
 * Packages are built by hand so each case changes one thing; the reader's
 * own behaviour is the library's suite's.
 */
import { describe, expect, it } from "vitest";

import { inMemoryPluginFiles } from "@stigmer/plugin-package";
import type {
  PluginFiles,
  PluginMcpServer,
  PluginPackage,
  PluginSubAgent,
} from "@stigmer/plugin-package";

import { SERVER_WARNING_KINDS } from "../constants.js";
import {
  isStorableEntry,
  planPluginStatus,
  ServerNameError,
  variablesRead,
} from "../plan-status.js";

/** An archive holding nothing beside the package: no eval suite. */
const NO_FILES: PluginFiles = inMemoryPluginFiles(new Map());

/** The plan of a hand-built package, over files that carry no eval suite unless given. */
function planOf(plugin: PluginPackage, files: PluginFiles = NO_FILES) {
  return planPluginStatus(plugin, files);
}

function pkg(overrides: Partial<PluginPackage> = {}): PluginPackage {
  return {
    name: "acme",
    keywords: [],
    dialect: "claude",
    manifestsFound: [".claude-plugin/plugin.json"],
    skills: [],
    mcpServers: [],
    subAgents: [],
    variables: [],
    ignored: [],
    ...overrides,
  };
}

function agent(overrides: Partial<PluginSubAgent> = {}): PluginSubAgent {
  return {
    name: "lead",
    instructions: "You lead the work and report back.",
    skillNames: [],
    path: "agents/lead.md",
    ...overrides,
  };
}

const httpServer: PluginMcpServer = {
  name: "github",
  transport: "http",
  url: "https://api.example.test/mcp",
  headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
  env: ["GITHUB_TOKEN"],
};

const stdioServer: PluginMcpServer = {
  name: "db",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@acme/db-mcp"],
  env: ["DB_URL"],
};

describe("planPluginStatus — the lists", () => {
  it("lists skills, agents and both server transports in the contract's shape", () => {
    const plan = planOf(
      pkg({
        skills: [
          {
            name: "review",
            description: "Reviews code",
            dir: "skills/review",
            files: [],
          },
          { name: "plain", dir: "skills/plain", files: [] },
        ],
        subAgents: [
          agent({
            description: "Leads",
            tools: ["Read", "mcp__plugin_acme_github__search"],
            disallowedTools: ["Bash"],
            skillNames: ["review", "missing"],
          }),
        ],
        mcpServers: [httpServer, stdioServer],
        variables: [
          {
            name: "GITHUB_TOKEN",
            isSecret: true,
            optional: false,
            declaredBy: "cursor",
            description: "token",
          },
          {
            name: "DB_URL",
            isSecret: false,
            optional: true,
            declaredBy: "claude",
          },
        ],
      }),
    );

    expect(plan.skills.map((s) => [s.name, s.description, s.path])).toEqual([
      ["review", "Reviews code", "skills/review"],
      ["plain", "", "skills/plain"],
    ]);
    expect(plan.agents).toHaveLength(1);
    const lead = plan.agents[0]!;
    expect([lead.name, lead.description, lead.instructions]).toEqual([
      "lead",
      "Leads",
      "You lead the work and report back.",
    ]);
    expect(lead.tools).toEqual(["Read", "mcp__plugin_acme_github__search"]);
    expect(lead.disallowedTools).toEqual(["Bash"]);
    // An unknown skill name already carries the library's own warning.
    expect(lead.skills).toEqual(["review"]);

    const [github, db] = plan.mcpServers;
    expect(github?.name).toBe("github");
    expect(github?.env).toEqual(["GITHUB_TOKEN"]);
    expect(github?.transport.case).toBe("http");
    if (github?.transport.case === "http") {
      expect(github.transport.value.url).toBe("https://api.example.test/mcp");
      expect(github.transport.value.headers).toEqual({
        Authorization: "Bearer ${GITHUB_TOKEN}",
      });
    }
    expect(db?.transport.case).toBe("stdio");
    if (db?.transport.case === "stdio") {
      expect(db.transport.value.command).toBe("npx");
      expect(db.transport.value.args).toEqual(["-y", "@acme/db-mcp"]);
    }

    expect(plan.env["GITHUB_TOKEN"]).toMatchObject({
      isSecret: true,
      optional: false,
      description: "token",
    });
    expect(plan.env["DB_URL"]).toMatchObject({
      isSecret: false,
      optional: true,
    });
    expect(plan.hooks).toBeUndefined();
    expect(plan.warnings).toEqual([]);
  });

  it("passes the hooks through as read", () => {
    const hooks = {
      format: "claude-code" as const,
      groups: [
        {
          event: "PreToolUse",
          matcher: "Bash",
          handlers: [{ command: "node guard.js", args: [], failClosed: true }],
        },
      ],
    };
    expect(planOf(pkg({ hooks })).hooks).toBe(hooks);
  });
});

describe("variablesRead", () => {
  it("declares what servers and hooks read: as declared, or a required secret for a hook's undeclared name; never an unread declaration", () => {
    const env = variablesRead(
      pkg({
        mcpServers: [stdioServer],
        variables: [
          {
            name: "DB_URL",
            isSecret: false,
            optional: false,
            declaredBy: "claude",
            description: "where",
          },
          {
            name: "UNUSED",
            isSecret: true,
            optional: false,
            declaredBy: "claude",
          },
        ],
        hooks: {
          format: "claude-code",
          groups: [
            {
              event: "PostToolUse",
              matcher: "",
              handlers: [
                {
                  command: "node",
                  args: ["notify.js", "${user_config.WEBHOOK}"],
                  failClosed: false,
                },
              ],
            },
          ],
        },
      }),
    );
    expect(Object.keys(env).sort()).toEqual(["DB_URL", "WEBHOOK"]);
    expect(env["DB_URL"]).toMatchObject({
      isSecret: false,
      optional: false,
      description: "where",
    });
    expect(env["WEBHOOK"]).toMatchObject({
      isSecret: true,
      optional: false,
      description: "",
    });
  });
});

describe("planPluginStatus — the server segment", () => {
  it("refuses a server whose segment holds two underscores in a row, naming the segment", () => {
    const plan = (): unknown =>
      planOf(
        pkg({ mcpServers: [{ ...stdioServer, name: "db__x" }] }),
      );
    expect(plan).toThrow(ServerNameError);
    expect(plan).toThrow(
      "MCP server 'db__x' of plugin 'acme' would name its tools 'mcp__plugin_acme_db__x__<tool>'",
    );
  });

  it("refuses two servers of one plugin that a turn would name the same, naming both", () => {
    const plan = (): unknown =>
      planOf(pkg({ mcpServers: [{ ...stdioServer, name: "x.y" }, { ...stdioServer, name: "x_y" }] }));
    expect(plan).toThrow(ServerNameError);
    expect(plan).toThrow("MCP servers 'x.y' and 'x_y' of plugin 'acme' would both name their tools 'mcp__plugin_acme_x_y__<tool>'");
  });

  it("refuses a segment that ends in an underscore, whether the name wrote it or a character mapped to it", () => {
    expect(() =>
      planOf(pkg({ mcpServers: [{ ...stdioServer, name: "db_" }] })),
    ).toThrow(ServerNameError);
    expect(() =>
      planOf(pkg({ mcpServers: [{ ...stdioServer, name: "db." }] })),
    ).toThrow(ServerNameError);
    expect(() =>
      planOf(pkg({ mcpServers: [{ ...stdioServer, name: "a.:b" }] })),
    ).toThrow(ServerNameError);
  });

  it("installs plugin and server names that hold a single underscore", () => {
    const plan = planOf(
      pkg({
        name: "my_plugin",
        mcpServers: [{ ...stdioServer, name: "my_db" }],
      }),
    );
    expect(plan.mcpServers.map((s) => s.name)).toEqual(["my_db"]);
  });
});

describe("planPluginStatus — the agents' judgements", () => {
  it("drops an entry the contract cannot store, with a warning naming it, and keeps the rest", () => {
    const plan = planOf(
      pkg({
        subAgents: [
          agent({
            tools: ["Read", "mcp__claude_ai_Slack__post"],
            disallowedTools: ["not a tool"],
          }),
        ],
      }),
    );
    expect(plan.agents[0]?.tools).toEqual(["Read"]);
    expect(plan.agents[0]?.disallowedTools).toEqual([]);
    expect(plan.warnings.map((w) => [w.kind, w.path])).toEqual([
      [SERVER_WARNING_KINDS.toolListEntryDropped, "agents/lead.md"],
      [SERVER_WARNING_KINDS.toolListEntryDropped, "agents/lead.md"],
    ]);
    expect(plan.warnings[0]?.message).toContain(
      "'mcp__claude_ai_Slack__post' in 'tools'",
    );
    expect(plan.warnings[1]?.message).toContain(
      "'not a tool' in 'disallowedTools'",
    );
  });

  it("leaves out an agent whose tools list loses every entry, rather than widening it to every tool", () => {
    const plan = planOf(
      pkg({
        subAgents: [
          agent({
            name: "notify",
            path: "agents/notify.md",
            tools: ["mcp__claude_ai_Slack__post"],
          }),
          agent(),
        ],
      }),
    );
    expect(plan.agents.map((a) => a.name)).toEqual(["lead"]);
    expect(plan.warnings.map((w) => w.kind)).toEqual([
      SERVER_WARNING_KINDS.toolListEntryDropped,
      SERVER_WARNING_KINDS.agentNotInstalled,
    ]);
    expect(plan.warnings[1]?.message).toContain(
      "agent 'acme:notify' is left out",
    );
  });

  it("keeps an agent with no tools list at all (every tool, as its author wrote)", () => {
    const plan = planOf(pkg({ subAgents: [agent()] }));
    expect(plan.agents[0]?.tools).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it("records a model hint as a warning and does not apply it; inherit and an unknown alias add none", () => {
    const plan = planOf(
      pkg({
        subAgents: [
          agent({ name: "a", modelHint: { raw: "sonnet", alias: "sonnet" } }),
          agent({ name: "b", modelHint: { raw: "inherit", alias: "inherit" } }),
          agent({ name: "c", modelHint: { raw: "gpt-9", alias: "unknown" } }),
        ],
      }),
    );
    expect(plan.agents.map((a) => a.name)).toEqual(["a", "b", "c"]);
    expect(plan.warnings.map((w) => w.kind)).toEqual([
      SERVER_WARNING_KINDS.modelHintUnresolved,
    ]);
    expect(plan.warnings[0]?.message).toContain("names model 'sonnet'");
  });

  it("keeps a settings main agent as an ordinary plugin agent, with a warning", () => {
    const plan = planOf(
      pkg({ subAgents: [agent()], mainAgent: "lead" }),
    );
    expect(plan.agents.map((a) => a.name)).toEqual(["lead"]);
    expect(plan.warnings.map((w) => [w.kind, w.path])).toEqual([
      [SERVER_WARNING_KINDS.settingsAgentNotApplied, "agents/lead.md"],
    ]);
    expect(plan.warnings[0]?.message).toContain(
      "'acme:lead' is one of the plugin's agents",
    );
  });
});

describe("planPluginStatus — version and ignored components", () => {
  it("tags a version that fits the tag pattern and warns about one that does not", () => {
    expect(planOf(pkg({ version: "1.2.0" })).tag).toBe("1.2.0");
    expect(planOf(pkg()).tag).toBe("");
    const plan = planOf(pkg({ version: "1.0.0+build.1" }));
    expect(plan.tag).toBe("");
    expect(plan.warnings.map((w) => w.kind)).toEqual([
      SERVER_WARNING_KINDS.versionNotTaggable,
    ]);
  });

  it("warns about each ignored component at its path", () => {
    const plan = planOf(
      pkg({ ignored: [{ kind: "commands", path: "commands/" }] }),
    );
    expect(plan.warnings.map((w) => [w.kind, w.path])).toEqual([
      [SERVER_WARNING_KINDS.componentIgnored, "commands/"],
    ]);
  });
});

describe("planPluginStatus — the eval suite", () => {
  const JUDGE = "---\ntype: llm\n---\nPASS if it greets.\n";

  it("returns the suite the files carry as evals, with no warning of the plan's own", () => {
    const plan = planOf(
      pkg(),
      inMemoryPluginFiles(
        new Map([
          ["evals/hi/prompt.md", "Hi."],
          ["evals/hi/graders/judge.md", JUDGE],
        ]),
      ),
    );
    expect(plan.evals?.dir).toBe("evals");
    expect(plan.evals?.cases.map((c) => c.name)).toEqual(["hi"]);
    expect(plan.warnings).toEqual([]);
  });

  it("returns no evals when the files carry no eval directory", () => {
    expect(planOf(pkg()).evals).toBeUndefined();
  });
});

describe("isStorableEntry", () => {
  it("answers by the contract's own rule", () => {
    expect(isStorableEntry("Read", "tools")).toBe(true);
    expect(isStorableEntry("Agent(acme:explore)", "tools")).toBe(true);
    expect(isStorableEntry("mcp__plugin_acme_db__query", "tools")).toBe(true);
    expect(isStorableEntry("mcp__plugin_acme_db", "disallowedTools")).toBe(
      true,
    );
    expect(isStorableEntry("mcp__claude_ai_Slack__post", "tools")).toBe(false);
    expect(isStorableEntry("read", "disallowedTools")).toBe(false);
  });
});
