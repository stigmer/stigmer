// Unit arms for the stdio-lane fixtures: the fixture's instructions name the
// read tool the arms script, the stdio McpServer declares the one env key the
// mcp-server reads and the runtime env supplies it as host:port, and the agent
// carries the description an arm reads back through the server. Pure
// builders; no target.
// Domain: conformance support (execution engine).
import { describe, expect, it } from "vitest";
import {
  STDIO_AGENT_INSTRUCTIONS,
  STDIO_READ_TOOL,
  STIGMER_SERVER_ADDRESS_ENV,
  makeStdioAgent,
  makeStigmerMcpServer,
  stigmerMcpServerRuntimeEnv,
} from "../stigmer-mcp-stdio";

describe("stdio-lane fixtures", () => {
  it("carries instructions that name the read tool the arms script", () => {
    expect(STDIO_AGENT_INSTRUCTIONS).toContain(STDIO_READ_TOOL);
  });

  it("registers the stigmer mcp-server over stdio, declaring only the server-address key", () => {
    const server = makeStigmerMcpServer({ org: "o", name: "stigmer-mcp" });
    expect(server.spec?.serverType).toEqual({ case: "stdio", value: { command: "stigmer", args: ["mcp-server"] } });
    expect(Object.keys(server.spec?.env ?? {})).toEqual([STIGMER_SERVER_ADDRESS_ENV]);
  });

  it("builds the agent on the fixture instructions and description, referencing the stigmer server", () => {
    const agent = makeStdioAgent({
      org: "o",
      name: "reader",
      description: "marker-123",
      stigmerMcpServerSlug: "stigmer-mcp",
    });
    expect(agent.spec?.instructions).toBe(STDIO_AGENT_INSTRUCTIONS);
    expect(agent.spec?.description).toBe("marker-123");
    expect(agent.spec?.mcpServerUsages?.map((u) => u.mcpServerRef?.slug)).toEqual(["stigmer-mcp"]);
  });

  it("supplies the server address as host:port, the form the mcp-server's gRPC target takes", () => {
    expect(stigmerMcpServerRuntimeEnv("http://127.0.0.1:54321")).toEqual({
      [STIGMER_SERVER_ADDRESS_ENV]: { value: "127.0.0.1:54321" },
    });
  });
});
