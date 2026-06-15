import { describe, expect, it } from "vitest";
import { CommandResult, resultToHuman, resultToJson, resultToQuiet } from "./command-result.js";

describe("resultToJson", () => {
  it("emits status as a lowercase string", () => {
    expect(JSON.parse(resultToJson(CommandResult.success("ok"))).status).toBe("success");
    expect(JSON.parse(resultToJson(CommandResult.warning("w"))).status).toBe("warning");
    expect(JSON.parse(resultToJson(CommandResult.error("e"))).status).toBe("error");
  });

  it("omits empty sections and hints", () => {
    const parsed = JSON.parse(resultToJson(CommandResult.success("done")));
    expect(parsed).not.toHaveProperty("sections");
    expect(parsed).not.toHaveProperty("hints");
  });

  it("serializes sections (fields + items) and hints", () => {
    const result = CommandResult.success("Created");
    result.addSection("Details").field("ID", "abc").field("Name", "agent");
    result.addSection("Items").item("first").item("second");
    result.hint("try this").hint("and that");

    const parsed = JSON.parse(resultToJson(result));
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]).toEqual({
      title: "Details",
      fields: [
        { key: "ID", value: "abc" },
        { key: "Name", value: "agent" },
      ],
    });
    expect(parsed.sections[1]).toEqual({ title: "Items", items: ["first", "second"] });
    expect(parsed.hints).toEqual(["try this", "and that"]);
  });
});

describe("resultToHuman (plain, no color)", () => {
  it("renders the status icon, message, fields, and hints", () => {
    const result = CommandResult.success("Created agent");
    result.addSection("Details").field("ID", "agt-123");
    result.hint("Run: stigmer get agent agt-123");

    const out = resultToHuman(result, false);
    expect(out).toContain("✓ Created agent");
    expect(out).toContain("Details:");
    expect(out).toContain("ID");
    expect(out).toContain("agt-123");
    expect(out).toContain("Run: stigmer get agent agt-123");
  });

  it("uses an error icon for error results", () => {
    expect(resultToHuman(CommandResult.error("boom"), false)).toContain("✗ boom");
  });
});

describe("resultToQuiet (plain, no color)", () => {
  it("renders only the status line", () => {
    const result = CommandResult.success("Done");
    result.addSection("Details").field("ID", "abc");
    const out = resultToQuiet(result, false);
    expect(out).toBe("✓ Done\n");
    expect(out).not.toContain("Details");
  });
});
