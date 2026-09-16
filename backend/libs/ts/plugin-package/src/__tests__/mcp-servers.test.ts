/**
 * Pins the MCP server normalisation on its accepting paths: the two
 * transports in both the open and the vendor dialects, transport inference,
 * `sse` mapped with its warning, the `${user_config.KEY}` rewrite, header
 * and argument references collected onto `env`, the Cursor `auth` block
 * warned and scanned, inline and multiple sources, and the URL rule's
 * loopback exception. Refusals are pinned kind by kind in the adversarial
 * suite.
 */

import { describe, expect, it } from "vitest";

import { claudePlugin, cursorPlugin, openPlugin } from "../testing.js";
import { accepted, findingOf, kindsOf, read } from "../__test-utils__/read.js";

describe("open dialect", () => {
  it("reads a stdio and a streamable-http server into the two spec shapes", () => {
    const plugin = accepted(
      read(
        openPlugin({
          mcpServers: {
            files: { type: "stdio", command: "npx", args: ["-y", "@acme/files", "--token", "${TOKEN}"], env: { TOKEN: "${TOKEN}" } },
            api: { type: "streamable-http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${API_KEY}", "X-Org": "acme" } },
          },
        }),
      ),
    );
    expect(plugin.mcpServers).toEqual([
      { name: "files", transport: "stdio", command: "npx", args: ["-y", "@acme/files", "--token", "${TOKEN}"], env: ["TOKEN"] },
      { name: "api", transport: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${API_KEY}", "X-Org": "acme" }, env: ["API_KEY"] },
    ]);
  });

  it("maps the legacy sse transport to http with the fallback warning", () => {
    const outcome = read(openPlugin({ mcpServers: { legacy: { type: "sse", url: "https://legacy.example.com/sse" } } }));
    expect(kindsOf(outcome).warnings).toEqual(["mcp-server-sse-mapped"]);
    expect(accepted(outcome).mcpServers[0]).toMatchObject({ transport: "http", url: "https://legacy.example.com/sse" });
    expect(findingOf(outcome.warnings, "mcp-server-sse-mapped").message).toContain("falls back to SSE only when the server rejects it");
  });

  it("allows plain http for loopback hosts only", () => {
    const outcome = read(openPlugin({ mcpServers: { local: { type: "streamable-http", url: "http://localhost:8080/mcp" }, ip: { type: "streamable-http", url: "http://127.0.0.1/mcp" } } }));
    expect(accepted(outcome).mcpServers).toHaveLength(2);
  });
});

describe("vendor dialects", () => {
  it("infers the transport from command or url when type is absent", () => {
    const plugin = accepted(
      read(
        cursorPlugin({
          mcpServers: {
            play: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
            web: { url: "https://mcp.example.com/" },
            explicit: { type: "http", url: "https://mcp.example.com/two" },
          },
        }),
      ),
    );
    expect(plugin.mcpServers.map((s) => [s.name, s.transport])).toEqual([
      ["play", "stdio"],
      ["web", "http"],
      ["explicit", "http"],
    ]);
  });

  it("rewrites Claude's ${user_config.KEY} to ${KEY} in headers, args and env", () => {
    const plugin = accepted(
      read(
        claudePlugin({
          userConfig: { API_KEY: { type: "string", sensitive: true, required: true }, DB: { type: "string" } },
          mcpServers: {
            api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${user_config.API_KEY}" } },
            db: { command: "uvx", args: ["db-mcp", "--name", "${user_config.DB}"], env: { DB: "${user_config.DB}" } },
          },
        }),
      ),
    );
    expect(plugin.mcpServers[0]).toMatchObject({ headers: { Authorization: "Bearer ${API_KEY}" }, env: ["API_KEY"] });
    expect(plugin.mcpServers[1]).toMatchObject({ args: ["db-mcp", "--name", "${DB}"], env: ["DB"] });
  });

  it("warns on Cursor's auth block and still counts the variables inside it as references", () => {
    const outcome = read(
      cursorPlugin({
        variables: { CLIENT_ID: { type: "string" } },
        required: ["CLIENT_ID"],
        mcpServers: { crm: { type: "http", url: "https://crm.example.com/mcp", auth: { CLIENT_ID: "${CLIENT_ID}", scopes: ["a"] } } },
      }),
    );
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["mcp-server-auth-ignored"] });
    expect(accepted(outcome).mcpServers[0]?.env).toEqual(["CLIENT_ID"]);
    expect(findingOf(outcome.warnings, "mcp-server-auth-ignored").message).toContain("ai.stigmer/mcp-servers/crm.yaml");
  });

  it("warns on a field Stigmer does not read instead of refusing", () => {
    const outcome = read(cursorPlugin({ mcpServers: { s: { type: "http", url: "https://x.example.com/mcp", timeout: 30 } } }));
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["mcp-server-field-ignored"] });
  });

  it("reads an inline mcpServers object and a declared file together", () => {
    const files = cursorPlugin({ mcpServers: { fromFile: { type: "http", url: "https://a.example.com/mcp" } } });
    const manifest = JSON.parse(files.get(".cursor-plugin/plugin.json") as string) as Record<string, unknown>;
    manifest["mcpServers"] = ["./mcp.json", { mcpServers: { inline: { type: "http", url: "https://b.example.com/mcp" } } }];
    files.set(".cursor-plugin/plugin.json", JSON.stringify(manifest));
    const plugin = accepted(read(files));
    expect(plugin.mcpServers.map((s) => s.name)).toEqual(["fromFile", "inline"]);
  });

  it("reads Claude's default .mcp.json when the manifest declares no mcpServers", () => {
    const plugin = accepted(read(claudePlugin({ mcpServers: { s: { command: "npx", args: ["x"] } } })));
    expect(plugin.mcpServers.map((s) => s.name)).toEqual(["s"]);
  });

  it("warns on a top-level .mcp.json field it does not read, where the open format would refuse", () => {
    const files = claudePlugin({ mcpServers: { s: { command: "npx" } } });
    files.set(".mcp.json", JSON.stringify({ mcpServers: { s: { command: "npx" } }, comment: "x" }));
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: ["mcp-config-field-ignored"] });
  });
});
