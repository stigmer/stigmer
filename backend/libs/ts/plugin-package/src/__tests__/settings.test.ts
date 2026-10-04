/**
 * Pins a Claude plugin's settings: `agent` names the main agent (bare or
 * plugin-scoped, the file winning over the manifest's inline `settings`),
 * an agent the plugin does not ship is warned and ignored, every other key
 * is named as not applied, and settings mean nothing without a Claude
 * manifest.
 */

import { describe, expect, it } from "vitest";

import { claudePlugin, codexPlugin, cursorPlugin, withFile } from "../testing.js";
import { accepted, findingOf, kindsOf, read, refused } from "../__test-utils__/read.js";

const agents = [
  { file: "reviewer", frontmatter: { description: "Reviews." } },
  { file: "writer", frontmatter: { description: "Writes." } },
];

describe("the main agent", () => {
  it("is the agent settings.json names", () => {
    const outcome = read(claudePlugin({ agents, settings: { agent: "reviewer" } }));
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: [] });
    expect(accepted(outcome).mainAgent).toBe("reviewer");
  });

  it("accepts the plugin-scoped name", () => {
    expect(accepted(read(claudePlugin({ name: "kit", agents, settings: { agent: "kit:writer" } }))).mainAgent).toBe("writer");
  });

  it("reads the manifest's inline settings, with settings.json winning", () => {
    expect(accepted(read(claudePlugin({ agents, manifest: { settings: { agent: "writer" } } }))).mainAgent).toBe("writer");
    expect(accepted(read(claudePlugin({ agents, manifest: { settings: { agent: "writer" } }, settings: { agent: "reviewer" } }))).mainAgent).toBe(
      "reviewer",
    );
  });

  it("ignores an agent scoped to another plugin, or one that is not a string", () => {
    for (const agent of ["other:writer", 3]) {
      const outcome = read(claudePlugin({ name: "kit", agents, settings: { agent } }));
      expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["settings-agent-unknown"] });
      expect(accepted(outcome).mainAgent).toBeUndefined();
    }
  });

  it("names every other key, inline or in the file", () => {
    const outcome = read(claudePlugin({ agents, manifest: { settings: { theme: "dark" } }, settings: { agent: "writer", subagentStatusLine: {} } }));
    expect(outcome.warnings.map((f) => [f.path, f.subject])).toEqual([
      [".claude-plugin/plugin.json#settings", "theme"],
      ["settings.json", "subagentStatusLine"],
    ]);
  });

  it("refuses inline settings that are not an object, and a settings.json that is not JSON", () => {
    expect(findingOf(refused(read(claudePlugin({ manifest: { settings: "x" } }))), "manifest-field-type")).toMatchObject({ subject: "settings" });
    expect(kindsOf(read(withFile(claudePlugin(), "settings.json", "[]"))).errors).toEqual(["settings-unreadable"]);
  });

  it("means nothing without a Claude manifest", () => {
    expect(accepted(read(cursorPlugin({ agents, files: { "settings.json": JSON.stringify({ agent: "reviewer" }) } }))).mainAgent).toBeUndefined();
    expect(kindsOf(read(codexPlugin({ manifest: { settings: { agent: "x" } } })))).toEqual({ errors: [], warnings: ["manifest-field-unknown"] });
  });
});
