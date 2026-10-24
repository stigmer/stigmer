/**
 * A background command's output file failing never fails the command
 * (`../background-commands.ts`): a file that cannot be written, or cannot
 * be closed, leaves the command running and its ending recorded, since the
 * agent is told the end of its output from the command runner's own copy.
 * The file system is doubled here, because a write to an open file fails
 * only when the disk is full.
 */

import { describe, expect, it, vi } from "vitest";

const { failing } = vi.hoisted(() => ({
  failing: {
    write: vi.fn(() => Promise.reject(new Error("ENOSPC"))),
    close: vi.fn(() => Promise.reject(new Error("EIO"))),
  },
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  open: vi.fn(async () => failing),
}));

import { BackgroundCommands } from "../background-commands.js";

describe("a background command's output file", () => {
  it("failing to write and to close leaves the command and its ending whole", async () => {
    const commands = new BackgroundCommands();
    commands.start({
      id: "bg_1",
      command: "echo hi",
      timeoutSeconds: 60,
      outputPath: "/offload/background-bg_1.log",
      run: async ({ onOutput }) => {
        onOutput("hi\n");
        return { stdout: "hi\n", stderr: "", exitCode: 0, timedOut: false, aborted: false, truncated: false };
      },
    });
    await commands.whenAnyEnds(["bg_1"], new AbortController().signal);
    expect(failing.write).toHaveBeenCalled();
    expect(failing.close).toHaveBeenCalled();
    expect(commands.get("bg_1")?.result?.stdout).toBe("hi\n");
  });
});
