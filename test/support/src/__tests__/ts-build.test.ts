// Unit arms for how the harness finds the servers it spawns: the Enterprise
// entry is the licensed test server under ee/server/test/conformance, run
// by the repository root's own tsx loader; the entry is handed out once the
// server's build exists and Enterprise's own dependencies are installed, and
// refused, naming the install, when they are not. The library entry is this
// checkout's by default, and another checkout's when its root is given (the
// live benchmark's `--stack`). The file system is stubbed for the refusal
// and the other checkout; nothing here builds or starts a server.
// Domain: test support (stack spawns).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// Paths the stubbed file system answers for, over the real one.
const missing = new Set<string>();
const present = new Set<string>();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: string) =>
      missing.has(String(path)) ? false : present.has(String(path)) || actual.existsSync(path),
  };
});

const {
  enterpriseServerEntryPath,
  ensureEnterpriseServerEntry,
  ensureLibraryServerEntry,
  libraryServerEntryPath,
  tsServerEntryPath,
  tsxLoaderUrl,
} = await import("../ts-build.ts");

afterEach(() => {
  missing.clear();
  present.clear();
});

const enterpriseModules = (): string =>
  enterpriseServerEntryPath().replace(/test\/conformance\/licensed-server\.ts$/, "node_modules");

describe("the Enterprise server entry", () => {
  it("is the licensed test server Enterprise keeps outside its published source", () => {
    const entry = enterpriseServerEntryPath();
    expect(entry).toMatch(/ee\/server\/test\/conformance\/licensed-server\.ts$/);
    expect(existsSync(entry)).toBe(true);
  });

  it("runs under the repository root's own tsx loader", () => {
    const loader = tsxLoaderUrl();
    expect(loader).toMatch(/^file:\/\/.*\/node_modules\/tsx\//);
    expect(existsSync(fileURLToPath(loader))).toBe(true);
  });

  it("is handed out once the server is built and Enterprise's dependencies are installed", async () => {
    // A built server and an installed Enterprise, so the ensure step only reads.
    present.add(tsServerEntryPath());
    present.add(enterpriseModules());
    expect(await ensureEnterpriseServerEntry()).toBe(enterpriseServerEntryPath());
  });

  it("is refused, naming the install, when Enterprise's dependencies are missing", async () => {
    present.add(tsServerEntryPath());
    missing.add(enterpriseModules());
    await expect(ensureEnterpriseServerEntry()).rejects.toThrow(
      "ee/server/node_modules is missing: the enterprise target runs Stigmer Enterprise from source " +
        "on its own dependencies; install them with `npm ci` in ee/server first",
    );
  });
});

describe("the library server entry", () => {
  it("is this checkout's by default", async () => {
    present.add(tsServerEntryPath());
    const entry = await ensureLibraryServerEntry();
    expect(entry).toBe(libraryServerEntryPath());
    expect(entry).toMatch(/test\/support\/src\/library-server\.mjs$/);
    expect(existsSync(entry)).toBe(true);
  });

  it("is another checkout's, beside that checkout's built server, when its root is given", async () => {
    const root = "/elsewhere/stigmer";
    present.add(tsServerEntryPath(root));
    expect(tsServerEntryPath(root)).toBe("/elsewhere/stigmer/backend/services/stigmer-server/dist/main.js");
    expect(await ensureLibraryServerEntry(root)).toBe("/elsewhere/stigmer/test/support/src/library-server.mjs");
  });
});
