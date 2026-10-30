// Pins terminalMode: live only on a TTY stdout, with TERM not dumb and no CI
// flag (read as is-in-ci reads them: "0" and "false" are off); answering
// needs a live screen and a TTY stdin, so a terminal's stdin with stdout piped
// cannot answer.
import { describe, expect, it } from "vitest";
import { terminalMode } from "../terminal-mode.js";

const tty = { isTTY: true };
const pipe = { isTTY: false };

describe("terminalMode", () => {
  it.each([
    ["a terminal", tty, tty, {}, { live: true, canAnswer: true }],
    ["stdout piped", tty, pipe, {}, { live: false, canAnswer: false }],
    ["stdin piped", pipe, tty, {}, { live: true, canAnswer: false }],
    ["both piped", pipe, pipe, {}, { live: false, canAnswer: false }],
    ["a dumb terminal", tty, tty, { TERM: "dumb" }, { live: false, canAnswer: false }],
    ["CI", tty, tty, { CI: "true" }, { live: false, canAnswer: false }],
    ["CONTINUOUS_INTEGRATION", tty, tty, { CONTINUOUS_INTEGRATION: "1" }, { live: false, canAnswer: false }],
    ["CI switched off with 0", tty, tty, { CI: "0" }, { live: true, canAnswer: true }],
    ["CI switched off with false", tty, tty, { CI: "false" }, { live: true, canAnswer: true }],
    ["a stream that says nothing", {}, {}, {}, { live: false, canAnswer: false }],
  ])("%s", (_name, stdin, stdout, env, expected) => {
    expect(terminalMode({ stdin, stdout, env })).toEqual(expected);
  });
});
