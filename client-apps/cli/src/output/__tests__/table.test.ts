// The shared table renderer: aligned columns under a dash separator, and
// (CLI-09) a fit to the terminal's width that cuts only the free-text
// columns a caller names, widest first, to a floor of 12, measured in
// terminal columns so wide characters and emoji count as the two they fill,
// and never cut piped. The expected lines are written out whole, so a
// flipped comparison or an off-by-one in the fit changes one and fails.
import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import { renderEmpty, renderTable, SHRINK_FLOOR, terminalWidth } from "../table.js";

/** The rendered lines, without the final newline. */
function lines(out: string): string[] {
  return out.trimEnd().split("\n");
}

describe("renderTable", () => {
  it("returns empty string for no rows", () => {
    expect(renderTable(["NAME", "KIND"], [])).toBe("");
  });

  it("renders aligned columns with a dash separator", () => {
    const out = renderTable(
      ["NAME", "KIND"],
      [
        ["my-agent", "agent"],
        ["github", "mcp_server"],
      ],
    );
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe("NAME       KIND");
    expect(lines[1]).toBe("--------   ----------");
    expect(lines[2]).toBe("my-agent   agent");
    expect(lines[3]).toBe("github     mcp_server");
  });

  it("tolerates short rows by padding missing cells", () => {
    const out = renderTable(["A", "B"], [["only"]]);
    expect(out.trimEnd().split("\n")[2]).toBe("only");
  });
});

