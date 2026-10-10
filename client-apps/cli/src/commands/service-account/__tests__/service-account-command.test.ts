// Unit tests for `stigmer service-account create|list|keys|delete` end to end
// through the commands (commands/service-account/index.ts and
// resources/service-account.ts):
//
//   - create sends one request in the organization the CLI resolves
//     (`--org` first, then the context), with the role `--role` names and
//     Member when it names none; owner and unknown roles are refused before
//     anything is sent (exit 2);
//   - list reads every page the server reports and prints a table, or the
//     accounts as JSON;
//   - keys resolves the name and lists that account's keys by its id, as a
//     table or as JSON;
//   - delete resolves the name in the organization, deletes by id only with
//     --force (off a TTY it asks, nobody answers, and nothing is deleted),
//     and an unknown name exits NotFound (5) naming the list command.
//
// The backend client is stubbed at its module seam; the config file is real
// (HOME redirected).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ApiKeysSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import {
  type CreateServiceAccountInput,
  IdentityAccountsListSchema,
  type ListWithIdentityOrg,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliExitError } from "../../../errors/cli-exit-error.js";
import { ExitCode } from "../../../errors/exit-codes.js";
import { registerServiceAccount } from "../index.js";

const backend = vi.hoisted(() => ({
  created: [] as CreateServiceAccountInput[],
  listed: [] as [string, number][],
  deleted: [] as string[],
  keysOf: [] as string[],
  // The organization has no service accounts, or the account has no keys.
  noAccounts: false,
  noKeys: false,
}));

// Two pages: the newest account first.
const PAGES = [
  [{ metadata: { id: "ida_sa_new", name: "nightly-evals" } }],
  [{ metadata: { id: "ida_sa_ci", name: "ci-deploy" } }],
];

vi.mock("../../../backend.js", async () => {
  const { load: loadConfig } = await import("../../../config/index.js");
  return {
    connectBackend: () => ({
      config: loadConfig(),
      stigmer: {
        identityAccount: {
          createServiceAccount: async (input: CreateServiceAccountInput) => {
            backend.created.push(input);
            return create(IdentityAccountSchema, {
              metadata: { id: "ida_sa_made", name: input.name, org: input.org },
            });
          },
          listServiceAccounts: async (input: ListWithIdentityOrg) => {
            const num = input.page?.num ?? 0;
            backend.listed.push([input.org, num]);
            return create(IdentityAccountsListSchema, {
              totalPages: backend.noAccounts ? 0 : PAGES.length,
              entries: backend.noAccounts ? [] : (PAGES[num - 1] ?? []),
            });
          },
          delete: async (id: string) => {
            backend.deleted.push(id);
            return create(IdentityAccountSchema, { metadata: { id } });
          },
        },
        apiKey: {
          findByAccount: async (id: string) => {
            backend.keysOf.push(id);
            return create(ApiKeysSchema, {
              entries: backend.noKeys ? [] : [
                { metadata: { id: "key_gha", name: "github-actions" }, spec: { fingerprint: "a1b2c3", neverExpires: true } },
              ],
            });
          },
        },
      },
    }),
  };
});

async function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
  try {
    const program = new Command().exitOverride().option("--org <org>");
    registerServiceAccount(program);
    await program.parseAsync(["node", "stigmer", ...args]);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return { stdout: out.join(""), stderr: err.join("") };
}

async function exitOf(args: string[]): Promise<number | undefined> {
  try {
    await run(args);
    return undefined;
  } catch (error) {
    return error instanceof CliExitError ? error.exitCode : -1;
  }
}

