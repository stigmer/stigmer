// Command-level contract for `connect plugin`: the org guard (issue #140) and
// the rendering of a listing.
//
// Listing through a runner reads the caller's My vault in an organization.
// Rather than let the backend reject the request with the cryptic "org value
// length must be at least 1" validation error, the command fails fast with
// actionable guidance, but only when a runner lists. `--dry-run` lists
// locally and must stay usable with no org configured.
//
// The guard fires only when no org is named AND the server holds several: a
// server that holds one organization fills it (client/single-org.ts). The
// test injects a config with no org by overriding `load()`, and the server's
// answer through a stand-in client the real guard asks; everything else stays real. The
// guard runs before the listing, so every case is deterministic and offline.
// The result names the plugin's organization by slug where the caller can
// see it, in place of the id the server stores, and marks the tools the
// server calls destructive.

import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Config } from "../../config/index.js";
import { classify, ExitCode } from "../../errors/index.js";
import { buildProgram } from "../../program.js";

// When set, `load()` returns this config instead of reading disk/defaults.
// Reset in beforeEach so each test opts in explicitly.
let configOverride: Config | undefined;

// The server's answer to "do you hold one organization?".
let singleOrg = false;

vi.mock("../../client/single-org.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/single-org.js")>();
  // A fresh stand-in client per call, whose server answers `singleOrg`; the
  // real guard runs over it.
  const answering = () =>
    ({
      platform: { getServerInfo: async () => ({ singleOrg }) },
    }) as unknown as Stigmer;
  return {
    ...actual,
    holdsOneOrganization: () => actual.holdsOneOrganization(answering()),
    omitsOrganization: () => actual.omitsOrganization(answering()),
    requireOrganization: (_stigmer: Stigmer, org: string, setItWith: readonly string[]) =>
      actual.requireOrganization(answering(), org, setItWith),
  };
});

// The organization id the plugin is filed under; unset, it is the
// slug `stigmer`, an organization from an earlier release whose id is its slug.
let serverOrg = "stigmer";

// When set, the client's organization get answers through this instead of
// reaching a backend (which none of these tests has, so the label falls back).
let organizationGet: ((value: string) => Promise<unknown>) | undefined;

vi.mock("../../backend.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../backend.js")>();
  return {
    ...actual,
    connectBackend: (...args: Parameters<typeof actual.connectBackend>) => {
      const real = actual.connectBackend(...args);
      const get = organizationGet;
      return get === undefined
        ? real
        : { ...real, stigmer: { organization: { get } } as unknown as Stigmer };
    },
  };
});

// A listing that settles, so the success rendering runs: the plugin's name
// and its organization as the backend returned them, and two tools.
vi.mock("../../resources/connect/connect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/connect/connect.js")>();
  return {
    ...actual,
    connectPlugin: async () => ({
      plugin: { metadata: { slug: "orders", org: serverOrg } },
      server: { name: "orders", transport: { case: "http", value: { url: "https://orders.example.com/mcp" } } },
      tools: [
        { name: "list_orders", description: "List orders", destructive: false },
        { name: "cancel_order", description: "Cancel an order", destructive: true },
      ],
      dryRun: false,
    }),
  };
});

vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  return {
    ...actual,
    load: (path?: string) => configOverride ?? actual.load(path),
  };
});

/** An authenticated cloud config with no org selected — the guard's target shape. */
function cloudConfigWithoutOrg(): Config {
  return {
    backend: { type: "cloud" },
    backends: { cloud: { type: "cloud", token: "test-token" } },
    current_backend: "cloud",
  };
}

interface RunOutcome {
  readonly exitCode: number;
  readonly message: string;
  readonly stdout: string;
}

// Runs `connect plugin <ref> [flags]` in standalone mode with output
// suppressed, returning the thrown error's classified exit code and message (or
// a success sentinel). `--standalone` is a program-global flag, so it must
// precede the subcommand (commander's enablePositionalOptions).
async function runConnect(
  ref: string,
  ...flags: string[]
): Promise<RunOutcome> {
  const program = buildProgram();
  program.exitOverride();
  const written: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await program.parseAsync([
      "node",
      "stigmer",
      "--standalone",
      "connect",
      "plugin",
      ref,
      ...flags,
    ]);
    return { exitCode: ExitCode.Success, message: "", stdout: written.join("") };
  } catch (err) {
    return {
      exitCode: classify(err)?.exitCode ?? -1,
      message: err instanceof Error ? err.message : String(err),
      stdout: written.join(""),
    };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

let savedOrg: string | undefined;
let savedApiKey: string | undefined;

beforeEach(() => {
  configOverride = undefined;
  singleOrg = false;
  serverOrg = "stigmer";
  organizationGet = undefined;
  savedOrg = process.env.STIGMER_ORG;
  savedApiKey = process.env.STIGMER_API_KEY;
  delete process.env.STIGMER_ORG;
  delete process.env.STIGMER_API_KEY;
});

afterEach(() => {
  if (savedOrg === undefined) delete process.env.STIGMER_ORG;
  else process.env.STIGMER_ORG = savedOrg;
  if (savedApiKey === undefined) delete process.env.STIGMER_API_KEY;
  else process.env.STIGMER_API_KEY = savedApiKey;
});

describe("connect plugin org guard", () => {
  it("fails fast with actionable guidance when cloud mode has no org (non-dry-run)", async () => {
    configOverride = cloudConfigWithoutOrg();
    const outcome = await runConnect("plg_test");
    expect(outcome.message).toContain("organization not set");
    expect(outcome.exitCode).toBe(ExitCode.Usage);
  });

  it("does not fire on a server that holds one organization: the server fills it, and the result names no organization", async () => {
    configOverride = cloudConfigWithoutOrg();
    singleOrg = true;
    const outcome = await runConnect("plg_test");
    expect(outcome.message).not.toContain("organization not set");
    expect(outcome.stdout).toContain("Plugin:     orders");
    expect(outcome.stdout).not.toContain("stigmer/orders");
    expect(outcome.stdout).toContain("MCP server: orders (http: https://orders.example.com/mcp)");
    expect(outcome.stdout).toMatch(/cancel_order\s+\[destructive\] Cancel an order/);
    expect(outcome.stdout).toMatch(/list_orders\s+List orders/);
    expect(outcome.stdout).toContain("Listed as you; nothing stored");
  });

  it("names the server with its organization on a server that holds several", async () => {
    configOverride = cloudConfigWithoutOrg();
    process.env.STIGMER_ORG = "stigmer";
    const outcome = await runConnect("plg_test");
    expect(outcome.stdout).toContain("Plugin:     stigmer/orders");
  });

  it("names the server's organization by slug where the server stores its id", async () => {
    const id = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
    configOverride = cloudConfigWithoutOrg();
    process.env.STIGMER_ORG = "acme";
    serverOrg = id;
    organizationGet = async (value) => {
      if (value !== id) throw new Error("organization not found");
      return create(OrganizationSchema, { metadata: { id, slug: "acme" } });
    };
    const outcome = await runConnect("plg_test");
    expect(outcome.stdout).toContain("Plugin:     acme/orders");
    expect(outcome.stdout).not.toContain(id);
  });

  it("does not apply the org guard in dry-run mode (offline dry-run stays usable)", async () => {
    // Dry-run lists locally, so the guard must not fire even with no org. The
    // command proceeds past the guard and fails later for an unrelated reason
    // (no reachable backend) — never with the org guidance error.
    const outcome = await runConnect("plg_test", "--dry-run");
    expect(outcome.message).not.toContain("organization not set");
  });
});
