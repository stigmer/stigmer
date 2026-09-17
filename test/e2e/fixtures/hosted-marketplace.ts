/**
 * A GitHub marketplace as the console reads it, served from fixtures so
 * the plugin journey needs no network: `page.route()` answers the Trees
 * API listing and the raw file reads for one repository at one commit.
 * The tree offers a plugin with a skill, a sub-agent and an HTTP MCP
 * server that declares `${API_TOKEN}`, so the journey can prove that the
 * agent the install materialises asks for its tool's variable at session
 * start.
 */

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
/** The plugin's children carry the suffix too: a child slug is unique across plugins in an organization. */
export const HOSTED_SKILL = `keep-warm-${RUN}`;
export const HOSTED_SERVER = `warmth-${RUN}`;
const HOSTED_COMMIT = "0123456789abcdef0123456789abcdef01234567";

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Root-relative path to content. */
export function hostedMarketplaceFiles(): Map<string, string> {
  return new Map<string, string>([
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
    [
      `${HOSTED_PLUGIN}/.cursor-plugin/plugin.json`,
      json({
        name: HOSTED_PLUGIN,
        version: "1.0.0",
        description: "A fixture plugin whose tool needs a token.",
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
      `${HOSTED_PLUGIN}/mcp.json`,
      json({
        mcpServers: {
          [HOSTED_SERVER]: {
            type: "http",
            url: "https://warmth.example.com/mcp",
            headers: { Authorization: "Bearer ${API_TOKEN}" },
          },
        },
      }),
    ],
    [
      `${HOSTED_PLUGIN}/skills/${HOSTED_SKILL}/SKILL.md`,
      `---\nname: ${HOSTED_SKILL}\ndescription: Keep it warm\n---\n# Keep warm\n\nInstructions.\n`,
    ],
    [
      `${HOSTED_PLUGIN}/agents/checker.md`,
      "---\nname: checker\ndescription: Checks temperature\n---\nYou check the temperature carefully and report.\n",
    ],
  ]);
}

/** Route the two GitHub hosts to the fixture tree for this page. */
export async function routeHostedMarketplace(page: Page): Promise<void> {
  const files = hostedMarketplaceFiles();
  const encoder = new TextEncoder();

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
