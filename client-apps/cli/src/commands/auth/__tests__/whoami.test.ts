// Unit tests for `stigmer auth whoami`'s result (commands/auth/whoami.ts):
// the command runs the SDK's ensureMyIdentityAccount — the
// same first-sign-in flow the console runs — and RENDERS what it learned.
// whoamiResult is the pure half: given the account and whether this call
// created it, the CommandResult a person reads. A first sign-in says so
// (visibility of system status); a missing organization is a hint, not a
// failure; an empty profile (the unconfigured laptop's operator) renders
// only the fields it has. Accounts are built with the generated schema
// (the generated type is the contract).
//
// runWhoami is the I/O half: it names the context organization by the slug
// the backend answers now, falls back to the slug `config context set`
// stored and then to the id, and stores a slug that changed since. The
// backend client and the account read are stubbed at their module seams;
// the config file is real (HOME redirected).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { load } from "../../../config/index.js";
import { runWhoami, whoamiResult } from "../whoami.js";

const ALICE = {
  metadata: { id: "ida_wtr3jcf281yfk9xx61kj59fsme", name: "alice@example.com" },
  spec: {
    idpId: "auth0|alice",
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Liddell",
    isMachineAccount: false,
  },
};
const ACCOUNT = create(IdentityAccountSchema, ALICE);

function fields(
  result: ReturnType<typeof whoamiResult>,
): Record<string, string> {
  return Object.fromEntries(
    result.sections.flatMap((s) => s.fields.map((f) => [f.key, f.value])),
  );
}

describe("whoamiResult", () => {
  it("renders an existing account as 'Authenticated' with its identity fields", () => {
    const result = whoamiResult(ACCOUNT, { created: false, org: "acme", singleOrg: false });
    expect(result.status).toBe("success");
    expect(result.message).toBe("Authenticated");
    expect(fields(result)).toEqual({
      "Account ID": "ida_wtr3jcf281yfk9xx61kj59fsme",
      Name: "alice@example.com",
      Email: "alice@example.com",
      "Full Name": "Alice Liddell",
      "Account Type": "User Account",
      Organization: "acme",
    });
    expect(result.hints).toEqual([]);
  });

  it("names the organization by slug, with its id as a field of its own", () => {
    const result = whoamiResult(ACCOUNT, {
      created: false,
      org: "acme",
      orgId: "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
      singleOrg: false,
    });
    expect(fields(result)).toMatchObject({
      Organization: "acme",
      "Organization ID": "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("says so when this call created the account — the first sign-in is visible, never silent", () => {
    const result = whoamiResult(ACCOUNT, { created: true, org: "acme", singleOrg: false });
    expect(result.status).toBe("success");
    expect(result.message).toBe(
      "Authenticated — your account was created on this first sign-in",
    );
    expect(fields(result)["Account ID"]).toBe("ida_wtr3jcf281yfk9xx61kj59fsme");
  });

  it("a missing organization is a hint with the command that sets it", () => {
    const result = whoamiResult(ACCOUNT, { created: false, org: "", singleOrg: false });
    expect(fields(result).Organization).toBeUndefined();
    expect(result.hints).toEqual([
      "No organization set. Use: stigmer config context set --org <slug>",
    ]);
  });

  it("on a server that holds one organization, names none and hints nothing", () => {
    for (const org of ["", "acme"]) {
      const result = whoamiResult(ACCOUNT, { created: false, org, singleOrg: true });
      expect(fields(result).Organization).toBeUndefined();
      expect(result.hints).toEqual([]);
    }
  });

  it("renders only the fields an empty profile has (the unconfigured laptop's operator)", () => {
    const result = whoamiResult(
      create(IdentityAccountSchema, {
        metadata: { id: "ida_fn0zdvkkkhhrb4wry43zba8gnn", name: "system" },
        spec: { idpId: "local|system" },
      }),
      { created: false, org: "local", singleOrg: false },
    );
    expect(fields(result)).toEqual({
      "Account ID": "ida_fn0zdvkkkhhrb4wry43zba8gnn",
      Name: "system",
      "Account Type": "User Account",
      Organization: "local",
    });
  });

  it("names a machine account", () => {
    const result = whoamiResult(
      create(IdentityAccountSchema, {
        ...ALICE,
        spec: { ...ALICE.spec, isMachineAccount: true },
      }),
      { created: false, org: "acme", singleOrg: false },
    );
    expect(fields(result)["Account Type"]).toBe("Machine Account");
  });
});

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

// What the stubbed backend's organization get does for ACME_ID: answer a
// slug, refuse it as hidden, or fail as an unreachable server.
let organizationAnswer: { slug: string } | "hidden" | "unreachable" = { slug: "acme" };

vi.mock("../../../backend.js", async () => {
  const { load: loadConfig } = await import("../../../config/index.js");
  return {
    connectBackend: () => ({
      config: loadConfig(),
      stigmer: {
        organization: {
          get: async (value: string) => {
            if (organizationAnswer === "hidden" || (value !== ACME_ID && value !== "acme-old")) {
              throw new ConnectError("permission denied", Code.PermissionDenied);
            }
            if (organizationAnswer === "unreachable") {
              throw new ConnectError("backend unavailable", Code.Unavailable);
            }
            return create(OrganizationSchema, { metadata: { id: ACME_ID, slug: organizationAnswer.slug } });
          },
        },
      },
    }),
  };
});

vi.mock("@stigmer/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/sdk")>();
  return {
    ...actual,
    ensureMyIdentityAccount: async () => ({ created: false, account: ACCOUNT }),
  };
});

