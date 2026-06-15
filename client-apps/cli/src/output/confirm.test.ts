import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { confirm } from "./confirm.js";

// A PassThrough masquerading as an interactive TTY input, with a writable sink
// for the prompt text we don't need to inspect.
function ttyPair(isTTY: boolean): { input: NodeJS.ReadStream; output: NodeJS.WritableStream } {
  const input = new PassThrough();
  (input as unknown as { isTTY: boolean }).isTTY = isTTY;
  return { input: input as unknown as NodeJS.ReadStream, output: new PassThrough() };
}

async function answer(reply: string): Promise<boolean> {
  const { input, output } = ttyPair(true);
  const pending = confirm("Proceed? [y/N]", { input, output });
  (input as unknown as PassThrough).write(`${reply}\n`);
  return pending;
}

describe("confirm", () => {
  it("auto-confirms when forced, without reading input", async () => {
    expect(await confirm("Proceed? [y/N]", { force: true })).toBe(true);
  });

  it("refuses (no prompt) when input is not a TTY", async () => {
    const { input, output } = ttyPair(false);
    expect(await confirm("Proceed? [y/N]", { input, output })).toBe(false);
  });

  it.each([
    ["y", true],
    ["Y", true],
    ["yes", true],
    ["YES", true],
    [" y ", true],
    ["n", false],
    ["no", false],
    ["", false],
    ["nope", false],
  ])("interprets %j as %s", async (reply, expected) => {
    expect(await answer(reply)).toBe(expected);
  });
});
