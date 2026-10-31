// Proves text another person wrote is printed with no control character
// left in it (../printable.ts): an escape sequence that would erase a line
// or write the clipboard reaches the terminal as harmless text, line breaks
// survive in a view and fold to spaces in a cell, a tab keeps its room.
import { describe, expect, it } from "vitest";
import { printable, printableCell } from "../printable.js";

const ERASE = "\u001b[1A\u001b[2K";
const CLIPBOARD = "\u001b]52;c;cGF5bG9hZA==\u0007";

describe("CLI-09 text another person wrote reaches the terminal with no control character", () => {
  it("removes C0 and C1 controls and DEL, keeping line breaks, and widens a tab", () => {
    expect(printable(`Review the ledger.${ERASE}\nFaked line${CLIPBOARD}\r\n\u009b31m\u007f\tdone`)).toBe(
      "Review the ledger.[1A[2K\nFaked line]52;c;cGF5bG9hZA==\n31m  done",
    );
    expect(printable("plain text, no change")).toBe("plain text, no change");
  });

  it("folds a cell's whitespace and controls into single spaces", () => {
    expect(printableCell(`  Drafts a report${ERASE}\n\n from the ledger\t `)).toBe("Drafts a report [1A [2K from the ledger");
  });
});
