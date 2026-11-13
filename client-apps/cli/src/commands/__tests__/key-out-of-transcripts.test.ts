// The two ways a key reaches the CLI without passing through a shell's
// history or a coding agent's transcript: `stigmer setup --api-key-stdin`
// (commands/setup.ts withStdinKey) reads it from stdin, refusing a terminal
// and `--api-key` beside it; `stigmer apikey create --save-to-env`
// (commands/apikey) writes `STIGMER_API_KEY` into a file (0600 when new,
// appended on its own line otherwise, refused before a key is made when the
// file already sets it) and prints only where it went, never the key.

import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ApiKeySchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import { refuseEnvFileThatSetsTheKey, renderSavedKey, saveToEnvFile } from "../apikey/index.js";
import { withStdinKey } from "../setup.js";

const SECRET = "stk_live_0123456789abcdefghij";

describe("setup --api-key-stdin", () => {
  it("reads the key from stdin, trimmed, as Anthropic's unless a provider is said", async () => {
    const flags = await withStdinKey({ apiKeyStdin: true }, { stdinIsTty: false, readStdin: async () => "sk-test\n" });
    expect(flags).toMatchObject({ provider: "anthropic", apiKey: "sk-test" });
  });
  it("refuses a terminal, an empty stdin, and --api-key beside it", async () => {
    await expect(withStdinKey({ apiKeyStdin: true }, { stdinIsTty: true, readStdin: async () => "" })).rejects.toThrow(/stdin is a terminal/);
    await expect(withStdinKey({ apiKeyStdin: true }, { stdinIsTty: false, readStdin: async () => " \n" })).rejects.toThrow(/read nothing/);
    await expect(withStdinKey({ apiKeyStdin: true, apiKey: "x" }, { stdinIsTty: false, readStdin: async () => "y" })).rejects.toThrow(UsageError);
  });
  it("leaves the flags alone without it", async () => {
    expect(await withStdinKey({ provider: "skip" })).toEqual({ provider: "skip" });
  });
});

describe("apikey create --save-to-env", () => {
  it("makes a new file readable by its owner alone", () => {
    const path = join(mkdtempSync(join(tmpdir(), "stigmer-env-")), ".env.local");
    saveToEnvFile(path, SECRET);
    expect(readFileSync(path, "utf8")).toBe(`STIGMER_API_KEY=${SECRET}\n`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it("appends on a line of its own to a file that has others", () => {
    const path = join(mkdtempSync(join(tmpdir(), "stigmer-env-")), ".env");
    writeFileSync(path, "DATABASE_URL=postgres://x");
    saveToEnvFile(path, SECRET);
    expect(readFileSync(path, "utf8")).toBe(`DATABASE_URL=postgres://x\nSTIGMER_API_KEY=${SECRET}\n`);
  });
  it("refuses, before a key is made, a file that already sets the variable", () => {
    const path = join(mkdtempSync(join(tmpdir(), "stigmer-env-")), ".env");
    writeFileSync(path, "export STIGMER_API_KEY=old\n");
    expect(() => refuseEnvFileThatSetsTheKey(path)).toThrow(/already sets STIGMER_API_KEY/);
    expect(() => refuseEnvFileThatSetsTheKey(join(path, "..", "missing.env"))).not.toThrow();
  });
  it("refuses, before a key is made, a file whose folder is missing", () => {
    const path = join(mkdtempSync(join(tmpdir(), "stigmer-env-")), "app", ".env.local");
    expect(() => refuseEnvFileThatSetsTheKey(path)).toThrow(/cannot be written: .* is missing or not writable/);
  });

  it("refuses, before a key is made, a file it may not write", () => {
    const path = join(mkdtempSync(join(tmpdir(), "stigmer-env-")), ".env");
    writeFileSync(path, "A=1\n", { mode: 0o400 });
    expect(() => refuseEnvFileThatSetsTheKey(path)).toThrow(/is not writable/);
  });

  it("prints where the key went and never the key, in either format", () => {
    const key = create(ApiKeySchema, { metadata: { id: "key_1", name: "my-app" }, spec: { keyHash: SECRET } });
    for (const format of ["table", "json"] as const) {
      const text = renderSavedKey(key, "app-backend", ".env.local", format);
      expect(text).not.toContain(SECRET);
      expect(text).toContain(".env.local");
    }
    expect(renderSavedKey(key, "app-backend", ".env.local", "table")).toContain(
      "API key created and saved as STIGMER_API_KEY in .env.local",
    );
  });
});
