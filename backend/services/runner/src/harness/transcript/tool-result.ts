/**
 * The tool-result serialization the transcript builder and the sub-agent
 * tracker both perform when a tool finishes, so the two never drift on the
 * rule (until S3 M2b `status-builder-shared.ts` also carried the v2 builder's
 * share and the approval-provenance stamp; the stamp now lives beside its
 * one caller in `builder.ts`).
 *
 * This module is M2-transient (S4, `T01_4_m1_plan.md` Q-M1-1). What it
 * unwraps is a LangChain `ToolMessage` envelope — engine knowledge that the
 * canonical union keeps out of the builder: at M2 `tool_finished` carries
 * `result: string` (Q-S4-3) and this function moves into the native
 * translator (`v3-protocol-normalizer.ts`), where it also learns to unwrap a
 * LangGraph `Command` to its ToolMessage's content (Q-S4-21, the F-M0-2
 * finding: deepagents' `write_todos` returns a Command, and today the row's
 * `result` is the whole serialized Command). Until then it sits here so the
 * builder can call it from `harness/` without importing `activities/`.
 */

/**
 * Serialize a LangChain message `content` field into the canonical tool-result
 * string.
 *
 * Text-only content is a plain string and passes through unchanged. Multimodal
 * content (image, or mixed text+image — e.g. a computer-use screenshot) is an
 * array of content blocks; we serialize the blocks array ITSELF, not the
 * surrounding message envelope, so the result lands in the exact top-level-array
 * shape the persist-time offload (`detectImagePayload`/`contentBlocks` in
 * status-offload.ts) consumes to lift the image out into a renderable
 * `ToolCallOutputRef`. Serializing the envelope instead would bury the base64
 * one level deeper and defeat that detection.
 *
 * Returns undefined when `content` is neither a string nor an array, letting the
 * caller fall back to serializing whatever else it holds.
 */
function serializeToolContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return JSON.stringify(content);
  return undefined;
}

/**
 * Extract tool result from v3 tool-finished output.
 * v3 output wraps LangChain ToolMessage in a constructor envelope:
 * `{ lc, type, id, kwargs: { content, status, ... } }`
 */
export function extractToolResultV3(output: unknown): string {
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    const kwargs = obj.kwargs as Record<string, unknown> | undefined;
    if (kwargs) {
      const fromKwargs = serializeToolContent(kwargs.content);
      if (fromKwargs !== undefined) return fromKwargs;
    }
    const fromContent = serializeToolContent(obj.content);
    if (fromContent !== undefined) return fromContent;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return "[serialization error]";
  }
}
