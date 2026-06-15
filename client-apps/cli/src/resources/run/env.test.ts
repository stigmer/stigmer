// Unit tests for runtime-env assembly: dotenv parsing, flag parsing, precedence,
// and quote/escape handling. The precedence ordering is a wire-parity contract
// with the Go CLI, so it gets dedicated coverage.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAndMergeEnv } from "./env.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "env-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFile(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

const NONE = { envFlags: [], secretFlags: [], envFiles: [], secretFiles: [] };

describe("loadAndMergeEnv flags", () => {
  it("parses plain KEY=VALUE env flags as non-secrets", () => {
    expect(loadAndMergeEnv({ ...NONE, envFlags: ["FOO=bar", "BAZ=qux"] })).toEqual({
      FOO: { value: "bar", isSecret: false },
      BAZ: { value: "qux", isSecret: false },
    });
  });

  it("parses secret flags as secrets", () => {
    expect(loadAndMergeEnv({ ...NONE, secretFlags: ["TOKEN=abc"] })).toEqual({
      TOKEN: { value: "abc", isSecret: true },
    });
  });

  it("rejects a flag without '='", () => {
    expect(() => loadAndMergeEnv({ ...NONE, envFlags: ["NOEQUALS"] })).toThrow(/missing '=' separator/);
  });

  it("rejects an invalid key", () => {
    expect(() => loadAndMergeEnv({ ...NONE, envFlags: ["1BAD=x"] })).toThrow(/invalid key/);
  });

  it("keeps everything after the first '=' as the value", () => {
    expect(loadAndMergeEnv({ ...NONE, envFlags: ["URL=https://a.b/c?d=e"] })).toEqual({
      URL: { value: "https://a.b/c?d=e", isSecret: false },
    });
  });
});

describe("loadAndMergeEnv files", () => {
  it("parses comments, blanks, export prefix, and quoted values", () => {
    const path = writeFile(
      ".env",
      ["# comment", "", "export FOO=bar", 'QUOTED="hello world"', "SINGLE='single'"].join("\n"),
    );
    expect(loadAndMergeEnv({ ...NONE, envFiles: [path] })).toEqual({
      FOO: { value: "bar", isSecret: false },
      QUOTED: { value: "hello world", isSecret: false },
      SINGLE: { value: "single", isSecret: false },
    });
  });

  it("treats secret files as all-secret", () => {
    const path = writeFile("secrets.env", "API_KEY=xyz\n");
    expect(loadAndMergeEnv({ ...NONE, secretFiles: [path] })).toEqual({
      API_KEY: { value: "xyz", isSecret: true },
    });
  });

  it("reports the file and line on a parse error", () => {
    const path = writeFile(".env", "GOOD=1\nBADLINE\n");
    expect(() => loadAndMergeEnv({ ...NONE, envFiles: [path] })).toThrow(/:2:/);
  });

  it("errors clearly when a file is missing", () => {
    expect(() => loadAndMergeEnv({ ...NONE, envFiles: [join(dir, "nope.env")] })).toThrow(
      /failed to open environment file/,
    );
  });
});

describe("loadAndMergeEnv precedence (later wins)", () => {
  it("layers env-files < secret-files < --env < --secret", () => {
    const envFile = writeFile("a.env", "K=from-env-file\n");
    const secretFile = writeFile("b.env", "K=from-secret-file\n");
    // secret-file beats env-file:
    expect(loadAndMergeEnv({ ...NONE, envFiles: [envFile], secretFiles: [secretFile] })).toEqual({
      K: { value: "from-secret-file", isSecret: true },
    });
    // --env beats secret-file:
    expect(
      loadAndMergeEnv({ ...NONE, secretFiles: [secretFile], envFlags: ["K=from-env-flag"] }),
    ).toEqual({ K: { value: "from-env-flag", isSecret: false } });
    // --secret beats --env:
    expect(loadAndMergeEnv({ ...NONE, envFlags: ["K=from-env"], secretFlags: ["K=from-secret"] })).toEqual({
      K: { value: "from-secret", isSecret: true },
    });
  });

  it("applies later files within the same tier last", () => {
    const first = writeFile("first.env", "K=first\n");
    const second = writeFile("second.env", "K=second\n");
    expect(loadAndMergeEnv({ ...NONE, envFiles: [first, second] })).toEqual({
      K: { value: "second", isSecret: false },
    });
  });
});

describe("escape handling matches Go's single-pass replacer", () => {
  it("does not double-process a literal backslash-n", () => {
    // "\\n" in the file is backslash + backslash + n; Go yields backslash + n,
    // NOT a newline. A naive chained replace would wrongly produce a newline.
    const path = writeFile(".env", 'K="\\\\n"\n');
    expect(loadAndMergeEnv({ ...NONE, envFiles: [path] })).toEqual({
      K: { value: "\\n", isSecret: false },
    });
  });

  it("unescapes real escape sequences", () => {
    const path = writeFile(".env", 'K="a\\tb\\nc"\n');
    expect(loadAndMergeEnv({ ...NONE, envFiles: [path] })).toEqual({
      K: { value: "a\tb\nc", isSecret: false },
    });
  });
});
