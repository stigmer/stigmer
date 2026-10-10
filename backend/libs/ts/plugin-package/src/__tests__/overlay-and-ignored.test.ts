/**
 * Pins that the `ai.stigmer/` folder is read by nothing (one warning names
 * it, whatever it holds, and the plugin installs without it) and the
 * ignored-component record (directories and files on disk, manifest
 * fields, deduplicated, never per file; `hooks/` only where no vendor
 * manifest reads it).
 */

import { describe, expect, it } from "vitest";

import { claudePlugin, cursorPlugin, openPlugin } from "../testing.js";
import { accepted, kindsOf, read } from "../__test-utils__/read.js";

describe("the ai.stigmer/ folder", () => {
  it("is warned once and read by nothing, whatever it holds", () => {
    const files = openPlugin({
      mcpServers: { gh: { type: "streamable-http", url: "https://gh.example.com/mcp" } },
      files: {
        "ai.stigmer/agent.yaml": "kind: Agent\n",
        "ai.stigmer/mcp-servers/gh.yaml": "spec:\n  auth: {}\n",
        "ai.stigmer/workflows/triage.yaml": "kind: Workflow\n",
      },
    });
    const outcome = read(files);
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["stigmer-folder-ignored"] });
    expect(accepted(outcome).mcpServers.map((server) => server.name)).toEqual(["gh"]);
  });

  it("says nothing when the folder is absent", () => {
    expect(kindsOf(read(openPlugin()))).toEqual({ errors: [], warnings: [] });
  });
});

describe("ignored components", () => {
  it("records each component directory and file once, and never reads inside them", () => {
    const files = cursorPlugin({
      manifest: { hooks: "./hooks/hooks.json", rules: "./rules/", logo: "assets/logo.png", minClientVersions: { cursor: "3.13.0" } },
      files: {
        "hooks/hooks.json": '{"hooks":{"stop":[{"command":"bash \\"${CURSOR_PLUGIN_ROOT}/hooks/stop.sh\\""}]}}',
        "hooks/stop.sh": "exit 0",
        "rules/one.mdc": "rule",
        "rules/two.mdc": "rule",
        "assets/logo.png": new Uint8Array([0x89, 0x50]),
        ".lsp.json": "{}",
        "settings.json": "{}",
        "README.md": "readme",
        "LICENSE": "MIT",
      },
    });
    const outcome = read(files);
    // The hooks file is read (its one event is named as not run), so neither hooks/ nor the field is ignored.
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["hook-event-not-run"] });
    expect(accepted(outcome).ignored).toEqual([
      { kind: "assets", path: "assets/" },
      { kind: "rules", path: "rules/" },
      { kind: "lsp-servers", path: ".lsp.json" },
      { kind: "settings", path: "settings.json" },
      { kind: "rules", path: ".cursor-plugin/plugin.json#rules" },
      { kind: "logo", path: ".cursor-plugin/plugin.json#logo" },
      { kind: "min-client-versions", path: ".cursor-plugin/plugin.json#minClientVersions" },
    ]);
  });

  it("names hooks/ as a hook warning and keeps settings.json ignored for a plugin with only the open manifest", () => {
    const files = openPlugin({ files: { "hooks/hooks.json": '{"hooks":{}}', "settings.json": "{}" } });
    const outcome = read(files);
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["hooks-not-read"] });
    expect(accepted(outcome).hooks).toBeUndefined();
    expect(accepted(outcome).ignored).toEqual([{ kind: "settings", path: "settings.json" }]);
  });

  it("reads settings.json for a Claude plugin instead of ignoring it", () => {
    const files = claudePlugin({ settings: {} });
    expect(kindsOf(read(files))).toEqual({ errors: [], warnings: [] });
    expect(accepted(read(files)).ignored).toEqual([]);
  });
});
