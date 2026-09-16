/**
 * The adversarial suite: one fixture per finding kind, each a valid plugin
 * with exactly one thing broken, asserting the COMPLETE sorted list of
 * kinds the reader produced (errors and warnings both) and the sentence of
 * the kind under test. A warning that legitimately accompanies an error is
 * named in its case, never tolerated by omission.
 *
 * The two tables are `Record`s over the kind unions, so a kind added to
 * `outcome.ts` without a case here does not compile, and a case for a kind
 * that no longer exists does not either. Together with `messages.ts` this
 * is the contract: every kind, one sentence, one fixture.
 */

import { describe, expect, it } from "vitest";

import { PLUGIN_DOCUMENT_LIMITS } from "../files.js";
import type { PluginErrorKind, PluginWarningKind } from "../outcome.js";
import { claudePlugin, cursorPlugin, openPlugin, type PluginFixture, withFile, withManifestField, withoutFile } from "../testing.js";
import { findingOf, type Kinds, kindsOf, read } from "../__test-utils__/read.js";

interface Case {
  readonly files: PluginFixture;
  /** Every kind the read produces, sorted. */
  readonly kinds: Kinds;
  /** The sentence of the kind under test. */
  readonly message: string;
}

const OPEN_MANIFEST_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const OPEN_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const HTTP = { type: "streamable-http", url: "https://mcp.example.com/mcp" } as const;
const CURSOR_HTTP = { type: "http", url: "https://mcp.example.com/mcp" } as const;

const errors = (...kinds: PluginErrorKind[]): Kinds => ({ errors: [...kinds].sort(), warnings: [] });
const withWarnings = (kinds: Kinds, ...warnings: PluginWarningKind[]): Kinds => ({ errors: kinds.errors, warnings: [...warnings].sort() });

