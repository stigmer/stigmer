// Unit arms for the stdio-lane fixtures: the fixture's instructions name the
// read tool the arms script, the stdio plugin's one server is the stigmer
// mcp-server referencing only the server-address variable the platform
// fills, and the agent carries the description an arm reads back through
// the server and lists the plugin. Pure builders; no target.
// Domain: conformance support (execution engine).
import { describe, expect, it } from "vitest";
import {
  STDIO_AGENT_INSTRUCTIONS,
  STDIO_READ_TOOL,
  STIGMER_SERVER_ADDRESS_ENV,
  STIGMER_STDIO_SERVER,
  makeStdioAgent,
  stigmerMcpPlugin,
  stigmerServerAddressOf,
} from "../stigmer-mcp-stdio";

describe("stdio-lane fixtures", () => {
  it("carries instructions that name the read tool the arms script", () => {
    expect(STDIO_AGENT_INSTRUCTIONS).toContain(STDIO_READ_TOOL);
  });

  it("packages the stigmer mcp-server as a local program, referencing only the server-address variable", () => {
    const content = stigmerMcpPlugin("stigmer-mcp").get(".mcp.json");
    const document = JSON.parse(typeof content === "string" ? content : "{}") as unknown;
    expect(document).toEqual({
      mcpServers: {
        [STIGMER_STDIO_SERVER]: {
          command: "stigmer",
          args: ["mcp-server"],
          env: { [STIGMER_SERVER_ADDRESS_ENV]: `\${${STIGMER_SERVER_ADDRESS_ENV}}` },
        },
      },
    });
  });

  it("builds the agent on the fixture instructions and description, listing the stdio plugin", () => {
    const agent = makeStdioAgent({
      org: "o",
      name: "reader",
      description: "marker-123",
      stigmerMcpPluginSlug: "stigmer-mcp",
    });
    expect(agent.spec?.instructions).toBe(STDIO_AGENT_INSTRUCTIONS);
    expect(agent.spec?.description).toBe("marker-123");
    expect(agent.spec?.plugins?.map((ref) => ref.slug)).toEqual(["stigmer-mcp"]);
  });

  it("supplies the server address as host:port, the form the mcp-server's gRPC target takes", () => {
    expect(stigmerServerAddressOf("http://127.0.0.1:54321")).toBe("127.0.0.1:54321");
  });
});
