// Command-level contract for `stigmer mcp add <name> <url>`: the one-server
// plugin is built in memory and pushed exactly as prepared (the archive the
// backend receives is the one `prepareServerPlugin` makes from the same name,
// address and headers), into the context organization with --visibility and
// the command's own version message; the install renders from the server's
// answer, each server with how it is reached and the next steps (the keys to
// save, a login key left to the sign-in); --dry-run describes the plugin and
// pushes nothing; a malformed --header is refused before any push. Over a
// plugin already installed under the name: one it made is changed, keeping
// its visibility and description unless given again; one pushed from a
// folder is refused, naming what it holds, and nothing is pushed; --dry-run
// says which. A real
// Connect backend over h2c serves the push; the config file (HOME
// redirected) points a selfhost backend at it.

import { create } from "@bufbuild/protobuf";
import { type Plugin, PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../errors/index.js";
import { oneServerPluginDocuments } from "@stigmer/plugin-package";
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
  backend.installed = undefined;
  backend.installedFiles = new Map();
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
    const expected = await prepareServerPlugin({ name: "linear", url: URL, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } });
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

  describe("over a plugin already installed under the name", () => {
    const NEW_URL = "https://mcp.linear.app/v2/mcp";

    // A plugin `mcp add` (or the console's form) made: shared with the
    // organization, described, at the old address.
    function oneServerInstalled(status: { digest?: string; evals?: { dir: string } } = {}): void {
      const documents = oneServerPluginDocuments({ name: "linear", url: URL, description: "Linear's issues." });
      backend.installedFiles = documents;
      backend.installed = create(PluginSchema, {
        metadata: { id: "plg_1", slug: "linear", org: "acme", visibility: ApiResourceVisibility.visibility_org },
        spec: { name: "linear" },
        status: {
          digest: status.digest ?? "b".repeat(64),
          mcpServers: [{ name: "linear", transport: { case: "http", value: { url: URL, headers: {} } } }],
          ...(status.evals !== undefined && { evals: status.evals }),
        },
      });
    }

    it("changes a plugin it made, keeping its visibility and description", async () => {
      oneServerInstalled();
      const outcome = await runCli(["mcp", "add", "linear", NEW_URL, "--json"]);
      expect(outcome.message).toBe("");
      expect(backend.pushes).toHaveLength(1);
      const expected = await prepareServerPlugin({ name: "linear", url: NEW_URL, description: "Linear's issues." });
      expect(Buffer.from(backend.pushes[0]?.artifact ?? []).equals(Buffer.from(expected.archive))).toBe(true);
      expect(backend.pushes[0]?.visibility).toBe(ApiResourceVisibility.visibility_org);
      expect(backend.pushes[0]?.message).toBe("changed with stigmer mcp add");
    });

    it("takes a new description and visibility when given", async () => {
      oneServerInstalled();
      await runCli(["mcp", "add", "linear", NEW_URL, "--description", "Issues, v2.", "--visibility", "private", "--json"]);
      const expected = await prepareServerPlugin({ name: "linear", url: NEW_URL, description: "Issues, v2." });
      expect(Buffer.from(backend.pushes[0]?.artifact ?? []).equals(Buffer.from(expected.archive))).toBe(true);
      expect(backend.pushes[0]?.visibility).toBe(ApiResourceVisibility.visibility_private);
    });

    it("refuses a plugin pushed from a folder, naming what it holds, and pushes nothing", async () => {
      backend.installed = create(PluginSchema, {
        metadata: { id: "plg_2", slug: "linear", org: "acme" },
        spec: { name: "linear" },
        status: {
          digest: "c".repeat(64),
          skills: [{ name: "triage" }, { name: "plan" }],
          mcpServers: [{ name: "linear" }, { name: "github" }, { name: "local" }],
        },
      });
      backend.installedFiles = new Map([
        [".claude-plugin/plugin.json", "{}"],
        [".mcp.json", "{}"],
        ["skills/triage/SKILL.md", "# triage"],
      ]);
      const outcome = await runCli(["mcp", "add", "linear", NEW_URL]);
      expect(outcome.exitCode).toBe(ExitCode.Usage);
      expect(outcome.message).toContain("'linear' was pushed from a folder and holds 2 skills and 3 servers");
      expect(outcome.message).toContain("stigmer push plugin <folder>");
      expect(backend.pushes).toHaveLength(0);
    });

    it("refuses a two-file plugin whose manifest says more than one server's", async () => {
      oneServerInstalled();
      backend.installedFiles = new Map([
        [".claude-plugin/plugin.json", JSON.stringify({ name: "linear", version: "2.0.0" })],
        [".mcp.json", oneServerPluginDocuments({ name: "linear", url: URL }).get(".mcp.json") ?? ""],
      ]);
      const outcome = await runCli(["mcp", "add", "linear", NEW_URL]);
      expect(outcome.exitCode).toBe(ExitCode.Usage);
      expect(outcome.message).toContain("holds 1 server and other files");
      expect(backend.pushes).toHaveLength(0);
    });

    it("refuses a plugin with an eval suite, whose served files leave the suite out", async () => {
      oneServerInstalled({ evals: { dir: "evals" } });
      const outcome = await runCli(["mcp", "add", "linear", NEW_URL]);
      expect(outcome.exitCode).toBe(ExitCode.Usage);
      expect(outcome.message).toContain("holds 1 server and evals");
      expect(backend.pushes).toHaveLength(0);
    });

    it("--dry-run says it would change the plugin, or that nothing would change", async () => {
      oneServerInstalled();
      const changed = JSON.parse((await runCli(["mcp", "add", "linear", NEW_URL, "--dry-run", "--json"])).stdout);
      expect(changed.message).toBe(`Dry run: plugin 'linear' would change (${URL} → ${NEW_URL})`);
      const same = await prepareServerPlugin({ name: "linear", url: URL, description: "Linear's issues." });
      oneServerInstalled({ digest: same.digest });
      const unchanged = JSON.parse((await runCli(["mcp", "add", "linear", URL, "--dry-run", "--json"])).stdout);
      expect(unchanged.message).toBe("Dry run: plugin 'linear' already is this server; nothing would change");
      expect(backend.pushes).toHaveLength(0);
    });
  });
});