const ERROR_CASES: Record<PluginErrorKind, Case> = {
  "no-manifest": {
    files: new Map([["README.md", "no manifest here"]]),
    kinds: errors("no-manifest"),
    message: "no plugin manifest found: expected one of 'plugin.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', '.codex-plugin/plugin.json'",
  },
  "manifest-unreadable": {
    files: new Map([["plugin.json", "{ oops"]]),
    kinds: errors("manifest-unreadable"),
    message: /^manifest 'plugin.json' is not valid JSON: /.source,
  },
  "manifest-schema-missing": {
    files: openPlugin({ schema: null }),
    kinds: errors("manifest-schema-missing"),
    message: `manifest 'plugin.json' is missing the required '$schema' field; an Agent Plugins manifest declares '${OPEN_MANIFEST_SCHEMA}'`,
  },
  "manifest-schema-unsupported": {
    files: openPlugin({ schema: "https://agent-plugins.org/schemas/9.0.0/plugin.schema.json" }),
    kinds: errors("manifest-schema-unsupported"),
    message: `manifest 'plugin.json' declares an unsupported '$schema' 'https://agent-plugins.org/schemas/9.0.0/plugin.schema.json'; this reader supports '${OPEN_MANIFEST_SCHEMA}'`,
  },
  "manifest-name-missing": {
    files: withManifestField(openPlugin(), "plugin.json", "name", undefined),
    kinds: errors("manifest-name-missing"),
    message: "manifest 'plugin.json' is missing the required 'name' field",
  },
  "manifest-name-invalid": {
    files: openPlugin({ name: "Has--Double" }),
    kinds: errors("manifest-name-invalid"),
    message: "plugin name 'Has--Double' in 'plugin.json' is invalid: 1 to 64 characters of lowercase letters, digits, hyphens and periods, starting and ending alphanumeric, with no '--' or '..'",
  },
  "manifest-name-conflict": {
    files: new Map([...openPlugin({ name: "one" }), ...claudePlugin({ name: "two" })]),
    kinds: errors("manifest-name-conflict"),
    message: "manifests disagree on the plugin name: 'one' in 'plugin.json' versus 'two' in '.claude-plugin/plugin.json'",
  },
  "manifest-field-type": {
    files: openPlugin({ manifest: { version: 3 } }),
    kinds: errors("manifest-field-type"),
    message: "field 'version' in 'plugin.json' has the wrong type: expected a string",
  },

  "path-not-relative": {
    files: cursorPlugin({ manifest: { skills: "skills/" } }),
    kinds: errors("path-not-relative"),
    message: "path 'skills/' in '.cursor-plugin/plugin.json' must be plugin-relative and begin with './'",
  },
  "path-escapes-root": {
    files: cursorPlugin({ manifest: { agents: "./../shared/agents/" } }),
    kinds: errors("path-escapes-root"),
    message: "path './../shared/agents/' in '.cursor-plugin/plugin.json' escapes the plugin root",
  },
  "path-glob-unsupported": {
    files: cursorPlugin({ manifest: { skills: "./skills/**" } }),
    kinds: errors("path-glob-unsupported"),
    message: "path './skills/**' in '.cursor-plugin/plugin.json' is a glob pattern; declare directories and files by path",
  },
  "path-uncontained": {
    files: withFile(openPlugin(), "/etc/passwd", "root"),
    kinds: errors("path-uncontained"),
    message: "the reader listed a path outside the plugin root: '/etc/passwd'",
  },
  "document-too-large": {
    files: withFile(openPlugin(), "skills/big/SKILL.md", `---\nname: big\ndescription: d\n---\n${"x".repeat(PLUGIN_DOCUMENT_LIMITS.skillMd)}`),
    kinds: errors("document-too-large"),
    message: `'skills/big/SKILL.md' is ${PLUGIN_DOCUMENT_LIMITS.skillMd + "---\nname: big\ndescription: d\n---\n".length} bytes, over the ${PLUGIN_DOCUMENT_LIMITS.skillMd}-byte limit for this kind of document`,
  },

  "skill-frontmatter-missing": {
    files: openPlugin({ skills: [{ name: "bare", frontmatter: null }] }),
    kinds: errors("skill-frontmatter-missing"),
    message: "'skills/bare/SKILL.md' must start with YAML frontmatter ('---')",
  },
  "skill-frontmatter-unclosed": {
    files: withFile(openPlugin(), "skills/open/SKILL.md", "---\nname: open\ndescription: d\nbody without a closing fence"),
    kinds: errors("skill-frontmatter-unclosed"),
    message: "'skills/open/SKILL.md' frontmatter is not closed (missing the closing '---')",
  },
  "skill-frontmatter-unreadable": {
    files: withFile(openPlugin(), "skills/broken/SKILL.md", "---\nname: [unclosed\n---\nbody"),
    kinds: errors("skill-frontmatter-unreadable"),
    message: /^'skills\/broken\/SKILL.md' frontmatter is not valid YAML: /.source,
  },
  "skill-name-invalid": {
    files: openPlugin({ skills: [{ name: "Bad_Name", dir: "bad", description: "d" }] }),
    kinds: errors("skill-name-invalid"),
    message: "skill name 'Bad_Name' in 'skills/bad/SKILL.md' is invalid: lowercase letters, digits and hyphens, optionally dot-scoped, with every segment alphanumeric",
  },
  "skill-name-duplicate": {
    files: openPlugin({ skills: [{ name: "same", dir: "a", description: "d" }, { name: "same", dir: "b", description: "d" }] }),
    kinds: withWarnings(errors("skill-name-duplicate"), "skill-name-differs-from-directory", "skill-name-differs-from-directory"),
    message: "skill name 'same' appears more than once (again in 'skills/b/SKILL.md')",
  },

  "mcp-config-unreadable": {
    files: withFile(openPlugin(), "mcp.json", "not json"),
    kinds: errors("mcp-config-unreadable"),
    message: /^MCP configuration 'mcp.json' is not valid JSON: /.source,
  },
  "mcp-config-shape": {
    files: withFile(openPlugin(), "mcp.json", JSON.stringify({ $schema: OPEN_MCP_SCHEMA, mcpServers: [] })),
    kinds: errors("mcp-config-shape"),
    message: "MCP configuration 'mcp.json' must be an object with an 'mcpServers' object",
  },
  "mcp-config-schema-missing": {
    files: openPlugin({ mcpServers: { s: HTTP }, mcpSchema: null }),
    kinds: errors("mcp-config-schema-missing"),
    message: `MCP configuration 'mcp.json' is missing the required '$schema' field; an Agent Plugins configuration declares '${OPEN_MCP_SCHEMA}'`,
  },
  "mcp-config-schema-unsupported": {
    files: openPlugin({ mcpServers: { s: HTTP }, mcpSchema: "https://agent-plugins.org/schemas/9.0.0/mcp.schema.json" }),
    kinds: errors("mcp-config-schema-unsupported"),
    message: `MCP configuration 'mcp.json' declares an unsupported '$schema' 'https://agent-plugins.org/schemas/9.0.0/mcp.schema.json'; this reader supports '${OPEN_MCP_SCHEMA}'`,
  },
  "mcp-config-field-unknown": {
    files: openPlugin({ mcpServers: { s: HTTP }, mcpConfig: { comment: "x" } }),
    kinds: errors("mcp-config-field-unknown"),
    message: "MCP configuration 'mcp.json' has an unexpected top-level field 'comment'; only '$schema' and 'mcpServers' are allowed",
  },

  "mcp-server-shape": {
    files: openPlugin({ mcpServers: { s: "not-an-object" } }),
    kinds: errors("mcp-server-shape"),
    message: "MCP server 's' in 'mcp.json' must be an object",
  },
  "mcp-server-type-missing": {
    files: openPlugin({ mcpServers: { s: { url: "https://mcp.example.com/mcp" } } }),
    kinds: errors("mcp-server-type-missing"),
    message: "MCP server 's' in 'mcp.json' is missing the 'type' field the Agent Plugins format requires ('stdio', 'streamable-http' or 'sse')",
  },
  "mcp-server-transport-unknown": {
    files: cursorPlugin({ mcpServers: { s: { args: ["x"] } } }),
    kinds: errors("mcp-server-transport-unknown"),
    message: "MCP server 's' in 'mcp.json' has no 'type' and neither a 'command' nor a 'url' to infer it from",
  },
  "mcp-server-type-ambiguous": {
    files: cursorPlugin({ mcpServers: { s: { command: "npx", url: "https://mcp.example.com/mcp" } } }),
    kinds: errors("mcp-server-type-ambiguous"),
    message: "MCP server 's' in 'mcp.json' declares both 'command' and 'url'; a server is either stdio or HTTP",
  },
  "mcp-server-type-unknown": {
    files: cursorPlugin({ mcpServers: { s: { type: "websocket", url: "wss://x" } } }),
    kinds: errors("mcp-server-type-unknown"),
    message: "MCP server 's' in 'mcp.json' has an unknown 'type' 'websocket'; expected 'stdio', 'http', 'streamable-http' or 'sse'",
  },
  "mcp-server-field-unknown": {
    files: openPlugin({ mcpServers: { s: { ...HTTP, env: { A: "${A}" } } } }),
    kinds: errors("mcp-server-field-unknown"),
    message: "MCP server 's' in 'mcp.json' has a field 'env' that its transport does not define",
  },
  "mcp-server-field-type": {
    files: openPlugin({ mcpServers: { s: { type: "stdio", command: "npx", args: "-y" } } }),
    kinds: errors("mcp-server-field-type"),
    message: "MCP server 's' in 'mcp.json' field 'args' has the wrong type",
  },
  "mcp-server-url-missing": {
    files: openPlugin({ mcpServers: { s: { type: "streamable-http" } } }),
    kinds: errors("mcp-server-url-missing"),
    message: "MCP server 's' in 'mcp.json' is missing the 'url' its HTTP transport requires",
  },
  "mcp-server-url-invalid": {
    files: openPlugin({ mcpServers: { s: { type: "streamable-http", url: "http://mcp.example.com/mcp" } } }),
    kinds: errors("mcp-server-url-invalid"),
    message: "MCP server 's' in 'mcp.json' has an invalid 'url' 'http://mcp.example.com/mcp': expected an absolute HTTPS URL (HTTP only for localhost) with no user information or fragment",
  },
  "mcp-server-url-variable": {
    files: cursorPlugin({ variables: { URL: { type: "string" } }, required: ["URL"], mcpServers: { s: { type: "http", url: "${URL}" } } }),
    kinds: errors("mcp-server-url-variable"),
    message: "MCP server 's' in 'mcp.json' has a variable in its 'url'; Stigmer sends the URL as written, so write the URL out and put variables in 'headers'",
  },
  "mcp-server-command-missing": {
    files: openPlugin({ mcpServers: { s: { type: "stdio", args: ["x"] } } }),
    kinds: errors("mcp-server-command-missing"),
    message: "MCP server 's' in 'mcp.json' is missing the 'command' its stdio transport requires",
  },
  "mcp-server-command-invalid": {
    files: openPlugin({ mcpServers: { s: { type: "stdio", command: "npx -y @acme/server" } } }),
    kinds: errors("mcp-server-command-invalid"),
    message: "MCP server 's' in 'mcp.json' has a 'command' that is not a single executable name; put arguments in 'args'",
  },
  "mcp-server-command-relative": {
    files: openPlugin({ mcpServers: { s: { type: "stdio", command: "./bin/server" } } }),
    kinds: errors("mcp-server-command-relative"),
    message: "MCP server 's' in 'mcp.json' runs a command bundled in the plugin './bin/server'; Stigmer runs only commands on the runner's PATH (for example 'npx' or 'uvx')",
  },
  "mcp-server-plugin-root-reference": {
    files: claudePlugin({ mcpServers: { s: { command: "npx", args: ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"] } } }),
    kinds: errors("mcp-server-plugin-root-reference"),
    message: "MCP server 's' in '.mcp.json' references the plugin's own files through '${CLAUDE_PLUGIN_ROOT}'; Stigmer does not mount plugin files into the runner",
  },
  "mcp-server-cwd-unsupported": {
    files: openPlugin({ mcpServers: { s: { type: "stdio", command: "npx", cwd: "./data" } } }),
    kinds: errors("mcp-server-cwd-unsupported"),
    message: "MCP server 's' in 'mcp.json' sets a working directory; Stigmer does not mount plugin files, so a bundled directory cannot be reached",
  },
  "mcp-server-env-literal": {
    files: openPlugin({ mcpServers: { s: { type: "stdio", command: "npx", env: { LOG_LEVEL: "debug" } } } }),
    kinds: errors("mcp-server-env-literal"),
    message: `MCP server 's' in 'mcp.json' sets environment variable 'LOG_LEVEL' to a literal value; Stigmer passes declared variables by name, so write 'LOG_LEVEL: "\${LOG_LEVEL}"' and declare the variable`,
  },
  "mcp-server-env-rename": {
    files: openPlugin({ mcpServers: { s: { type: "stdio", command: "npx", env: { API_KEY: "${MY_KEY}" } } } }),
    kinds: errors("mcp-server-env-rename"),
    message: "MCP server 's' in 'mcp.json' maps environment variable 'API_KEY' to a differently named variable; Stigmer passes declared variables by name, so use the same name on both sides",
  },
  "mcp-server-name-duplicate": {
    files: new Map([
      ...openPlugin({ name: "dup", mcpServers: { s: HTTP } }),
      ...claudePlugin({ name: "dup", mcpServers: { s: { url: "https://other.example.com/mcp" } } }),
    ]),
    kinds: errors("mcp-server-name-duplicate"),
    message: "MCP server name 's' appears more than once (again in '.mcp.json')",
  },
  "mcp-server-header-duplicate": {
    files: openPlugin({ mcpServers: { s: { ...HTTP, headers: { Authorization: "a", authorization: "b" } } } }),
    kinds: errors("mcp-server-header-duplicate"),
    message: "MCP server 's' in 'mcp.json' declares header 'authorization' more than once (header names are case-insensitive)",
  },
  "mcp-server-header-invalid": {
    files: openPlugin({ mcpServers: { s: { ...HTTP, headers: { "X Bad Header": "a" } } } }),
    kinds: errors("mcp-server-header-invalid"),
    message: "MCP server 's' in 'mcp.json' has an invalid header name 'X Bad Header'",
  },

  "sub-agent-frontmatter-unreadable": {
    files: withFile(cursorPlugin({ agents: [] }), "agents/broken.md", "---\nname: [unclosed\n---\nA perfectly good prompt body."),
    kinds: errors("sub-agent-frontmatter-unreadable"),
    message: /^'agents\/broken.md' frontmatter is not valid YAML: /.source,
  },
  "sub-agent-instructions-short": {
    files: cursorPlugin({ agents: [{ file: "terse", frontmatter: { name: "terse" }, body: "Go.\n" }] }),
    kinds: errors("sub-agent-instructions-short"),
    message: "sub-agent 'terse' in 'agents/terse.md' has instructions under 10 characters; the body of the file is the sub-agent's prompt",
  },
  "sub-agent-name-duplicate": {
    files: cursorPlugin({ agents: [{ file: "a", frontmatter: { name: "same" } }, { file: "b", frontmatter: { name: "same" } }] }),
    kinds: errors("sub-agent-name-duplicate"),
    message: "sub-agent name 'same' appears more than once (again in 'agents/b.md')",
  },

  "variable-name-invalid": {
    files: cursorPlugin({ variables: { "my-token": { type: "string" } } }),
    kinds: errors("variable-name-invalid"),
    message: "variable name 'my-token' in '.cursor-plugin/plugin.json' is invalid: an environment variable name is letters, digits and underscores, not starting with a digit",
  },

  "overlay-server-unknown": {
    files: openPlugin({ mcpServers: { s: HTTP }, files: { "ai.stigmer/mcp-servers/other.yaml": "spec: {}\n" } }),
    kinds: errors("overlay-server-unknown"),
    message: "'ai.stigmer/mcp-servers/other.yaml' overlays MCP server 'other', which the plugin does not declare",
  },
  "overlay-document-unknown": {
    files: openPlugin({ files: { "ai.stigmer/agent.yml": "kind: Agent\n" } }),
    kinds: errors("overlay-document-unknown"),
    message: "'ai.stigmer/agent.yml' is not a document Stigmer reads; the 'ai.stigmer/' folder holds 'agent.yaml', 'workflows/<name>.yaml' and 'mcp-servers/<server>.yaml'",
  },
};

const warnings = (...kinds: PluginWarningKind[]): Kinds => ({ errors: [], warnings: [...kinds].sort() });

const WARNING_CASES: Record<PluginWarningKind, Case> = {
  "manifest-field-unknown": {
    files: openPlugin({ manifest: { colour: "blue" } }),
    kinds: warnings("manifest-field-unknown"),
    message: "manifest 'plugin.json' has an unknown field 'colour', ignored",
  },
  "manifest-extensions-invalid": {
    files: openPlugin({ manifest: { extensions: ["nope"] } }),
    kinds: warnings("manifest-extensions-invalid"),
    message: "manifest 'plugin.json' has an 'extensions' field that is not an object, ignored",
  },
  "path-missing": {
    files: cursorPlugin({ manifest: { agents: "./agents/" } }),
    kinds: warnings("path-missing"),
    message: "path './agents' declared in '.cursor-plugin/plugin.json' does not exist in the plugin",
  },
  "skill-name-defaulted": {
    files: withFile(openPlugin(), "skills/from-dir/SKILL.md", "---\ndescription: d\n---\nbody"),
    kinds: warnings("skill-name-defaulted"),
    message: "'skills/from-dir/SKILL.md' has no 'name' in its frontmatter; the skill is named after its directory, 'from-dir'",
  },
  "skill-name-differs-from-directory": {
    files: openPlugin({ skills: [{ name: "real", dir: "folder", description: "d" }] }),
    kinds: warnings("skill-name-differs-from-directory"),
    message: "skill 'real' in 'skills/folder/SKILL.md' is named differently from its directory 'folder'",
  },
  "skill-description-missing": {
    files: openPlugin({ skills: [{ name: "quiet" }] }),
    kinds: warnings("skill-description-missing"),
    message: "skill 'quiet' in 'skills/quiet/SKILL.md' has no 'description'",
  },
  "mcp-config-field-ignored": {
    files: withFile(claudePlugin(), ".mcp.json", JSON.stringify({ mcpServers: {}, comment: "x" })),
    kinds: warnings("mcp-config-field-ignored"),
    message: "MCP configuration '.mcp.json' has a top-level field 'comment' Stigmer does not read, ignored",
  },
  "mcp-server-sse-mapped": {
    files: openPlugin({ mcpServers: { legacy: { type: "sse", url: "https://legacy.example.com/sse" } } }),
    kinds: warnings("mcp-server-sse-mapped"),
    message: "MCP server 'legacy' in 'mcp.json' declares the legacy 'sse' transport; Stigmer connects over Streamable HTTP and falls back to SSE only when the server rejects it",
  },
  "mcp-server-field-ignored": {
    files: cursorPlugin({ mcpServers: { s: { ...CURSOR_HTTP, timeout: 30 } } }),
    kinds: warnings("mcp-server-field-ignored"),
    message: "MCP server 's' in 'mcp.json' has a field 'timeout' Stigmer does not read, ignored",
  },
  "mcp-server-auth-ignored": {
    files: cursorPlugin({ mcpServers: { s: { ...CURSOR_HTTP, auth: { scopes: ["read"] } } } }),
    kinds: warnings("mcp-server-auth-ignored"),
    message: "MCP server 's' in 'mcp.json' has an 'auth' block Stigmer does not read; OAuth for a server is declared in 'ai.stigmer/mcp-servers/s.yaml'",
  },
  "variable-inferred": {
    files: cursorPlugin({ mcpServers: { s: { ...CURSOR_HTTP, headers: { Authorization: "Bearer ${TOKEN}" } } } }),
    kinds: warnings("variable-inferred"),
    message: "variable 'TOKEN' is referenced by MCP server 's' but not declared; it is declared as a required secret",
  },
  "variable-unreferenced": {
    files: cursorPlugin({ variables: { UNUSED: { type: "string" } } }),
    kinds: warnings("variable-unreferenced"),
    message: "variable 'UNUSED' in '.cursor-plugin/plugin.json' is declared but no MCP server references it",
  },
  "variable-default-dropped": {
    files: claudePlugin({ userConfig: { MODE: { type: "string", default: "fast" } }, mcpServers: { s: { command: "npx", args: ["${MODE}"] } } }),
    kinds: warnings("variable-default-dropped"),
    message: "variable 'MODE' in '.claude-plugin/plugin.json' has a default value, which Stigmer does not carry; the user supplies the value",
  },
  "variable-type-narrowed": {
    files: claudePlugin({ userConfig: { DIR: { type: "directory" } }, mcpServers: { s: { command: "npx", args: ["${DIR}"] } } }),
    kinds: warnings("variable-type-narrowed"),
    message: "variable 'DIR' in '.claude-plugin/plugin.json' is typed 'directory'; Stigmer variables are strings",
  },
  "variable-option-dropped": {
    files: claudePlugin({ userConfig: { MODE: { type: "string", options: ["a", "b"] } }, mcpServers: { s: { command: "npx", args: ["${MODE}"] } } }),
    kinds: warnings("variable-option-dropped"),
    message: "variable 'MODE' in '.claude-plugin/plugin.json' has a 'options' constraint, which Stigmer does not carry",
  },
  "sub-agent-name-defaulted": {
    files: cursorPlugin({ agents: [{ file: "helper", frontmatter: null, body: "You help with everything, patiently.\n" }] }),
    kinds: warnings("sub-agent-name-defaulted"),
    message: "'agents/helper.md' has no 'name' in its frontmatter; the sub-agent is named after the file, 'helper'",
  },
  "sub-agent-skill-unknown": {
    files: claudePlugin({ agents: [{ file: "a", frontmatter: { skills: ["missing"] } }] }),
    kinds: warnings("sub-agent-skill-unknown"),
    message: "sub-agent 'a' in 'agents/a.md' asks for skill 'missing', which the plugin does not ship",
  },
  "sub-agent-model-unknown": {
    files: cursorPlugin({ agents: [{ file: "a", frontmatter: { model: "grok-4.6[effort=xhigh]" } }] }),
    kinds: warnings("sub-agent-model-unknown"),
    message: "sub-agent 'a' in 'agents/a.md' names model 'grok-4.6[effort=xhigh]', which Stigmer cannot map; the sub-agent runs on the session's model",
  },
  "sub-agent-field-ignored": {
    files: cursorPlugin({ agents: [{ file: "a", frontmatter: { readonly: true } }] }),
    kinds: warnings("sub-agent-field-ignored"),
    message: "sub-agent 'a' in 'agents/a.md' has a field 'readonly' Stigmer does not read, ignored",
  },
};

function expectSentence(actual: string, expected: string): void {
  // A case whose sentence ends in a parser's own message pins its prefix.
  if (expected.startsWith("^")) expect(actual).toMatch(new RegExp(expected));
  else expect(actual).toBe(expected);
}

describe("every error kind refuses with its own sentence and nothing unexpected", () => {
  it.each(Object.entries(ERROR_CASES))("%s", (kind, testCase) => {
    const outcome = read(testCase.files);
    expect(kindsOf(outcome)).toEqual(testCase.kinds);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expectSentence(findingOf(outcome.errors, kind).message, testCase.message);
  });
});

describe("every warning kind warns with its own sentence and the plugin is accepted", () => {
  it.each(Object.entries(WARNING_CASES))("%s", (kind, testCase) => {
    const outcome = read(testCase.files);
    expect(kindsOf(outcome)).toEqual(testCase.kinds);
    expect(outcome.ok).toBe(true);
    expectSentence(findingOf(outcome.warnings, kind).message, testCase.message);
  });
});

describe("a valid plugin in every dialect produces no findings at all", () => {
  it.each([
    ["open", openPlugin({ skills: [{ name: "a", description: "d" }], mcpServers: { s: HTTP } })],
    ["claude", claudePlugin({ skills: [{ name: "a", description: "d" }], agents: [{ file: "b", frontmatter: { description: "x" } }] })],
    ["cursor", cursorPlugin({ skills: [{ name: "a", description: "d" }], agents: [{ file: "b" }], mcpServers: { s: CURSOR_HTTP } })],
  ])("%s", (_dialect, files) => {
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: [] });
  });

  it("removing the one broken thing from an adversarial case yields a clean plugin", () => {
    // The env-literal case minus its env block is the open stdio server every other stdio case starts from.
    const files = withFile(ERROR_CASES["mcp-server-env-literal"].files, "mcp.json", JSON.stringify({ $schema: OPEN_MCP_SCHEMA, mcpServers: { s: { type: "stdio", command: "npx" } } }));
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: [] });
    expect(withoutFile(files, "mcp.json").has("mcp.json")).toBe(false);
  });
});
