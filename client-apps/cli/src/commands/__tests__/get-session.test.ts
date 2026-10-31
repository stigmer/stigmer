// `stigmer get session <id>` end to end through the program (CLI-09,
// stigmer#2502): the session is read by its id through the client's
// `session.get`, its runs through `run.listBySession`, and the view names
// its organization by slug; `-o json` and `-o yaml` print the session alone,
// whole, and read no runs; a reference that is not an id is refused as a
// usage error before any call. The backend is stubbed at its module seam;
// the command, the registry, the bindings, the views and the program are
// real.

import { create, toJson } from "@bufbuild/protobuf";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { buildProgram } from "../../program.js";
import * as fixtures from "../../resources/views/__fixtures__/resources.js";

vi.mock("../../client/single-org.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/single-org.js")>();
  return { ...actual, holdsOneOrganization: async () => false, omitsOrganization: async () => false };
});

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

// What the stubbed client was asked.
const calls: string[] = [];

const stigmer = {
  session: {
    get: async (id: string) => {
      calls.push(`session.get ${id}`);
      return fixtures.session;
    },
  },
  run: {
    listBySession: async (request: { sessionId: string }) => {
      calls.push(`run.listBySession ${request.sessionId}`);
      return { entries: fixtures.sessionRuns, nextPageToken: "" };
    },
  },
  organization: {
    get: async (id: string) => create(OrganizationSchema, { metadata: { id, slug: "acme" } }),
  },
};

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

/** Runs `stigmer --standalone get ...`, returning what it wrote to stdout. */
async function runGet(...args: string[]): Promise<string> {
  const program = buildProgram();
  program.exitOverride();
  const written: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  try {
    await program.parseAsync(["node", "stigmer", "--standalone", "get", ...args]);
  } finally {
    outSpy.mockRestore();
  }
  return written.join("");
}

const SESSION_ID = fixtures.session.metadata!.id;

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CLI-09 stigmer get session", () => {
  it("shows the session by its id with its newest runs, its organization by slug", async () => {
    const out = await runGet("session", SESSION_ID);
    expect(calls).toEqual([`session.get ${SESSION_ID}`, `run.listBySession ${SESSION_ID}`]);
    expect(out).toMatch(/^Q3 ledger variance review {2}acme\/ses-01jddd$/m);
    expect(out).toContain(`  ID:           ${SESSION_ID}\n`);
    expect(out).toMatch(/^Runs$/m);
    expect(out).toContain("  … 2 earlier runs\n");
    expect(out).not.toContain(fixtures.ACME_ID);
  });

  it("prints the session alone, whole, for -o json and -o yaml, and reads no runs", async () => {
    const whole = toJson(SessionSchema, fixtures.session, { useProtoFieldName: true });
    expect(JSON.parse(await runGet("session", SESSION_ID, "-o", "json"))).toEqual(whole);
    expect(parseYaml(await runGet("session", SESSION_ID, "-o", "yaml"))).toEqual(whole);
    expect(calls).toEqual([`session.get ${SESSION_ID}`, `session.get ${SESSION_ID}`]);
  });

  it("refuses a session named by anything but its id, before any call", async () => {
    await expect(runGet("session", "variance-reporter")).rejects.toThrow("Sessions can only be fetched by ID");
    expect(calls).toEqual([]);
  });
});