describe("stigmer service-account", () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    backend.created.length = 0;
    backend.listed.length = 0;
    backend.deleted.length = 0;
    backend.keysOf.length = 0;
    backend.noAccounts = false;
    backend.noKeys = false;
    originalHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "stigmer-service-account-"));
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

  it("creates in the context organization with the Member role when --role names none", async () => {
    const { stderr } = await run(["service-account", "create", "ci-deploy"]);
    expect(backend.created.map((c) => [c.org, c.name, c.role])).toEqual([
      ["org_ctx", "ci-deploy", IamRole.member],
    ]);
    expect(stderr).toContain("Service account ci-deploy created with the Member role");
    expect(stderr).toContain("stigmer apikey create --service-account ci-deploy");
  });

  it("creates in the organization --org names, with the role --role names, and prints it as JSON", async () => {
    const { stdout } = await run([
      "--org",
      "acme",
      "service-account",
      "create",
      "ci-deploy",
      "--role",
      "Admin",
      "--json",
    ]);
    expect(backend.created.map((c) => [c.org, c.role])).toEqual([["acme", IamRole.admin]]);
    expect(JSON.parse(stdout)).toMatchObject({ data: { metadata: { id: "ida_sa_made" } } });
  });

  it("refuses owner and an unknown role before anything is sent", async () => {
    expect(await exitOf(["service-account", "create", "ci", "--role", "owner"])).toBe(ExitCode.Usage);
    expect(await exitOf(["service-account", "create", "ci", "--role", "boss"])).toBe(ExitCode.Usage);
    expect(backend.created).toEqual([]);
  });

  it("lists every page as a table, and as JSON", async () => {
    const { stdout } = await run(["service-account", "list"]);
    expect(backend.listed).toEqual([
      ["org_ctx", 1],
      ["org_ctx", 2],
    ]);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toMatch(/^NAME\s+ID\s+CREATED$/);
    expect(lines.slice(2).map((line) => line.split(/\s+/)[0])).toEqual(["nightly-evals", "ci-deploy"]);

    const json = await run(["service-account", "list", "--json"]);
    expect((JSON.parse(json.stdout) as { metadata: { name: string } }[]).map((a) => a.metadata.name)).toEqual([
      "nightly-evals",
      "ci-deploy",
    ]);
  });

  it("lists the named account's keys by its id, as a table and as JSON", async () => {
    const { stdout } = await run(["service-account", "keys", "ci-deploy"]);
    expect(backend.keysOf).toEqual(["ida_sa_ci"]);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toMatch(/^ID\s+NAME\s+FINGERPRINT\s+EXPIRES$/);
    expect(lines[2]?.split(/\s+/)).toEqual(["key_gha", "github-actions", "***a1b2c3", "Never"]);

    const json = await run(["service-account", "keys", "ci-deploy", "--json"]);
    expect((JSON.parse(json.stdout) as { metadata: { id: string } }[]).map((k) => k.metadata.id)).toEqual(["key_gha"]);
  });

  it("prints the accounts and the keys as YAML", async () => {
    const accounts = await run(["service-account", "list", "-o", "yaml"]);
    expect(accounts.stdout.startsWith("- metadata:")).toBe(true);
    expect(accounts.stdout).toContain("id: ida_sa_new");
    const keys = await run(["service-account", "keys", "ci-deploy", "-o", "yaml"]);
    expect(keys.stdout.startsWith("- metadata:")).toBe(true);
    expect(keys.stdout).toContain("id: key_gha");
  });

  it("says so when there is no service account, or the account has no keys", async () => {
    backend.noKeys = true;
    expect((await run(["service-account", "keys", "ci-deploy"])).stdout).toContain("No API keys found");
    backend.noAccounts = true;
    expect((await run(["service-account", "list"])).stdout).toContain("No service accounts found");
  });

  it("deletes the named account by its id with --force, and says its keys no longer work", async () => {
    const { stderr } = await run(["service-account", "delete", "ci-deploy", "--force"]);
    expect(backend.deleted).toEqual(["ida_sa_ci"]);
    expect(stderr).toContain("its API keys no longer work");
  });

  it("deletes nothing without --force when no one can confirm, after warning that its keys stop working", async () => {
    const { stderr } = await run(["service-account", "delete", "ci-deploy"]);
    expect(stderr).toContain("Every API key it has stops working at once");
    expect(stderr).toContain("Aborted.");
    expect(backend.deleted).toEqual([]);
  });

  it("answers NotFound for a name the organization has no service account by", async () => {
    expect(await exitOf(["service-account", "delete", "nobody", "--force"])).toBe(ExitCode.NotFound);
    expect(backend.deleted).toEqual([]);
  });
});
