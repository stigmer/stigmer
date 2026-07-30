import { describe, it, expect } from "vitest";
import { createThinkTool } from "../think-tool.js";

describe("createThinkTool", () => {
  it("returns a tool named 'think'", () => {
    const thinkTool = createThinkTool();
    expect(thinkTool.name).toBe("think");
  });

  it("has a description explaining its purpose", () => {
    const thinkTool = createThinkTool();
    expect(thinkTool.description).toContain("think through a problem");
  });

  it("returns 'ok' for any thought input", async () => {
    const thinkTool = createThinkTool();
    const result = await thinkTool.invoke({ thought: "Let me consider the options..." });
    expect(result).toBe("ok");
  });

  it("accepts an empty thought string", async () => {
    const thinkTool = createThinkTool();
    const result = await thinkTool.invoke({ thought: "" });
    expect(result).toBe("ok");
  });
});
