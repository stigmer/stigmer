// The coding-agent door's commands through the real program and flag parsing
// (commands/example.ts, embedding.ts, app-handover.ts, coding-agent.ts, and
// apikey's --save-to-env), with the backend replaced at its module seam by a
// fake client: `example list|get` write files in a scratch folder;
// `coding-agent` prints the released guide; `embedding` reads the
// organization and `set` saves the two settings keeping its origins and
// vaults, and an admin-only refusal comes back in plain words;
// `app-handover` prints or writes the handover for the organization's slug,
// refuses an agent the organization lacks, and hands the development chat on
// a server that trusts every caller; `apikey create --save-to-env` writes the
// key and prints only where it went. currentOrganization reads the named
// organization, or a one-organization server's own.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ConnectError, Code } from "@connectrpc/connect";
import { GUIDE } from "@stigmer/coding-agent-plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentOrganization } from "../../client/current-organization.js";
import type { Config } from "../../config/index.js";
import { classify } from "../../errors/index.js";
import { buildProgram } from "../../program.js";
import { withStdinKey } from "../setup.js";

const CONFIG: Config = {
  backend: {},
  backends: { acme: { type: "selfhost", endpoint: "stigmer.acme.test:443", api_key: "stk_admin" } },
  current_backend: "acme",
  context: { org: "acme" },
};

const ORG = {
  metadata: { id: "org_1", slug: "acme" },
  spec: { embedding: { allowedOrigins: ["https://app.acme.test"], vaults: [{ org: "acme", slug: "app-keys" }], createAccountsOnSignIn: false, signInRole: 0 } },
};

const fake = vi.hoisted(() => ({
  updateEmbedding: vi.fn(),
  getByReference: vi.fn(),
  serverInfo: vi.fn(),
  createKey: vi.fn(),
  getOrg: vi.fn(),
}));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({
    config: CONFIG,
    serverInfo: fake.serverInfo,
    stigmer: {
      organization: { get: fake.getOrg, updateEmbedding: fake.updateEmbedding },
      platform: { getServerInfo: async () => ({ singleOrg: false }) },
      agent: { getByReference: fake.getByReference },
      apiKey: { create: fake.createKey },
    },
  }),
}));

let out = "";
let cwd: string;
let previousCwd: string;

beforeEach(() => {
  out = "";
  for (const mock of Object.values(fake)) mock.mockReset();
  fake.getOrg.mockResolvedValue(ORG);
  fake.serverInfo.mockResolvedValue({ authenticationRequired: true, version: "0.2.0" });
  fake.getByReference.mockResolvedValue({ metadata: { slug: "invoice-matcher" } });
  previousCwd = process.cwd();
  cwd = mkdtempSync(join(tmpdir(), "stigmer-door-cmd-"));
  process.chdir(cwd);
});

afterEach(() => {
  process.chdir(previousCwd);
});

