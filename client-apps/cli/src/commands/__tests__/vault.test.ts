// Command-level contract for `stigmer vault`: each subcommand parses its
// flags, resolves the organization, reaches the vault RPC it names through
// the real resource layer, and renders its result on stdout without ever
// printing a value. A value is read from --from-env or from piped stdin,
// never from the command line, and only after the named vault resolves: a
// vault that does not resolve refuses before the hidden prompt asks. `--mine`
// with no organization sends an empty one for a single-organization server
// to fill. A removal names what it removes and from which
// vault, confirms on a TTY, aborts with nothing sent when declined or when no
// one can answer, and skips the question under --force. The backend is
// replaced at its module seam; the program, the resources, the confirmation
// and the renderer are real. A result renders on stderr (the human format),
// so both streams are captured. A Connect link sends its address, return URL
// and the lifetime --expires-in names, in seconds, or none for the server's
// default.

import { PassThrough, Readable } from "node:stream";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { type Vault, VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { ConnectLinkSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import type {
  CreateConnectLinkInput,
  RemoveVaultConnectionsInput,
  RemoveVaultSecretsInput,
  SetVaultConnectionInput,
  SetVaultSecretsInput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const MINE = create(VaultSchema, {
  metadata: { id: "vlt_2", name: "My vault", org: "org_acme" },
  spec: {
    owner: { case: "person", value: "ida_ana" },
    secrets: { OPENAI_API_KEY: { value: "", description: "work key" } },
  },
});

const SHARED = create(VaultSchema, {
  metadata: { id: "vlt_1", name: "Support tools", slug: "support-tools", org: "org_acme" },
  spec: { owner: { case: "org", value: "org_acme" } },
});

const calls = vi.hoisted(() => ({ requests: [] as Array<[string, unknown]>, prompts: [] as string[] }));

vi.mock("../../local/setup/prompt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../local/setup/prompt.js")>()),
  promptSecret: async (question: string) => {
    calls.prompts.push(question);
    return "typed-secret";
  },
}));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({
    config: CONFIG,
    controller(service: unknown) {
      const record = (method: string, answer: Vault) => async (req: unknown) => {
        calls.requests.push([method, req]);
        return answer;
      };
      if (service === VaultQueryController) {
        return {
          getMine: record("getMine", MINE),
          getByReference: async (req: { slug: string }) => {
            calls.requests.push(["getByReference", req]);
            if (req.slug === "no-such-vault") throw new ConnectError("vault not found", Code.NotFound);
            return SHARED;
          },
          get: record("get", SHARED),
        };
      }
      if (service === VaultCommandController) {
        return {
          create: record("create", SHARED),
          setSecrets: record("setSecrets", MINE),
          removeSecrets: record("removeSecrets", MINE),
          setConnection: record("setConnection", SHARED),
          removeConnections: record("removeConnections", SHARED),
          createConnectLink: async (req: unknown) => {
            calls.requests.push(["createConnectLink", req]);
            return create(ConnectLinkSchema, { url: "https://console.example/connect/secret-token" });
          },
        };
      }
      throw new Error("unexpected service");
    },
  }),
}));

let stdout: string[];
const realStdin = process.stdin;

/** Runs `stigmer --org acme vault ...`, returning what it wrote to stdout and stderr. */
async function vault(...args: string[]): Promise<string> {
  return stigmer("--org", "acme", "vault", ...args);
}

/** Runs `stigmer ...` as given, returning what it wrote to stdout and stderr. */
async function stigmer(...args: string[]): Promise<string> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", ...args]);
  return stdout.join("");
}

/** Makes stdin a terminal, so a value is asked for with the hidden prompt. */
function terminalStdin(): void {
  Object.defineProperty(process, "stdin", {
    value: Object.assign(new PassThrough(), { isTTY: true }),
    configurable: true,
  });
}

/** Makes stdin a terminal that answers the confirmation with `answer`. */
function terminalAnswering(answer: string): void {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  input.write(`${answer}\n`);
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
}

/** Makes stdin a pipe: no one can answer a confirmation. */
function pipedStdin(): void {
  Object.defineProperty(process, "stdin", {
    value: Object.assign(Readable.from([]), { isTTY: false }),
    configurable: true,
  });
}

function sent(method: string): boolean {
  return calls.requests.some(([m]) => m === method);
}

function requestOf<T>(method: string): T {
  const found = calls.requests.find(([m]) => m === method);
  if (found === undefined) throw new Error(`no ${method} request`);
  return found[1] as T;
}

beforeEach(() => {
  stdout = [];
  calls.requests.length = 0;
  calls.prompts.length = 0;
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
  }
});

