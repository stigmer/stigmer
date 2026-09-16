/**
 * The fixture suite: six real Cursor plugins, vendored from cursor/plugins
 * at c1c0a32 (see fixtures/cursor-plugins/NOTICE), read exactly as a user's
 * checkout would be. Every assertion names the field it pins; there are no
 * snapshot files, so a change in what the reader produces is a change
 * someone wrote down here.
 *
 * Between them the six cover: Cursor `variables` with `required` (github,
 * xero, salesforce), a `${VAR}` inside a header (github), stdio `env` as
 * `KEY: "${KEY}"` (xero), an entry with no `type` inferred to stdio
 * (playwright), a `${VAR}` url plus the undocumented `auth` block
 * (salesforce, the one refusal), two sub-agents and no server (thermos), a
 * sub-agent with an unmappable model and a `readonly` field plus hooks that
 * reference `${CURSOR_PLUGIN_ROOT}` and must never be read (advisor), skill
 * frontmatter with vendor keys, `minClientVersions`, a `references/` file
 * inside a skill, and image assets that are listed and never opened.
 */

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readPluginPackage } from "../read-plugin-package.js";
import { directoryPluginFiles } from "../__test-utils__/directory-files.js";
import { accepted, findingOf, kindsOf, refused } from "../__test-utils__/read.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/cursor-plugins/", import.meta.url));

function readFixture(name: string) {
  return readPluginPackage(directoryPluginFiles(`${FIXTURES}${name}`));
}

describe("thermos: skills and sub-agents, no server", () => {
  const outcome = readFixture("thermos");

  it("is accepted with no warnings", () => {
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: [] });
  });

  it("carries the manifest identity", () => {
    const plugin = accepted(outcome);
    expect(plugin).toMatchObject({
      name: "thermos",
      version: "1.0.0",
      license: "MIT",
      dialect: "cursor",
      manifestsFound: [".cursor-plugin/plugin.json"],
      author: { name: "Cursor", email: "plugins@cursor.com" },
      homepage: "https://github.com/cursor/plugins",
    });
    expect(plugin.keywords).toContain("thermo-nuclear");
  });

  it("reads the three skills with their descriptions and files", () => {
    const plugin = accepted(outcome);
    expect(plugin.skills.map((s) => s.name)).toEqual(["thermo-nuclear-code-quality-review", "thermo-nuclear-review", "thermos"]);
    expect(plugin.skills[2]?.description).toMatch(/^Launch both thermo-nuclear review subagents/);
    expect(plugin.skills[2]?.files).toEqual(["skills/thermos/SKILL.md"]);
  });

  it("reads the two sub-agents with the file body as instructions and no model hint", () => {
    const plugin = accepted(outcome);
    expect(plugin.subAgents.map((a) => a.name)).toEqual(["thermo-nuclear-code-quality-review-subagent", "thermo-nuclear-review-subagent"]);
    const review = plugin.subAgents[1];
    expect(review?.description).toMatch(/^Thermo-nuclear branch audit/);
    expect(review?.instructions.length).toBeGreaterThan(1000);
    expect(review?.modelHint).toBeUndefined();
    expect(review?.path).toBe("agents/thermo-nuclear-review-subagent.md");
  });

  it("has no servers and no variables, and records only the logo", () => {
    const plugin = accepted(outcome);
    expect(plugin.mcpServers).toEqual([]);
    expect(plugin.variables).toEqual([]);
    expect(plugin.ignored).toEqual([
      { kind: "assets", path: "assets/" },
      { kind: "logo", path: ".cursor-plugin/plugin.json#logo" },
    ]);
  });
});

