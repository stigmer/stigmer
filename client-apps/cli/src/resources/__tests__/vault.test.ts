// Unit tests for the `stigmer vault` resource layer: which vault an entry
// command names (--mine or --vault, exactly one), where a value is read from
// (never the command line), the VaultTarget each write sends (My vault by
// `mine`, with the organization as resolved, empty included; a reference
// resolved to its id first, and before any value is read), that a removal is
// staged (warning naming the entries and the vault, nothing sent until
// performed), that a Connect link is made for a shared vault resolved to its
// id, and that no rendering ever carries a value. The controller is faked to
// capture the exact requests.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { type Vault, VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { ConnectLinkSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import type {
  CreateConnectLinkInput,
  RemoveVaultConnectionsInput,
  RemoveVaultSecretsInput,
  SetVaultConnectionInput,
  SetVaultSecretsInput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnectLink,
  createSharedVault,
  readValue,
  planRemoveConnections,
  planRemoveSecrets,
  setConnection,
  setSecret,
  showMyVault,
  type ValueIo,
  vaultChoiceOf,
} from "../vault.js";
import type { ControllerFn } from "../run/create.js";

const SHARED = create(VaultSchema, {
  metadata: { id: "vlt_1", name: "Support tools", slug: "support-tools", org: "org_acme" },
  spec: { owner: { case: "org", value: "org_acme" } },
});

const MINE = create(VaultSchema, {
  metadata: { id: "vlt_2", name: "My vault", org: "org_acme" },
  spec: {
    owner: { case: "person", value: "ida_ana" },
    secrets: { OPENAI_API_KEY: { value: "", description: "work key" } },
    connections: { "https://mcp.linear.app/mcp": { token: "" } },
  },
});

interface Recorded {
  created?: Vault;
  removeConnections?: RemoveVaultConnectionsInput;
  setSecrets?: SetVaultSecretsInput;
  removeSecrets?: RemoveVaultSecretsInput;
  setConnection?: SetVaultConnectionInput;
  connectLink?: CreateConnectLinkInput;
  referenceLookups: string[];
}

function fakeController(
  opts: { mine?: Vault | "missing" | "broken"; idless?: boolean; unknownRef?: boolean } = {},
): { fn: ControllerFn; rec: Recorded } {
  const rec: Recorded = { referenceLookups: [] };
  const fn = ((service: unknown) => {
    if (service === VaultQueryController) {
      return {
        get: async (req: { value: string }) => {
          rec.referenceLookups.push(`id:${req.value}`);
          return SHARED;
        },
        getByReference: async (req: { org: string; slug: string }) => {
          rec.referenceLookups.push(`ref:${req.org}/${req.slug}`);
          if (opts.unknownRef === true) {
            throw new ConnectError("vault not found", Code.NotFound);
          }
          return opts.idless === true ? create(VaultSchema, { metadata: { name: "Ghost" } }) : SHARED;
        },
        getMine: async () => {
          if (opts.mine === "missing" || opts.mine === undefined) {
            throw new ConnectError("vault not found", Code.NotFound);
          }
          if (opts.mine === "broken") {
            throw new ConnectError("store unavailable", Code.Unavailable);
          }
          return opts.mine;
        },
      };
    }
    if (service === VaultCommandController) {
      return {
        setSecrets: async (req: SetVaultSecretsInput) => {
          rec.setSecrets = req;
          return req.vault?.vault.case === "mine" ? MINE : SHARED;
        },
        removeSecrets: async (req: RemoveVaultSecretsInput) => {
          rec.removeSecrets = req;
          return SHARED;
        },
        setConnection: async (req: SetVaultConnectionInput) => {
          rec.setConnection = req;
          return MINE;
        },
        removeConnections: async (req: RemoveVaultConnectionsInput) => {
          rec.removeConnections = req;
          return SHARED;
        },
        createConnectLink: async (req: CreateConnectLinkInput) => {
          rec.connectLink = req;
          return create(ConnectLinkSchema, {
            url: "https://console.example/connect/secret-token",
            expiresAt: timestampFromMs(Date.parse("2026-10-09T12:30:00Z")),
          });
        },
        create: async (req: Vault) => {
          rec.created = req;
          return create(VaultSchema, {
            metadata: { id: "vlt_9", name: req.metadata?.name ?? "", slug: "support-tools", org: "org_acme" },
          });
        },
      };
    }
    throw new Error("unexpected service");
  }) as unknown as ControllerFn;
  return { fn, rec };
}

