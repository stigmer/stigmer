/**
 * Post-stream safety net for artifact publishing.
 *
 * Scans completed tool calls for file-modifying operations (write, edit,
 * create) and publishes any files that were not already published inline.
 * This catches files modified by paths not triggered during streaming
 * (e.g., shell commands, race conditions in fire-and-forget publish).
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { InlinePublisher } from "./inline-publisher.js";

const FILE_MODIFYING_TOOLS = new Set([
  "write_file",
  "edit_file",
  "create_file",
  "write",
  "edit",
  "create",
  "str_replace_editor",
]);

/**
 * Scan all tool calls in the execution status for file-modifying operations
 * and publish any files that were not already published inline.
 *
 * Returns the count of additionally published artifacts.
 */
export async function autoPublishWrittenFiles(
  status: AgentExecutionStatus,
  inlinePublisher: InlinePublisher,
): Promise<number> {
  const alreadyPublished = inlinePublisher.publishedPaths;
  const pathsToPublish: string[] = [];

  for (const message of status.messages) {
    for (const tc of message.toolCalls) {
      if (!FILE_MODIFYING_TOOLS.has(tc.name)) continue;

      const filePath = extractFilePath(tc.args as Record<string, unknown> | undefined);
      if (!filePath) continue;

      const normalized = filePath.replace(/^\/+/, "");
      if (alreadyPublished.has(normalized)) continue;
      if (pathsToPublish.includes(normalized)) continue;

      pathsToPublish.push(normalized);
    }
  }

  let count = 0;
  for (const path of pathsToPublish) {
    try {
      await inlinePublisher.publish(path);
      count++;
    } catch {
      // InlinePublisher.publish already swallows errors internally.
      // This catch is defense-in-depth.
    }
  }

  if (count > 0) {
    console.log(
      `[autoPublish] Published ${count} additional artifact(s) via safety net`,
    );
  }

  return count;
}

function extractFilePath(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null;

  if (typeof args.path === "string") return args.path;
  if (typeof args.file_path === "string") return args.file_path;
  if (typeof args.filename === "string") return args.filename;
  if (typeof args.file === "string") return args.file;

  return null;
}
