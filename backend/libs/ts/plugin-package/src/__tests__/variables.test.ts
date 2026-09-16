/**
 * Pins variable normalisation: Cursor variables are secrets with `required`
 * deciding `optional`, Claude `userConfig` carries `sensitive` and
 * `required`, titles and descriptions are joined, the unsupported Claude
 * attributes warn once each, an undeclared reference is declared as a
 * required secret with a warning naming the server, and a declared
 * variable no server uses is warned.
 */

import { describe, expect, it } from "vitest";

import { claudePlugin, cursorPlugin } from "../testing.js";
import { accepted, findingOf, kindsOf, read } from "../__test-utils__/read.js";

describe("Cursor variables", () => {
  it("declares every property as a secret, optional unless required", () => {
    const plugin = accepted(
      read(
        cursorPlugin({
          variables: {
            TOKEN: { type: "string", title: "Token", description: "A personal access token." },
            REGION: { type: "string", title: "Region" },
          },
          required: ["TOKEN"],
          mcpServers: { s: { type: "http", url: "https://x.example.com/mcp", headers: { A: "${TOKEN}", B: "${REGION}" } } },
        }),
      ),
    );
    expect(plugin.variables).toEqual([
      { name: "TOKEN", description: "Token: A personal access token.", isSecret: true, optional: false, declaredBy: "cursor" },
      { name: "REGION", description: "Region", isSecret: true, optional: true, declaredBy: "cursor" },
    ]);
  });
});

describe("Claude userConfig", () => {
  it("carries sensitive and required, and warns once per unsupported attribute", () => {
    const outcome = read(
      claudePlugin({
        userConfig: {
          API_KEY: { type: "string", title: "API key", sensitive: true, required: true },
          MODE: { type: "string", default: "fast", options: ["fast", "slow"] },
          DIR: { type: "directory", description: "Where to write" },
          COUNT: { type: "number", min: 1, max: 5, multiple: true },
        },
        mcpServers: {
          s: { command: "npx", args: ["x", "${MODE}", "${DIR}", "${COUNT}"], env: { API_KEY: "${API_KEY}" } },
        },
      }),
    );
    expect(kindsOf(outcome).warnings).toEqual([
      "variable-default-dropped",
      "variable-option-dropped",
      "variable-option-dropped",
      "variable-option-dropped",
      "variable-option-dropped",
      "variable-type-narrowed",
      "variable-type-narrowed",
    ]);
    expect(accepted(outcome).variables).toEqual([
      { name: "API_KEY", description: "API key", isSecret: true, optional: false, declaredBy: "claude" },
      { name: "MODE", isSecret: false, optional: true, declaredBy: "claude" },
      { name: "DIR", description: "Where to write", isSecret: false, optional: true, declaredBy: "claude" },
      { name: "COUNT", isSecret: false, optional: true, declaredBy: "claude" },
    ]);
  });
});

describe("reconciliation with references", () => {
  it("declares an undeclared reference as a required secret and names the server", () => {
    const outcome = read(cursorPlugin({ mcpServers: { gh: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } } } }));
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["variable-inferred"] });
    expect(findingOf(outcome.warnings, "variable-inferred")).toMatchObject({ subject: "GITHUB_TOKEN", detail: "gh" });
    expect(accepted(outcome).variables).toEqual([{ name: "GITHUB_TOKEN", isSecret: true, optional: false, declaredBy: "inferred" }]);
  });

  it("warns on a declared variable no server references", () => {
    const outcome = read(cursorPlugin({ variables: { UNUSED: { type: "string" } } }));
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["variable-unreferenced"] });
    expect(accepted(outcome).variables[0]?.name).toBe("UNUSED");
  });

  it("lists declared variables first in declaration order, then inferred ones sorted", () => {
    const plugin = accepted(
      read(
        cursorPlugin({
          variables: { Z: { type: "string" }, A: { type: "string" } },
          mcpServers: { s: { type: "http", url: "https://x.example.com/mcp", headers: { h: "${Z} ${A} ${M} ${B}" } } },
        }),
      ),
    );
    expect(plugin.variables.map((v) => v.name)).toEqual(["Z", "A", "B", "M"]);
  });
});
