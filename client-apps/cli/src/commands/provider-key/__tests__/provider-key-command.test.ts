// Unit tests for `stigmer provider-key list|set|delete` end to end through
// the commands (commands/provider-key/index.ts and resources/provider-key.ts):
//
//   - list joins each provider's readiness, in the server's order, with the
//     organization's key on Stigmer Cloud (last four, endpoint host, check,
//     saver, saved and last-used days), as a table, JSON or YAML; on open
//     source the key list answers Unimplemented and the list stands on
//     readiness alone, with no key columns; a caller who may not read the
//     keys gets the standings and a line saying who sees the details;
//   - set reads the key from stdin under --key-stdin or from the hidden
//     prompt on a terminal, sends it once in the resolved organization, says
//     whether the provider checked it, and never prints it; a key given as
//     an argument or a flag, or no way to read one, is a usage error before
//     anything is sent; a Cursor base URL is refused in the contract's words;
//   - delete removes with --force, asks on a terminal naming the provider
//     and the organization, and off a terminal without --force aborts with
//     nothing sent, as every confirmed delete does (output/confirm.ts);
//   - on an open-source server set and delete are usage errors naming
//     `stigmer setup`, refused before a key is asked for.
//
// The backend client is stubbed at its module seam and the hidden prompt at
// its module; the program, the resources, the confirmation and the renderer
// are real.

