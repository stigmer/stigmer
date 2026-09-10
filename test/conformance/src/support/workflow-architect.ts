// Fixtures for the Workflow Architect agent: the seedpack agent that designs
// Workflow YAML through the `stigmer mcp-server` tools.
// Domain: conformance support (execution engine).
//
// The architect is a product surface, not a test invention: its instructions
// are the seedpack's (seedpack/agents/workflow-architect.yaml) and its tools are
// the real `@stigmer/mcp-server` full roster, spawned by the runner as a stdio
// child exactly as an OSS install spawns it. So the fixture reads the seedpack
// file rather than copying the prompt (a prompt change is a behavior change
// the arms should see), and registers the CLI as a stdio McpServer the way the
// memory lane already spawns it (runner shared/memory-attachment.ts —
// `stigmer mcp-server`; the CLI shim is on PATH wherever the execution class
// runs, see ci.conformance-execution.yaml).
//
// The stdio child needs the server's gRPC address (STIGMER_SERVER_ADDRESS,
// mcp-server/src/config.ts). The runner hands a stdio server ONLY the merged
// execution env filtered to the keys its spec declares — never the runner's
// own process env — so the McpServer declares the key and the execution
// supplies the value through runtime_env, the same envmerge lane
// envmerge-agent.conformance.test.ts pins. Ported from the Go harness's
// workflow_architect_helpers.go (entry 20260910.02).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import type { InitShape } from "./init-shape";
import type { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { makeAgent } from "./agents";
import type { ExecutionValueInit } from "./executioncontexts";
import { makeMcpServer } from "./mcpservers";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SEEDPACK_AGENT_PATH = join(REPO_ROOT, "seedpack", "agents", "workflow-architect.yaml");

// The mcp-server tools the architect's instructions direct it to call; the
// arms script tool_use turns by these names and assert the ToolCalls carry them.
export const ARCHITECT_REGISTRY_TOOL = "get_task_kind_registry";
export const ARCHITECT_VALIDATE_TOOL = "validate_workflow_yaml";

// The env key the mcp-server reads its gRPC target from (host:port, no scheme).
export const STIGMER_SERVER_ADDRESS_ENV = "STIGMER_SERVER_ADDRESS";

// The seedpack agent's instructions, read from disk so the arms exercise the
// prompt the product ships. Refuses by name when the file or field is gone —
// a seedpack rename must fail here, not as an agent with no instructions.
export function loadWorkflowArchitectInstructions(): string {
  const parsed = parseYaml(readFileSync(SEEDPACK_AGENT_PATH, "utf8")) as {
    spec?: { instructions?: unknown };
  } | null;
  const instructions = parsed?.spec?.instructions;
  if (typeof instructions !== "string" || instructions.length === 0) {
    throw new Error(`${SEEDPACK_AGENT_PATH} carries no spec.instructions`);
  }
  return instructions;
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
    description: "Workflow Architect (seedpack instructions) — conformance fixture",
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
