// Pins when the CLI colours its output: only an interactive terminal, never
// with NO_COLOR set to any value; the plain styler passes text through
// untouched; and the outputs a pipe reads (a command's result off a
// terminal, the plaintext run transcript) carry no escape code at all.
import { scenarios, SCENARIO_NAMES } from "@stigmer/react-sdk/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlaintextRenderer } from "../../resources/stream/render-plaintext.js";
import { CommandResult, renderResult } from "../command-result.js";
import { shouldColorize, styler } from "../style.js";

const ESCAPE = "\x1b";

describe("CLI-05 off a terminal there is no colour, spinner or prompt, and NO_COLOR is honoured", () => {
  let noColor: string | undefined;
  beforeEach(() => {
    noColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
  });
  afterEach(() => {
    if (noColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = noColor;
  });

  it("colours only an interactive terminal", () => {
    expect(shouldColorize({ isTTY: true })).toBe(true);
    expect(shouldColorize({ isTTY: false })).toBe(false);
    expect(shouldColorize({})).toBe(false);
  });

  it("turns colour off for any NO_COLOR value, and leaves it on for an empty one", () => {
    for (const value of ["1", "0", "false", "yes"]) {
      process.env.NO_COLOR = value;
      expect(shouldColorize({ isTTY: true }), `NO_COLOR=${value}`).toBe(false);
    }
    process.env.NO_COLOR = "";
    expect(shouldColorize({ isTTY: true })).toBe(true);
  });

  it("passes text through the plain styler, and wraps it only in the coloured one", () => {
    const plain = styler(false);
    for (const style of [plain.green, plain.yellow, plain.red, plain.cyan, plain.bold, plain.dim]) expect(style("text")).toBe("text");
    const coloured = styler(true);
    for (const style of [coloured.green, coloured.yellow, coloured.red, coloured.cyan, coloured.bold, coloured.dim]) {
      expect(style("text")).toContain(ESCAPE);
      expect(style("text")).toContain("text");
    }
  });

  it("writes a result piped off a terminal with no escape code, and colours it on one", () => {
    const write = (isTTY: boolean) => {
      let text = "";
      const sink = { isTTY, write: (chunk: string) => (text += chunk) };
      renderResult(CommandResult.warning("Plugin installed"), "human", { stdout: sink, stderr: sink });
      return text;
    };
    expect(write(false)).not.toContain(ESCAPE);
    expect(write(true)).toContain(ESCAPE);
    process.env.NO_COLOR = "1";
    expect(write(true)).not.toContain(ESCAPE);
  });

  it("writes every catalogue run's plaintext transcript with no escape code", () => {
    for (const name of SCENARIO_NAMES) {
      let text = "";
      const sink = { write: (chunk: string) => (text += chunk) };
      new PlaintextRenderer({ data: sink, status: sink }).fold(scenarios[name].fold);
      expect(text, name).not.toContain(ESCAPE);
    }
  });
});
