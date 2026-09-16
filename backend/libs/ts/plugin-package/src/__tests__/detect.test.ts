/**
 * Pins manifest detection and identity: the root manifest wins, the vendor
 * precedence without one, every present manifest contributes, name rules
 * and conflicts, the open manifest's `$schema` arms, and unknown fields as
 * warnings in every dialect.
 */

import { describe, expect, it } from "vitest";

import { isValidPluginName } from "../detect.js";
import { claudePlugin, codexPlugin, cursorPlugin, openPlugin, withManifestField } from "../testing.js";
import { accepted, findingOf, kindsOf, read, refused } from "../__test-utils__/read.js";

describe("identity and precedence", () => {
  it("takes identity from the root manifest and lists it first", () => {
    const files = openPlugin({ name: "tools", version: "1.2.0", description: "d", manifest: { license: "MIT", keywords: ["a"] } });
    const plugin = accepted(read(files));
    expect(plugin).toMatchObject({ name: "tools", version: "1.2.0", description: "d", license: "MIT", keywords: ["a"], dialect: "agent-plugins" });
    expect(plugin.manifestsFound).toEqual(["plugin.json"]);
  });

  it("without a root manifest, Claude precedes Cursor precedes Codex", () => {
    const both = new Map([...cursorPlugin({ name: "same" }), ...claudePlugin({ name: "same" })]);
    expect(accepted(read(both))).toMatchObject({ dialect: "claude", manifestsFound: [".claude-plugin/plugin.json", ".cursor-plugin/plugin.json"] });
    const cursorAndCodex = new Map([...codexPlugin({ name: "same" }), ...cursorPlugin({ name: "same" })]);
    expect(accepted(read(cursorAndCodex)).dialect).toBe("cursor");
    expect(accepted(read(codexPlugin({ name: "same" }))).dialect).toBe("codex");
  });

  it("a root manifest beside a vendor manifest keeps the root identity and reads the vendor's declarations", () => {
    // With a root manifest present, `mcp.json` is the open format's fixed
    // location and is read under its rules; the Cursor manifest contributes
    // what the open format cannot say (the variables declaration).
    const files = new Map([
      ...openPlugin({ name: "dual", version: "2.0.0", mcpServers: { s: { type: "streamable-http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${TOKEN}" } } } }),
      ...cursorPlugin({ name: "dual", version: "9.9.9", variables: { TOKEN: { type: "string" } } }),
    ]);
    const plugin = accepted(read(files));
    expect(plugin.version).toBe("2.0.0");
    expect(plugin.dialect).toBe("agent-plugins");
    expect(plugin.variables.map((v) => v.name)).toEqual(["TOKEN"]);
    expect(plugin.mcpServers.map((s) => s.name)).toEqual(["s"]);
  });

  it("a Cursor-shaped mcp.json beside a root manifest is refused under the open format's rules", () => {
    const files = new Map([
      ...openPlugin({ name: "dual" }),
      ...cursorPlugin({ name: "dual", mcpServers: { s: { type: "http", url: "https://example.com/mcp" } } }),
    ]);
    expect(kindsOf(read(files)).errors).toEqual(["mcp-config-schema-missing", "mcp-server-type-unknown"]);
  });

  it("refuses manifests that disagree on the name", () => {
    const files = new Map([...openPlugin({ name: "one" }), ...cursorPlugin({ name: "two" })]);
    const finding = findingOf(refused(read(files)), "manifest-name-conflict");
    expect(finding.message).toBe("manifests disagree on the plugin name: 'one' in 'plugin.json' versus 'two' in '.cursor-plugin/plugin.json'");
  });

  it("refuses a directory with no manifest and names the four locations", () => {
    const finding = findingOf(refused(read(new Map([["README.md", "hi"]]))), "no-manifest");
    expect(finding.message).toContain("'plugin.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', '.codex-plugin/plugin.json'");
  });
});

