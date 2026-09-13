// Pins the process-identity reader: the kernel's /proc answer comes first, `ps`
// is the fallback, and neither's absence is mistaken for "not Temporal" when the
// other can answer. The /proc arm is what keeps a minimal container (no `ps`)
// from restarting a healthy Temporal every supervisor tick.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isLikelyTemporal, processCommandLine } from "./inspect.js";

function procFixture(entries: Record<number, string[] | "">): string {
  const root = mkdtempSync(join(tmpdir(), "stigmer-proc-"));
  for (const [pid, argv] of Object.entries(entries)) {
    mkdirSync(join(root, pid));
    // /proc/<pid>/cmdline: argv joined by NUL, NUL-terminated; empty for a zombie.
    writeFileSync(join(root, pid, "cmdline"), argv === "" ? "" : `${argv.join("\0")}\0`);
  }
  return root;
}

// Hide `ps` so the fallback cannot answer; tests that need it restore PATH.
let savedPath: string | undefined;
beforeEach(() => {
  savedPath = process.env.PATH;
});
afterEach(() => {
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
});

describe("processCommandLine", () => {
  it("reads argv from <procRoot>/<pid>/cmdline, joining the NUL-separated arguments", () => {
    const root = procFixture({ 42: ["/opt/stigmer/bin/temporal", "server", "start-dev", "--port", "7233"] });
    process.env.PATH = "";
    expect(processCommandLine(42, { procRoot: root })).toBe("/opt/stigmer/bin/temporal server start-dev --port 7233");
  });

  it("falls back to ps when the pid has no cmdline entry", () => {
    const root = procFixture({});
    // Our own process is the one PID whose command line `ps` can always report.
    const line = processCommandLine(process.pid, { procRoot: root });
    expect(line).not.toBeNull();
    expect(line).toMatch(/node|vitest/);
  });

  it("treats an empty cmdline (a zombie) as unreadable and falls back to ps", () => {
    const root = procFixture({ [process.pid]: "" });
    expect(processCommandLine(process.pid, { procRoot: root })).toMatch(/node|vitest/);
  });

  it("returns null when neither /proc nor ps can answer", () => {
    process.env.PATH = "";
    expect(processCommandLine(process.pid, { procRoot: null })).toBeNull();
  });
});

describe("isLikelyTemporal", () => {
  it("recognises the managed dev server by its binary path", () => {
    const root = procFixture({ 7: ["/home/u/.stigmer/bin/temporal", "server", "start-dev"] });
    process.env.PATH = "";
    expect(isLikelyTemporal(7, "/home/u/.stigmer/bin/temporal", { procRoot: root })).toBe(true);
  });

  it("recognises a temporal server started from another path by its subcommand", () => {
    const root = procFixture({ 8: ["/usr/local/bin/temporal", "server", "start-dev"] });
    process.env.PATH = "";
    expect(isLikelyTemporal(8, "/elsewhere/temporal", { procRoot: root })).toBe(true);
  });

  it("rejects an unrelated process that reused the pid", () => {
    const root = procFixture({ 9: ["/usr/bin/node", "/app/main.js"] });
    process.env.PATH = "";
    expect(isLikelyTemporal(9, "/home/u/.stigmer/bin/temporal", { procRoot: root })).toBe(false);
  });

  // The defect the /proc arm fixes: with `ps` gone and no /proc reader, a live
  // Temporal read as "not Temporal" and the supervisor restarted it forever.
  it("is false, not an exception, when no reader can answer", () => {
    process.env.PATH = "";
    expect(isLikelyTemporal(process.pid, "/x/temporal", { procRoot: null })).toBe(false);
  });
});