describe("github: an HTTP server with a token in a header", () => {
  const outcome = readFixture("github");

  it("is accepted with no warnings", () => {
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: [] });
  });

  it("reads the server with the header reference on its env", () => {
    expect(accepted(outcome).mcpServers).toEqual([
      {
        name: "github",
        transport: "http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" },
        env: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
      },
    ]);
  });

  it("declares the required variable as a secret with the joined title and description", () => {
    expect(accepted(outcome).variables).toEqual([
      {
        name: "GITHUB_PERSONAL_ACCESS_TOKEN",
        description:
          "GitHub personal access token: Fine-grained or classic PAT from https://github.com/settings/tokens with the repo scopes you want the agent to use.",
        isSecret: true,
        optional: false,
        declaredBy: "cursor",
      },
    ]);
  });

  it("records minClientVersions and the logo as ignored", () => {
    expect(accepted(outcome).ignored.map((c) => c.kind).sort()).toEqual(["assets", "logo", "min-client-versions"]);
  });
});

describe("xero: a stdio server passing two secrets by name", () => {
  const outcome = readFixture("xero");

  it("is accepted with no warnings", () => {
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: [] });
  });

  it("reads the npx command with its args and both env references", () => {
    expect(accepted(outcome).mcpServers).toEqual([
      {
        name: "xero",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@xeroapi/xero-mcp-server@latest"],
        env: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
      },
    ]);
  });

  it("declares both variables as required secrets", () => {
    expect(accepted(outcome).variables.map((v) => [v.name, v.isSecret, v.optional])).toEqual([
      ["XERO_CLIENT_ID", true, false],
      ["XERO_CLIENT_SECRET", true, false],
    ]);
  });
});

describe("playwright: a server with no type and no variables", () => {
  const outcome = readFixture("playwright");

  it("is accepted with no warnings and infers stdio from command", () => {
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: [] });
    expect(accepted(outcome).mcpServers).toEqual([
      { name: "playwright", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"], env: [] },
    ]);
    expect(accepted(outcome).variables).toEqual([]);
  });
});

describe("salesforce: a variable in the url is refused", () => {
  const outcome = readFixture("salesforce");

  it("is refused for the url alone, with the auth block warned", () => {
    expect(kindsOf(outcome)).toEqual({ errors: ["mcp-server-url-variable"], warnings: ["mcp-server-auth-ignored"] });
    expect(findingOf(refused(outcome), "mcp-server-url-variable").message).toBe(
      "MCP server 'salesforce' in 'mcp.json' has a variable in its 'url'; Stigmer sends the URL as written, so write the URL out and put variables in 'headers'",
    );
  });
});

describe("advisor: a sub-agent with an unmappable model, and hooks that are never read", () => {
  const outcome = readFixture("advisor");

  it("is accepted with the model and the readonly field warned", () => {
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["sub-agent-field-ignored", "sub-agent-model-unknown"] });
    expect(findingOf(outcome.warnings, "sub-agent-model-unknown")).toMatchObject({ subject: "advisor-subagent", detail: "grok-4.6[effort=xhigh]" });
    expect(findingOf(outcome.warnings, "sub-agent-field-ignored")).toMatchObject({ subject: "advisor-subagent", detail: "readonly" });
  });

  it("keeps the raw model text in the hint", () => {
    expect(accepted(outcome).subAgents[0]?.modelHint).toEqual({ raw: "grok-4.6[effort=xhigh]", alias: "unknown" });
  });

  it("reads the skill with its references file and vendor frontmatter keys", () => {
    const skill = accepted(outcome).skills[0];
    expect(skill?.name).toBe("advisor");
    expect(skill?.files).toEqual(["skills/advisor/SKILL.md", "skills/advisor/references/briefing-template.md"]);
  });

  it("records hooks as ignored without reading the ${CURSOR_PLUGIN_ROOT} inside them", () => {
    const plugin = accepted(outcome);
    expect(plugin.ignored).toEqual([
      { kind: "assets", path: "assets/" },
      { kind: "hooks", path: "hooks/" },
      { kind: "logo", path: ".cursor-plugin/plugin.json#logo" },
      { kind: "hooks", path: ".cursor-plugin/plugin.json#hooks" },
    ]);
    expect(plugin.mcpServers).toEqual([]);
  });
});