import { PassThrough, Readable } from "node:stream";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import {
  type ProviderKey,
  ProviderKeyCheck,
  ProviderKeySchema,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import {
  type DeleteProviderKeyInput,
  type ListProviderKeysInput,
  ListProviderKeysOutputSchema,
  type SetProviderKeyInput,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/io_pb";
import {
  GetModelReadinessOutputSchema,
  ProviderAvailability,
  ProviderReadinessSchema,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { StigmerError } from "@stigmer/client";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Config } from "../../../config/index.js";
import { CliExitError } from "../../../errors/cli-exit-error.js";
import { ExitCode } from "../../../errors/exit-codes.js";
import { standingWords } from "../../../resources/provider-key.js";
import { registerProviderKey } from "../index.js";

const CLOUD_CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
  context: { org: "org_ctx", org_slug: "acme" },
};

// A laptop's `stigmer up`: the local daemon, no organization named.
const LOCAL_CONFIG: Config = { backend: { type: "local" }, backends: {}, current_backend: "local" };

const ANTHROPIC_KEY = create(ProviderKeySchema, {
  org: "org_ctx",
  provider: "anthropic",
  keyHint: "x9Qz",
  createdBy: "ida_ana",
  createdAt: timestampFromDate(new Date("2026-09-01T10:00:00Z")),
  updatedAt: timestampFromDate(new Date("2026-10-20T08:30:00Z")),
  lastUsedAt: timestampFromDate(new Date("2026-10-27T17:05:00Z")),
  check: ProviderKeyCheck.checked,
});

// The parent's key, serving this organization through its parent.
const OPENAI_KEY = create(ProviderKeySchema, {
  org: "org_parent",
  provider: "openai",
  keyHint: "7abc",
  createdBy: "ida_bo",
  createdAt: timestampFromDate(new Date("2026-08-14T09:00:00Z")),
  inheritedFromOrg: "acme-holdings",
  check: ProviderKeyCheck.unchecked,
});

const backend = vi.hoisted(() => ({
  edition: "cloud" as "cloud" | "local" | "enterprise",
  config: undefined as Config | undefined,
  readinessOrgs: [] as string[],
  listed: [] as ListProviderKeysInput[],
  set: [] as SetProviderKeyInput[],
  deleted: [] as DeleteProviderKeyInput[],
  prompts: [] as string[],
  // How the key list answers: the keys, Unimplemented, or PermissionDenied.
  keyList: "keys" as "keys" | "unimplemented" | "denied" | "unavailable",
  // The keys the list answers with.
  keys: [] as ProviderKey[],
  // The check the server reports on a saved key.
  check: 1 as ProviderKeyCheck,
}));

vi.mock("../../../local/setup/prompt.js", () => ({
  promptSecret: async (question: string) => {
    backend.prompts.push(question);
    return "sk-typed-at-the-prompt-5678\n";
  },
}));

vi.mock("../../../backend.js", () => ({
  connectBackend: () => ({
    config: backend.config,
    serverInfo: async () => ({ deploymentMode: backend.edition }),
    stigmer: {
      platform: {
        getServerInfo: async () => ({ deploymentMode: backend.edition, singleOrg: backend.edition === "local" }),
        getModelReadiness: async (org: string) => {
          backend.readinessOrgs.push(org);
          return backend.edition === "local"
            ? create(GetModelReadinessOutputSchema, {
                providers: [
                  { provider: "anthropic", availability: ProviderAvailability.served_by_runners },
                  { provider: "openai", availability: ProviderAvailability.missing_from_runners },
                  { provider: "cursor", availability: ProviderAvailability.availability_unknown },
                ],
              })
            : create(GetModelReadinessOutputSchema, {
                providers: [
                  { provider: "anthropic", availability: ProviderAvailability.served_by_organization },
                  {
                    provider: "openai",
                    availability: ProviderAvailability.served_by_parent_organization,
                    parentOrg: "acme-holdings",
                  },
                  { provider: "cursor", availability: ProviderAvailability.missing_from_organization },
                ],
              });
        },
      },
      providerkey: {
        list: async (input: ListProviderKeysInput) => {
          backend.listed.push(input);
          if (backend.keyList === "unimplemented") {
            throw new StigmerError("unknown", "unimplemented", Code.Unimplemented);
          }
          if (backend.keyList === "denied") {
            throw new StigmerError("permission-denied", "unauthorized to view provider keys", Code.PermissionDenied);
          }
          if (backend.keyList === "unavailable") {
            throw new StigmerError("unavailable", "the key store is down", Code.Unavailable);
          }
          return create(ListProviderKeysOutputSchema, { entries: backend.keys });
        },
        set: async (input: SetProviderKeyInput): Promise<ProviderKey> => {
          backend.set.push(input);
          return create(ProviderKeySchema, {
            org: input.org,
            provider: input.provider,
            keyHint: input.apiKey.slice(-4),
            baseUrl: input.baseUrl,
            check: backend.check,
          });
        },
        delete: async (input: DeleteProviderKeyInput): Promise<ProviderKey> => {
          backend.deleted.push(input);
          return create(ProviderKeySchema, { org: input.org, provider: input.provider, keyHint: "x9Qz" });
        },
      },
    },
  }),
}));

const realStdin = process.stdin;

/** Makes stdin a pipe carrying `text` (nothing when omitted): no one can answer a prompt. */
function pipedStdin(text?: string): void {
  Object.defineProperty(process, "stdin", {
    value: Object.assign(Readable.from(text === undefined ? [] : [Buffer.from(text)]), { isTTY: false }),
    configurable: true,
  });
}

/** Makes stdin a terminal, answering a confirmation with `answer` when given. */
function terminalStdin(answer?: string): void {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  if (answer !== undefined) input.write(`${answer}\n`);
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
}

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
    const program = new Command().exitOverride().option("--org <org>").enablePositionalOptions();
    registerProviderKey(program);
    await program.parseAsync(["node", "stigmer", ...args]);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return { stdout: out.join(""), stderr: err.join("") };
}

/** The local error a command fails with. */
async function failureOf(args: string[]): Promise<CliExitError> {
  try {
    await run(args);
  } catch (error) {
    if (error instanceof CliExitError) return error;
    throw error;
  }
  throw new Error(`stigmer ${args.join(" ")} succeeded`);
}

/** Splits a table's line into its cells (separated by three spaces or more). */
function cells(line: string | undefined): string[] {
  return (line ?? "").trim().split(/ {3,}/);
}

function nothingSent(): void {
  expect(backend.set).toEqual([]);
  expect(backend.deleted).toEqual([]);
}

beforeEach(() => {
  vi.stubEnv("STIGMER_ORG", "");
  backend.edition = "cloud";
  backend.config = CLOUD_CONFIG;
  backend.readinessOrgs.length = 0;
  backend.listed.length = 0;
  backend.set.length = 0;
  backend.deleted.length = 0;
  backend.prompts.length = 0;
  backend.keyList = "keys";
  backend.keys = [ANTHROPIC_KEY, OPENAI_KEY];
  backend.check = ProviderKeyCheck.checked;
  pipedStdin();
});

afterEach(() => {
  Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  vi.unstubAllEnvs();
});

