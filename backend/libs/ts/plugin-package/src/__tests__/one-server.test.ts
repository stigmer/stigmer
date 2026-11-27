/**
 * Pins the one-server plugin both surfaces add: equal inputs make equal
 * bytes whatever order the headers came in, the documents read back to the
 * inputs, and anything a folder could add beside them (a third file, a
 * second server, a manifest field, a server field) reads as not one-server,
 * so a change of address never flattens it.
 */
import { describe, expect, it } from "vitest";

import { hasOneServerPluginPaths, oneServerPluginDocuments, readOneServerPlugin } from "../one-server.js";

const LINEAR = { name: "linear", url: "https://mcp.linear.app/mcp" };

describe("oneServerPluginDocuments", () => {
  it("writes the manifest and the one http server named as the plugin", () => {
    const documents = oneServerPluginDocuments({ ...LINEAR, description: "Linear's issues." });
    expect([...documents.keys()]).toEqual([".claude-plugin/plugin.json", ".mcp.json"]);
    expect(JSON.parse(documents.get(".claude-plugin/plugin.json")!)).toEqual({ name: "linear", description: "Linear's issues." });
    expect(JSON.parse(documents.get(".mcp.json")!)).toEqual({
      mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
    });
  });

  it("writes headers in name order, so the order they were given in changes nothing", () => {
    const a = oneServerPluginDocuments({ ...LINEAR, headers: { b: "2", a: "1" } });
    const b = oneServerPluginDocuments({ ...LINEAR, headers: { a: "1", b: "2" } });
    expect(a).toEqual(b);
    expect(a.get(".mcp.json")!.indexOf('"a"')).toBeLessThan(a.get(".mcp.json")!.indexOf('"b"'));
  });

  it("trims every value, drops a nameless header and leaves out an empty description", () => {
    const documents = oneServerPluginDocuments({
      name: " linear ",
      url: " https://mcp.linear.app/mcp ",
      headers: { " ": "x", " X-Team ": " eng " },
      description: "  ",
    });
    expect(JSON.parse(documents.get(".claude-plugin/plugin.json")!)).toEqual({ name: "linear" });
    expect(JSON.parse(documents.get(".mcp.json")!).mcpServers.linear).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { "X-Team": "eng" },
    });
  });
});

describe("readOneServerPlugin", () => {
  it("reads back what the builder wrote", () => {
    const input = { ...LINEAR, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" }, description: "Issues." };
    expect(readOneServerPlugin(oneServerPluginDocuments(input))).toEqual(input);
    expect(readOneServerPlugin(oneServerPluginDocuments(LINEAR))).toEqual(LINEAR);
  });

  it("refuses a third file beside the two", () => {
    const documents = oneServerPluginDocuments(LINEAR);
    documents.set("README.md", "# linear\n");
    expect(readOneServerPlugin(documents)).toBeUndefined();
  });

  it("refuses a second server, a server named otherwise, or one of another type", () => {
    const manifest = oneServerPluginDocuments(LINEAR).get(".claude-plugin/plugin.json")!;
    const withMcp = (mcp: unknown) =>
      new Map([
        [".claude-plugin/plugin.json", manifest],
        [".mcp.json", JSON.stringify(mcp)],
      ]);
    const server = { type: "http", url: LINEAR.url };
    expect(readOneServerPlugin(withMcp({ mcpServers: { linear: server, other: server } }))).toBeUndefined();
    expect(readOneServerPlugin(withMcp({ mcpServers: { other: server } }))).toBeUndefined();
    expect(readOneServerPlugin(withMcp({ mcpServers: { linear: { type: "stdio", command: "x" } } }))).toBeUndefined();
    expect(readOneServerPlugin(withMcp({ mcpServers: { linear: { ...server, oauth: { clientId: "x" } } } }))).toBeUndefined();
    expect(readOneServerPlugin(withMcp({ mcpServers: { linear: { ...server, headers: { a: 1 } } } }))).toBeUndefined();
  });

  it("refuses a manifest that says more than a name and a description", () => {
    const documents = oneServerPluginDocuments(LINEAR);
    documents.set(".claude-plugin/plugin.json", JSON.stringify({ name: "linear", version: "1.0.0" }));
    expect(readOneServerPlugin(documents)).toBeUndefined();
  });

  it("refuses a manifest whose description is not text", () => {
    const documents = oneServerPluginDocuments(LINEAR);
    documents.set(".claude-plugin/plugin.json", JSON.stringify({ name: "linear", description: 42 }));
    expect(readOneServerPlugin(documents)).toBeUndefined();
  });

  it("refuses a .mcp.json that says more than its servers, or whose servers are not a map", () => {
    const documents = oneServerPluginDocuments(LINEAR);
    documents.set(".mcp.json", JSON.stringify({ mcpServers: { linear: { type: "http", url: LINEAR.url } }, inputs: [] }));
    expect(readOneServerPlugin(documents)).toBeUndefined();
    documents.set(".mcp.json", JSON.stringify({ mcpServers: ["linear"] }));
    expect(readOneServerPlugin(documents)).toBeUndefined();
  });

  it("refuses a document that is not JSON", () => {
    const documents = oneServerPluginDocuments(LINEAR);
    documents.set(".mcp.json", "{");
    expect(readOneServerPlugin(documents)).toBeUndefined();
  });
});

describe("hasOneServerPluginPaths", () => {
  it("is true for exactly the two paths, in any order", () => {
    expect(hasOneServerPluginPaths([".mcp.json", ".claude-plugin/plugin.json"])).toBe(true);
    expect(hasOneServerPluginPaths([".claude-plugin/plugin.json"])).toBe(false);
    expect(hasOneServerPluginPaths([".claude-plugin/plugin.json", ".mcp.json", "skills/a/SKILL.md"])).toBe(false);
  });
});
