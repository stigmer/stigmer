// Fixtures for the stdio-lane arms: an agent that reads Stigmer resources
// through the `stigmer mcp-server` tools, run against the real mcp-server
// over stdio.
// Domain: conformance support (execution engine).
//
// The agent is a fixture, not a product surface. The suite exists to pin the
// runner's stdio lane and the `@stigmer/mcp-server` roster on CI, where they
// are otherwise proven only by the vault resolution arms (the desktop-only
// open-computer-use suite does not run there). So the instructions live here,
// reduced to the one tool the arms script by name, and the McpServer is the
// real full roster spawned by the runner as a stdio child exactly as an OSS
// install spawns it (the way the memory lane already spawns it, runner
// shared/memory-attachment.ts — `stigmer mcp-server`; the CLI shim is on PATH
// wherever the execution class runs, see ci.conformance-execution.yaml).
//
// The stdio child needs the server's gRPC address (STIGMER_SERVER_ADDRESS,
// mcp-server/src/config.ts). The runner hands a stdio server ONLY the values
// resolved for the keys its spec declares — never the runner's own process
// env — so the McpServer declares the key with the address as its plain
// default value: a setting, not a secret, lives in the definition.
import type { InitShape } from "./init-shape";
import type { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { makeAgent } from "./agents";
import { makeMcpServer } from "./mcpservers";

// The mcp-server tool the fixture's instructions direct it to call; the arms
// script tool_use turns by this name and assert the ToolCalls carry it. A read
// with one deterministic answer, so an arm can assert the server's reply.
export const STDIO_READ_TOOL = "get_agent";

// The env key the mcp-server reads its gRPC target from (host:port, no scheme).
export const STIGMER_SERVER_ADDRESS_ENV = "STIGMER_SERVER_ADDRESS";

// The fixture's instructions: enough for a scripted model to be asked, by
// name, for the tool turn the arms assert on. Not a product prompt.
export const STDIO_AGENT_INSTRUCTIONS = [
  "You answer questions about Stigmer agents.",
  "",
  `Call the ${STDIO_READ_TOOL} tool with the organization and slug you are`,
  "asked about, and answer with the agent's description.",
].join("\n");

export interface StigmerMcpServerOptions {
  org: string;
  name: string;
  // The server under test's base URL; the declaration carries its host:port.
  serverBaseUrl: string;
}

// The address the mcp-server's gRPC target takes: host:port, no scheme.
export function stigmerServerAddressOf(serverBaseUrl: string): string {
  return new URL(serverBaseUrl).host;
}

// The `stigmer mcp-server` full roster as a stdio McpServer, declaring the one
// env key it needs with the server's address as its plain value.
export function makeStigmerMcpServer(opts: StigmerMcpServerOptions): InitShape<typeof McpServerSchema> {
  return makeMcpServer({
    org: opts.org,
    name: opts.name,
    description: "the stigmer mcp-server full roster over stdio (conformance stdio fixture)",
    command: "stigmer",
    args: ["mcp-server"],
    env: {
      [STIGMER_SERVER_ADDRESS_ENV]: {
        description: "gRPC host:port of the server under test",
        value: stigmerServerAddressOf(opts.serverBaseUrl),
      },
    },
  });
}

export interface StdioAgentOptions {
  org: string;
  name: string;
  // The agent's description: what the read through the stdio server returns,
  // so an arm can tell this server's answer from anything else.
  description: string;
  // Slug of the McpServer makeStigmerMcpServer registered.
  stigmerMcpServerSlug: string;
}

export function makeStdioAgent(opts: StdioAgentOptions): InitShape<typeof AgentSchema> {
  return makeAgent({
    org: opts.org,
    name: opts.name,
    description: opts.description,
    instructions: STDIO_AGENT_INSTRUCTIONS,
    mcpServerRefs: [opts.stigmerMcpServerSlug],
  });
}

