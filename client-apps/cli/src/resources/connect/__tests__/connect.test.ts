// In-process test for `connect plugin` orchestration over an in-memory
// backend serving the plugin and vault controllers.
//
// Pins: the plugin resolves by slug in the caller's organization, or by id; the one
// server is used without --server, several are refused naming them, and an
// unknown --server or a plugin without servers is refused; the listing is
// the server's listTools with the plugin id, the server's name and the org,
// and nothing else is called; a server that takes a sign-in is listed
// without one when My vault holds a login at its normalized address (or, for
// a server that accepts a pasted key, its login key), and off a terminal it
// stops with the commands (a pasted key offered only where the server takes
// one), and on a terminal runs the browser sign-in, which first refuses a
// local console that does not answer; an address that names no login (a
// placeholder host) needs no sign-in; --dry-run lists from this machine (a
// stdio fixture) with no RPC, refuses a sign-in-only server, and turns an
// unset ${VAR} into the variable to export, or, for one the server does not
// read, a problem with the plugin. --sign-in-again runs the sign-in even
// when My vault holds a login, refuses a server that does not sign in and
// --dry-run, and off a terminal stops before signing in. A
// listing refused for its login is said in the server's words, ending with
// the command that signs in again. The renderer marks destructive tools, says
// where the list came from, shows an empty list, and says how each server is
// reached.

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { type Plugin, PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/command_pb";
import {
  type ListPluginToolsInput,
  ListPluginToolsOutputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import type { McpServerEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import {
  CompleteSignInOutputSchema,
  type StartSignInInput,
  StartSignInOutputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import { Stigmer } from "@stigmer/client";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { classify, CliExitError, ExitCode, UsageError } from "../../../errors/index.js";
import { type ConnectOptions, connectPlugin } from "../connect.js";
import { renderConnectResult } from "../display.js";

const FIXTURE = fileURLToPath(new URL("../__fixtures__/stdio-server.mjs", import.meta.url));

let listCalls: ListPluginToolsInput[] = [];
let listFailure: ConnectError | undefined;
let signInStarts: StartSignInInput[] = [];
let served: Plugin;
// The caller's My vault: undefined answers NOT_FOUND (none yet).
let myVault: { secrets: string[]; connections: string[] } | undefined;

type EntryInit = MessageInitShape<typeof McpServerEntrySchema>;

function http(name: string, url: string, extra: EntryInit = {}): EntryInit {
  return { name, transport: { case: "http", value: { url } }, ...extra };
}

function pluginWith(servers: readonly EntryInit[]): Plugin {
  return create(PluginSchema, {
    metadata: { id: "plg_1", slug: "linear", org: "acme" },
    status: { mcpServers: [...servers] },
  });
}

const client = new Stigmer({
  baseUrl: "/",
  getAccessToken: () => "t",
  customTransport: createRouterTransport(({ service }) => {
    service(PluginQueryController, {
      get: (id) => {
        if (id.value !== "plg_1") throw new ConnectError("no plugin", Code.NotFound);
        return served;
      },
      getByReference: (ref) => {
        if (ref.org !== "acme" || ref.slug !== "linear") throw new ConnectError("no plugin", Code.NotFound);
        return served;
      },
    });
    service(PluginCommandController, {
      listTools: (input) => {
        listCalls.push(input);
        if (listFailure !== undefined) throw listFailure;
        return create(ListPluginToolsOutputSchema, {
          tools: [
            { name: "list_issues", description: "List issues" },
            { name: "delete_issue", description: "Delete an issue", destructive: true },
          ],
        });
      },
    });
    service(VaultCommandController, {
      startSignIn: (input) => {
        signInStarts.push(input);
        return create(StartSignInOutputSchema, { authorizationUrl: "https://login.example/authorize", state: "st_1" });
      },
      completeSignIn: () => create(CompleteSignInOutputSchema, { address: "https://mcp.linear.app/mcp", description: "Linear @ana" }),
    });
    service(VaultQueryController, {
      getMine: () => {
        if (myVault === undefined) throw new ConnectError("no My vault", Code.NotFound);
        const vault = myVault;
        return create(VaultSchema, {
          spec: {
            secrets: Object.fromEntries(vault.secrets.map((key) => [key, {}])),
            connections: Object.fromEntries(vault.connections.map((address) => [address, {}])),
          },
        });
      },
    });
  }),
});

function options(overrides: Partial<ConnectOptions> = {}): ConnectOptions {
  return {
    reference: "linear",
    org: "acme",
    timeoutMs: 10_000,
    dryRun: false,
    consoleURL: "https://app.stigmer.ai",
    probeLocalConsole: false,
    interactive: false,
    ...overrides,
  };
}

beforeEach(() => {
  listCalls = [];
  listFailure = undefined;
  signInStarts = [];
  myVault = undefined;
  served = pluginWith([http("linear", "https://mcp.linear.app/mcp")]);
});

describe("connectPlugin: choosing the server", () => {
  it("lists the plugin's only server through listTools, naming the plugin, the server and the org", async () => {
    const result = await connectPlugin(client, options());
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]).toMatchObject({ pluginId: "plg_1", server: "linear", org: "acme" });
    expect(result.tools.map((tool) => tool.name)).toEqual(["list_issues", "delete_issue"]);
    expect(result.dryRun).toBe(false);
  });

  it("refuses a plugin with several servers until --server names one, then lists that one", async () => {
    served = pluginWith([http("issues", "https://a.example/mcp"), http("docs", "https://b.example/mcp")]);
    const err = await connectPlugin(client, options()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(String((err as Error).message)).toContain("carries 2 MCP servers: issues, docs");
    expect(String((err as Error).message)).toContain("stigmer connect plugin linear --server <name>");
    expect(listCalls).toHaveLength(0);

    await connectPlugin(client, options({ server: "docs" }));
    expect(listCalls[0]?.server).toBe("docs");
  });

  it("resolves a plugin named by its id", async () => {
    const result = await connectPlugin(client, options({ reference: "plg_1" }));
    expect(result.plugin.metadata?.id).toBe("plg_1");
    expect(listCalls[0]?.pluginId).toBe("plg_1");
  });

  it("refuses an unknown --server and a plugin with no server", async () => {
    await expect(connectPlugin(client, options({ server: "nope" }))).rejects.toThrow(
      "plugin 'linear' has no MCP server 'nope'; its servers are: linear",
    );
    served = pluginWith([]);
    await expect(connectPlugin(client, options())).rejects.toThrow("carries no MCP server");
  });
});

describe("connectPlugin: a server that takes a sign-in", () => {
  const signInOnly = () =>
    pluginWith([http("linear", "https://MCP.Linear.app:443/mcp/", { signIn: { oauthOnly: true } })]);
  const keyOrSignIn = () =>
    pluginWith([
      {
        name: "linear",
        transport: {
          case: "http",
          value: { url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } },
        },
        signIn: { oauthOnly: false },
      },
    ]);

  it("lists without a sign-in when My vault holds a login at the server's normalized address", async () => {
    served = signInOnly();
    myVault = { secrets: [], connections: ["https://mcp.linear.app/mcp"] };
    await connectPlugin(client, options());
    expect(listCalls).toHaveLength(1);
  });

  it("stops off a terminal with the interactive way only, for a sign-in-only server", async () => {
    served = signInOnly();
    const err = await connectPlugin(client, options()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(String((err as Error).message)).toContain("needs a sign-in, which needs an interactive terminal");
    expect(String((err as Error).message)).not.toContain("set-secret");
    expect(listCalls).toHaveLength(0);
  });

  it("offers the pasted key where the server accepts one, and lists once it is saved", async () => {
    served = keyOrSignIn();
    const err = await connectPlugin(client, options()).catch((e: unknown) => e);
    expect(String((err as Error).message)).toContain(
      "stigmer vault set-secret LINEAR_TOKEN --mine, then run stigmer connect plugin linear",
    );
    myVault = { secrets: ["LINEAR_TOKEN"], connections: [] };
    await connectPlugin(client, options());
    expect(listCalls).toHaveLength(1);
  });
});

describe("connectPlugin: a sign-in on a terminal", () => {
  it("runs the browser sign-in, which refuses a local console that does not answer, before any listing", async () => {
    served = pluginWith([http("linear", "https://mcp.linear.app/mcp", { signIn: { oauthOnly: true } })]);
    const err = await connectPlugin(
      client,
      options({ interactive: true, probeLocalConsole: true, consoleURL: "http://127.0.0.1:1" }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(String((err as Error).message)).toContain(
      "Signing in to 'linear' returns to the web console, which is not running for this local backend",
    );
    expect(listCalls).toHaveLength(0);
  });

  it("lists without a sign-in when the address names no login (a placeholder host)", async () => {
    served = pluginWith([http("linear", "https://${HOST}/mcp", { signIn: { oauthOnly: true } })]);
    await connectPlugin(client, options());
    expect(listCalls).toHaveLength(1);
  });
});

describe("connectPlugin --sign-in-again", () => {
  const signedIn = () => {
    served = pluginWith([http("linear", "https://mcp.linear.app/mcp", { signIn: { oauthOnly: true } })]);
    myVault = { secrets: [], connections: ["https://mcp.linear.app/mcp"] };
  };

  it("signs in although My vault holds a login at the address, then lists", async () => {
    signedIn();
    const browser = process.env.BROWSER;
    process.env.BROWSER = "true";
    try {
      await connectPlugin(client, options({ signInAgain: true, interactive: true }));
    } finally {
      if (browser === undefined) delete process.env.BROWSER;
      else process.env.BROWSER = browser;
    }
    expect(signInStarts).toHaveLength(1);
    expect(signInStarts[0]?.address).toBe("https://mcp.linear.app/mcp");
    expect(signInStarts[0]?.vault?.vault).toEqual({ case: "mine", value: true });
    expect(listCalls).toHaveLength(1);
  }, 10_000);

  it("off a terminal, stops with the interactive way before any sign-in or listing", async () => {
    signedIn();
    const err = await connectPlugin(client, options({ signInAgain: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(String((err as Error).message)).toContain("needs a sign-in, which needs an interactive terminal");
    expect(signInStarts).toHaveLength(0);
    expect(listCalls).toHaveLength(0);
  });

  it("refuses a server whose address names no place a login is saved at", async () => {
    served = pluginWith([http("linear", "https://${LINEAR_HOST}/mcp", { signIn: {} })]);
    const err = await connectPlugin(client, options({ signInAgain: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(String((err as Error).message)).toContain("names no address a login is saved at");
    expect(signInStarts).toHaveLength(0);
  });

  it("refuses a server that does not sign in, and --dry-run", async () => {
    const plain = await connectPlugin(client, options({ signInAgain: true })).catch((e: unknown) => e);
    expect(String((plain as Error).message)).toContain("does not sign in, so there is no login to replace");
    const dry = await connectPlugin(client, options({ signInAgain: true, dryRun: true })).catch((e: unknown) => e);
    expect(String((dry as Error).message)).toContain("--sign-in-again signs in through the server");
    expect(listCalls).toHaveLength(0);
  });
});

describe("connectPlugin: a listing refused for its login", () => {
  const REFUSED =
    "listing the tools of linear failed: 401 Unauthorized. Check that the server's address is reachable and your sign-in or key is valid";

  it("says the server's words and ends with the command that signs in again", async () => {
    served = pluginWith([http("linear", "https://mcp.linear.app/mcp", { signIn: { oauthOnly: true } })]);
    myVault = { secrets: [], connections: ["https://mcp.linear.app/mcp"] };
    listFailure = new ConnectError(REFUSED, Code.Internal);
    const err = await connectPlugin(client, options()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliExitError);
    expect((err as CliExitError).message).toBe(REFUSED);
    expect((err as CliExitError).hints).toEqual([
      "If your login has expired or was revoked, run stigmer connect plugin linear --sign-in-again.",
    ]);
  });

  it("keeps the exit code and words the CLI gives that refusal's status, adding the command that signs in again", async () => {
    served = pluginWith([http("linear", "https://mcp.linear.app/mcp", { signIn: { oauthOnly: true } })]);
    myVault = { secrets: [], connections: ["https://mcp.linear.app/mcp"] };
    listFailure = new ConnectError(REFUSED, Code.FailedPrecondition);
    const err = await connectPlugin(client, options()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliExitError);
    const own = classify((err as CliExitError).cause);
    expect(own?.exitCode).toBe(ExitCode.Usage);
    expect((err as CliExitError).exitCode).toBe(own?.exitCode);
    expect((err as CliExitError).message).toBe(own?.message);
    expect((err as CliExitError).message).toContain(REFUSED);
    expect((err as CliExitError).hints?.at(-1)).toBe(
      "If your login has expired or was revoked, run stigmer connect plugin linear --sign-in-again.",
    );
  });

  it("matches the runner's sign-in challenge too, and leaves a server that does not sign in alone", async () => {
    served = pluginWith([http("linear", "https://mcp.linear.app/mcp", { signIn: { oauthOnly: true } })]);
    myVault = { secrets: [], connections: ["https://mcp.linear.app/mcp"] };
    listFailure = new ConnectError("MCP server 'linear' requires OAuth: its endpoint returned an authentication challenge (HTTP 401).", Code.Internal);
    expect(await connectPlugin(client, options()).catch((e: unknown) => e)).toBeInstanceOf(CliExitError);

    served = pluginWith([http("linear", "https://mcp.linear.app/mcp")]);
    listFailure = new ConnectError(REFUSED, Code.Internal);
    expect(await connectPlugin(client, options()).catch((e: unknown) => e)).not.toBeInstanceOf(CliExitError);
  });
});

describe("connectPlugin --dry-run", () => {
  it("lists a local program's tools from this machine, calling no RPC", async () => {
    served = pluginWith([
      { name: "local", transport: { case: "stdio", value: { command: process.execPath, args: [FIXTURE] } } },
    ]);
    const result = await connectPlugin(client, options({ dryRun: true }));
    expect(result.dryRun).toBe(true);
    expect(result.tools.map((tool) => [tool.name, tool.destructive])).toEqual([
      ["echo", false],
      ["noop", true],
    ]);
    expect(listCalls).toHaveLength(0);
  }, 15_000);

  it("names the variable to export when a ${VAR} the server reads is unset", async () => {
    const original = process.env;
    process.env = { ...original };
    delete process.env.CONNECT_TEST_DIR;
    try {
      served = pluginWith([
        {
          name: "local",
          transport: { case: "stdio", value: { command: process.execPath, args: [FIXTURE, "${CONNECT_TEST_DIR}"] } },
          env: ["CONNECT_TEST_DIR"],
        },
      ]);
      await expect(connectPlugin(client, options({ dryRun: true }))).rejects.toThrow(
        "MCP server 'local' of plugin 'linear' needs CONNECT_TEST_DIR, but it is not set.\nExport it in your shell before running --dry-run.",
      );

      served = pluginWith([
        {
          name: "local",
          transport: { case: "stdio", value: { command: process.execPath, args: [FIXTURE, "${CONNECT_TEST_DIR}"] } },
        },
      ]);
      await expect(connectPlugin(client, options({ dryRun: true }))).rejects.toThrow(
        "MCP server 'local' of plugin 'linear' references ${CONNECT_TEST_DIR} in its stdio arg[1] but does not read CONNECT_TEST_DIR.",
      );
    } finally {
      process.env = original;
    }
  });

  it("refuses a sign-in-only server, whose token never leaves the server", async () => {
    served = pluginWith([http("linear", "https://mcp.linear.app/mcp", { signIn: { oauthOnly: true } })]);
    await expect(connectPlugin(client, options({ dryRun: true }))).rejects.toThrow(
      /accepts only a sign-in, so --dry-run cannot list it/,
    );
  });
});

describe("renderConnectResult", () => {
  it("marks destructive tools and says where the list came from", async () => {
    const result = await connectPlugin(client, options());
    const lines: string[] = [];
    renderConnectResult(result, (line) => lines.push(line), false, "acme");
    const text = lines.join("\n");
    expect(text).toContain("Plugin:     acme/linear");
    expect(text).toContain("MCP server: linear (http: https://mcp.linear.app/mcp)");
    expect(text).toMatch(/delete_issue\s+\[destructive\] Delete an issue/);
    expect(text).toMatch(/list_issues\s+List issues/);
    expect(text).toContain("Listed as you; nothing stored");

    lines.length = 0;
    renderConnectResult({ ...result, dryRun: true }, (line) => lines.push(line), false);
    expect(lines.join("\n")).toContain("Dry run: listed from this machine; nothing stored");
  });

  it("shows an empty list, a local program's command line, and a server with no transport", () => {
    const plugin = pluginWith([
      { name: "local", transport: { case: "stdio", value: { command: "npx", args: ["-y", "linear-mcp"] } } },
      { name: "bare" },
    ]);
    const [local, bare] = plugin.status?.mcpServers ?? [];
    const lines: string[] = [];
    renderConnectResult({ plugin, server: local, tools: [], dryRun: true }, (line) => lines.push(line), false);
    expect(lines).toContain("MCP server: local (stdio: npx -y linear-mcp)");
    expect(lines).toContain("Tools (0):");
    expect(lines).toContain("  (none)");

    lines.length = 0;
    renderConnectResult({ plugin, server: bare, tools: [], dryRun: true }, (line) => lines.push(line), false);
    expect(lines).toContain("MCP server: bare (unknown)");
  });
});
