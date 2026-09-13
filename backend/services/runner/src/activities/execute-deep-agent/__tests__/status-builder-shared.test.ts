import { describe, it, expect } from "vitest";
import { extractToolResultV3 } from "../status-builder-shared.js";

// Image/mixed content blocks (e.g. a computer-use screenshot). The extractor
// must serialize the BLOCKS ARRAY — not the LangChain envelope around it — so
// the persist-time offload can detect the image and lift it into a renderable
// ToolCallOutputRef.
const imageBlock = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };

describe("extractToolResultV3", () => {
  it("passes a plain string output through unchanged", () => {
    expect(extractToolResultV3("just text")).toBe("just text");
  });

  it("returns kwargs.content when it is a text string (serialized envelope)", () => {
    const envelope = {
      lc: 1,
      type: "constructor",
      id: ["langchain_core", "messages", "ToolMessage"],
      kwargs: { status: "success", content: "hello" },
    };
    expect(extractToolResultV3(envelope)).toBe("hello");
  });

  it("serializes the blocks array (not the envelope) when kwargs.content is an array", () => {
    const envelope = {
      lc: 1,
      type: "constructor",
      id: ["langchain_core", "messages", "ToolMessage"],
      kwargs: { content: [{ type: "text", text: "shot" }, imageBlock] },
    };
    const result = extractToolResultV3(envelope);
    expect(JSON.parse(result)).toEqual([{ type: "text", text: "shot" }, imageBlock]);
    // The surrounding envelope keys must NOT appear in the serialized result.
    expect(result).not.toContain("constructor");
    expect(result).not.toContain("langchain_core");
  });

  it("serializes the blocks array on a live ToolMessage-shaped object (obj.content)", () => {
    const live = { content: [imageBlock] };
    expect(JSON.parse(extractToolResultV3(live))).toEqual([imageBlock]);
  });

  it("falls back to JSON.stringify for unrecognized shapes", () => {
    expect(extractToolResultV3({ foo: "bar" })).toBe(JSON.stringify({ foo: "bar" }));
  });
});
