// Plugin fixtures for the conformance suite: the library's own dialect
// builders (`@stigmer/plugin-package/testing`) produce the file layout each
// tool writes, and one deterministic zipper turns the map into the archive
// PushPlugin takes. Same map, same bytes, same digest — the content hash is
// the contract, so the zipper pins its mtime exactly as the skill fixtures
// do (see skills.ts).
import {
  cursorPlugin,
  openPlugin,
  withFile,
} from "@stigmer/plugin-package/testing";
import type { PluginFixture } from "@stigmer/plugin-package/testing";
import { zipFiles } from "./skills";

export { cursorPlugin, openPlugin, withFile };
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
