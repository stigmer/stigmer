/**
 * In-memory plugin builders for tests (exported as
 * `@stigmer/plugin-package/testing`).
 *
 * One builder per dialect, each writing the exact file layout that
 * dialect's tools produce: `openPlugin` a root `plugin.json` with the
 * canonical `$schema` and an `mcp.json` beside it; `claudePlugin` a
 * `.claude-plugin/plugin.json` with `.mcp.json`; `cursorPlugin` a
 * `.cursor-plugin/plugin.json` declaring `./skills/`, `./agents/` and
 * `./mcp.json` the way every published Cursor plugin does; `codexPlugin`
 * the legacy `.codex-plugin/plugin.json` compatibility layout. The
 * adversarial suite starts from a valid plugin and breaks exactly one
 * thing with the mutators (`withFile`, `withoutFile`,
 * `withManifestField`), so each test reads as "this plugin, minus this",
 * and the consumers' tests (the CLI's, the server's) craft their fixtures
 * from the same source so the shapes never drift apart.
 *
 * Builders return a path -> content map; `inMemoryPluginFiles` turns one
 * into the `PluginFiles` the reader takes. Zipping a fixture for an
 * archive-based consumer is `@stigmer/zip-structure/testing`'s job.
 */

import { stringify as stringifyYaml } from "yaml";

import { inMemoryPluginFiles } from "./files.js";
import { AGENT_PLUGINS_MANIFEST_SCHEMA, AGENT_PLUGINS_MCP_SCHEMA, MANIFEST_LOCATIONS } from "./messages.js";

export { inMemoryPluginFiles };

/** A plugin as files: plugin-relative path -> content. */
export type PluginFixture = Map<string, string | Uint8Array>;

export interface SkillFixture {
  /** The frontmatter `name`; also the directory name unless `dir` says otherwise. */
  readonly name: string;
  readonly description?: string;
  /** Directory under `skills/` (or the declared skills root); defaults to `name`. */
  readonly dir?: string;
  /** Extra frontmatter fields, or `null` for a `SKILL.md` with no frontmatter at all. */
  readonly frontmatter?: Readonly<Record<string, unknown>> | null;
  readonly body?: string;
  /** Extra files inside the skill directory, relative to it. */
  readonly files?: Readonly<Record<string, string>>;
}

export interface AgentFixture {
  /** File name under `agents/`, without `.md`. */
  readonly file: string;
  /** Frontmatter fields, or `null` for a bare prompt with no frontmatter. */
  readonly frontmatter?: Readonly<Record<string, unknown>> | null;
  readonly body?: string;
}

interface CommonFixture {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  /** Extra or overriding manifest fields, merged last. */
  readonly manifest?: Readonly<Record<string, unknown>>;
  readonly skills?: readonly SkillFixture[];
  /** Extra files anywhere in the plugin. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
}

export interface OpenPluginFixture extends CommonFixture {
  /** The manifest `$schema`; `null` omits it. Defaults to the canonical 1.0.0 identifier. */
  readonly schema?: string | null;
  /** The `mcpServers` map for `mcp.json`; absent means no `mcp.json`. */
  readonly mcpServers?: Readonly<Record<string, unknown>>;
  /** The `mcp.json` `$schema`; `null` omits it. */
  readonly mcpSchema?: string | null;
  /** Extra top-level `mcp.json` fields. */
  readonly mcpConfig?: Readonly<Record<string, unknown>>;
}

export interface ClaudePluginFixture extends CommonFixture {
  readonly agents?: readonly AgentFixture[];
  /** The `mcpServers` map for `.mcp.json`; absent means no `.mcp.json`. */
  readonly mcpServers?: Readonly<Record<string, unknown>>;
  readonly userConfig?: Readonly<Record<string, unknown>>;
}

