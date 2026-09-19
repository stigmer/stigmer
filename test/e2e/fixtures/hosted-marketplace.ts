/**
 * A GitHub marketplace as the console reads it, served from fixtures so
 * the plugin journey needs no network: `page.route()` answers the Trees
 * API listing and the raw file reads for one repository at one commit,
 * and the avatars the marks load abort, so the run never touches GitHub.
 * The tree offers a plugin with a skill, a sub-agent and an HTTP MCP server that declares
 * `${API_TOKEN}`, so the journey can prove that the agent the install
 * materialises asks for its tool's variable at session start. The same
 * plugin, under a second suffix, is written to a directory for the upload
 * arm, which hands it to the folder input as a browser would.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";

export const HOSTED_REPO = "acme/plugins";
export const HOSTED_MARKETPLACE_NAME = "acme-plugins";
/**
 * Unique per run so the journey always starts from "not installed", even
 * against a backend the harness reused from an earlier run (a plugin's name
 * is its identity in an organization, and a second run would otherwise read
 * as an upgrade).
 */
const RUN = Date.now().toString(36);
export const HOSTED_PLUGIN = `warmth-kit-${RUN}`;
/** The name the manifest gives it for people; the card shows this, the install keeps `HOSTED_PLUGIN`. */
export const HOSTED_PLUGIN_DISPLAY_NAME = "Warmth Kit";
/** The plugin's children carry the suffix too: a child slug is unique across plugins in an organization. */
export const HOSTED_SKILL = `keep-warm-${RUN}`;
export const HOSTED_SERVER = `warmth-${RUN}`;
/** The upload arm's plugin: the same shape under its own names, so the two arms never collide on a slug. */
export const UPLOADED_PLUGIN = `warmth-kit-upload-${RUN}`;
export const UPLOADED_SKILL = `keep-warm-upload-${RUN}`;
export const UPLOADED_SERVER = `warmth-upload-${RUN}`;
const HOSTED_COMMIT = "0123456789abcdef0123456789abcdef01234567";

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** One plugin's files, plugin-relative, under the given names. */
export function pluginFiles(plugin: string, skill: string, server: string): Map<string, string> {
  return new Map<string, string>([
    [
      ".cursor-plugin/plugin.json",
      json({
        name: plugin,
        displayName: HOSTED_PLUGIN_DISPLAY_NAME,
        version: "1.0.0",
        description: "A fixture plugin whose tool needs a token.",
        author: { name: "Acme" },
        skills: "./skills/",
        agents: "./agents/",
        mcpServers: "./mcp.json",
        variables: {
          type: "object",
          properties: { API_TOKEN: { type: "string", title: "API token" } },
          required: ["API_TOKEN"],
        },
      }),
    ],
    [
      "mcp.json",
      json({
        mcpServers: {
          [server]: {
            type: "http",
            url: "https://warmth.example.com/mcp",
            headers: { Authorization: "Bearer ${API_TOKEN}" },
          },
        },
      }),
    ],
    [`skills/${skill}/SKILL.md`, `---\nname: ${skill}\ndescription: Keep it warm\n---\n# Keep warm\n\nInstructions.\n`],
    ["agents/checker.md", "---\nname: checker\ndescription: Checks temperature\n---\nYou check the temperature carefully and report.\n"],
  ]);
}

/** Root-relative path to content: the marketplace file and the hosted plugin's folder. */
export function hostedMarketplaceFiles(): Map<string, string> {
  const files = new Map<string, string>([
    [
      ".cursor-plugin/marketplace.json",
      json({
        name: HOSTED_MARKETPLACE_NAME,
        metadata: { description: "A fixture catalogue for the console journey" },
        plugins: [
          { name: HOSTED_PLUGIN, source: HOSTED_PLUGIN, description: "Keeps things warm; its tool needs a token." },
        ],
      }),
    ],
  ]);
  for (const [path, content] of pluginFiles(HOSTED_PLUGIN, HOSTED_SKILL, HOSTED_SERVER)) {
    files.set(`${HOSTED_PLUGIN}/${path}`, content);
  }
  return files;
}

/**
 * The upload arm's plugin written to a temp directory, the shape a user's
 * folder has on disk (dotfiles included), for `setInputFiles` on the
 * console's directory input. Returns the folder's path.
 */
export function writeUploadPluginDir(): string {
  const root = join(mkdtempSync(join(tmpdir(), "stigmer-e2e-upload-")), UPLOADED_PLUGIN);
  for (const [path, content] of pluginFiles(UPLOADED_PLUGIN, UPLOADED_SKILL, UPLOADED_SERVER)) {
    const full = join(root, ...path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

/**
 * Route the two GitHub hosts to the fixture tree for this page, and every
 * source's avatar (the mark a chip and a card wear, `github.com/<owner>.png`)
 * to an abort, so the run never touches GitHub for an image either.
 */
export async function routeHostedMarketplace(page: Page): Promise<void> {
  const files = hostedMarketplaceFiles();
  const encoder = new TextEncoder();

  await page.route("https://github.com/**", (route) => route.abort());

  await page.route(`https://api.github.com/repos/${HOSTED_REPO}/git/trees/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", etag: '"fixture"' },
      body: JSON.stringify({
        sha: HOSTED_COMMIT,
        truncated: false,
        tree: [...files.entries()].map(([path, content]) => ({
          path,
          type: "blob",
          size: encoder.encode(content).length,
        })),
      }),
    }),
  );

  await page.route(`https://raw.githubusercontent.com/${HOSTED_REPO}/${HOSTED_COMMIT}/**`, (route) => {
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname.split(`/${HOSTED_COMMIT}/`)[1] ?? "");
    const content = files.get(path);
    if (content === undefined) return route.fulfill({ status: 404, body: "Not Found" });
    return route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from(content, "utf8"),
    });
  });
}