describe("CLI-12 provider keys are saved, listed and removed from the CLI", () => {
  it("lists every provider in the server's order with its key's details on Stigmer Cloud", async () => {
    const { stdout } = await run(["provider-key", "list"]);
    expect(backend.readinessOrgs).toEqual(["org_ctx"]);
    expect(backend.listed.map((input) => input.org)).toEqual(["org_ctx"]);
    const lines = stdout.trimEnd().split("\n");
    expect(cells(lines[0])).toEqual(["PROVIDER", "STATE", "KEY", "ENDPOINT", "CHECK", "SAVED BY", "SAVED", "LAST USED"]);
    expect(cells(lines[2])).toEqual(["Anthropic", "connected", "…x9Qz", "-", "checked", "ida_ana", "2026-10-20", "2026-10-27"]);
    expect(cells(lines[3])).toEqual([
      "OpenAI",
      "through acme-holdings",
      "…7abc",
      "-",
      "not checked",
      "ida_bo",
      "2026-08-14",
      "never",
    ]);
    expect(cells(lines[4])).toEqual(["Cursor", "not connected", "-", "-", "-", "-", "-", "-"]);
  });

  it("saves a key piped in with --key-stdin, says the provider checked it, and never prints it", async () => {
    pipedStdin("sk-ant-api03-secret-1234\n");
    const { stdout, stderr } = await run(["provider-key", "set", "anthropic", "--key-stdin"]);
    expect(backend.set).toEqual([
      expect.objectContaining({ org: "org_ctx", provider: "anthropic", apiKey: "sk-ant-api03-secret-1234", baseUrl: "" }),
    ]);
    expect(stderr).toContain("Saved; checked with Anthropic");
    expect(stderr).toContain("…1234");
    expect(stdout + stderr).not.toContain("secret");
    expect(backend.prompts).toEqual([]);
  });

  it("removes a key with --force", async () => {
    const { stderr } = await run(["provider-key", "delete", "anthropic", "--force"]);
    expect(backend.deleted).toEqual([expect.objectContaining({ org: "org_ctx", provider: "anthropic" })]);
    expect(stderr).toContain("Removed the Anthropic key");
  });
});

describe("stigmer provider-key list", () => {
  it("stands on readiness alone where the key list is not served (open source)", async () => {
    backend.edition = "local";
    backend.config = LOCAL_CONFIG;
    backend.keyList = "unimplemented";
    const { stdout, stderr } = await run(["provider-key", "list"]);
    // The one organization the server holds fills an empty org.
    expect(backend.readinessOrgs).toEqual([""]);
    const lines = stdout.trimEnd().split("\n");
    expect(cells(lines[0])).toEqual(["PROVIDER", "STATE"]);
    expect(lines.slice(2).map(cells)).toEqual([
      ["Anthropic", "set on this machine"],
      ["OpenAI", "not connected"],
      ["Cursor", "not known: set where the runner runs"],
    ]);
    expect(stderr).toBe("");
  });

  it("prints the providers and their keys as JSON, and as YAML", async () => {
    const json = JSON.parse((await run(["provider-key", "list", "-o", "json"])).stdout) as Record<string, unknown>[];
    expect(json).toEqual([
      expect.objectContaining({
        provider: "anthropic",
        availability: "served_by_organization",
        key: expect.objectContaining({ key_hint: "x9Qz", check: "checked", created_by: "ida_ana" }),
      }),
      expect.objectContaining({
        provider: "openai",
        availability: "served_by_parent_organization",
        parent_org: "acme-holdings",
        key: expect.objectContaining({ inherited_from_org: "acme-holdings", check: "unchecked" }),
      }),
      { provider: "cursor", availability: "missing_from_organization" },
    ]);

    const yaml = (await run(["provider-key", "list", "-o", "yaml"])).stdout;
    expect(yaml.startsWith("- provider: anthropic")).toBe(true);
    expect(yaml).toContain("key_hint: x9Qz");
  });

  it("prints readiness alone as JSON where the key list is not served", async () => {
    backend.edition = "local";
    backend.config = LOCAL_CONFIG;
    backend.keyList = "unimplemented";
    const json = JSON.parse((await run(["provider-key", "list", "--json"])).stdout) as Record<string, unknown>[];
    expect(json.map((row) => row.availability)).toEqual([
      "served_by_runners",
      "missing_from_runners",
      "availability_unknown",
    ]);
    expect(json.some((row) => "key" in row)).toBe(false);
  });

  it("shows a caller who may not read the keys every provider's standing, and says who sees the details", async () => {
    backend.keyList = "denied";
    const { stdout, stderr } = await run(["provider-key", "list"]);
    expect(cells(stdout.split("\n")[0])).toEqual(["PROVIDER", "STATE"]);
    expect(stdout).toContain("through acme-holdings");
    expect(stderr).toContain("shown to those who manage the organization's billing");
  });
});

