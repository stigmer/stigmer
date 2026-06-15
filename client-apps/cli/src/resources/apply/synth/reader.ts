// Reader for SDK synthesis output.
//
// The SDK writes one binary proto per resource into the out dir:
//   skill-N.pb       (SkillSynth — input for skill push)
//   mcpserver-N.pb   (McpServer)
//   agent-N.pb       (Agent)
//   workflow-N.pb    (Workflow)
// We glob each `<kind>-*.pb`, sort lexically (matching Go's reader so the same
// bytes read identically on both consumers), and decode with `fromBinary`
// (DD-009 §3). At least one resource must be present.
//
// `dependencies.json` (Go's local-only dependency graph) is deliberately NOT
// consumed: no dependency-graph validation feature exists, and the TS SDK does
// not emit it. Its absence is therefore tolerated by construction (DD-009).
// Port of `internal/cli/synthesis/reader.go`.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type DescMessage, fromBinary, type MessageShape } from "@bufbuild/protobuf";
import { type Agent, AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { type McpServer, McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { type SkillSynth, SkillSynthSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/synth_pb";
import { type Workflow, WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { UsageError } from "../../../errors/index.js";

/** Decoded synthesis output, grouped by kind in read order. */
export interface SynthesisResult {
  readonly skillSynths: SkillSynth[];
  readonly mcpServers: McpServer[];
  readonly agents: Agent[];
  readonly workflows: Workflow[];
}

/**
 * Read and decode all synthesized `.pb` files from `outputDir`. Throws a
 * UsageError if the synthesis produced no resources (a program that registered
 * nothing, or wrote to the wrong directory).
 */
export function readSynthesisOutput(outputDir: string): SynthesisResult {
  const skillSynths = readProtoFiles(outputDir, "skill-", SkillSynthSchema);
  const mcpServers = readProtoFiles(outputDir, "mcpserver-", McpServerSchema);
  const agents = readProtoFiles(outputDir, "agent-", AgentSchema);
  const workflows = readProtoFiles(outputDir, "workflow-", WorkflowSchema);

  if (skillSynths.length + mcpServers.length + agents.length + workflows.length === 0) {
    throw new UsageError(
      "no resources found in synthesis output\n\n" +
        "The entry point ran but registered no resources. Register at least one " +
        "agent, workflow, MCP server, or skill, and end with `await project.synth()`.",
    );
  }

  return { skillSynths, mcpServers, agents, workflows };
}

// Glob `<prefix>*.pb` in `dir`, sort lexically (parity with Go's sort.Strings),
// and decode each. A missing directory yields an empty list (the caller's
// zero-resource check produces the user-facing error).
function readProtoFiles<Desc extends DescMessage>(dir: string, prefix: string, schema: Desc): MessageShape<Desc>[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith(".pb")).sort();
  return matches.map((name) => fromBinary(schema, readFileSync(join(dir, name))));
}