export interface CursorPluginFixture extends CommonFixture {
  readonly agents?: readonly AgentFixture[];
  /** The `mcpServers` map for `mcp.json`, declared as `"mcpServers": "./mcp.json"`. */
  readonly mcpServers?: Readonly<Record<string, unknown>>;
  /** The `variables` JSON Schema: property name -> `{ type, title, description }`. */
  readonly variables?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly required?: readonly string[];
}

export interface CodexPluginFixture extends CommonFixture {
  /** The `mcpServers` map for `.mcp.json`, declared as `"mcpServers": "./.mcp.json"`. */
  readonly mcpServers?: Readonly<Record<string, unknown>>;
  /** The `apps` map for `.app.json`. */
  readonly apps?: Readonly<Record<string, unknown>>;
}

const DEFAULT_NAME = "example";

/** An Agent Plugins 1.0.0 package. */
export function openPlugin(fixture: OpenPluginFixture = {}): PluginFixture {
  const files: PluginFixture = new Map();
  const manifest: Record<string, unknown> = {
    ...(fixture.schema !== null && { $schema: fixture.schema ?? AGENT_PLUGINS_MANIFEST_SCHEMA }),
    name: fixture.name ?? DEFAULT_NAME,
    ...(fixture.version !== undefined && { version: fixture.version }),
    ...(fixture.description !== undefined && { description: fixture.description }),
    ...fixture.manifest,
  };
  files.set(MANIFEST_LOCATIONS["agent-plugins"], json(manifest));
  if (fixture.mcpServers !== undefined) {
    files.set(
      "mcp.json",
      json({
        ...(fixture.mcpSchema !== null && { $schema: fixture.mcpSchema ?? AGENT_PLUGINS_MCP_SCHEMA }),
        mcpServers: fixture.mcpServers,
        ...fixture.mcpConfig,
      }),
    );
  }
  writeSkills(files, "skills", fixture.skills);
  writeExtra(files, fixture.files);
  return files;
}

/** A Claude Code plugin. */
export function claudePlugin(fixture: ClaudePluginFixture = {}): PluginFixture {
  const files: PluginFixture = new Map();
  const manifest: Record<string, unknown> = {
    name: fixture.name ?? DEFAULT_NAME,
    ...(fixture.version !== undefined && { version: fixture.version }),
    ...(fixture.description !== undefined && { description: fixture.description }),
    ...(fixture.userConfig !== undefined && { userConfig: fixture.userConfig }),
    ...fixture.manifest,
  };
  files.set(MANIFEST_LOCATIONS.claude, json(manifest));
  if (fixture.mcpServers !== undefined) files.set(".mcp.json", json({ mcpServers: fixture.mcpServers }));
  writeSkills(files, "skills", fixture.skills);
  writeAgents(files, "agents", fixture.agents);
  writeExtra(files, fixture.files);
  return files;
}

/** A Cursor plugin, declaring its components the way the published catalogue does. */
export function cursorPlugin(fixture: CursorPluginFixture = {}): PluginFixture {
  const files: PluginFixture = new Map();
  const manifest: Record<string, unknown> = {
    name: fixture.name ?? DEFAULT_NAME,
    ...(fixture.version !== undefined && { version: fixture.version }),
    ...(fixture.description !== undefined && { description: fixture.description }),
    ...(fixture.skills !== undefined && { skills: "./skills/" }),
    ...(fixture.agents !== undefined && { agents: "./agents/" }),
    ...(fixture.variables !== undefined && {
      variables: {
        type: "object",
        properties: fixture.variables,
        ...(fixture.required !== undefined && { required: fixture.required }),
      },
    }),
    ...(fixture.mcpServers !== undefined && { mcpServers: "./mcp.json" }),
    ...fixture.manifest,
  };
  files.set(MANIFEST_LOCATIONS.cursor, json(manifest));
  if (fixture.mcpServers !== undefined) files.set("mcp.json", json({ mcpServers: fixture.mcpServers }));
  writeSkills(files, "skills", fixture.skills);
  writeAgents(files, "agents", fixture.agents);
  writeExtra(files, fixture.files);
  return files;
}

