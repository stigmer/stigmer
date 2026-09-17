// Pins the two grammars: every accepted form of `[marketplace/]name[@version]`
// and every refusal with its sentence; every accepted form of an `add`
// source (a directory wins, then owner/repo[@ref], then the GitHub URL) and
// the refusals.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatInstallRef, parseAddSource, parseInstallRef } from "./ref.js";

describe("parseInstallRef", () => {
  it("reads a bare name, a marketplace prefix, a version, and all three", () => {
    expect(parseInstallRef("thermos")).toEqual({ name: "thermos" });
    expect(parseInstallRef("cursor-plugins/thermos")).toEqual({
      marketplace: "cursor-plugins",
      name: "thermos",
    });
    expect(parseInstallRef("thermos@1.0.0")).toEqual({
      name: "thermos",
      version: "1.0.0",
    });
    expect(parseInstallRef("stigmer/assistant@1.0.0")).toEqual({
      marketplace: "stigmer",
      name: "assistant",
      version: "1.0.0",
    });
    expect(parseInstallRef("third.party-x@v2-rc.1")).toEqual({
      name: "third.party-x",
      version: "v2-rc.1",
    });
  });

  it("round-trips through formatInstallRef", () => {
    for (const text of [
      "thermos",
      "cursor-plugins/thermos",
      "thermos@1.0.0",
      "a/b@c",
    ]) {
      expect(formatInstallRef(parseInstallRef(text))).toBe(text);
    }
  });

  it("refuses a path toward push plugin", () => {
    for (const path of [
      "./thermos",
      "../x",
      "/tmp/plugin",
      ".",
      "..",
      "~/plugins",
      "C:\\plugins",
    ]) {
      expect(() => parseInstallRef(path)).toThrow(
        /is a path.*stigmer push plugin/s,
      );
    }
  });

  it("refuses names and versions outside the grammar, naming the part", () => {
    expect(() => parseInstallRef("Thermos")).toThrow(
      /'Thermos' is not a plugin name/,
    );
    expect(() => parseInstallRef("a/b/c")).toThrow(
      /'b\/c' is not a plugin name/,
    );
    expect(() => parseInstallRef("Bad/thermos")).toThrow(
      /'Bad' is not a marketplace name/,
    );
    expect(() => parseInstallRef("thermos@")).toThrow(/'' is not a version/);
    expect(() => parseInstallRef("thermos@1.0+build")).toThrow(
      /'1.0\+build' is not a version/,
    );
    expect(() => parseInstallRef("")).toThrow(/'' is not a plugin name/);
    expect(() => parseInstallRef("a@b@c")).toThrow(/'b@c' is not a version/);
  });
});

describe("parseAddSource", () => {
  let cwd: string;

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "stigmer-add-source-"));
    mkdirSync(join(cwd, "plugins"));
    mkdirSync(join(cwd, "cursor", "plugins"), { recursive: true });
  });

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reads an existing directory as local, stored absolute, before any other reading", () => {
    expect(parseAddSource("plugins", cwd)).toEqual({
      type: "local",
      path: join(cwd, "plugins"),
    });
    expect(parseAddSource("./plugins/", cwd)).toEqual({
      type: "local",
      path: join(cwd, "plugins"),
    });
    expect(parseAddSource(join(cwd, "plugins"), cwd)).toEqual({
      type: "local",
      path: join(cwd, "plugins"),
    });
    // A directory named like an owner/repo is the directory.
    expect(parseAddSource("cursor/plugins", cwd)).toEqual({
      type: "local",
      path: join(cwd, "cursor", "plugins"),
    });
  });

  it("reads owner/repo and owner/repo@ref as github when no such directory exists", () => {
    expect(parseAddSource("anthropics/claude-code", cwd)).toEqual({
      type: "github",
      repo: "anthropics/claude-code",
    });
    expect(parseAddSource("anthropics/claude-code@v1.0", cwd)).toEqual({
      type: "github",
      repo: "anthropics/claude-code",
      ref: "v1.0",
    });
    expect(parseAddSource("openai/codex@refs/heads/main", cwd)).toEqual({
      type: "github",
      repo: "openai/codex",
      ref: "refs/heads/main",
    });
  });

  it("unwraps the GitHub URL a browser shows, with or without a tree ref", () => {
    expect(parseAddSource("https://github.com/cursor/plugins", cwd)).toEqual({
      type: "github",
      repo: "cursor/plugins",
    });
    expect(parseAddSource("https://github.com/cursor/plugins/", cwd)).toEqual({
      type: "github",
      repo: "cursor/plugins",
    });
    expect(
      parseAddSource("https://github.com/cursor/plugins.git", cwd),
    ).toEqual({ type: "github", repo: "cursor/plugins" });
    expect(
      parseAddSource("https://www.github.com/cursor/plugins/tree/main", cwd),
    ).toEqual({
      type: "github",
      repo: "cursor/plugins",
      ref: "main",
    });
    expect(
      parseAddSource("http://github.com/openai/codex/tree/release/1.2", cwd),
    ).toEqual({
      type: "github",
      repo: "openai/codex",
      ref: "release/1.2",
    });
  });

  it("refuses what is neither, naming the three forms", () => {
    expect(() => parseAddSource("", cwd)).toThrow(/source is required/);
    expect(() => parseAddSource("missing-dir", cwd)).toThrow(
      /not a marketplace source/,
    );
    expect(() => parseAddSource("./missing-dir", cwd)).toThrow(
      /not a directory on this machine and not a GitHub/,
    );
    expect(() => parseAddSource("a/b/c", cwd)).toThrow(
      /not a directory on this machine and not a GitHub/,
    );
    expect(() => parseAddSource("cursor/plugins@", cwd)).toThrow(
      /not a marketplace source|not a directory/,
    );
    expect(() => parseAddSource("https://gitlab.com/a/b", cwd)).toThrow(
      /not a directory on this machine and not a GitHub/,
    );
    expect(() => parseAddSource("https://github.com/cursor", cwd)).toThrow(
      /not a directory on this machine and not a GitHub/,
    );
  });
});
