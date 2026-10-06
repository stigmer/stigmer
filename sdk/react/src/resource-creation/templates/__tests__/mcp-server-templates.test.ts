/**
 * The built-in MCP server templates: every id is unique, the hosted ones are
 * HTTP with an endpoint, and the one stdio template (the filesystem server)
 * says in its name and description that it runs on local runners only,
 * because cloud-targeted sessions refuse stdio servers at run create.
 */
import { describe, expect, it } from "vitest";
import { MCP_SERVER_TEMPLATES } from "../mcp-server-templates";

describe("MCP_SERVER_TEMPLATES", () => {
  it("gives every template a unique id", () => {
    const ids = MCP_SERVER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every HTTP template at an https endpoint", () => {
    const http = MCP_SERVER_TEMPLATES.filter((t) => t.data.transportType === "http");
    expect(http.length).toBeGreaterThan(0);
    for (const t of http) expect(t.data.httpUrl).toMatch(/^https:\/\//);
  });

  it("marks the only stdio template, the filesystem server, as local-runner only", () => {
    const stdio = MCP_SERVER_TEMPLATES.filter((t) => t.data.transportType === "stdio");
    expect(stdio.map((t) => t.id)).toEqual(["filesystem"]);
    const [filesystem] = stdio;
    expect(filesystem!.name).toBe("Filesystem (local runners)");
    expect(filesystem!.description).toContain("Runs on local runners only.");
    expect(filesystem!.data.stdioCommand).toBe("npx");
  });
});