/** The legacy Codex compatibility layout (`.codex-plugin/plugin.json`, `.mcp.json`, `.app.json`). */
export function codexPlugin(fixture: CodexPluginFixture = {}): PluginFixture {
  const files: PluginFixture = new Map();
  const manifest: Record<string, unknown> = {
    name: fixture.name ?? DEFAULT_NAME,
    ...(fixture.version !== undefined && { version: fixture.version }),
    ...(fixture.description !== undefined && { description: fixture.description }),
    ...(fixture.skills !== undefined && { skills: "./skills/" }),
    ...(fixture.mcpServers !== undefined && { mcpServers: "./.mcp.json" }),
    ...(fixture.apps !== undefined && { apps: "./.app.json" }),
    ...fixture.manifest,
  };
  files.set(MANIFEST_LOCATIONS.codex, json(manifest));
  if (fixture.mcpServers !== undefined) files.set(".mcp.json", json({ mcpServers: fixture.mcpServers }));
  if (fixture.apps !== undefined) files.set(".app.json", json({ apps: fixture.apps }));
  writeSkills(files, "skills", fixture.skills);
  writeExtra(files, fixture.files);
  return files;
}

/** A copy of `files` with `path` set to `content`. */
export function withFile(files: PluginFixture, path: string, content: string | Uint8Array): PluginFixture {
  const copy = new Map(files);
  copy.set(path, content);
  return copy;
}

/** A copy of `files` without `path`. */
export function withoutFile(files: PluginFixture, path: string): PluginFixture {
  const copy = new Map(files);
  copy.delete(path);
  return copy;
}

/**
 * A copy of `files` with one top-level field of the JSON document at
 * `manifestPath` set (or removed, when `value` is `undefined`).
 */
export function withManifestField(files: PluginFixture, manifestPath: string, field: string, value: unknown): PluginFixture {
  const current = files.get(manifestPath);
  if (current === undefined) throw new Error(`fixture has no document at '${manifestPath}'`);
  const text = typeof current === "string" ? current : new TextDecoder().decode(current);
  const document = JSON.parse(text) as Record<string, unknown>;
  if (value === undefined) delete document[field];
  else document[field] = value;
  return withFile(files, manifestPath, json(document));
}

/** A `SKILL.md` document from a fixture description. */
export function skillMarkdown(skill: SkillFixture): string {
  const body = skill.body ?? `# ${skill.name}\n\nInstructions for the ${skill.name} skill.\n`;
  if (skill.frontmatter === null) return body;
  const frontmatter = {
    name: skill.name,
    ...(skill.description !== undefined && { description: skill.description }),
    ...skill.frontmatter,
  };
  return `---\n${stringifyYaml(frontmatter)}---\n${body}`;
}

/** A sub-agent document from a fixture description. */
export function agentMarkdown(agent: AgentFixture): string {
  const body = agent.body ?? `You are the ${agent.file} sub-agent. Do the task thoroughly and report back.\n`;
  if (agent.frontmatter === null) return body;
  const frontmatter = { name: agent.file, ...agent.frontmatter };
  return `---\n${stringifyYaml(frontmatter)}---\n${body}`;
}

function writeSkills(files: PluginFixture, root: string, skills: readonly SkillFixture[] | undefined): void {
  for (const skill of skills ?? []) {
    const dir = `${root}/${skill.dir ?? skill.name}`;
    files.set(`${dir}/SKILL.md`, skillMarkdown(skill));
    for (const [path, content] of Object.entries(skill.files ?? {})) files.set(`${dir}/${path}`, content);
  }
}

function writeAgents(files: PluginFixture, root: string, agents: readonly AgentFixture[] | undefined): void {
  for (const agent of agents ?? []) files.set(`${root}/${agent.file}.md`, agentMarkdown(agent));
}

function writeExtra(files: PluginFixture, extra: Readonly<Record<string, string | Uint8Array>> | undefined): void {
  for (const [path, content] of Object.entries(extra ?? {})) files.set(path, content);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
