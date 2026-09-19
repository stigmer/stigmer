// Fixtures for the Workflow Architect arms: an agent that designs Workflow
// YAML through the `stigmer mcp-server` tools, run against the real
// mcp-server over stdio.
// Domain: conformance support (execution engine).
//
// The architect is a fixture, not a product surface: the product no longer
// ships an architect agent (its former home, a seeded content pack, was
// retired in favour of plugins), and this suite exists to pin the runner's
// stdio lane and the `@stigmer/mcp-server` roster on CI, where it is otherwise
// proven only by envmerge-agent (the desktop-only open-computer-use suite
// does not run there). So the instructions live here, reduced to the two
// tools the arms script by name, and the McpServer is the real full roster
// spawned by the runner as a stdio child exactly as an OSS install spawns it
// (the way the memory lane already spawns it, runner shared/memory-
// attachment.ts — `stigmer mcp-server`; the CLI shim is on PATH wherever the
// execution class runs, see ci.conformance-execution.yaml).
//
// The stdio child needs the server's gRPC address (STIGMER_SERVER_ADDRESS,
// mcp-server/src/config.ts). The runner hands a stdio server ONLY the merged
// execution env filtered to the keys its spec declares — never the runner's
// own process env — so the McpServer declares the key and the execution
// supplies the value through runtime_env, the same envmerge lane
// envmerge-agent.conformance.test.ts pins.
import type { InitShape } from "./init-shape";
import type { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { makeAgent } from "./agents";
import type { ExecutionValueInit } from "./executioncontexts";
import { makeMcpServer } from "./mcpservers";

// The mcp-server tools the architect's instructions direct it to call; the
// arms script tool_use turns by these names and assert the ToolCalls carry them.
export const ARCHITECT_REGISTRY_TOOL = "get_task_kind_registry";
export const ARCHITECT_VALIDATE_TOOL = "validate_workflow_yaml";

// The env key the mcp-server reads its gRPC target from (host:port, no scheme).
export const STIGMER_SERVER_ADDRESS_ENV = "STIGMER_SERVER_ADDRESS";

// The fixture's instructions: enough for a scripted model to be asked, by
// name, for the two tool turns the arms assert on, and for the answer's
// contract (a fenced YAML block) to be stated. Not a product prompt.
export const WORKFLOW_ARCHITECT_INSTRUCTIONS = [
  "You are a workflow architect that designs Stigmer workflows as valid",
  "Workflow YAML conforming to the agentic.stigmer.ai/v1 specification.",
  "",
  `Before designing, call the ${ARCHITECT_REGISTRY_TOOL} tool to learn the`,
  "task kinds the platform supports and their configuration.",
  `Before answering, call the ${ARCHITECT_VALIDATE_TOOL} tool on the YAML`,
  "you produced and fix anything it reports.",
  "",
  "Answer with the workflow as a single fenced ```yaml block.",
].join("\n");

/** The fixture's instructions, as the agent carries them. */
export function loadWorkflowArchitectInstructions(): string {
  return WORKFLOW_ARCHITECT_INSTRUCTIONS;
}

export interface StigmerMcpServerOptions {
  org: string;
  name: string;
}

// The `stigmer mcp-server` full roster as a stdio McpServer, declaring the one
// env key it needs.
export function makeStigmerMcpServer(opts: StigmerMcpServerOptions): InitShape<typeof McpServerSchema> {
  return makeMcpServer({
    org: opts.org,
    name: opts.name,
    description: "the stigmer mcp-server full roster over stdio (conformance architect fixture)",
    command: "stigmer",
    args: ["mcp-server"],
    env: { [STIGMER_SERVER_ADDRESS_ENV]: { description: "gRPC host:port of the server under test" } },
  });
}

export interface WorkflowArchitectAgentOptions {
  org: string;
  name: string;
  // Slug of the McpServer makeStigmerMcpServer registered.
  stigmerMcpServerSlug: string;
}

export function makeWorkflowArchitectAgent(opts: WorkflowArchitectAgentOptions): InitShape<typeof AgentSchema> {
  return makeAgent({
    org: opts.org,
    name: opts.name,
    description: "Workflow Architect — conformance fixture",
    instructions: loadWorkflowArchitectInstructions(),
    mcpServerRefs: [opts.stigmerMcpServerSlug],
  });
}

// The runtime_env an architect execution carries so the stdio mcp-server child
// receives the server's address: the value for the key the McpServer declares.
export function stigmerMcpServerRuntimeEnv(serverBaseUrl: string): Record<string, ExecutionValueInit> {
  return { [STIGMER_SERVER_ADDRESS_ENV]: { value: new URL(serverBaseUrl).host } };
}

// The first ```yaml fenced block in an assistant message, or undefined. The
// architect's contract is to answer with the workflow as a fenced YAML block.
export function extractWorkflowYaml(text: string): string | undefined {
  const match = /```ya?ml\s*\n([\s\S]*?)```/.exec(text);
  return match?.[1]?.trim();
}
