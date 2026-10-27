// Pins the structured command result: its JSON form (status, sections,
// hints, the data payload), its human and quiet forms, and which stream each
// goes to: JSON data alone on stdout, every human and quiet line on stderr.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandResult, renderResult, resultToHuman, resultToJson, resultToQuiet } from "../command-result.js";

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

  it("emits the data payload in JSON only, and omits it when unset", () => {
    const result = CommandResult.warning("Plugin is valid").withData({ plugin: { name: "x" }, warnings: [] });
    const parsed = JSON.parse(resultToJson(result));
    expect(parsed.data).toEqual({ plugin: { name: "x" }, warnings: [] });
    expect(JSON.parse(resultToJson(CommandResult.success("ok")))).not.toHaveProperty("data");
    expect(resultToHuman(result, false)).not.toContain("plugin");
    expect(resultToQuiet(result, false)).toBe("⚠ Plugin is valid\n");
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

describe("CLI-01 data goes to stdout and everything else to stderr; -o json prints clean data", () => {
  let noColor: string | undefined;
  beforeEach(() => {
    noColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
  });
  afterEach(() => {
    if (noColor !== undefined) process.env.NO_COLOR = noColor;
  });

  function streams(isTTY: boolean) {
    const out = { stdout: "", stderr: "" };
    return {
      out,
      streams: {
        stdout: { write: (chunk: string) => (out.stdout += chunk) },
        stderr: { isTTY, write: (chunk: string) => (out.stderr += chunk) },
      },
    };
  }

  function created(): CommandResult {
    const result = CommandResult.success("Agent created").withData({ slug: "release-notes" });
    result.addSection().field("Name", "release-notes");
    result.hint("stigmer run release-notes");
    return result;
  }

  it("writes exactly one parseable document to stdout under json, and nothing to stderr", () => {
    const { out, streams: s } = streams(true);
    renderResult(created(), "json", s);
    expect(out.stderr).toBe("");
    expect(out.stdout.endsWith("}\n")).toBe(true);
    expect(JSON.parse(out.stdout)).toMatchObject({ status: "success", message: "Agent created", data: { slug: "release-notes" } });
  });

  it.each(["human", "quiet"] as const)("writes the %s form to stderr and nothing to stdout", (format) => {
    const { out, streams: s } = streams(false);
    renderResult(created(), format, s);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/^✓ Agent created\n/);
  });
});

