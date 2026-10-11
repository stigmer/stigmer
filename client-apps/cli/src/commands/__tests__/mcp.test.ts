// Command-level contract for `stigmer mcp add <name> <url>`: the one-server
// plugin is built in memory and pushed exactly as prepared (the archive the
// backend receives is the one `prepareServerPlugin` makes from the same name,
// address and headers), into the context organization with --visibility and
// the command's own version message; the install renders from the server's
// answer, each server with how it is reached and the next steps (the keys to
// save, a login key left to the sign-in); --dry-run describes the plugin and
// pushes nothing; a malformed --header is refused before any push. A real
// Connect backend over h2c serves the push; the config file (HOME
// redirected) points a selfhost backend at it.

import { create } from "@bufbuild/protobuf";
import { type Plugin, PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../errors/index.js";
import { prepareServerPlugin } from "../../resources/mcp/add.js";
import { type PluginBackend, runCli, startPluginBackend, type TestHome, useTestHome } from "../__test-utils__/plugin-backend.js";

const URL = "https://mcp.linear.app/mcp";
const HEADER = "Authorization=Bearer ${LINEAR_TOKEN}";

// The server's answer: a signing-in address whose login key is the header's,
// a local program, a server with no transport, and one key with no value.
function installed(): Plugin {
  return create(PluginSchema, {
    metadata: { id: "plg_1", slug: "linear", org: "acme" },
    spec: { name: "linear" },
    status: {
      digest: "a".repeat(64),
      mcpServers: [
        {
          name: "linear",
          transport: { case: "http", value: { url: URL, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } } },
          signIn: { oauthOnly: false },
        },
        { name: "local", transport: { case: "stdio", value: { command: "npx", args: ["linear-mcp"] } } },
        { name: "bare" },
      ],
      env: { LINEAR_TOKEN: {}, WORKSPACE_ID: {} },
    },
  });
}

let backend: PluginBackend;
let home: TestHome;

beforeAll(async () => {
  backend = await startPluginBackend(installed());
});

afterAll(async () => {
  await backend.close();
});

beforeEach(() => {
  backend.pushes.length = 0;
  home = useTestHome(backend.port);
});

afterEach(() => {
  home.restore();
});

interface Section {
  readonly title: string;
  readonly fields?: readonly { key: string; value: string }[];
  readonly items?: readonly string[];
}

function section(payload: { sections: readonly Section[] }, title: string): Section | undefined {
  return payload.sections.find((s) => s.title === title);
}

describe("stigmer mcp add", () => {
  it("pushes the one-server plugin as prepared, with --visibility and the command's message, and renders the install", async () => {
    const outcome = await runCli(["mcp", "add", "linear", URL, "--header", HEADER, "--visibility", "org", "--json"]);
    expect(outcome.message).toBe("");
    expect(outcome.exitCode).toBe(ExitCode.Success);

    expect(backend.pushes).toHaveLength(1);
    const pushed = backend.pushes[0];
    const expected = await prepareServerPlugin("linear", URL, { Authorization: "Bearer ${LINEAR_TOKEN}" });
    expect(Buffer.from(pushed?.artifact ?? []).equals(Buffer.from(expected.archive))).toBe(true);
    expect(pushed?.org).toBe("acme");
    expect(pushed?.message).toBe("added with stigmer mcp add");
    expect(pushed?.visibility).toBe(ApiResourceVisibility.visibility_org);

    const payload = JSON.parse(outcome.stdout);
    expect(section(payload, "Installed")?.fields).toContainEqual({
      key: "MCP servers",
      value: "linear (http), local (stdio), bare (unknown)",
    });
    expect(section(payload, "Next")?.items).toEqual([
      "Sign in to linear:  stigmer connect plugin linear --server linear",
      "Save WORKSPACE_ID in your vault:  stigmer vault set-secret WORKSPACE_ID --mine",
      "Use it in a conversation:  stigmer run --plugin linear",
      "Give it to an agent: add '- slug: linear' under spec.plugins in the agent's YAML, or from the plugin's page in the console",
    ]);
    expect(payload.data.next).toContainEqual({
      kind: "save-keys",
      variables: ["WORKSPACE_ID"],
      command: "stigmer vault set-secret WORKSPACE_ID --mine",
    });
  });

  it("--dry-run describes the plugin that would install and pushes nothing", async () => {
    const outcome = await runCli(["mcp", "add", "linear", URL, "--dry-run", "--json"]);
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(backend.pushes).toHaveLength(0);
    const payload = JSON.parse(outcome.stdout);
    expect(payload.message).toBe("Dry run: plugin 'linear' would install");
    expect(payload.data.plugin.name).toBe("linear");
  });

  it("refuses a --header with no name before any push", async () => {
    const outcome = await runCli(["mcp", "add", "linear", URL, "--header", "=x"]);
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toContain("invalid --header: expected NAME=VALUE");
    expect(backend.pushes).toHaveLength(0);
  });
});