/** A value reader that records each read, as the command layer's would. */
function valueOf(value: string): { read: () => Promise<string>; reads: () => number } {
  let count = 0;
  return {
    read: async () => {
      count += 1;
      return value;
    },
    reads: () => count,
  };
}

function io(overrides: Partial<ValueIo> = {}): ValueIo {
  return {
    env: {},
    stdinIsTty: false,
    promptHidden: async () => {
      throw new Error("no prompt expected");
    },
    readStdin: async () => "",
    ...overrides,
  };
}

describe("vaultChoiceOf", () => {
  it("takes --mine or --vault", () => {
    expect(vaultChoiceOf({ mine: true })).toEqual({ kind: "mine" });
    expect(vaultChoiceOf({ vault: "acme/support-tools" })).toEqual({ kind: "ref", ref: "acme/support-tools" });
  });

  it("refuses both and neither", () => {
    expect(() => vaultChoiceOf({ mine: true, vault: "x" })).toThrow(/not both/);
    expect(() => vaultChoiceOf({})).toThrow(/--mine for your own/);
  });
});

describe("readValue", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vault-value-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a named environment variable", async () => {
    expect(await readValue("K", { fromEnv: "MY_KEY" }, io({ env: { MY_KEY: "sk-1" } }))).toBe("sk-1");
  });

  it("refuses an unset environment variable", async () => {
    await expect(readValue("K", { fromEnv: "MISSING" }, io())).rejects.toThrow(/MISSING is not set/);
  });

  it("reads a file, dropping one trailing newline", async () => {
    const path = join(dir, "key");
    writeFileSync(path, "line-one\n");
    expect(await readValue("K", { fromFile: path }, io())).toBe("line-one");
  });

  it("reads piped stdin when no source is named", async () => {
    expect(await readValue("K", {}, io({ readStdin: async () => "piped\r\n" }))).toBe("piped");
  });

  it("prompts with hidden input on a terminal", async () => {
    const asked: string[] = [];
    const value = await readValue(
      "OPENAI_API_KEY",
      {},
      io({
        stdinIsTty: true,
        promptHidden: async (q) => {
          asked.push(q);
          return "typed";
        },
      }),
    );
    expect(value).toBe("typed");
    expect(asked).toEqual(["Value for OPENAI_API_KEY"]);
  });

  it("names the file it could not read", async () => {
    await expect(readValue("K", { fromFile: join(dir, "absent") }, io())).rejects.toThrow(/failed to read .*absent/);
  });

  it("refuses an empty value and two sources at once", async () => {
    await expect(readValue("K", {}, io())).rejects.toThrow(/no value given for K/);
    await expect(readValue("K", { fromEnv: "A", fromFile: "b" }, io())).rejects.toThrow(/not both/);
  });
});

