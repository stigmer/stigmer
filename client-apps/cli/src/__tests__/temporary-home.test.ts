// Pins the suite's temporary home (__test-utils__/temporary-home.ts): every
// test file starts in a fresh folder under the system's temporary directory,
// never the developer's own home, and `os.homedir()`, through both of the
// ways the CLI imports it, follows HOME when a test redirects it further.
import os, { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("the suite's home", () => {
  const start = process.env.HOME;
  afterEach(() => {
    process.env.HOME = start;
  });

  it("is a fresh folder under the temporary directory", () => {
    expect(start).toBeDefined();
    expect(start!.startsWith(join(tmpdir(), "stigmer-cli-test-home-"))).toBe(true);
    expect(homedir()).toBe(start);
    expect(os.homedir()).toBe(start);
  });

  it("follows HOME when a test redirects it", () => {
    process.env.HOME = join(tmpdir(), "elsewhere");
    expect(homedir()).toBe(join(tmpdir(), "elsewhere"));
    expect(os.homedir()).toBe(join(tmpdir(), "elsewhere"));
  });
});
