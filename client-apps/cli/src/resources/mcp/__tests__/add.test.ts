// `stigmer mcp add`: the one-server plugin it builds. Pins that its two
// documents are the shared builder's (the console's too), that the library reads
// them as that plugin with a `${NAME}` header value declared as a variable,
// that the same input makes the same archive and digest, that a name a
// plugin may not carry is refused with the library's sentence, the
// in-memory file set (sorted entries, a read that refuses a path it does not
// hold), and the `--header NAME=VALUE` parsing with its refusals.

import { describe, expect, it } from "vitest";
import { UsageError } from "../../../errors/index.js";
import { oneServerPluginDocuments } from "@stigmer/plugin-package";
import { documentFiles, parseHeaders, prepareServerPlugin } from "../add.js";

describe("prepareServerPlugin's documents", () => {
  it("are the shared one-server builder's, headers sorted, the description in the manifest", async () => {
    const input = { name: "linear", url: "https://mcp.linear.app/mcp", headers: { b: "2", a: "1" }, description: "Issues." };
    const prepared = await prepareServerPlugin(input);
    const decoder = new TextDecoder();
    const documents = new Map(prepared.files.entries.map((entry) => [entry.path, decoder.decode(prepared.files.read(entry.path))]));
    expect(documents).toEqual(oneServerPluginDocuments(input));
    expect(JSON.parse(documents.get(".claude-plugin/plugin.json") ?? "")).toEqual({ name: "linear", description: "Issues." });
  });
});

describe("documentFiles", () => {
  it("lists the documents sorted by path with their byte sizes, reads each, and refuses a path it does not hold", () => {
    const files = documentFiles(new Map([["b.json", "{}"], ["a.txt", "héllo"]]));
    expect(files.entries).toEqual([
      { path: "a.txt", size: 6 },
      { path: "b.json", size: 2 },
    ]);
    expect(new TextDecoder().decode(files.read("a.txt"))).toBe("héllo");
    expect(() => files.read("c.md")).toThrow("no file 'c.md' in the plugin");
  });
});

describe("prepareServerPlugin", () => {
  it("reads as the one-server plugin, declaring the key a header names", async () => {
    const prepared = await prepareServerPlugin({
      name: "acme",
      url: "https://mcp.acme.example/mcp",
      headers: { Authorization: "Bearer ${ACME_TOKEN}" },
    });
    expect(prepared.plugin.name).toBe("acme");
    expect(prepared.plugin.dialect).toBe("claude");
    expect(prepared.plugin.mcpServers.map((server) => [server.name, server.transport])).toEqual([["acme", "http"]]);
    expect(prepared.plugin.variables.map((variable) => variable.name)).toEqual(["ACME_TOKEN"]);
    expect(prepared.files.entries.map((entry) => entry.path)).toEqual([".claude-plugin/plugin.json", ".mcp.json"]);
    expect(prepared.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("makes the same archive and digest from the same input", async () => {
    const first = await prepareServerPlugin({ name: "linear", url: "https://mcp.linear.app/mcp", headers: { x: "1", y: "2" } });
    const second = await prepareServerPlugin({ name: "linear", url: "https://mcp.linear.app/mcp", headers: { y: "2", x: "1" } });
    expect(Buffer.from(first.archive).equals(Buffer.from(second.archive))).toBe(true);
    expect(first.digest).toBe(second.digest);
  });

  it("refuses a name a plugin may not carry with the library's sentence", async () => {
    await expect(prepareServerPlugin({ name: "Not Valid", url: "https://mcp.linear.app/mcp" })).rejects.toThrow(
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
