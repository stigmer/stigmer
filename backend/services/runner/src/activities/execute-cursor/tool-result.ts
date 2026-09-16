/**
 * The Cursor harness's rendering of a tool result into the one string a
 * transcript row carries — the translator's half of `tool_finished.result`
 * (`harness/transcript/events.ts`): the engine's output envelope is the
 * harness's to unwrap, the builder stores what it is handed, and the persist
 * chokepoint bounds it. Native's twin is
 * `extractToolResult` in `execute-deep-agent/translator.ts` (the LangChain
 * ToolMessage envelope and the LangGraph Command).
 *
 * Its own module because two readers need it — the translator for a root
 * row's result, `sub-agent-steps.ts` for a sub-agent's — and the second would
 * otherwise import the first, which imports the second. Moved from
 * `message-translator.ts` verbatim.
 */

/**
 * Normalize a tool_call event result into a string for the ToolCall proto.
 * Returns "" for an absent result so callers can treat "no result yet" and
 * "empty result" uniformly (e.g. to avoid clobbering a captured result).
 *
 * The one non-passthrough case is a multimodal MCP result (e.g. a computer-use
 * screenshot): see {@link canonicalizeImageResult}. Everything else is the
 * string as-is, or a whole-value JSON.stringify — byte-identical to before.
 */
export function toResultString(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  const canonical = canonicalizeImageResult(result);
  if (canonical !== undefined) return canonical;
  return JSON.stringify(result);
}

/**
 * Re-emit a Cursor MCP result that carries an image block as the canonical
 * top-level content-block array the persist-time offload understands.
 *
 * The Cursor SDK wraps an MCP tool result as `{ status, value: { content: [...] } }`
 * (or a bare `{ content: [...] }`), where an image block is
 * `{ image: { data, mimeType } }` and `data` is a Node Buffer-JSON
 * (`{ type:"Buffer", data:number[] }`). Persisting that envelope verbatim buries
 * the image where `detectImagePayload`/`contentBlocks` (shared/status-offload.ts)
 * cannot see it, so the screenshot lands as `text/plain` instead of a renderable
 * `ToolCallOutputRef`.
 *
 * This mirrors `serializeToolContent` in the deep-agent path
 * (harness/transcript/tool-result.ts): the harness adapter normalizes
 * its own wire shape into the canonical array
 *   `[{ type:"text", text }, { type:"image", data:<base64>, mimeType }]`
 * so the shared offload stays harness-agnostic (its envelope handling is
 * documented there as insurance, not the primary path). Buffer-JSON is decoded
 * to base64 here so the bloated byte-array never propagates into the status.
 *
 * Returns undefined when there is no content array or no image block, so the
 * caller falls back to its existing serialization (no change for text/error
 * results).
 */
export function canonicalizeImageResult(result: unknown): string | undefined {
  if (result == null || typeof result !== "object") return undefined;
  const blocks = resultContentBlocks(result as Record<string, unknown>);
  if (!blocks) return undefined;

  const canonical: Array<Record<string, unknown>> = [];
  let sawImage = false;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;

    if (b.image && typeof b.image === "object") {
      const img = b.image as Record<string, unknown>;
      const base64 = imageDataToBase64(img.data);
      if (base64) {
        const mimeType = typeof img.mimeType === "string" ? img.mimeType : "image/png";
        canonical.push({ type: "image", data: base64, mimeType });
        sawImage = true;
        continue;
      }
    }

    const text = blockText(b);
    if (text !== undefined) canonical.push({ type: "text", text });
  }

  return sawImage ? JSON.stringify(canonical) : undefined;
}

/** Extract the content-block array from a Cursor result envelope or a bare one. */
function resultContentBlocks(obj: Record<string, unknown>): unknown[] | undefined {
  const value = obj.value;
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).content)) {
    return (value as Record<string, unknown>).content as unknown[];
  }
  if (Array.isArray(obj.content)) return obj.content;
  return undefined;
}

/**
 * Decode an image block's `data` to plain base64. Accepts a Node Buffer-JSON
 * (`{ type:"Buffer", data:number[] }`, how the Cursor SDK serializes bytes), a
 * `data:` URL, or an already-base64 string. Returns undefined for anything else.
 */
function imageDataToBase64(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.type === "Buffer" && Array.isArray(d.data)) {
      try {
        return Buffer.from(d.data as number[]).toString("base64");
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  if (typeof data === "string" && data) {
    const dataUrl = data.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/);
    return (dataUrl ? dataUrl[1] : data).replace(/\s+/g, "");
  }
  return undefined;
}

/** Extract the text from a Cursor content block: `{ text:{text} }` or `{ text }`. */
function blockText(b: Record<string, unknown>): string | undefined {
  const t = b.text;
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && typeof (t as Record<string, unknown>).text === "string") {
    return (t as Record<string, unknown>).text as string;
  }
  return undefined;
}
