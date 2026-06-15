import { afterEach, describe, expect, it } from "vitest";
import { interactiveBrowseEnabled } from "./tty.js";

const TTY = { isTTY: true };
const PIPE = { isTTY: false };

describe("interactiveBrowseEnabled", () => {
  const originalTerm = process.env.TERM;
  afterEach(() => {
    process.env.TERM = originalTerm;
  });

  it("enables the picker for inline output on a full TTY", () => {
    process.env.TERM = "xterm-256color";
    expect(interactiveBrowseEnabled("inline", { stdin: TTY, stdout: TTY })).toBe(true);
  });

  it("disables the picker in JSON output mode", () => {
    process.env.TERM = "xterm-256color";
    expect(interactiveBrowseEnabled("json", { stdin: TTY, stdout: TTY })).toBe(false);
  });

  it("disables the picker when stdout is not a TTY (piped output)", () => {
    process.env.TERM = "xterm-256color";
    expect(interactiveBrowseEnabled("inline", { stdin: TTY, stdout: PIPE })).toBe(false);
  });

  it("disables the picker when stdin is not a TTY (piped input)", () => {
    process.env.TERM = "xterm-256color";
    expect(interactiveBrowseEnabled("inline", { stdin: PIPE, stdout: TTY })).toBe(false);
  });

  it("disables the picker on a dumb terminal", () => {
    process.env.TERM = "dumb";
    expect(interactiveBrowseEnabled("inline", { stdin: TTY, stdout: TTY })).toBe(false);
  });
});
