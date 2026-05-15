import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** Extracted workflow YAML and accompanying explanation from an agent response. */
export interface ExtractedWorkflowYaml {
  /** The raw YAML content extracted from the fenced code block. */
  readonly yaml: string;
  /** Prose explanation surrounding the YAML block (concatenated non-YAML text). */
  readonly explanation: string;
}

const YAML_FENCE_REGEX = /```ya?ml\s*\n([\s\S]*?)```/g;

/**
 * Extracts the last YAML fenced code block from an agent execution's
 * assistant messages.
 *
 * The Workflow Architect agent is instructed to return validated workflow
 * YAML inside a markdown ````yaml` fence. This function scans all AI
 * messages in reverse order, finds the last such block, and separates
 * the YAML content from the surrounding explanation prose.
 *
 * Returns `null` when no YAML block is found — callers should surface
 * this as an extraction error.
 */
export function extractWorkflowYaml(
  execution: AgentExecution | null,
): ExtractedWorkflowYaml | null {
  if (!execution?.status?.messages?.length) return null;

  const messages = execution.status.messages;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type !== MessageType.MESSAGE_AI) continue;

    const content = msg.content;
    if (!content) continue;

    const blocks = findAllYamlBlocks(content);
    if (blocks.length === 0) continue;

    const lastBlock = blocks[blocks.length - 1];
    const explanation = buildExplanation(content, blocks);

    return {
      yaml: lastBlock.trim(),
      explanation: explanation.trim(),
    };
  }

  return null;
}

function findAllYamlBlocks(content: string): string[] {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(YAML_FENCE_REGEX.source, "g");

  while ((match = regex.exec(content)) !== null) {
    if (match[1]) blocks.push(match[1]);
  }

  return blocks;
}

function buildExplanation(content: string, yamlBlocks: string[]): string {
  let explanation = content;

  for (const block of yamlBlocks) {
    const fenced = new RegExp(
      "```ya?ml\\s*\\n" + escapeRegex(block) + "```",
      "g",
    );
    explanation = explanation.replace(fenced, "");
  }

  return explanation
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