describe("entry writes", () => {
  it("names My vault by `mine` with the organization, without resolving anything", async () => {
    const { fn, rec } = fakeController();
    const result = await setSecret(fn, "acme", { kind: "mine" }, "OPENAI_API_KEY", valueOf("sk-1").read, "work key");
    expect(rec.referenceLookups).toEqual([]);
    expect(rec.setSecrets?.vault?.org).toBe("acme");
    expect(rec.setSecrets?.vault?.vault).toEqual({ case: "mine", value: true });
    expect(rec.setSecrets?.secrets.OPENAI_API_KEY).toMatchObject({ value: "sk-1", description: "work key" });
    expect(result.message).toBe("Secret OPENAI_API_KEY saved in your vault");
    expect(JSON.stringify(result)).not.toContain("sk-1");
  });

  it("sends --mine with an empty organization for a single-organization server to fill", async () => {
    const { fn, rec } = fakeController();
    await setSecret(fn, "", { kind: "mine" }, "K", valueOf("v").read, "");
    expect(rec.setSecrets?.vault?.org).toBe("");
    expect(rec.setSecrets?.vault?.vault).toEqual({ case: "mine", value: true });
    const plan = await planRemoveConnections(fn, "", { kind: "mine" }, ["github.com"]);
    await plan.perform();
    expect(rec.removeConnections?.vault?.org).toBe("");
  });

  it("refuses a vault that does not resolve before reading any value", async () => {
    const { fn, rec } = fakeController({ unknownRef: true });
    const secret = valueOf("sk-1");
    await expect(setSecret(fn, "acme", { kind: "ref", ref: "suport-tools" }, "K", secret.read, "")).rejects.toThrow(
      /vault not found/,
    );
    const token = valueOf("tok");
    await expect(
      setConnection(fn, "acme", { kind: "ref", ref: "suport-tools" }, "github.com", token.read, ""),
    ).rejects.toThrow(/vault not found/);
    expect(secret.reads()).toBe(0);
    expect(token.reads()).toBe(0);
    expect(rec.setSecrets).toBeUndefined();
    expect(rec.setConnection).toBeUndefined();
  });

  it("resolves a shared vault's reference to its id and organization first", async () => {
    const { fn, rec } = fakeController();
    const plan = await planRemoveSecrets(fn, "acme", { kind: "ref", ref: "support-tools" }, ["ZENDESK_KEY"]);
    expect(rec.referenceLookups).toEqual(["ref:acme/support-tools"]);
    expect(rec.removeSecrets).toBeUndefined();
    expect(plan.warning.message).toBe("You are about to remove this secret from vault 'Support tools':");
    expect(JSON.stringify(plan.warning)).toContain("ZENDESK_KEY");
    await plan.perform();
    expect(rec.removeSecrets?.vault?.org).toBe("org_acme");
    expect(rec.removeSecrets?.vault?.vault).toEqual({ case: "id", value: "vlt_1" });
    expect(rec.removeSecrets?.names).toEqual(["ZENDESK_KEY"]);
  });

  it("reads an id reference by id", async () => {
    const { fn, rec } = fakeController();
    await setSecret(fn, "acme", { kind: "ref", ref: "vlt_1" }, "K", valueOf("v").read, "");
    expect(rec.referenceLookups).toEqual(["id:vlt_1"]);
  });

  it("saves a login at the address as given; the server normalizes it", async () => {
    const { fn, rec } = fakeController();
    const token = valueOf("tok");
    const result = await setConnection(fn, "acme", { kind: "mine" }, "https://MCP.Linear.app/mcp/", token.read, "");
    expect(token.reads()).toBe(1);
    expect(rec.setConnection?.address).toBe("https://MCP.Linear.app/mcp/");
    expect(rec.setConnection?.token).toBe("tok");
    expect(result.message).toBe("Login for https://MCP.Linear.app/mcp/ saved in your vault");
  });
});

describe("showMyVault", () => {
  it("lists entry names and descriptions, never a value", async () => {
    const { fn } = fakeController({ mine: MINE });
    const result = await showMyVault(fn, "acme");
    const text = JSON.stringify(result);
    expect(text).toContain("OPENAI_API_KEY");
    expect(text).toContain("work key");
    expect(text).toContain("https://mcp.linear.app/mcp");
    expect(result.sections.map((s) => s.title)).toEqual(["Secrets (1)", "Logins (1)"]);
  });

  it("answers an empty vault before the first save", async () => {
    const { fn } = fakeController({ mine: "missing" });
    const result = await showMyVault(fn, "acme");
    expect(result.message).toBe("Your vault is empty");
  });
});

describe("createSharedVault", () => {
  it("creates an empty organization vault with its description and external id, and says how to add a key", async () => {
    const { fn, rec } = fakeController();
    const result = await createSharedVault(fn, "acme", "Support tools", {
      description: "the support team's keys",
      externalId: "cust-1",
    });
    expect(rec.created?.metadata).toMatchObject({ name: "Support tools", org: "acme" });
    expect(rec.created?.spec).toMatchObject({ description: "the support team's keys", externalId: "cust-1" });
    expect(Object.keys(rec.created?.spec?.secrets ?? {})).toEqual([]);
    expect(result.message).toBe("Shared vault 'Support tools' created");
    expect(JSON.stringify(result)).toContain("vlt_9");
    expect(JSON.stringify(result)).toContain("--vault support-tools");
  });

  it("sends empty fields when no options are given", async () => {
    const { fn, rec } = fakeController();
    await createSharedVault(fn, "acme", "Plain", {});
    expect(rec.created?.spec).toMatchObject({ description: "", externalId: "" });
  });
});

