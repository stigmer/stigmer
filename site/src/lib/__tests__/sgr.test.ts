/**
 * The terminal text renderer (../sgr.ts) and every recording the docs play
 * (../recordings.ts): the codes the terminal kit may write become styled
 * runs, any other code is refused, and every frame of every recording draws
 * through it, so a recording that starts carrying another code fails here.
 * The site holds a file for exactly the recordings the kit lists.
 */
import { describe, expect, it } from "vitest";
import { HELD_RECORDINGS, RECORDINGS, lastFrameText, recording } from "../recordings";
import { plainText, styledLines } from "../sgr";

describe("styledLines", () => {
  it("styles runs by the status hues and text styles, and ends each at its reset", () => {
    const lines = styledLines("\u001b[1mbold\u001b[22m plain\n\u001b[32m✓\u001b[39m \u001b[2;3mdim italic\u001b[0m");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.map((run) => [run.text, run.style.bold])).toEqual([
      ["bold", true],
      [" plain", false],
    ]);
    expect(lines[1]![0]).toEqual({ text: "✓", style: expect.objectContaining({ hue: "green" }) });
    expect(lines[1]![1]!.style.hue).toBeNull();
    expect(lines[1]![2]!.style).toMatchObject({ dim: true, italic: true });
    expect(styledLines("\u001b[31mx\u001b[33my\u001b[4;7mz\u001b[24;27mw\u001b[m")[0]!.map((run) => run.style)).toEqual([
      expect.objectContaining({ hue: "red" }),
      expect.objectContaining({ hue: "yellow", underline: false }),
      expect.objectContaining({ hue: "yellow", underline: true, inverse: true }),
      expect.objectContaining({ hue: "yellow", underline: false, inverse: false }),
    ]);
  });

  it("refuses a colour beyond the status hues, a background, and any other escape", () => {
    expect(() => styledLines("\u001b[34mblue")).toThrow(/SGR 34/);
    expect(() => styledLines("\u001b[38;5;200mpink")).toThrow(/SGR 38/);
    expect(() => styledLines("\u001b[41mred ground")).toThrow(/SGR 41/);
    expect(() => styledLines("\u001b[2Jcleared")).toThrow(/which the docs do not draw/);
  });

  it("reads plain text with every code gone", () => {
    expect(plainText("\u001b[1ma\u001b[22m\n\u001b[32mb\u001b[39m")).toBe("a\nb");
  });
});

describe("the recordings the docs play", () => {
  it("holds a file for exactly the recordings the terminal kit lists", () => {
    expect([...HELD_RECORDINGS].sort()).toEqual(RECORDINGS.map((entry) => entry.name).sort());
  });

  it.each(RECORDINGS.map((entry) => entry.name))("draws every frame of %s through the renderer", (name) => {
    const held = recording(name);
    expect(held.frames.length).toBeGreaterThan(2);
    for (const frame of held.frames) expect(() => styledLines(frame.text)).not.toThrow();
  });

  it("ends the scripted run on the answer, as the exports carry it", () => {
    const text = lastFrameText("run-approval");
    expect(text).toContain("Two changes this week");
    expect(text).not.toContain("\u001b[");
    expect(text.split("\n").length).toBeLessThanOrEqual(recording("run-approval").rows);
  });

  it("refuses a name the kit does not record", () => {
    expect(() => recording("run-denial")).toThrow(/no terminal recording named "run-denial".*"run-approval"/);
  });
});