describe("stigmer provider-key set", () => {
  it("says a saved key was not checked when the provider did not answer, and sends the base URL", async () => {
    backend.check = ProviderKeyCheck.unchecked;
    pipedStdin("sk-proj-gateway-key-9876");
    const { stderr } = await run([
      "--org",
      "acme",
      "provider-key",
      "set",
      "openai",
      "--key-stdin",
      "--base-url",
      "https://gateway.example.com/openai/v1",
    ]);
    expect(backend.set).toEqual([
      expect.objectContaining({
        org: "acme",
        provider: "openai",
        apiKey: "sk-proj-gateway-key-9876",
        baseUrl: "https://gateway.example.com/openai/v1",
      }),
    ]);
    expect(stderr).toContain("Saved, not checked: OpenAI did not answer");
    expect(stderr).toContain("https://gateway.example.com/openai/v1");
  });

  it("reads the key from the hidden prompt on a terminal", async () => {
    terminalStdin();
    await run(["provider-key", "set", "cursor"]);
    expect(backend.prompts).toEqual(["Cursor key"]);
    expect(backend.set.map((input) => [input.provider, input.apiKey])).toEqual([["cursor", "sk-typed-at-the-prompt-5678"]]);
  });

  it("prints the saved key as JSON with -o json", async () => {
    pipedStdin("sk-ant-api03-secret-1234");
    const { stdout } = await run(["provider-key", "set", "anthropic", "--key-stdin", "-o", "json"]);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "success",
      message: "Saved; checked with Anthropic",
      data: { provider: "anthropic", key_hint: "1234", check: "checked" },
    });
  });

  it("refuses a key given as an argument or a flag before anything is read or sent", async () => {
    for (const args of [
      ["provider-key", "set", "anthropic", "sk-ant-api03-secret-1234"],
      ["provider-key", "set", "anthropic", "--key", "sk-ant-api03-secret-1234"],
    ]) {
      const failure = await failureOf(args);
      expect(failure.exitCode).toBe(ExitCode.Usage);
      expect(failure.message).toContain("never taken on the command line");
      expect(failure.message).toContain("--key-stdin");
    }
    nothingSent();
    expect(backend.prompts).toEqual([]);
  });

  it("refuses to read a key off a terminal without --key-stdin", async () => {
    pipedStdin("sk-ant-api03-secret-1234");
    const failure = await failureOf(["provider-key", "set", "anthropic"]);
    expect(failure.exitCode).toBe(ExitCode.Usage);
    expect(failure.message).toContain("stigmer provider-key set anthropic --key-stdin");
    nothingSent();
  });

  it("refuses an empty key, an unknown provider, a Cursor base URL and a base URL that is not https", async () => {
    pipedStdin("\n");
    expect((await failureOf(["provider-key", "set", "anthropic", "--key-stdin"])).message).toBe("no Anthropic key given");
    expect((await failureOf(["provider-key", "set", "gemini", "--key-stdin"])).message).toContain(
      "Use anthropic, openai or cursor.",
    );
    expect((await failureOf(["provider-key", "set", "cursor", "--base-url", "https://cursor.example.com"])).message).toBe(
      "a Cursor key takes no base URL; Cursor serves from its own hosts",
    );
    expect((await failureOf(["provider-key", "set", "openai", "--base-url", "http://gateway.example.com/v1"])).exitCode).toBe(
      ExitCode.Usage,
    );
    nothingSent();
  });
});

