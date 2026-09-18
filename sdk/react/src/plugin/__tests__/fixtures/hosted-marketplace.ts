/**
 * A marketplace tree as a browser would receive it from a host: a flat
 * file map, and a `fetch` fake that answers the GitHub Trees API, raw
 * content, and jsdelivr's listing and CDN for it. Two plugins offered (one
 * with a skill, a sub-agent and an HTTP server declaring `${API_TOKEN}`;
 * one MCP-only under a nested source directory), one entry whose directory
 * is missing, so a suite sees an offered list and a dropped entry, the
 * CLI's own fixture shape.
 */

import type { FetchImpl } from "../../sources/types.js";

/** The fixture names itself `acme-plugins`: the vendors' names are built in, and a fixture under one would meet the reserved-name refusal. */
export const HOSTED_MARKETPLACE_NAME = "acme-plugins";
export const HOSTED_REPO = "acme/plugins";
export const HOSTED_COMMIT = "0123456789abcdef0123456789abcdef01234567";

const encoder = new TextEncoder();

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The tree's files, path to content. */
export function hostedMarketplaceFiles(): Map<string, string> {
  return new Map<string, string>([
    [
      ".cursor-plugin/marketplace.json",
      json({
        name: HOSTED_MARKETPLACE_NAME,
        metadata: { description: "A test catalogue" },
        plugins: [
          { name: "thermos", source: "thermos", description: "Keeps things warm." },
          { name: "github", source: "third_party/github" },
          { name: "ghost", source: "ghost", description: "Listed, not present." },
        ],
      }),
    ],
    [
      "thermos/.cursor-plugin/plugin.json",
      json({
        name: "thermos",
        version: "1.0.0",
        description: "The thermos plugin.",
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
      "thermos/mcp.json",
      json({
        mcpServers: {
          warmth: { type: "http", url: "https://warmth.example.com/mcp", headers: { Authorization: "Bearer ${API_TOKEN}" } },
        },
      }),
    ],
    ["thermos/skills/keep-warm/SKILL.md", "---\nname: keep-warm\ndescription: Keep it warm\n---\n# Keep warm\n\nInstructions.\n"],
    ["thermos/agents/checker.md", "---\nname: checker\ndescription: Checks temperature\n---\nYou check the temperature carefully and report.\n"],
    ["thermos/.gitignore", "*.log\n"],
    ["thermos/debug.log", "excluded by the tree's own .gitignore"],
    [
      "third_party/github/.cursor-plugin/plugin.json",
      json({ name: "github", version: "2.0.0", description: "GitHub tools.", mcpServers: "./mcp.json" }),
    ],
    [
      "third_party/github/mcp.json",
      json({ mcpServers: { github: { type: "http", url: "https://api.githubcopilot.com/mcp/" } } }),
    ],
    ["README.md", "# Plugins\n"],
  ]);
}

export interface HostedFetchOptions {
  /** Report the GitHub listing as truncated. */
  readonly truncated?: boolean;
  /** Answer the listing with this status instead of 200. */
  readonly listingStatus?: number;
  /** Serve this many fewer bytes than declared for the named path. */
  readonly shortRead?: string;
  /** The published version jsdelivr knows; others answer 404. */
  readonly publishedVersion?: string;
}

/** Every request the fake answered, in order, for assertions on budget and conditionality. */
export interface RecordedRequest {
  readonly url: string;
  readonly ifNoneMatch: string | null;
}

/** A `fetch` for the hosted tree. */
export function hostedFetch(
  files: Map<string, string> = hostedMarketplaceFiles(),
  options: HostedFetchOptions = {},
): { fetchImpl: FetchImpl; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const etag = `"tree-${HOSTED_COMMIT.slice(0, 8)}"`;

  const fetchImpl: FetchImpl = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    requests.push({ url, ifNoneMatch: headers.get("if-none-match") });

    // GitHub Trees API
    const trees = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/trees\/([^?]+)\?recursive=1$/.exec(url);
    if (trees) {
      if (options.listingStatus !== undefined) return new Response("{}", { status: options.listingStatus });
      if (trees[1] !== HOSTED_REPO) return new Response("{}", { status: 404 });
      if (headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
      return new Response(
        JSON.stringify({
          sha: HOSTED_COMMIT,
          truncated: options.truncated ?? false,
          tree: [
            { path: "thermos", type: "tree" },
            ...[...files.entries()].map(([path, content]) => ({
              path,
              type: "blob",
              size: encoder.encode(content).length,
            })),
          ],
        }),
        { status: 200, headers: { etag, "content-type": "application/json" } },
      );
    }

    // GitHub raw
    const raw = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(url);
    if (raw) {
      const path = decodeURIComponent(raw[3] ?? "");
      const content = files.get(path);
      if (raw[2] !== HOSTED_COMMIT || content === undefined) return new Response("Not Found", { status: 404 });
      const bytes = encoder.encode(content);
      return new Response(options.shortRead === path ? bytes.slice(0, -1) : bytes, { status: 200 });
    }

    // jsdelivr listing
    const listing = /^https:\/\/data\.jsdelivr\.com\/v1\/package\/npm\/@stigmer\/plugins@([^/]+)\/flat$/.exec(url);
    if (listing) {
      if (listing[1] !== options.publishedVersion) return new Response("{}", { status: 404 });
      return new Response(
        JSON.stringify({
          files: [...files.entries()].map(([path, content]) => ({ name: `/${path}`, size: encoder.encode(content).length })),
        }),
        { status: 200 },
      );
    }

    // jsdelivr CDN
    const cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@stigmer\/plugins@([^/]+)\/(.+)$/.exec(url);
    if (cdn) {
      const path = decodeURIComponent(cdn[2] ?? "");
      const content = files.get(path);
      if (cdn[1] !== options.publishedVersion || content === undefined) return new Response("Not Found", { status: 404 });
      return new Response(encoder.encode(content), { status: 200 });
    }

    return new Response("unexpected request", { status: 500 });
  };

  return { fetchImpl, requests };
}
