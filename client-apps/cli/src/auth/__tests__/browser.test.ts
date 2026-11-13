// Unit tests for opening the person's browser (auth/browser.ts): `BROWSER` is
// run with the address as its one argument, never pasted into a command line,
// so shell syntax in an address stays text; and a browser can open with
// `BROWSER` set or a desktop session, never over SSH or with no display.

import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canOpenBrowser, openBrowser } from "../browser.js";

describe("canOpenBrowser", () => {
  it.each<[string, NodeJS.ProcessEnv, NodeJS.Platform, boolean]>([
    ["BROWSER set anywhere", { BROWSER: "lynx", SSH_CONNECTION: "a b c d" }, "linux", true],
    ["a Mac desktop", {}, "darwin", true],
    ["a Mac over SSH", { SSH_CONNECTION: "a b c d" }, "darwin", false],
    ["Linux with a display", { DISPLAY: ":0" }, "linux", true],
    ["Linux on Wayland", { WAYLAND_DISPLAY: "wayland-0" }, "linux", true],
    ["Linux with no display (a container, a sandbox)", {}, "linux", false],
  ])("%s", (_label, env, platform, can) => {
    expect(canOpenBrowser(env, platform)).toBe(can);
  });
});

describe.skipIf(process.platform === "win32")("openBrowser with BROWSER", () => {
  it("runs the command with the address as one argument, shell syntax kept as text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-browser-"));
    const received = join(dir, "received");
    const planted = join(dir, "planted");
    const script = join(dir, "fake-browser");
    writeFileSync(script, `#!/bin/sh\nprintf '%s' "$1" > '${received}'\n`);
    chmodSync(script, 0o755);
    const url = `https://id.example.test/authorize?state=a&x=$(touch ${planted});touch ${planted}`;

    await openBrowser(url, { BROWSER: script });
    for (let i = 0; i < 100 && !existsSync(received); i++) await new Promise((r) => setTimeout(r, 20));

    expect(readFileSync(received, "utf8")).toBe(url);
    expect(existsSync(planted)).toBe(false);
  });
});
