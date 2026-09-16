// Command-level contract for `validate`. Drives the real commander program
// against temp files and asserts the classified exit code and, for the plugin
// route, the rendered output. The contract: 0 = valid (a plugin with warnings
// is still 0), 2 = invalid input (bad path, bad YAML, unknown kind, schema
// failure, a plugin the reader refuses), 1 = unexpected. This is a
// deliberate, documented refinement over the Go CLI, which returned a
// generic exit 1 for all validate failures. The YAML cases are unchanged by
// the plugin route and pin that it stays out of their way.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { classify, ExitCode } from "../errors/index.js";
import { buildProgram } from "../program.js";

let dir: string;
let plugin: string;
let brokenPlugin: string;

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "stigmer-validate-"));
  writeFileSync(
    join(dir, "valid.yaml"),
    [
      "apiVersion: agentic.stigmer.ai/v1",
      "kind: Agent",
      "metadata:",
      "  name: Reviewer",
      "  slug: reviewer",
      "  org: acme",
      "spec:",
      "  description: reviews code",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "bad-schema.yaml"), ["kind: Agent", "metadata: not-an-object", ""].join("\n"));
  writeFileSync(join(dir, "unknown.yaml"), ["kind: Banana", "metadata:", "  name: x", ""].join("\n"));

  // A Cursor plugin with a header token the manifest does not declare: valid,
  // with one warning, and an ai.stigmer/ document that must not be validated
  // as a loose resource.
  plugin = mkdtempSync(join(tmpdir(), "stigmer-validate-plugin-"));
  write(plugin, ".cursor-plugin/plugin.json", JSON.stringify({ name: "github", version: "1.0.0", mcpServers: "./mcp.json", logo: "assets/logo.svg" }));
  write(plugin, "mcp.json", JSON.stringify({ mcpServers: { github: { type: "http", url: "https://api.example.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } } } }));
  write(plugin, "ai.stigmer/agent.yaml", "not: a valid resource document\n");
  write(plugin, "assets/logo.svg", "<svg/>");

  // The same plugin with the URL made a variable: the one refusal.
  brokenPlugin = mkdtempSync(join(tmpdir(), "stigmer-validate-broken-"));
  write(brokenPlugin, ".cursor-plugin/plugin.json", JSON.stringify({ name: "Broken Name", mcpServers: "./mcp.json" }));
  write(brokenPlugin, "mcp.json", JSON.stringify({ mcpServers: { crm: { type: "http", url: "${CRM_URL}", auth: { scopes: ["a"] } } } }));
});

afterAll(() => {
  for (const path of [dir, plugin, brokenPlugin]) rmSync(path, { recursive: true, force: true });
});

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: unknown;
}

// Runs `validate <args>` with output captured, returning the classified exit
// code (0 on success) and what reached each stream.
async function runValidate(...args: string[]): Promise<Run> {
  const program = buildProgram();
  program.exitOverride();
  let stdout = "";
  let stderr = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    await program.parseAsync(["node", "stigmer", "validate", ...args]);
    return { exitCode: ExitCode.Success, stdout, stderr, error: undefined };
  } catch (err) {
    return { exitCode: classify(err)?.exitCode ?? -1, stdout, stderr, error: err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe("validate exit codes (YAML)", () => {
  it("exits 0 for a valid resource", async () => {
    expect((await runValidate("-f", join(dir, "valid.yaml"))).exitCode).toBe(ExitCode.Success);
  });

  it("fails the batch when a directory holds an invalid file", async () => {
    expect((await runValidate("-f", dir)).exitCode).not.toBe(ExitCode.Success);
  });

  it("exits 2 for a schema-invalid resource", async () => {
    expect((await runValidate("-f", join(dir, "bad-schema.yaml"))).exitCode).toBe(ExitCode.Usage);
  });

  it("exits 2 for an unknown resource kind", async () => {
    expect((await runValidate("-f", join(dir, "unknown.yaml"))).exitCode).toBe(ExitCode.Usage);
  });

  it("exits 2 for a path that does not exist", async () => {
    expect((await runValidate("-f", join(dir, "missing.yaml"))).exitCode).toBe(ExitCode.Usage);
  });
});

describe("validate on a plugin directory", () => {
  it("accepts the plugin with a warning status, exit 0, everything on stderr", async () => {
    const run = await runValidate("-f", plugin);
    expect(run.exitCode).toBe(ExitCode.Success);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("Plugin 'github' is valid with 1 warning");
    expect(run.stderr).toContain("Cursor plugin");
    // Section keys are padded to the widest key, so match key and value loosely.
    expect(run.stderr).toMatch(/MCP servers\s+1: github \(http\)/);
    expect(run.stderr).toMatch(/Variables\s+1: GITHUB_TOKEN \(inferred\)/);
    expect(run.stderr).toMatch(/Files\s+4 read, 0 excluded by ignore rules/);
    expect(run.stderr).toMatch(/Stigmer overlay\s+agent/);
    expect(run.stderr).toContain("variable 'GITHUB_TOKEN' is referenced by MCP server 'github' but not declared");
    expect(run.stderr).toContain("- logo (.cursor-plugin/plugin.json#logo)");
  });

  it("emits the normalised package as JSON data on stdout with --json", async () => {
    const run = await runValidate("-f", plugin, "--json");
    expect(run.exitCode).toBe(ExitCode.Success);
    expect(run.stderr).toBe("");
    const parsed = JSON.parse(run.stdout);
    expect(parsed.status).toBe("warning");
    expect(parsed.data.plugin).toMatchObject({
      name: "github",
      dialect: "cursor",
      mcpServers: [{ name: "github", transport: "http", env: ["GITHUB_TOKEN"] }],
      variables: [{ name: "GITHUB_TOKEN", isSecret: true, optional: false, declaredBy: "inferred" }],
      overlay: { agent: "ai.stigmer/agent.yaml", workflows: [], mcpServers: [] },
    });
    expect(parsed.data.warnings.map((w: { kind: string }) => w.kind)).toEqual(["variable-inferred"]);
  });

  it("prints only the status line with --quiet", async () => {
    const run = await runValidate("-f", plugin, "--quiet");
    expect(run.stderr.trim()).toBe("⚠ Plugin 'github' is valid with 1 warning");
  });

  it("refuses with exit 2 and every problem's sentence", async () => {
    const run = await runValidate("-f", brokenPlugin);
    expect(run.exitCode).toBe(ExitCode.Usage);
    const message = (run.error as Error).message;
    expect(message).toContain("plugin cannot be installed, 2 problems found:");
    expect(message).toContain("plugin name 'Broken Name' in '.cursor-plugin/plugin.json' is invalid");
    expect(message).toContain("MCP server 'crm' in 'mcp.json' has a variable in its 'url'");
    // Warnings ride along under the refusal so one run says everything.
    expect(message).toContain("and 1 warning:");
    expect(message).toContain("MCP server 'crm' in 'mcp.json' has an 'auth' block Stigmer does not read");
  });
});
