// Unit tests for `stigmer apikey create` end to end through the command
// (commands/apikey/index.ts): the flags reach the backend as one create
// request (the context organization as the key's organization, the
// `--bound-org` limit when given), and the key the backend answers is
// printed once, as JSON or as the save-it-now banner. The backend client is
// stubbed at its module seam; the config file is real (HOME redirected).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerApiKey } from "../index.js";

// Every create request the stubbed backend received.
const sent: unknown[] = [];

vi.mock("../../../backend.js", async () => {
  const { load: loadConfig } = await import("../../../config/index.js");
  return {
    connectBackend: () => ({
      config: loadConfig(),
      stigmer: {
        apiKey: {
          create: async (input: { name?: string; boundOrg?: string }) => {
            sent.push(input);
            return create(ApiKeySchema, {
              metadata: {
                id: "key_01jaaaaaaaaaaaaaaaaaaaaaaa",
                name: input.name ?? "",
              },
              spec: {
                keyHash: "stk_plaintext",
                fingerprint: "a1b2",
                boundOrg: input.boundOrg ?? "",
              },
            });
          },
        },
      },
    }),
  };
});

async function run(args: string[]): Promise<string> {
  const written: string[] = [];
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
  try {
    const program = new Command().exitOverride();
    registerApiKey(program);
    await program.parseAsync(["node", "stigmer", "apikey", "create", ...args]);
  } finally {
    write.mockRestore();
  }
  return written.join("");
}

describe("stigmer apikey create", () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    sent.length = 0;
    originalHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "stigmer-apikey-create-"));
    process.env.HOME = home;
    mkdirSync(join(home, ".stigmer"), { recursive: true });
    writeFileSync(
      join(home, ".stigmer", "config.yaml"),
      [
        "backends:",
        "  team:",
        "    type: selfhost",
        "    endpoint: 127.0.0.1:1",
        "current_backend: team",
        "context:",
        "  org: org_ctx",
        "",
      ].join("\n"),
    );
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("sends one create limited to the organization --bound-org names, and prints the key as JSON", async () => {
    const out = await run([
      "--name",
      "ci",
      "--never-expires",
      "--bound-org",
      "acme",
      "--json",
    ]);
    expect(sent).toEqual([
      expect.objectContaining({ name: "ci", org: "org_ctx", boundOrg: "acme" }),
    ]);
    expect(JSON.parse(out)).toMatchObject({
      spec: { bound_org: "acme", key_hash: "stk_plaintext" },
    });
  });

  it("sends no limit without --bound-org, and prints the plaintext once in the banner", async () => {
    const out = await run(["--name", "laptop", "--never-expires"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty("boundOrg");
    expect(out).toContain("API key created successfully!");
    expect(out).toContain("stk_plaintext");
  });
});
