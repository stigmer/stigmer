// Plugin fixtures for the conformance suite: the library's own dialect
// builders (`@stigmer/plugin-package/testing`) produce the file layout each
// tool writes, and one deterministic zipper turns the map into the archive
// PushPlugin takes. Same map, same bytes, same digest — the content hash is
// the contract, so the zipper pins its mtime exactly as the skill fixtures
// do (see skills.ts).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  claudePlugin,
  cursorPlugin,
  openPlugin,
  withFile,
} from "@stigmer/plugin-package/testing";
import type { PluginFixture } from "@stigmer/plugin-package/testing";
import { zipFiles } from "./skills";

export { claudePlugin, cursorPlugin, openPlugin, withFile };
export type { PluginFixture };

/** A fixture map as the archive `PushPlugin` takes. */
export function pluginArchive(fixture: PluginFixture): Uint8Array {
  const files: Record<string, Uint8Array | string> = {};
  for (const [path, content] of fixture) {
    files[path] = content;
  }
  return zipFiles(files);
}

export interface ThermosOptions {
  /** The one skill's name; defaults to `<name>-review`. */
  readonly skill?: string;
  /** A second skill, for the upgrade-drops-a-skill arm. */
  readonly extraSkill?: string;
  /** An `ai.stigmer/agent.yaml` body to lay over the composed agent. */
  readonly agentOverlay?: string;
}

/**
 * The thermos shape: a Cursor plugin with a skill, a sub-agent naming a
 * model, an HTTP MCP server referencing one declared variable. Exercises
 * every materialiser but workflows.
 */
export function thermosLike(
  name: string,
  options: ThermosOptions = {},
): PluginFixture {
  const skill = options.skill ?? `${name}-review`;
  let fixture = cursorPlugin({
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
  if (options.agentOverlay !== undefined) {
    fixture = withFile(fixture, "ai.stigmer/agent.yaml", options.agentOverlay);
  }
  return fixture;
}

/** An MCP-only plugin in the open format: one streamable-http server, one inferred variable. */
export function mcpOnly(name: string): PluginFixture {
  return openPlugin({
    name,
    version: "0.1.0",
    mcpServers: {
      [name]: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${TOKEN}" },
      },
    },
  });
}

/**
 * A Claude Code plugin: `userConfig` variables and an `npx` stdio server that
 * references one of them, plus a skill so an agent materialises. The stdio
 * transport is the arm the Cursor shape does not reach.
 */
export function claudeLike(name: string): PluginFixture {
  return claudePlugin({
    name,
    version: "0.3.0",
    description: "Notes with a local server",
    userConfig: {
      NOTES_TOKEN: {
        type: "string",
        description: "Token for the notes server",
        sensitive: true,
        required: true,
      },
    },
    skills: [
      {
        name: `${name}-notes`,
        description: "Keep notes",
        body: "# Notes\nWrite them down.",
      },
    ],
    mcpServers: {
      [`${name}-notes`]: {
        command: "npx",
        args: ["-y", "notes-mcp"],
        env: { NOTES_TOKEN: "${NOTES_TOKEN}" },
      },
    },
  });
}

/**
 * The six plugins vendored from `cursor/plugins` into the library's fixtures,
 * read from disk as the CLI would read them: every file, ignore rules the
 * library's reader applies itself. `salesforce` is the one the library
 * refuses (a variable in a server `url`), so it is the refusal arm of the
 * six, not an install.
 */
export const VENDORED_CURSOR_PLUGINS = [
  "thermos",
  "github",
  "xero",
  "playwright",
  "advisor",
  "salesforce",
] as const;

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const VENDORED_ROOT = join(
  REPO_ROOT,
  "backend/libs/ts/plugin-package/src/__tests__/fixtures/cursor-plugins",
);

export function vendoredPlugin(
  name: (typeof VENDORED_CURSOR_PLUGINS)[number],
): PluginFixture {
  const root = join(VENDORED_ROOT, name);
  const files: PluginFixture = new Map();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.set(
          relative(root, full).split("\\").join("/"),
          readFileSync(full),
        );
      }
    }
  };
  walk(root);
  return files;
}
