// Local MCP capability discovery for `connect mcp-server --dry-run`.
//
// Spawns/connects to the MCP server from the caller's machine (no backend push)
// using the official @modelcontextprotocol/sdk client, lists its tools and
// resource templates, and converts them to the same DiscoveredCapabilities proto
// the backend returns — so dry-run and real connect render identically. Mirrors
// Go's mcpdiscovery.Discover + CreateTransport (internal/cli/mcpdiscovery).
//
// stdio servers inherit process.env merged with --env overrides (override wins),
// so credentials never leave the local machine. HTTP servers connect to the
// configured URL with the server's static headers.

import { create } from "@bufbuild/protobuf";
import type { McpServerSpec } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  type DiscoveredCapabilities,
  DiscoveredCapabilitiesSchema,
  DiscoveredResourceTemplateSchema,
  DiscoveredToolSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { mergeProcessEnv, resolveDeclaredEnvValues } from "../mcp/runtime-env.js";
import { resolveHeaders, resolvePlaceholders } from "../mcp/placeholder-resolver.js";

/** Discover an MCP server's capabilities locally without persisting to the backend. */
export async function localDiscover(
  spec: McpServerSpec,
  envOverrides: readonly string[],
  timeoutMs: number,
): Promise<DiscoveredCapabilities> {
  const { transport, readStderr } = await buildTransport(spec, envOverrides);
  const client = new Client({ name: "stigmer-cli", version: "1.0.0" });
  const options = timeoutMs > 0 ? { timeout: timeoutMs } : undefined;

  try {
    await client.connect(transport, options);
  } catch (error) {
    // Append captured subprocess stderr so config/toolchain failures are
    // diagnosable, mirroring Go's withStderr — without dumping raw output.
    const stderr = readStderr();
    const detail = stderr !== "" ? `\nsubprocess stderr:\n${stderr}` : "";
    throw new Error(`failed to connect to MCP server: ${(error as Error).message}${detail}`);
  }

  try {
    const { tools } = await client.listTools(undefined, options);
    const resourceTemplates = (await client.getServerCapabilities())?.resources
      ? (await client.listResourceTemplates(undefined, options)).resourceTemplates
      : [];

    return create(DiscoveredCapabilitiesSchema, {
      tools: tools.map((tool) =>
        create(DiscoveredToolSchema, {
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: (tool.inputSchema as JsonObject | undefined) ?? undefined,
        }),
      ),
      resourceTemplates: resourceTemplates.map((template) =>
        create(DiscoveredResourceTemplateSchema, {
          uriTemplate: template.uriTemplate,
          name: template.name,
          description: template.description ?? "",
          mimeType: template.mimeType ?? "",
        }),
      ),
      lastDiscoveredAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
    });
  } finally {
    await client.close();
  }
}

interface BuiltTransport {
  readonly transport: Transport;
  /** Returns subprocess stderr captured so far (stdio only; "" otherwise). */
  readStderr(): string;
}

async function buildTransport(spec: McpServerSpec, envOverrides: readonly string[]): Promise<BuiltTransport> {
  // ${VAR} placeholders in args/headers resolve against the exact same env the
  // backend hands the runner for real connect (declared keys from the OS env +
  // --env overrides) — so dry-run is a faithful preview. Resolution is strict:
  // an unresolved placeholder throws before any subprocess is spawned, matching
  // the proto contract (never pass a literal "${VAR}" to the server).
  const resolutionEnv = resolveDeclaredEnvValues(spec.env ?? {}, envOverrides);

  if (spec.serverType?.case === "stdio") {
    const { command, args, workingDir } = spec.serverType.value;
    if (command === "") throw new Error("stdio transport requires a command");
    const resolvedArgs = args.map((arg, i) => resolvePlaceholders(arg, resolutionEnv, `stdio arg[${i}]`));
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const transport = new StdioClientTransport({
      command,
      args: resolvedArgs,
      cwd: workingDir !== "" ? workingDir : undefined,
      env: mergeProcessEnv([...envOverrides, ...goRunEnvOverrides(command, args)]),
      // "pipe" exposes the child stderr as a PassThrough immediately, so we can
      // capture diagnostics rather than leaking them to the user's terminal.
      stderr: "pipe",
    });

    let captured = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      captured += chunk.toString("utf8");
    });
    return { transport, readStderr: () => captured.trim() };
  }

  if (spec.serverType?.case === "http") {
    const { url, headers } = spec.serverType.value;
    if (url === "") throw new Error("HTTP transport requires a URL");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const resolvedHeaders = Object.keys(headers).length > 0 ? resolveHeaders(headers, resolutionEnv) : undefined;
    const transport = new StreamableHTTPClientTransport(
      new URL(url),
      resolvedHeaders ? { requestInit: { headers: resolvedHeaders } } : undefined,
    );
    return { transport, readStderr: () => "" };
  }

  throw new Error("MCP server has no transport configured (expected stdio or http)");
}

// Go-toolchain overrides for `go run <module>@<version>` stdio commands so a
// freshly-tagged version is usable before sum.golang.org indexes it. Mirrors
// Go's goRunEnvOverrides. Safe: the command comes from operator-authored config.
function goRunEnvOverrides(command: string, args: readonly string[]): string[] {
  if (command !== "go" || args.length < 2 || args[0] !== "run") return [];
  const pkg = args[1].split("@")[0];
  const parts = pkg.split("/");
  if (parts.length < 3) return [];
  const prefix = `${parts[0]}/${parts[1]}/${parts[2]}/*`;
  return [`GONOSUMDB=${prefix}`, `GONOSUMCHECK=${prefix}`];
}