afterEach(() => {
  Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("stigmer vault", () => {
  it("connect-link sends the address, the return URL and the lifetime --expires-in names", async () => {
    const out = await vault(
      "connect-link",
      "support-tools",
      "--address",
      "https://mcp.linear.app/mcp",
      "--return-url",
      "https://helpdesk.example/done",
      "--expires-in",
      "1h",
    );
    expect(requestOf<CreateConnectLinkInput>("createConnectLink")).toMatchObject({
      vaultId: "vlt_1",
      address: "https://mcp.linear.app/mcp",
      returnUrl: "https://helpdesk.example/done",
      expiresInSeconds: 3600,
    });
    expect(out).toContain("https://console.example/connect/secret-token");
  });

  it("connect-link with no --expires-in leaves the lifetime to the server", async () => {
    await vault("connect-link", "support-tools", "--address", "github.com", "--return-url", "https://helpdesk.example/done");
    expect(requestOf<CreateConnectLinkInput>("createConnectLink").expiresInSeconds).toBe(0);
  });

  it("mine shows the entry names of the caller's own vault", async () => {
    const out = await vault("mine");
    expect(requestOf<{ org: string }>("getMine").org).toBe("acme");
    expect(out).toContain("OPENAI_API_KEY");
  });

  it("create makes a shared vault with its description and external id", async () => {
    const out = await vault("create", "Support tools", "--description", "team keys", "--external-id", "cust-1");
    const sent = requestOf<Vault>("create");
    expect(sent.metadata?.name).toBe("Support tools");
    expect(sent.spec).toMatchObject({ description: "team keys", externalId: "cust-1" });
    expect(out).toContain("Shared vault 'Support tools' created");
  });

  it("set-secret reads the value from --from-env and never prints it", async () => {
    vi.stubEnv("MY_OPENAI_KEY", "sk-secret-1");
    const out = await vault("set-secret", "OPENAI_API_KEY", "--mine", "--from-env", "MY_OPENAI_KEY", "--description", "work");
    const sent = requestOf<SetVaultSecretsInput>("setSecrets");
    expect(sent.vault?.vault).toEqual({ case: "mine", value: true });
    expect(sent.secrets.OPENAI_API_KEY).toMatchObject({ value: "sk-secret-1", description: "work" });
    expect(out).toContain("Secret OPENAI_API_KEY saved in your vault");
    expect(out).not.toContain("sk-secret-1");
  });

  it("set-secret asks for the value with the hidden prompt on a terminal", async () => {
    terminalStdin();
    await vault("set-secret", "OPENAI_API_KEY", "--mine");
    expect(calls.prompts).toEqual(["Value for OPENAI_API_KEY"]);
    expect(requestOf<SetVaultSecretsInput>("setSecrets").secrets.OPENAI_API_KEY?.value).toBe("typed-secret");
  });

  it("set-secret and set-connection refuse a vault that does not resolve before asking for the value", async () => {
    terminalStdin();
    await expect(vault("set-secret", "OPENAI_API_KEY", "--vault", "no-such-vault")).rejects.toThrow(/vault not found/);
    await expect(vault("set-connection", "github.com", "--vault", "no-such-vault")).rejects.toThrow(/vault not found/);
    expect(calls.prompts).toEqual([]);
    expect(sent("setSecrets")).toBe(false);
    expect(sent("setConnection")).toBe(false);
  });

  it("set-secret --mine with no organization sends an empty one", async () => {
    vi.stubEnv("STIGMER_ORG", "");
    vi.stubEnv("MY_OPENAI_KEY", "sk-secret-1");
    await stigmer("vault", "set-secret", "OPENAI_API_KEY", "--mine", "--from-env", "MY_OPENAI_KEY");
    const sent = requestOf<SetVaultSecretsInput>("setSecrets");
    expect(sent.vault?.org).toBe("");
    expect(sent.vault?.vault).toEqual({ case: "mine", value: true });
  });

  it("set-connection reads a piped token from stdin", async () => {
    Object.defineProperty(process, "stdin", {
      value: Object.assign(Readable.from([Buffer.from("ghp-piped\n")]), { isTTY: false }),
      configurable: true,
    });
    const out = await vault("set-connection", "github.com", "--vault", "support-tools");
    const sent = requestOf<SetVaultConnectionInput>("setConnection");
    expect(sent.address).toBe("github.com");
    expect(sent.token).toBe("ghp-piped");
    expect(sent.vault?.vault).toEqual({ case: "id", value: "vlt_1" });
    expect(out).toContain("Login for github.com saved in vault 'Support tools'");
    expect(out).not.toContain("ghp-piped");
  });

  it("remove-secret and remove-connection skip the question under --force", async () => {
    pipedStdin();
    const out = await vault("remove-secret", "A", "B", "--mine", "--force");
    expect(requestOf<RemoveVaultSecretsInput>("removeSecrets").names).toEqual(["A", "B"]);
    await vault("remove-connection", "github.com", "--vault", "vlt_1", "-f");
    expect(requestOf<RemoveVaultConnectionsInput>("removeConnections").addresses).toEqual(["github.com"]);
    expect(out).not.toContain("Proceed with removal?");
  });

  it("remove-secret on a terminal names the secrets and the vault, and removes on yes", async () => {
    terminalAnswering("y");
    const out = await vault("remove-secret", "ZENDESK_KEY", "--vault", "support-tools");
    expect(out).toContain("You are about to remove this secret from vault 'Support tools'");
    expect(out).toContain("ZENDESK_KEY");
    expect(out).toContain("cannot be recovered");
    expect(out).toContain("Proceed with removal? [y/N]");
    expect(requestOf<RemoveVaultSecretsInput>("removeSecrets").names).toEqual(["ZENDESK_KEY"]);
    expect(out).toContain("Removed ZENDESK_KEY from vault 'Support tools'");
  });

  it("remove-connection on a terminal sends nothing when declined", async () => {
    terminalAnswering("n");
    const out = await vault("remove-connection", "github.com", "--mine");
    expect(out).toContain("You are about to remove the login for this address from your vault");
    expect(out).toContain("github.com");
    expect(out).toContain("Aborted.");
    expect(sent("removeConnections")).toBe(false);
  });

  it("refuses a removal off a terminal without --force, sending nothing", async () => {
    pipedStdin();
    const secrets = await vault("remove-secret", "A", "--mine");
    expect(secrets).toContain("Aborted.");
    await vault("remove-connection", "github.com", "--mine");
    expect(sent("removeSecrets")).toBe(false);
    expect(sent("removeConnections")).toBe(false);
  });
});