describe("runWhoami's organization", () => {
  let home: string;
  let originalHome: string | undefined;

  function writeConfig(context: string[], backend: string[] = []): void {
    writeFileSync(
      join(home, ".stigmer", "config.yaml"),
      [
        "backends:",
        "  team:",
        "    type: selfhost",
        "    endpoint: 127.0.0.1:1",
        ...backend,
        "current_backend: team",
        ...context,
        "",
      ].join("\n"),
    );
  }

  beforeEach(() => {
    organizationAnswer = { slug: "acme" };
    originalHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "stigmer-whoami-"));
    process.env.HOME = home;
    mkdirSync(join(home, ".stigmer"), { recursive: true });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("shows the slug the backend answers now and stores it in place of the one `context set` stored", async () => {
    writeConfig(["context:", `  org: ${ACME_ID}`, "  org_slug: acme-old"]);
    organizationAnswer = { slug: "acme-corp" };
    const result = await runWhoami();
    expect(fields(result)).toMatchObject({ Organization: "acme-corp", "Organization ID": ACME_ID });
    expect(load().context).toEqual({ org: ACME_ID, org_slug: "acme-corp" });
  });

  it("leaves the config alone when the stored slug is current", async () => {
    writeConfig(["context:", `  org: ${ACME_ID}`, "  org_slug: acme"]);
    const before = load();
    const result = await runWhoami();
    expect(fields(result)).toMatchObject({ Organization: "acme", "Organization ID": ACME_ID });
    expect(load()).toEqual(before);
  });

  it("falls back to the stored slug when the backend will not name the organization", async () => {
    writeConfig(["context:", `  org: ${ACME_ID}`, "  org_slug: acme"]);
    for (const answer of ["hidden", "unreachable"] as const) {
      organizationAnswer = answer;
      const result = await runWhoami();
      expect(fields(result)).toMatchObject({ Organization: "acme", "Organization ID": ACME_ID });
      expect(load().context).toEqual({ org: ACME_ID, org_slug: "acme" });
    }
  });

  it("stores no slug beside a context that names no organization, when the backend's own names it", async () => {
    // A slug left in the file without the organization it described.
    writeConfig(["context:", "  org_slug: acme-old"], [`    org_id: ${ACME_ID}`]);
    const before = load();
    organizationAnswer = { slug: "acme-corp" };
    const result = await runWhoami();
    expect(fields(result).Organization).toBe("acme-corp");
    expect(load()).toEqual(before);
  });

  it("rewrites a context an older CLI wrote by slug to the organization's id, once the backend names it", async () => {
    // The organization was renamed from acme-old since, and the old slug
    // still leads to it.
    writeConfig(["context:", "  org: acme-old"]);
    organizationAnswer = { slug: "acme-corp" };
    const result = await runWhoami();
    expect(fields(result)).toMatchObject({ Organization: "acme-corp", "Organization ID": ACME_ID });
    expect(load().context).toEqual({ org: ACME_ID, org_slug: "acme-corp" });

    organizationAnswer = "hidden";
    writeConfig(["context:", "  org: acme-old"]);
    const hidden = await runWhoami();
    expect(fields(hidden).Organization).toBe("acme-old");
    expect(fields(hidden)["Organization ID"]).toBeUndefined();
    expect(load().context).toEqual({ org: "acme-old" });
  });

  it("falls back to the id when no slug is stored, and stores none it was not asked to keep", async () => {
    writeConfig(["context:", `  org: ${ACME_ID}`]);
    organizationAnswer = "hidden";
    const hidden = await runWhoami();
    expect(fields(hidden).Organization).toBe(ACME_ID);
    expect(fields(hidden)["Organization ID"]).toBeUndefined();

    organizationAnswer = { slug: "acme" };
    const named = await runWhoami();
    expect(fields(named)).toMatchObject({ Organization: "acme", "Organization ID": ACME_ID });
    expect(load().context).toEqual({ org: ACME_ID });
  });
});
