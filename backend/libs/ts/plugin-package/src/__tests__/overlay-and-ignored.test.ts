/**
 * Pins the `ai.stigmer/` overlay (the three document shapes located and
 * handed over as bytes with the server check) and the ignored-component
 * record (directories and files on disk, manifest fields, deduplicated,
 * never per file, with hook scripts never read).
 */

import { describe, expect, it } from "vitest";

import { cursorPlugin, openPlugin } from "../testing.js";
import { accepted, kindsOf, read } from "../__test-utils__/read.js";

describe("the ai.stigmer/ overlay", () => {
  it("locates the agent, workflow and server documents and hands them over as bytes", () => {
    const files = openPlugin({
      mcpServers: { gh: { type: "streamable-http", url: "https://gh.example.com/mcp" } },
      files: {
        "ai.stigmer/agent.yaml": "kind: Agent\n",
        "ai.stigmer/workflows/triage.yaml": "kind: Workflow\n",
        "ai.stigmer/mcp-servers/gh.yaml": "spec:\n  auth: {}\n",
      },
    });
    const overlay = accepted(read(files)).overlay;
    expect(overlay.agent?.path).toBe("ai.stigmer/agent.yaml");
    expect(new TextDecoder().decode(overlay.agent?.bytes)).toBe("kind: Agent\n");
    expect(overlay.workflows.map((w) => [w.name, w.path])).toEqual([["triage", "ai.stigmer/workflows/triage.yaml"]]);
    expect(overlay.mcpServers.map((s) => [s.server, s.path])).toEqual([["gh", "ai.stigmer/mcp-servers/gh.yaml"]]);
  });

  it("is empty when the folder is absent", () => {
    expect(accepted(read(openPlugin())).overlay).toEqual({ workflows: [], mcpServers: [] });
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
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: [] });
    expect(accepted(outcome).ignored).toEqual([
      { kind: "assets", path: "assets/" },
      { kind: "hooks", path: "hooks/" },
      { kind: "rules", path: "rules/" },
      { kind: "lsp-servers", path: ".lsp.json" },
      { kind: "settings", path: "settings.json" },
      { kind: "hooks", path: ".cursor-plugin/plugin.json#hooks" },
      { kind: "rules", path: ".cursor-plugin/plugin.json#rules" },
      { kind: "logo", path: ".cursor-plugin/plugin.json#logo" },
      { kind: "min-client-versions", path: ".cursor-plugin/plugin.json#minClientVersions" },
    ]);
  });
});