describe("the plugin name rule", () => {
  it("accepts the open format's valid names and refuses its invalid ones", () => {
    for (const name of ["my-plugin", "acme.tools", "lint3r", "a"]) expect(isValidPluginName(name), name).toBe(true);
    for (const name of ["My-Plugin", "-start", "has--double", "too.many..dots", "", "a".repeat(65), "end-"]) {
      expect(isValidPluginName(name), name).toBe(false);
    }
  });

  it("refuses an invalid name with the rule spelled out", () => {
    const finding = findingOf(refused(read(cursorPlugin({ name: "Bad Name" }))), "manifest-name-invalid");
    expect(finding.message).toContain("'Bad Name' in '.cursor-plugin/plugin.json' is invalid");
  });

  it("refuses a missing name once, naming the manifest", () => {
    const files = withManifestField(claudePlugin(), ".claude-plugin/plugin.json", "name", undefined);
    expect(kindsOf(read(files)).errors).toEqual(["manifest-name-missing"]);
  });
});

describe("the open manifest's schema", () => {
  it("refuses a missing and an unsupported $schema, each with its own sentence", () => {
    expect(kindsOf(read(openPlugin({ schema: null }))).errors).toEqual(["manifest-schema-missing"]);
    const unsupported = findingOf(refused(read(openPlugin({ schema: "https://agent-plugins.org/schemas/2.0.0/plugin.schema.json" }))), "manifest-schema-unsupported");
    expect(unsupported.message).toContain("2.0.0");
  });

  it("reports an unreadable manifest once and does not also blame its missing name", () => {
    const files = new Map([["plugin.json", "{ not json"]]);
    expect(kindsOf(read(files)).errors).toEqual(["manifest-unreadable"]);
  });

  it("decodes a manifest saved with a byte-order mark", () => {
    const files = openPlugin();
    const text = files.get("plugin.json") as string;
    files.set("plugin.json", `\ufeff${text}`);
    expect(accepted(read(files)).name).toBe("example");
  });
});

describe("unknown and mistyped fields", () => {
  it("warns on an unknown top-level field in every dialect", () => {
    expect(kindsOf(read(openPlugin({ manifest: { colour: "blue" } }))).warnings).toEqual(["manifest-field-unknown"]);
    expect(kindsOf(read(claudePlugin({ manifest: { colour: "blue" } }))).warnings).toEqual(["manifest-field-unknown"]);
    expect(kindsOf(read(cursorPlugin({ manifest: { colour: "blue" } }))).warnings).toEqual(["manifest-field-unknown"]);
    expect(kindsOf(read(codexPlugin({ manifest: { colour: "blue" } }))).warnings).toEqual(["manifest-field-unknown"]);
  });

  it("does not warn on a dialect's own metadata fields", () => {
    const cursor = cursorPlugin({ manifest: { displayName: "X", publisher: "Acme", category: "c", tags: ["t"], author: { name: "a", email: "a@b.c" } } });
    expect(kindsOf(read(cursor))).toEqual({ errors: [], warnings: [] });
    const codex = codexPlugin({ manifest: { interface: { displayName: "X" } } });
    expect(kindsOf(read(codex))).toEqual({ errors: [], warnings: [] });
  });

  it("refuses a known field of the wrong type, naming the field", () => {
    const finding = findingOf(refused(read(openPlugin({ manifest: { keywords: "not-an-array" } }))), "manifest-field-type");
    expect(finding).toMatchObject({ path: "plugin.json", subject: "keywords" });
  });

  it("records a non-empty extension namespace as ignored and an empty ai.stigmer namespace as nothing", () => {
    const plugin = accepted(read(openPlugin({ manifest: { extensions: { "com.openai": { apps: "./.app.json" }, "ai.stigmer": {} } } })));
    expect(plugin.ignored).toEqual([{ kind: "extension", path: "plugin.json#extensions.com.openai" }]);
  });

  it("warns on a non-object extensions field and keeps reading", () => {
    const outcome = read(openPlugin({ manifest: { extensions: "nope" } }));
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["manifest-extensions-invalid"] });
  });
});
