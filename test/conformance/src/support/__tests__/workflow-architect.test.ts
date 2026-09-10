// Unit arms for the Workflow Architect fixtures (entry 20260910.02): the
// instructions come from the seedpack file the product ships, the stdio
// McpServer declares the one env key the mcp-server reads and the runtime env
// supplies it as host:port, and the YAML extractor reads the architect's
// fenced answer. Pure file read + builders; no target.
// Domain: conformance support (execution engine).
import { describe, expect, it } from "vitest";
import {
  STIGMER_SERVER_ADDRESS_ENV,
  extractWorkflowYaml,
  loadWorkflowArchitectInstructions,
  makeStigmerMcpServer,
  makeWorkflowArchitectAgent,
  stigmerMcpServerRuntimeEnv,
} from "../workflow-architect";

describe("workflow architect fixtures", () => {
  it("reads the seedpack agent's instructions, which name the registry and validate tools", () => {
    const instructions = loadWorkflowArchitectInstructions();
    expect(instructions).toContain("get_task_kind_registry");
    expect(instructions).toContain("validate_workflow_yaml");
  });

  it("registers the stigmer mcp-server over stdio, declaring only the server-address key", () => {
    const server = makeStigmerMcpServer({ org: "o", name: "stigmer-mcp" });
    expect(server.spec?.serverType).toEqual({ case: "stdio", value: { command: "stigmer", args: ["mcp-server"] } });
    expect(Object.keys(server.spec?.env ?? {})).toEqual([STIGMER_SERVER_ADDRESS_ENV]);
  });

  it("builds the agent on the seedpack instructions referencing the stigmer server", () => {
    const agent = makeWorkflowArchitectAgent({ org: "o", name: "architect", stigmerMcpServerSlug: "stigmer-mcp" });
    expect(agent.spec?.instructions).toBe(loadWorkflowArchitectInstructions());
    expect(agent.spec?.mcpServerUsages?.map((u) => u.mcpServerRef?.slug)).toEqual(["stigmer-mcp"]);
  });

  it("supplies the server address as host:port, the form the mcp-server's gRPC target takes", () => {
    expect(stigmerMcpServerRuntimeEnv("http://127.0.0.1:54321")).toEqual({
      [STIGMER_SERVER_ADDRESS_ENV]: { value: "127.0.0.1:54321" },
    });
  });

  it("extracts the first fenced YAML block and nothing else", () => {
    const text = "Here is the workflow:\n\n```yaml\napiVersion: agentic.stigmer.ai/v1\nkind: Workflow\n```\n\nNotes.";
    expect(extractWorkflowYaml(text)).toBe("apiVersion: agentic.stigmer.ai/v1\nkind: Workflow");
    expect(extractWorkflowYaml("no fence here")).toBeUndefined();
    expect(extractWorkflowYaml("```json\n{}\n```")).toBeUndefined();
  });
});
