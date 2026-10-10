// `stigmer mcp add`: the one-server plugin it builds. Pins the two documents
// (a Claude Code manifest naming the plugin, a `.mcp.json` naming one HTTP
// server of the same name, headers sorted), that the shared library reads
// them as that plugin with a `${NAME}` header value declared as a variable,
// that the same input makes the same archive and digest, that a name a
// plugin may not carry is refused with the library's sentence, and the
// `--header NAME=VALUE` parsing with its refusals.

import { describe, expect, it } from "vitest";
import { UsageError } from "../../../errors/index.js";
import { parseHeaders, prepareServerPlugin, serverPluginDocuments } from "../add.js";

describe("serverPluginDocuments", () => {
  it("writes a manifest naming the plugin and one HTTP server of the same name", () => {
    const documents = serverPluginDocuments("linear", "https://mcp.linear.app/mcp", { b: "2", a: "1" });
    expect([...documents.keys()]).toEqual([".claude-plugin/plugin.json", ".mcp.json"]);
    expect(JSON.parse(documents.get(".claude-plugin/plugin.json") ?? "")).toEqual({ name: "linear" });
    const mcp = documents.get(".mcp.json") ?? "";
    expect(JSON.parse(mcp)).toEqual({
      mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp", headers: { a: "1", b: "2" } } },
    });
    expect(mcp.indexOf('"a"')).toBeLessThan(mcp.indexOf('"b"'));
  });

  it("leaves headers out when none are given", () => {
    const mcp = JSON.parse(serverPluginDocuments("linear", "https://mcp.linear.app/mcp", {}).get(".mcp.json") ?? "");
    expect(mcp.mcpServers.linear).toEqual({ type: "http", url: "https://mcp.linear.app/mcp" });
  });
});

describe("prepareServerPlugin", () => {
  it("reads as the one-server plugin, declaring the key a header names", async () => {
    const prepared = await prepareServerPlugin("acme", "https://mcp.acme.example/mcp", {
      Authorization: "Bearer ${ACME_TOKEN}",
    });
    expect(prepared.plugin.name).toBe("acme");
    expect(prepared.plugin.dialect).toBe("claude");
    expect(prepared.plugin.mcpServers.map((server) => [server.name, server.transport])).toEqual([["acme", "http"]]);
    expect(prepared.plugin.variables.map((variable) => variable.name)).toEqual(["ACME_TOKEN"]);
    expect(prepared.files.entries.map((entry) => entry.path)).toEqual([".claude-plugin/plugin.json", ".mcp.json"]);
    expect(prepared.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("makes the same archive and digest from the same input", async () => {
    const first = await prepareServerPlugin("linear", "https://mcp.linear.app/mcp", { x: "1", y: "2" });
    const second = await prepareServerPlugin("linear", "https://mcp.linear.app/mcp", { y: "2", x: "1" });
    expect(Buffer.from(first.archive).equals(Buffer.from(second.archive))).toBe(true);
    expect(first.digest).toBe(second.digest);
  });

  it("refuses a name a plugin may not carry with the library's sentence", async () => {
    await expect(prepareServerPlugin("Not Valid", "https://mcp.linear.app/mcp", {})).rejects.toThrow(
      /mcp add Not Valid: plugin cannot be installed/,
    );
  });
});

describe("parseHeaders", () => {
  it("splits each value at its first '=' and keeps the rest whole", () => {
    expect(parseHeaders(["Authorization=Bearer ${T}", "X-Query=a=b"])).toEqual({
      Authorization: "Bearer ${T}",
      "X-Query": "a=b",
    });
  });

  it("refuses a value without a name and a name given twice", () => {
    expect(() => parseHeaders(["novalue"])).toThrow(UsageError);
    expect(() => parseHeaders(["=x"])).toThrow(/expected NAME=VALUE/);
    expect(() => parseHeaders(["A=1", "A=2"])).toThrow("--header A is given twice");
  });
});