async function run(...args: string[]): Promise<{ readonly out: string; readonly error?: unknown }> {
  const program = buildProgram();
  program.exitOverride();
  const write = (chunk: unknown): boolean => {
    out += String(chunk);
    return true;
  };
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(write);
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(write);
  try {
    await program.parseAsync(["node", "stigmer", ...args]);
    return { out };
  } catch (error) {
    return { out, error };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe("stigmer example", () => {
  it("lists the examples, and writes one and a skill into the repository", async () => {
    expect((await run("example", "list")).out).toContain("invoice-match — Invoice match");
    expect((await run("example", "get", "invoice-match")).out).toContain("Wrote Invoice match into stigmer/invoice-match");
    expect(readFileSync(join(cwd, "stigmer", "invoice-match", "invoice-matcher.yaml"), "utf8")).toContain("name: invoice-matcher");
    expect((await run("example", "get", "spreadsheet-export")).out).toContain("Wrote the Spreadsheet export skill into stigmer/skills/spreadsheet-export");
  });

  it("refuses a name that is neither, listing both", async () => {
    const { error } = await run("example", "get", "nope");
    expect((error as Error).message).toBe('no example or skill named "nope"');
  });
});

describe("stigmer coding-agent", () => {
  it("prints the guide released with this CLI", async () => {
    const { out: text } = await run("coding-agent");
    expect(text).toContain("the guide for a coding agent");
    expect(text).toContain(GUIDE.split("\n")[0]);
  });
});

describe("stigmer embedding", () => {
  it("shows the organization's settings", async () => {
    expect((await run("embedding")).out).toMatch(/Accounts on sign-in\s+off: your app makes them first/);
  });

  it("saves account creation and the role, keeping the origins and vaults", async () => {
    fake.updateEmbedding.mockImplementation(async (input: { embedding: unknown }) => ({ ...ORG, spec: { embedding: input.embedding } }));
    const { out: text } = await run("embedding", "set", "--create-accounts-on-sign-in", "on", "--sign-in-role", "member");
    const input = fake.updateEmbedding.mock.calls[0]?.[0] as { orgId: string; embedding: { allowedOrigins: string[]; vaults: unknown[]; createAccountsOnSignIn: boolean; signInRole: number } };
    expect(input.orgId).toBe("org_1");
    expect(input.embedding.allowedOrigins).toEqual(["https://app.acme.test"]);
    expect(input.embedding.vaults).toHaveLength(1);
    expect(input.embedding.createAccountsOnSignIn).toBe(true);
    expect(text).toContain("Embedding settings saved");
  });

  it("says only admins may change them when the server refuses", async () => {
    fake.updateEmbedding.mockRejectedValue(new ConnectError("unauthorized to update organization embedding settings", Code.PermissionDenied));
    const { error } = await run("embedding", "set", "--create-accounts-on-sign-in", "on");
    expect((error as Error).message).toBe("only the organization's admins can change how people sign in from your app");
  });

  it("passes any other failure on", async () => {
    fake.updateEmbedding.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    const { error } = await run("embedding", "set", "--create-accounts-on-sign-in", "on");
    expect(classify(error)?.code).toBe(Code.Unavailable);
  });
});

describe("stigmer app-handover", () => {
  it("prints the route and chat for the organization and agent", async () => {
    const { out: text } = await run("app-handover", "--stack", "nextjs", "--agent", "invoice-matcher");
    expect(text).toContain("# app/api/stigmer-token/route.ts");
    expect(text).toContain('"acme/invoice-matcher"');
    expect(text).toContain("https://stigmer.acme.test");
  });

  it("writes them under the folder it is given", async () => {
    const { out: text } = await run("app-handover", "--stack", "node", "--agent", "invoice-matcher", "--write", ".");
    expect(text).toContain("Wrote server.ts");
    expect(readFileSync(join(cwd, "server.ts"), "utf8")).toContain("stigmer-token");
  });

  it("hands the development chat alone on a server that trusts every caller", async () => {
    fake.serverInfo.mockResolvedValue({ authenticationRequired: false, version: "0.0.0-dev" });
    const { out: text } = await run("app-handover", "--stack", "nextjs", "--agent", "invoice-matcher");
    expect(text).toContain("this is the development chat");
  });

  it("refuses an agent the organization does not have, and passes other failures on", async () => {
    fake.getByReference.mockRejectedValueOnce(new ConnectError("no agent", Code.NotFound));
    expect(((await run("app-handover", "--stack", "go", "--agent", "nope")).error as Error).message).toBe('no agent "nope" in acme');
    fake.getByReference.mockRejectedValueOnce(new ConnectError("down", Code.Unavailable));
    expect(classify((await run("app-handover", "--stack", "go", "--agent", "x")).error)?.code).toBe(Code.Unavailable);
    expect(((await run("app-handover", "--stack", "go", "--agent", " ")).error as Error).message).toBe("--agent needs the agent's slug");
  });
});

describe("stigmer apikey create --save-to-env", () => {
  it("writes the new key into the file and prints only where it went", async () => {
    fake.createKey.mockResolvedValue({ metadata: { id: "key_1", name: "my-app" }, spec: { keyHash: "stk_secret_value_1234" } });
    const { out: text } = await run("apikey", "create", "--name", "my-app", "--save-to-env", ".env.local");
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toBe("STIGMER_API_KEY=stk_secret_value_1234\n");
    expect(text).toContain("saved as STIGMER_API_KEY in .env.local");
    expect(text).not.toContain("stk_secret_value_1234");
  });
});

describe("currentOrganization", () => {
  const stigmer = (single: boolean, mine: unknown[]) => ({
    organization: { get: async (value: string) => ({ metadata: { id: "org_named", slug: value } }), listMineAll: async function* () { yield* mine; } },
    platform: { getServerInfo: async () => ({ singleOrg: single }) },
  });

  it("reads the organization a value names, or a one-organization server's own", async () => {
    expect((await currentOrganization(stigmer(false, []) as never, "acme", [])).metadata?.slug).toBe("acme");
    expect((await currentOrganization(stigmer(true, [{ metadata: { slug: "stigmer" } }]) as never, "", [])).metadata?.slug).toBe("stigmer");
  });

  it("asks for one where the server holds several and none is named", async () => {
    await expect(currentOrganization(stigmer(false, []) as never, "", ["stigmer config context set --org <org>"])).rejects.toThrow(
      "organization not set\n\nSet it with:\n  stigmer config context set --org <org>",
    );
  });
});

describe("setup --api-key-stdin's own stdin", () => {
  it("reads what is piped to the process", async () => {
    const stdin = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", { value: Object.assign(Readable.from([Buffer.from("sk-piped\n")]), { isTTY: false }), configurable: true });
    try {
      expect(await withStdinKey({ apiKeyStdin: true })).toMatchObject({ apiKey: "sk-piped", provider: "anthropic" });
    } finally {
      if (stdin !== undefined) Object.defineProperty(process, "stdin", stdin);
    }
  });
});
