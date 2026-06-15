import { describe, expect, it } from "vitest";
import { renderEmpty, renderTable } from "./table.js";

describe("renderTable", () => {
  it("returns empty string for no rows", () => {
    expect(renderTable(["NAME", "KIND"], [])).toBe("");
  });

  it("renders aligned columns with a dash separator", () => {
    const out = renderTable(
      ["NAME", "KIND"],
      [
        ["my-agent", "agent"],
        ["wf", "workflow"],
      ],
    );
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe("NAME       KIND");
    expect(lines[1]).toBe("--------   --------");
    expect(lines[2]).toBe("my-agent   agent");
    expect(lines[3]).toBe("wf         workflow");
  });

  it("tolerates short rows by padding missing cells", () => {
    const out = renderTable(["A", "B"], [["only"]]);
    expect(out.trimEnd().split("\n")[2]).toBe("only");
  });
});

describe("renderEmpty", () => {
  it("reports an unfiltered empty state", () => {
    expect(renderEmpty("agents")).toBe("\nNo agents found\n\n");
  });
  it("reports a query-filtered empty state", () => {
    expect(renderEmpty("agents", "foo")).toBe("\nNo agents found matching 'foo'\n\n");
  });
});
