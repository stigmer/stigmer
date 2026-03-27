"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { UploadAttachmentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { PENDING_SUBJECT } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

export interface TriggerApprovalPolicyResult {
  readonly sessionId: string;
  readonly executionId: string;
}

export interface UseTriggerApprovalPolicySessionReturn {
  /**
   * Create an agent session with the `mcp-server-creator` agent, attach the
   * current MCP server YAML, and start an execution that generates approval
   * policies for the discovered tools.
   *
   * @param mcpServerYaml - Serialized MCP server YAML to attach as input.
   * @param org - Organization slug.
   * @param mcpServerSlug - MCP server slug (for context in the prompt).
   */
  readonly trigger: (
    mcpServerYaml: string,
    org: string,
    mcpServerSlug: string,
  ) => Promise<TriggerApprovalPolicyResult>;
  readonly isTriggering: boolean;
  readonly error: Error | null;
  readonly clearError: () => void;
  readonly result: TriggerApprovalPolicyResult | null;
}

const MCP_SERVER_CREATOR_SLUG = "mcp-server-creator";
const MCP_SERVER_CREATOR_ORG = "stigmer";

/**
 * Orchestration hook that auto-creates a session with the `mcp-server-creator`
 * agent and starts an execution with a pre-filled prompt and YAML attachment.
 *
 * The prompt instructs the agent to read the attached YAML, query the
 * discovered tools for this MCP server, classify each tool's risk level,
 * and generate `default_tool_approvals` entries with appropriate approval
 * messages. The agent applies the result using the `apply_mcp_server` tool.
 *
 * @example
 * ```tsx
 * const { trigger, isTriggering, result } = useTriggerApprovalPolicySession();
 *
 * async function handleGenerate() {
 *   const yaml = serializeMcpServer(mcpServer);
 *   await trigger(yaml, org, slug);
 *   // result.sessionId and result.executionId are now available
 * }
 * ```
 */
export function useTriggerApprovalPolicySession(): UseTriggerApprovalPolicySessionReturn {
  const stigmer = useStigmer();
  const [isTriggering, setIsTriggering] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<TriggerApprovalPolicyResult | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const trigger = useCallback(
    async (
      mcpServerYaml: string,
      org: string,
      mcpServerSlug: string,
    ): Promise<TriggerApprovalPolicyResult> => {
      setIsTriggering(true);
      setError(null);

      try {
        const agent = await stigmer.agent.getByReference({
          org: MCP_SERVER_CREATOR_ORG,
          slug: MCP_SERVER_CREATOR_SLUG,
        });

        const defaultInstanceId = agent.status?.defaultInstanceId;
        if (!defaultInstanceId) {
          throw new Error(
            `Agent "${MCP_SERVER_CREATOR_ORG}/${MCP_SERVER_CREATOR_SLUG}" does not have a ` +
              "default instance. Ensure the mcp-server-creator agent is properly set up.",
          );
        }

        const session = await stigmer.session.create({
          name: `approval-policy-${mcpServerSlug}-${Date.now()}`,
          org,
          subject: PENDING_SUBJECT,
          agentInstanceId: defaultInstanceId,
        });

        const sessionId = session.metadata!.id;
        const fileName = `${mcpServerSlug}.yaml`;

        const attachment = await stigmer.agentExecution.uploadAttachment(
          create(UploadAttachmentRequestSchema, {
            filename: fileName,
            content: new TextEncoder().encode(mcpServerYaml),
            contentType: "application/x-yaml",
          }),
        );

        const prompt = buildApprovalPolicyPrompt(mcpServerSlug, org);

        const execution = await stigmer.agentExecution.create({
          name: `gen-approval-policy-${Date.now()}`,
          org,
          sessionId,
          message: prompt,
          attachments: [
            {
              storageKey: attachment.storageKey,
              filename: fileName,
            },
          ],
        });

        const triggerResult: TriggerApprovalPolicyResult = {
          sessionId,
          executionId: execution.metadata!.id,
        };

        setResult(triggerResult);
        return triggerResult;
      } catch (err) {
        const wrapped = toError(err);
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsTriggering(false);
      }
    },
    [stigmer],
  );

  return { trigger, isTriggering, error, clearError, result };
}

function buildApprovalPolicyPrompt(slug: string, org: string): string {
  return [
    `Generate default tool approval policies for the MCP server "${org}/${slug}".`,
    "",
    "Instructions:",
    "1. Read the attached YAML file — it contains the full MCP server definition.",
    `2. Use the get_mcp_server tool to fetch the latest version of "${org}/${slug}" including its discovered capabilities.`,
    "3. For each discovered tool, classify its risk level:",
    "   - **Low risk** (read-only queries, searches): No approval needed — do NOT add an entry.",
    "   - **Medium risk** (creates/modifies resources): Add an entry with a clear approval message.",
    "   - **High risk** (deletes, destructive operations): Add an entry with a detailed approval message including relevant parameter placeholders ({{args.field}}).",
    "4. Generate the `default_tool_approvals` section in the YAML.",
    "5. Apply the updated YAML using the apply_mcp_server tool.",
    "",
    "The approval message should be human-readable and explain what the tool will do,",
    "using {{args.field}} placeholders for dynamic content where appropriate.",
  ].join("\n");
}
