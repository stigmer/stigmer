// Unit arms for the request-shape renderers and the Anthropic request reader
// they sit on: a captured body is read into the wire type or refused by name,
// and the two renderers write a golden's text with the boundary lines that
// separate the golden's own structure from the bytes it photographs. Pure:
// hand-built bodies, no mock, no target.
// Domain: conformance support (execution engine).
import { describe, expect, it } from "vitest";
import { readAnthropicRequest } from "../../harness/llm-wire";
import { renderSystemPrompt, renderToolSurface } from "../request-shape";

const LS_SCHEMA = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };

// A body in the shape the runner's deepagents engine sends: several system
// blocks with a breakpoint on the last, two tools, thinking absent.
const ENGINE_BODY = {
  model: "claude-sonnet-4-6",
  stream: true,
  temperature: 0,
  system: [
    { type: "text", text: "You are the agent." },
    { type: "text", text: "You are a Deep Agent.", cache_control: { type: "ephemeral" } },
  ],
  tools: [
    { name: "ls", description: "List a directory.", input_schema: LS_SCHEMA },
    { name: "web_fetch", input_schema: { type: "object", properties: {} } },
  ],
  messages: [{ role: "user", content: "hi" }],
};

describe("readAnthropicRequest", () => {
  it("reads the asserted fields of a messages body and carries thinking and cache_control as received", () => {
    const request = readAnthropicRequest({ ...ENGINE_BODY, thinking: { type: "enabled", budget_tokens: 1024 } });
    expect(request.model).toBe("claude-sonnet-4-6");
    expect(request.temperature).toBe(0);
    expect(request.stream).toBe(true);
    expect(request.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(request.system).toEqual(ENGINE_BODY.system);
    expect(request.tools).toEqual(ENGINE_BODY.tools);
  });

  it("leaves thinking, temperature and stream absent when the body did not send them", () => {
    const request = readAnthropicRequest({ model: "m", messages: [], system: "one string" });
    expect(request).toEqual({ model: "m", system: "one string" });
    expect("thinking" in request, "absent means absent, not undefined-valued").toBe(false);
  });

  it("refuses a body that is not a messages request, naming what it found", () => {
    expect(() => readAnthropicRequest(undefined)).toThrow("expected an object, found undefined");
    expect(() => readAnthropicRequest({ error: "MockLlmProxy speaks only Anthropic" })).toThrow(
      "expected string `model` and array `messages`, found keys [error]",
    );
    expect(() => readAnthropicRequest({ model: "m", messages: [], system: 42 })).toThrow(
      "`system` must be a string or an array of text blocks, found number 42",
    );
    expect(() => readAnthropicRequest({ model: "m", messages: [], system: [{ type: "image" }] })).toThrow(
      "`system[0]` must be a text block",
    );
    expect(() => readAnthropicRequest({ model: "m", messages: [], tools: [{ description: "nameless" }] })).toThrow(
      "`tools[0]` must carry a string `name`",
    );
  });
});

describe("renderSystemPrompt", () => {
  it("renders every block verbatim in order under a boundary that names its position and its cache breakpoint", () => {
    expect(renderSystemPrompt(readAnthropicRequest(ENGINE_BODY))).toBe(
      "<<< system block 1 of 2 >>>\n\nYou are the agent.\n\n" +
        '<<< system block 2 of 2 | cache_control {"type":"ephemeral"} >>>\n\nYou are a Deep Agent.\n',
    );
  });

  it("marks a system prompt sent as one string, and says when there is none", () => {
    expect(renderSystemPrompt({ model: "m", system: "Extract the structured data." })).toBe(
      "<<< system prompt sent as one string >>>\n\nExtract the structured data.\n",
    );
    expect(renderSystemPrompt({ model: "m" })).toBe("<<< no system prompt on this request >>>\n");
  });
});

describe("renderToolSurface", () => {
  it("renders each tool in wire order with its description verbatim and its schema pretty-printed", () => {
    expect(renderToolSurface(readAnthropicRequest(ENGINE_BODY))).toBe(
      "<<< tool 1 of 2: ls >>>\n\nList a directory.\n\ninput_schema:\n\n```json\n" +
        `${JSON.stringify(LS_SCHEMA, null, 2)}\n\`\`\`\n\n` +
        "<<< tool 2 of 2: web_fetch >>>\n\n<<< no description >>>\n\ninput_schema:\n\n```json\n" +
        '{\n  "type": "object",\n  "properties": {}\n}\n```\n',
    );
  });

  it("says when the request bound no tools", () => {
    expect(renderToolSurface({ model: "m" })).toBe("<<< no tools on this request >>>\n");
    expect(renderToolSurface({ model: "m", tools: [] })).toBe("<<< no tools on this request >>>\n");
  });
});