describe("CLI-09 a table fits the terminal's width", () => {
  const forty = "d".repeat(40);

  it("cuts nothing when the row fits exactly", () => {
    // 3 + 3 (gap) + 40 = 46 columns.
    const out = renderTable(["ID", "DESCRIPTION"], [["abc", forty]], { width: 46, shrink: ["DESCRIPTION"] });
    expect(lines(out)).toEqual(["ID    DESCRIPTION", `---   ${"-".repeat(40)}`, `abc   ${forty}`]);
  });

  it("takes the one column a row is too wide by from the shrinkable column, and ends it in …", () => {
    const out = renderTable(["ID", "DESCRIPTION"], [["abc", forty]], { width: 45, shrink: ["DESCRIPTION"] });
    expect(lines(out)).toEqual(["ID    DESCRIPTION", `---   ${"-".repeat(39)}`, `abc   ${"d".repeat(38)}…`]);
    expect(stringWidth(lines(out)[2]!)).toBe(45);
  });

  it("cuts nothing without a width, as when piped", () => {
    const out = renderTable(["ID", "DESCRIPTION"], [["abc", forty]], { shrink: ["DESCRIPTION"] });
    expect(lines(out)[2]).toBe(`abc   ${forty}`);
  });

  it("cuts nothing when no column may shrink, and leaves the terminal to wrap the row", () => {
    const out = renderTable(["ID", "DESCRIPTION"], [["abc", forty]], { width: 20 });
    expect(lines(out)[2]).toBe(`abc   ${forty}`);
  });

  it("never cuts a column it is not told may shrink, an id or a slug", () => {
    const id = "ses_".padEnd(30, "0");
    const out = renderTable(["ID", "SUBJECT"], [[id, forty]], { width: 50, shrink: ["SUBJECT"] });
    // 30 + 3 + 17 = 50: the subject gives up all 23 columns, the id none.
    expect(lines(out)[2]).toBe(`${id}   ${"d".repeat(16)}…`);
  });

  it("takes width from the widest shrinkable column first, then from each in turn, the leftmost of equals first", () => {
    const row = ["id1", "n".repeat(20), "d".repeat(30)];
    const shrink = ["NAME", "DESCRIPTION"];
    // Natural: 3 + 3 + 20 + 3 + 30 = 59. Five over: all from the widest.
    expect(lines(renderTable(["ID", "NAME", "DESCRIPTION"], [row], { width: 54, shrink }))[2]).toBe(
      `id1   ${"n".repeat(20)}   ${"d".repeat(24)}…`,
    );
    // Fifteen over: DESCRIPTION comes down to 20, then the two take turns, NAME first: 17 and 18.
    expect(lines(renderTable(["ID", "NAME", "DESCRIPTION"], [row], { width: 44, shrink }))).toEqual([
      `ID    NAME${" ".repeat(13)}   DESCRIPTION`,
      `---   ${"-".repeat(17)}   ${"-".repeat(18)}`,
      `id1   ${"n".repeat(16)}…   ${"d".repeat(17)}…`,
    ]);
  });

  it(`stops every shrinkable column at the floor of ${SHRINK_FLOOR}`, () => {
    expect(SHRINK_FLOOR).toBe(12);
    const row = ["id1", "n".repeat(20), "d".repeat(30)];
    const out = renderTable(["ID", "NAME", "DESCRIPTION"], [row], { width: 10, shrink: ["NAME", "DESCRIPTION"] });
    expect(lines(out)[2]).toBe(`id1   ${"n".repeat(11)}…   ${"d".repeat(11)}…`);
  });

  it("leaves a column already at or under the floor whole", () => {
    const out = renderTable(["ID", "DESCRIPTION"], [["abc", "d".repeat(SHRINK_FLOOR)]], { width: 5, shrink: ["DESCRIPTION"] });
    expect(lines(out)[2]).toBe(`abc   ${"d".repeat(SHRINK_FLOOR)}`);
  });

  it("sizes a column to a header wider than its cells, and never cuts a header", () => {
    const heading = "A LONG HEADING HERE";
    const fits = renderTable(["ID", heading], [["abc", "short"]], { width: 3 + 3 + heading.length, shrink: [heading] });
    expect(lines(fits)).toEqual([`ID    ${heading}`, `---   ${"-".repeat(heading.length)}`, "abc   short"]);
    const narrow = renderTable(["ID", heading], [["abc", "short"]], { width: 10, shrink: [heading] });
    expect(lines(narrow)[0]).toBe(`ID    ${heading}`);
  });

  it("stops a column at its header when the header is wider than the floor", () => {
    const heading = "LONGER HEADING"; // 14 columns
    const out = renderTable([heading, "ID"], [["t".repeat(30), "abc"]], { width: 10, shrink: [heading] });
    expect(lines(out)).toEqual([`${heading}   ID`, `${"-".repeat(14)}   ---`, `${"t".repeat(13)}…   abc`]);
  });

  it("drops the space before the ellipsis when the cut falls at a word break", () => {
    const out = renderTable(["DESCRIPTION", "ID"], [["alpha beta gamma delta epsilon", "abc"]], {
      width: 18,
      shrink: ["DESCRIPTION"],
    });
    // DESCRIPTION is 12 wide: "alpha beta " fits beside the ellipsis, its space goes, and the cell pads to 12.
    expect(lines(out)[2]).toBe("alpha beta…    abc");
  });

  it("counts a wide character as two columns and pads around it by what it fills", () => {
    const cjk = "日本語のテキストです"; // ten characters, twenty columns
    const piped = renderTable(["ID", "DESCRIPTION", "X"], [["a", cjk, "z"]]);
    expect(lines(piped)[1]).toBe(`--   ${"-".repeat(20)}   -`);
    // Natural: 2 + 3 + 20 + 3 + 1 = 29. At 25 the description is 16 wide: seven characters (14), "…", one space.
    const out = renderTable(["ID", "DESCRIPTION", "X"], [["a", cjk, "z"]], { width: 25, shrink: ["DESCRIPTION"] });
    expect(lines(out)[2]).toBe("a    日本語のテキス…    z");
    expect(stringWidth(lines(out)[2]!)).toBe(25);
  });

  it("never splits an emoji, a surrogate pair or a combined character", () => {
    const thumbs = "👍🏽".repeat(10); // a skin-toned emoji: two code points, four UTF-16 units, two columns
    const emoji = renderTable(["ID", "DESCRIPTION"], [["abc", thumbs]], { width: 3 + 3 + 13, shrink: ["DESCRIPTION"] });
    expect(lines(emoji)[2]).toBe(`abc   ${"👍🏽".repeat(6)}…`);

    const accented = "é".repeat(20); // "é" as a letter and a combining accent, one column each
    const combined = renderTable(["ID", "DESCRIPTION"], [["abc", accented]], { width: 3 + 3 + 13, shrink: ["DESCRIPTION"] });
    expect(lines(combined)[2]).toBe(`abc   ${"é".repeat(12)}…`);
  });
});

describe("CLI-09 terminalWidth reads the width a table fits", () => {
  it("is the columns of a terminal", () => {
    expect(terminalWidth({ isTTY: true, columns: 80 })).toBe(80);
  });

  it("is undefined piped, or where a terminal reports no width", () => {
    expect(terminalWidth({ isTTY: false, columns: 80 })).toBeUndefined();
    expect(terminalWidth({ columns: 80 })).toBeUndefined();
    expect(terminalWidth({ isTTY: true })).toBeUndefined();
    expect(terminalWidth({ isTTY: true, columns: 0 })).toBeUndefined();
  });

  it("reads stdout by default, which a test's worker sees piped", () => {
    expect(terminalWidth()).toBe(terminalWidth(process.stdout));
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