describe("stigmer provider-key delete", () => {
  it("asks on a terminal, naming the provider and the organization, and removes on yes", async () => {
    terminalStdin("y");
    const { stderr } = await run(["provider-key", "delete", "openai"]);
    expect(stderr).toContain(
      "Remove the OpenAI key? Runs that need OpenAI are refused until a key serves acme again. [y/N]",
    );
    expect(backend.deleted.map((input) => input.provider)).toEqual(["openai"]);
  });

  it("removes nothing when the answer is no", async () => {
    terminalStdin("n");
    const { stderr } = await run(["provider-key", "delete", "openai"]);
    expect(stderr).toContain("Aborted.");
    nothingSent();
  });

  it("aborts off a terminal without --force, as every confirmed delete does, with nothing sent", async () => {
    const { stderr } = await run(["provider-key", "delete", "anthropic"]);
    expect(stderr).toContain("Aborted.");
    nothingSent();
  });
});

describe("stigmer provider-key on a server that keeps no provider keys", () => {
  beforeEach(() => {
    backend.edition = "local";
    backend.config = LOCAL_CONFIG;
  });

  it("refuses set on open source with the fix, before a key is asked for", async () => {
    terminalStdin();
    const failure = await failureOf(["provider-key", "set", "anthropic"]);
    expect(failure.exitCode).toBe(ExitCode.Usage);
    expect(failure.hints).toEqual([
      "On your own machine the runner's keys come from `stigmer setup`, then `stigmer down && stigmer up`.",
    ]);
    expect(backend.prompts).toEqual([]);
    nothingSent();
  });

  it("refuses delete on open source with the fix, --force or not", async () => {
    const failure = await failureOf(["provider-key", "delete", "anthropic", "--force"]);
    expect(failure.exitCode).toBe(ExitCode.Usage);
    expect(failure.message).toBe("this server keeps no provider keys: they are saved on Stigmer Cloud");
    expect(failure.hints?.[0]).toContain("stigmer setup");
    nothingSent();
  });

  it("refuses set on Stigmer Enterprise, whose runners hold their own keys", async () => {
    backend.edition = "enterprise";
    backend.config = CLOUD_CONFIG;
    pipedStdin("sk-ant-api03-secret-1234");
    const failure = await failureOf(["provider-key", "set", "anthropic", "--key-stdin"]);
    expect(failure.exitCode).toBe(ExitCode.Usage);
    expect(failure.hints?.[0]).toContain("whoever runs them");
    nothingSent();
  });
});

describe("stigmer provider-key, the rarer answers", () => {
  it("shows a key's own endpoint by its host, and a check that was never recorded as a dash", async () => {
    backend.keys = [
      create(ProviderKeySchema, {
        org: "org_ctx",
        provider: "anthropic",
        keyHint: "g4te",
        baseUrl: "https://gateway.acme.example/anthropic",
        createdBy: "ida_ana",
        updatedAt: timestampFromDate(new Date("2026-10-20T08:30:00Z")),
      }),
    ];
    const { stdout } = await run(["provider-key", "list"]);
    expect(cells(stdout.trimEnd().split("\n")[2])).toEqual([
      "Anthropic",
      "connected",
      "…g4te",
      "gateway.acme.example",
      "-",
      "ida_ana",
      "2026-10-20",
      "never",
    ]);
  });

  it("fails the list with the key store's own error when it is neither unserved nor refused", async () => {
    backend.keyList = "unavailable";
    await expect(run(["provider-key", "list"])).rejects.toThrow(/the key store is down/);
  });

  it("says only Saved when the server recorded no check", async () => {
    backend.check = ProviderKeyCheck.provider_key_check_unspecified;
    pipedStdin("sk-piped-1234\n");
    const { stderr } = await run(["provider-key", "set", "openai", "--key-stdin"]);
    expect(stderr).toContain("Saved");
    expect(stderr).not.toContain("checked");
  });

  it("refuses a base URL that does not parse", async () => {
    pipedStdin("sk-piped-1234\n");
    const failure = await failureOf(["provider-key", "set", "openai", "--key-stdin", "--base-url", "not a url"]);
    expect(failure.exitCode).toBe(ExitCode.Usage);
    expect(failure.message).toContain('--base-url must be an https URL, not "not a url"');
  });

  it("calls an availability this build does not know not known", () => {
    expect(standingWords(create(ProviderReadinessSchema, { provider: "anthropic", availability: 99 as ProviderAvailability }))).toBe(
      "not known",
    );
  });
});
