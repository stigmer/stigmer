// Unit tests for `stigmer apikey create` end to end through the command
// (commands/apikey/index.ts): the flags reach the backend as one create
// request (the context organization as the key's organization, the
// `--bound-org` limit when given), and the key the backend answers is
// printed once, as JSON or as the save-it-now banner. With
// `--service-account`, the name is resolved in the organization and the key
// is created for that account instead (never as the caller's own key), and
// the flags such a key cannot take (`--bound-org`, no `--name`) are refused
// before anything is sent. The backend client is stubbed at its module seam;
// the config file is real (HOME redirected).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { IdentityAccountsListSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliExitError } from "../../../errors/cli-exit-error.js";
import { ExitCode } from "../../../errors/exit-codes.js";
import { registerApiKey } from "../index.js";

// Every create request the stubbed backend received.
const sent: unknown[] = [];
// Every service-account key request, and every organization listed.
const forServiceAccount: { serviceAccountId: string; name: string; neverExpires: boolean }[] = [];
const listedOrgs: string[] = [];

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
          createForServiceAccount: async (input: {
            serviceAccountId: string;
            name: string;
            neverExpires: boolean;
          }) => {
            forServiceAccount.push(input);
            return create(ApiKeySchema, {
              metadata: { id: "key_01jbbbbbbbbbbbbbbbbbbbbbbb", name: input.name },
              spec: { keyHash: "stk_sa_plaintext", fingerprint: "c3d4" },
            });
          },
        },
        identityAccount: {
          listServiceAccounts: async (input: { org: string }) => {
            listedOrgs.push(input.org);
            return create(IdentityAccountsListSchema, {
              totalPages: 1,
              entries: [{ metadata: { id: "ida_sa_ci", name: "ci-deploy" } }],
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
    const program = new Command().exitOverride().option("--org <org>");
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
    forServiceAccount.length = 0;
    listedOrgs.length = 0;
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

  it("creates the key for the service account --service-account names, in the context organization", async () => {
    const out = await run(["--service-account", "ci-deploy", "--name", "github-actions", "--never-expires"]);
    expect(listedOrgs).toEqual(["org_ctx"]);
    expect(forServiceAccount).toEqual([
      expect.objectContaining({ serviceAccountId: "ida_sa_ci", name: "github-actions", neverExpires: true }),
    ]);
    expect(sent).toEqual([]);
    expect(out).toContain("stk_sa_plaintext");
    expect(out).toContain("Speaks for:  service account ci-deploy");
  });

  it("resolves the service account in the organization --org names", async () => {
    await runWithGlobals(["--org", "acme"], ["--service-account", "ci-deploy", "--name", "gha"]);
    expect(listedOrgs).toEqual(["acme"]);
  });

  it("refuses --bound-org and a missing --name for a service account's key before anything is sent", async () => {
    for (const args of [
      ["--service-account", "ci-deploy", "--name", "gha", "--bound-org", "acme"],
      ["--service-account", "ci-deploy"],
    ]) {
      let exit: number | undefined;
      try {
        await run(args);
      } catch (error) {
        exit = error instanceof CliExitError ? error.exitCode : -1;
      }
      expect(exit, args.join(" ")).toBe(ExitCode.Usage);
    }
    expect(listedOrgs).toEqual([]);
    expect(forServiceAccount).toEqual([]);
  });
});

async function runWithGlobals(globals: string[], args: string[]): Promise<void> {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const program = new Command().exitOverride().option("--org <org>");
    registerApiKey(program);
    await program.parseAsync(["node", "stigmer", ...globals, "apikey", "create", ...args]);
  } finally {
    write.mockRestore();
  }
}
