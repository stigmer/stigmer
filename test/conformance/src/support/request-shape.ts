// Renders what the model received — the system prompt blocks and the tool
// surface of one Anthropic request — as readable text for a file golden.
// Domain: conformance support (execution engine, the request-shape facet).
//
// A golden exists so that a change to what the runner sends the model shows
// up as a hunk a reviewer can READ: a prompt sentence that moved, a tool
// description that was reworded, a cache breakpoint that landed on a
// different block. Raw JSON defeats that purpose (every newline escaped, a
// 5 KB prompt on one line), so these two pure functions write the request
// out as Markdown-like text: each system block verbatim under a boundary
// line that names its position and its cache breakpoint, each tool under a
// boundary line with its description verbatim and its JSON schema pretty-
// printed in a fence. The boundary lines use a bracket form (`<<< ... >>>`)
// that no prompt or description in the repository writes, so a reader can
// always tell the golden's own structure from the bytes it photographs.
//
// Pure over the wire type; nothing here knows which harness produced the
// request or what a "right" prompt looks like. The golden a renderer feeds
// moves only under a ruling quoted in the facet's header, never a quiet
// vitest `-u`.
import type { AnthropicRequestBody, AnthropicSystemBlock } from "../harness/llm-wire";

// The system prompt as the provider received it. A request that sent
// `system` as one string renders as a single block marked as such, so the
// two wire shapes are distinguishable in the golden; a request with no
// `system` says so instead of rendering an empty file.
export function renderSystemPrompt(request: AnthropicRequestBody): string {
  const { system } = request;
  if (system === undefined) {
    return "<<< no system prompt on this request >>>\n";
  }
  if (typeof system === "string") {
    return `<<< system prompt sent as one string >>>\n\n${system}\n`;
  }
  return system.map((block, index) => renderSystemBlock(block, index, system.length)).join("\n");
}

function renderSystemBlock(block: AnthropicSystemBlock, index: number, count: number): string {
  const breakpoint = block.cache_control === undefined ? "" : ` | cache_control ${JSON.stringify(block.cache_control)}`;
  return `<<< system block ${index + 1} of ${count}${breakpoint} >>>\n\n${block.text}\n`;
}

// The tool surface in wire order: what the model can call, the words that
// steer when it calls, and the arguments each call takes. A request that
// bound no tools says so.
export function renderToolSurface(request: AnthropicRequestBody): string {
  const tools = request.tools ?? [];
  if (tools.length === 0) {
    return "<<< no tools on this request >>>\n";
  }
  return tools
    .map((tool, index) => {
      const description = tool.description === undefined ? "<<< no description >>>" : tool.description;
      const schema = JSON.stringify(tool.input_schema, null, 2);
      return `<<< tool ${index + 1} of ${tools.length}: ${tool.name} >>>\n\n${description}\n\ninput_schema:\n\n\`\`\`json\n${schema}\n\`\`\`\n`;
    })
    .join("\n");
}