describe("planRemoveConnections", () => {
  it("names the logins and the vault, then removes them by address from the resolved vault", async () => {
    const { fn, rec } = fakeController();
    const plan = await planRemoveConnections(fn, "acme", { kind: "ref", ref: "acme/support-tools" }, ["github.com"]);
    expect(plan.warning.message).toBe("You are about to remove the login for this address from vault 'Support tools':");
    expect(plan.confirmPrompt).toBe("Proceed with removal? [y/N]");
    expect(rec.removeConnections).toBeUndefined();
    const result = await plan.perform();
    expect(rec.removeConnections?.vault?.vault).toEqual({ case: "id", value: "vlt_1" });
    expect(rec.removeConnections?.addresses).toEqual(["github.com"]);
    expect(result.message).toBe("Removed the logins for github.com from vault 'Support tools'");
  });

  it("names several entries in the plural, and the caller's own vault as theirs", async () => {
    const { fn } = fakeController();
    const secrets = await planRemoveSecrets(fn, "acme", { kind: "mine" }, ["A", "B"]);
    expect(secrets.warning.message).toBe("You are about to remove these secrets from your vault:");
    const logins = await planRemoveConnections(fn, "acme", { kind: "mine" }, ["github.com", "gitlab.com"]);
    expect(logins.warning.message).toBe("You are about to remove the logins for these addresses from your vault:");
  });

  it("refuses a reference that resolves to a vault with no id", async () => {
    const { fn } = fakeController({ idless: true });
    await expect(planRemoveConnections(fn, "acme", { kind: "ref", ref: "ghost" }, ["github.com"])).rejects.toThrow(
      /vault 'ghost' has no id/,
    );
  });
});

describe("showMyVault, more", () => {
  it("passes on any failure other than a missing vault", async () => {
    const { fn } = fakeController({ mine: "broken" });
    await expect(showMyVault(fn, "acme")).rejects.toThrow(/store unavailable/);
  });

  it("sorts entries by name and says how to save a first key when the vault holds none", async () => {
    const empty = create(VaultSchema, {
      metadata: { id: "vlt_3", name: "My vault" },
      spec: { owner: { case: "person", value: "ida_ana" } },
    });
    const emptyResult = await showMyVault(fakeController({ mine: empty }).fn, "acme");
    expect(emptyResult.sections.map((s) => s.title)).toEqual(["Secrets (0)", "Logins (0)"]);
    expect(JSON.stringify(emptyResult)).toContain("stigmer vault set-secret <NAME> --mine");

    const two = create(VaultSchema, {
      metadata: { id: "vlt_4", name: "My vault" },
      spec: {
        owner: { case: "person", value: "ida_ana" },
        secrets: { ZED: { value: "" }, ALPHA: { value: "" } },
        connections: { "https://b.example/mcp": { token: "" }, "https://a.example/mcp": { token: "" } },
      },
    });
    const text = JSON.stringify(await showMyVault(fakeController({ mine: two }).fn, "acme"));
    expect(text.indexOf("ALPHA")).toBeLessThan(text.indexOf("ZED"));
    expect(text.indexOf("https://a.example/mcp")).toBeLessThan(text.indexOf("https://b.example/mcp"));
  });
});

describe("createConnectLink", () => {
  it("resolves the shared vault to its id and sends the address, return URL and lifetime", async () => {
    const { fn, rec } = fakeController();
    const result = await createConnectLink(fn, "acme", "support-tools", {
      address: "https://mcp.linear.app/mcp",
      returnUrl: "https://helpdesk.example/done",
      expiresInSeconds: 3600,
    });
    expect(rec.referenceLookups).toEqual(["ref:acme/support-tools"]);
    expect(rec.connectLink).toMatchObject({
      org: "org_acme",
      vaultId: "vlt_1",
      address: "https://mcp.linear.app/mcp",
      returnUrl: "https://helpdesk.example/done",
      expiresInSeconds: 3600,
    });
    const text = JSON.stringify(result);
    expect(text).toContain("https://console.example/connect/secret-token");
    expect(text).toContain("2026-10-09T12:30:00.000Z");
    expect(text).toContain("send it only to the customer");
  });

  it("leaves the lifetime to the server when none is given", async () => {
    const { fn, rec } = fakeController();
    await createConnectLink(fn, "acme", "vlt_1", {
      address: "github.com",
      returnUrl: "https://helpdesk.example/done",
    });
    expect(rec.referenceLookups).toEqual(["id:vlt_1"]);
    expect(rec.connectLink?.expiresInSeconds).toBe(0);
  });
});
