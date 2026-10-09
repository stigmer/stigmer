// Unit tests for a run's own values: dotenv parsing, flag parsing, precedence,
// and quote/escape handling. The precedence ordering is a wire-parity contract
// with the Go CLI, so it gets dedicated coverage. A conversation's secret
// needs a value and a conversation keeps at most 100, so empty values are
// left out with a notice naming only their keys, and more are refused. A
// malformed flag is refused naming the flag and at most its key, never the
// text after the '=' (or a whole entry with no '='), which may be the secret.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EnvSources, MAX_SESSION_SECRETS, loadSessionSecrets } from "../env.js";

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

describe("loadSessionSecrets flags", () => {
  it("parses KEY=VALUE env flags", () => {
    expect(loadSessionSecrets({ ...NONE, envFlags: ["FOO=bar", "BAZ=qux"] })).toEqual({
      FOO: "bar",
      BAZ: "qux",
    });
  });

  it("parses secret flags", () => {
    expect(loadSessionSecrets({ ...NONE, secretFlags: ["TOKEN=abc"] })).toEqual({
      TOKEN: "abc",
    });
  });

  it("rejects a flag without '='", () => {
    expect(() => loadSessionSecrets({ ...NONE, envFlags: ["NOEQUALS"] })).toThrow(/missing '=' separator/);
  });

  it("rejects an invalid key", () => {
    expect(() => loadSessionSecrets({ ...NONE, envFlags: ["1BAD=x"] })).toThrow(/invalid key/);
  });

  it("never echoes the value of a malformed flag", () => {
    const refusal = (sources: Partial<EnvSources>): string => {
      try {
        loadSessionSecrets({ ...NONE, ...sources });
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error("expected a refusal");
    };
    const noEquals = refusal({ secretFlags: ["sk-live-noequals"] });
    expect(noEquals).toBe("invalid --secret value: invalid format: missing '=' separator");
    const badKey = refusal({ envFlags: ["1BAD=sk-live-badkey"] });
    expect(badKey).toBe('invalid --env value: invalid key "1BAD": must contain only letters, numbers, and underscores');
    const emptyKey = refusal({ secretFlags: ["=sk-live-emptykey"] });
    expect(emptyKey).toBe("invalid --secret value: empty key");
    const comment = refusal({ envFlags: ["#TOKEN=sk-live-comment"] });
    expect(comment).toBe("invalid --env value: empty or a comment, expected KEY=VALUE");
    for (const message of [noEquals, badKey, emptyKey, comment]) expect(message).not.toContain("sk-live");
  });

  it("keeps everything after the first '=' as the value", () => {
    expect(loadSessionSecrets({ ...NONE, envFlags: ["URL=https://a.b/c?d=e"] })).toEqual({
      URL: "https://a.b/c?d=e",
    });
  });
});

describe("loadSessionSecrets files", () => {
  it("parses comments, blanks, export prefix, and quoted values", () => {
    const path = writeFile(
      ".env",
      ["# comment", "", "export FOO=bar", 'QUOTED="hello world"', "SINGLE='single'"].join("\n"),
    );
    expect(loadSessionSecrets({ ...NONE, envFiles: [path] })).toEqual({
      FOO: "bar",
      QUOTED: "hello world",
      SINGLE: "single",
    });
  });

  it("parses secret files", () => {
    const path = writeFile("secrets.env", "API_KEY=xyz\n");
    expect(loadSessionSecrets({ ...NONE, secretFiles: [path] })).toEqual({
      API_KEY: "xyz",
    });
  });

  it("reports the file and line on a parse error", () => {
    const path = writeFile(".env", "GOOD=1\nBADLINE\n");
    expect(() => loadSessionSecrets({ ...NONE, envFiles: [path] })).toThrow(/:2:/);
  });

  it("errors clearly when a file is missing", () => {
    expect(() => loadSessionSecrets({ ...NONE, envFiles: [join(dir, "nope.env")] })).toThrow(
      /failed to open environment file/,
    );
  });
});

describe("loadSessionSecrets precedence (later wins)", () => {
  it("layers env-files < secret-files < --env < --secret", () => {
    const envFile = writeFile("a.env", "K=from-env-file\n");
    const secretFile = writeFile("b.env", "K=from-secret-file\n");
    // secret-file beats env-file:
    expect(loadSessionSecrets({ ...NONE, envFiles: [envFile], secretFiles: [secretFile] })).toEqual({
      K: "from-secret-file",
    });
    // --env beats secret-file:
    expect(
      loadSessionSecrets({ ...NONE, secretFiles: [secretFile], envFlags: ["K=from-env-flag"] }),
    ).toEqual({ K: "from-env-flag" });
    // --secret beats --env:
    expect(loadSessionSecrets({ ...NONE, envFlags: ["K=from-env"], secretFlags: ["K=from-secret"] })).toEqual({
      K: "from-secret",
    });
  });

  it("applies later files within the same tier last", () => {
    const first = writeFile("first.env", "K=first\n");
    const second = writeFile("second.env", "K=second\n");
    expect(loadSessionSecrets({ ...NONE, envFiles: [first, second] })).toEqual({
      K: "second",
    });
  });
});

describe("escape handling matches Go's single-pass replacer", () => {
  it("does not double-process a literal backslash-n", () => {
    // "\\n" in the file is backslash + backslash + n; Go yields backslash + n,
    // NOT a newline. A naive chained replace would wrongly produce a newline.
    const path = writeFile(".env", 'K="\\\\n"\n');
    expect(loadSessionSecrets({ ...NONE, envFiles: [path] })).toEqual({
      K: "\\n",
    });
  });

  it("unescapes real escape sequences", () => {
    const path = writeFile(".env", 'K="a\\tb\\nc"\n');
    expect(loadSessionSecrets({ ...NONE, envFiles: [path] })).toEqual({
      K: "a\tb\nc",
    });
  });
});

describe("values a conversation cannot keep", () => {
  it("leaves out empty values, naming their keys and never a value", () => {
    const path = writeFile(".env", "FILLED=keep-me\nEMPTY=\nQUOTED_EMPTY=\"\"\n");
    const notice = vi.fn();
    expect(loadSessionSecrets({ ...NONE, envFiles: [path], envFlags: ["FLAG_EMPTY="] }, notice)).toEqual({
      FILLED: "keep-me",
    });
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("Skipped variables with no value: EMPTY, QUOTED_EMPTY, FLAG_EMPTY");
  });

  it("writes the notice to stderr by default", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      loadSessionSecrets({ ...NONE, envFlags: ["EMPTY="] });
      expect(write).toHaveBeenCalledWith("Skipped a variable with no value: EMPTY\n");
    } finally {
      write.mockRestore();
    }
  });

  it("says nothing when every value is filled", () => {
    const notice = vi.fn();
    loadSessionSecrets({ ...NONE, envFlags: ["K=v"] }, notice);
    expect(notice).not.toHaveBeenCalled();
  });

  it("refuses more secrets than a conversation keeps, counting only those with a value", () => {
    const lines = Array.from({ length: MAX_SESSION_SECRETS }, (_, i) => `K${i}=v`);
    const atLimit = writeFile("limit.env", [...lines, "EMPTY="].join("\n"));
    expect(Object.keys(loadSessionSecrets({ ...NONE, envFiles: [atLimit] }, () => {}))).toHaveLength(
      MAX_SESSION_SECRETS,
    );

    const over = writeFile("over.env", [...lines, "ONE_MORE=v"].join("\n"));
    expect(() => loadSessionSecrets({ ...NONE, envFiles: [over] }, () => {})).toThrow(
      /too many variables: 101 given, a run takes at most 100/,
    );
  });
});
