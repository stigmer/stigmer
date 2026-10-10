// Local tool discovery for `connect plugin --dry-run`.
//
// Starts or reaches one of a plugin's MCP servers from the caller's machine
// (no runner, nothing stored) with the official @modelcontextprotocol/sdk
// client, lists its tools, and converts them to the PluginTool proto a
// runner's listing answers, so a dry run and a real connect print the same
// way. A tool is destructive when the server marks it so
// (`annotations.destructiveHint`), as the server's own listing reads it.
//
// A local program inherits the caller's shell environment, and ${VAR}
// placeholders in its arguments and an address's headers resolve from the
// variables the server reads (its entry's `env`): the shell's value, else
// the plugin's declared default. Keys never leave the local machine.

import { create } from "@bufbuild/protobuf";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { type PluginTool, PluginToolSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { resolveHeaders, resolvePlaceholders } from "../mcp/placeholder-resolver.js";

/** List a plugin server's tools from this machine, storing nothing. */
export async function localDiscover(
  server: McpServerEntry,
  declarations: Readonly<Record<string, EnvVarDeclaration>>,
  timeoutMs: number,
): Promise<PluginTool[]> {
  const { transport, readStderr } = await buildTransport(server, declarations);
  const client = new Client({ name: "stigmer-cli", version: "1.0.0" });
  const options = timeoutMs > 0 ? { timeout: timeoutMs } : undefined;

  try {
    await client.connect(transport, options);
  } catch (error) {
    // Append captured subprocess stderr so config/toolchain failures are
    // diagnosable without dumping raw output.
    const stderr = readStderr();
    const detail = stderr !== "" ? `\nsubprocess stderr:\n${stderr}` : "";
    throw new Error(`failed to connect to MCP server '${server.name}': ${(error as Error).message}${detail}`);
  }

  try {
    const { tools } = await client.listTools(undefined, options);
    return tools.map((tool) =>
      create(PluginToolSchema, {
        name: tool.name,
        description: tool.description ?? "",
        destructive: tool.annotations?.destructiveHint === true,
      }),
    );
  } finally {
    await client.close();
  }
}

interface BuiltTransport {
  readonly transport: Transport;
  /** Returns subprocess stderr captured so far (stdio only; "" otherwise). */
  readStderr(): string;
}

async function buildTransport(
  server: McpServerEntry,
  declarations: Readonly<Record<string, EnvVarDeclaration>>,
): Promise<BuiltTransport> {
  // ${VAR} placeholders resolve against the variables the server reads.
  // Resolution is strict: an unresolved placeholder throws before any
  // subprocess is spawned (never pass a literal "${VAR}" to the server).
  const resolutionEnv = serverValues(server.env, declarations);
  const transport = server.transport;

  switch (transport.case) {
    case "stdio": {
      const { command, args } = transport.value;
      if (command === "") throw new Error(`MCP server '${server.name}' names no program to run`);
      const resolvedArgs = args.map((arg, i) => resolvePlaceholders(arg, resolutionEnv, `stdio arg[${i}]`));
      const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
      const stdio = new StdioClientTransport({
        command,
        args: resolvedArgs,
        env: { ...shellEnv(), ...goRunEnvOverrides(command, args) },
        // "pipe" exposes the child stderr as a PassThrough immediately, so we can
        // capture diagnostics rather than leaking them to the user's terminal.
        stderr: "pipe",
      });
      let captured = "";
      stdio.stderr?.on("data", (chunk: Buffer) => {
        captured += chunk.toString("utf8");
      });
      return { transport: stdio, readStderr: () => captured.trim() };
    }
    case "http": {
      const { url, headers } = transport.value;
      if (url === "") throw new Error(`MCP server '${server.name}' names no address`);
      const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      const resolvedHeaders = Object.keys(headers).length > 0 ? resolveHeaders(headers, resolutionEnv) : undefined;
      const http = new StreamableHTTPClientTransport(
        new URL(url),
        resolvedHeaders ? { requestInit: { headers: resolvedHeaders } } : undefined,
      );
      return { transport: http, readStderr: () => "" };
    }
    case undefined:
      throw new Error(`MCP server '${server.name}' has no transport (expected a program or an address)`);
    default: {
      const exhaustive: never = transport;
      return exhaustive;
    }
  }
}

// Go-toolchain overrides for `go run <module>@<version>` stdio commands so a
// freshly-tagged version is usable before sum.golang.org indexes it. Safe: the
// command comes from the plugin's own configuration.
// Exported for its unit test: discovery never spawns `go` in the suite.
export function goRunEnvOverrides(command: string, args: readonly string[]): Record<string, string> {
  if (command !== "go" || args.length < 2 || args[0] !== "run") return {};
  const pkg = args[1].split("@")[0];
  const parts = pkg.split("/");
  if (parts.length < 3) return {};
  const prefix = `${parts[0]}/${parts[1]}/${parts[2]}/*`;
  return { GONOSUMDB: prefix, GONOSUMCHECK: prefix };
}

// The values for the variables a server reads: the caller's shell value, else
// the plugin's declared default, non-empty only.
function serverValues(
  names: readonly string[],
  declarations: Readonly<Record<string, EnvVarDeclaration>>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name] ?? "";
    const fallback = declarations[name]?.value ?? "";
    if (value !== "") values[name] = value;
    else if (fallback !== "") values[name] = fallback;
  }
  return values;
}

// The caller's shell environment as a plain map for the stdio subprocess.
function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}
