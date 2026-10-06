// Command-level contract for the commands that print an organization: on a
// server that holds one (client/single-org.ts says yes), `get` and
// `get run <id>` print no Org line and `auth whoami` names none and hints
// nothing; on a server that holds several they print it as before, except
// for an organization itself, which belongs to none, naming it by slug
// where the caller can see it and by the value as given where not. The
// backend, the resource fetch and the account read are stubbed at their module
// seams; the commands, the renderers and the program are real.

import { create } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Config } from "../../config/index.js";
import { buildProgram } from "../../program.js";
import { runWhoami } from "../auth/whoami.js";

// The server's answer to "do you hold one organization?".
let singleOrg = false;

vi.mock("../../client/single-org.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/single-org.js")>();
  return {
    ...actual,
    holdsOneOrganization: async () => singleOrg,
    omitsOrganization: async () => singleOrg,
  };
});

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

// The stubbed client; one with no organization get unless a test says otherwise,
// so every label falls back to the value as given.
let stigmer: object = {};

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

/** A client whose organization get answers acme for its id. */
function stigmerKnowingAcme(): object {
  return {
    organization: {
      get: async (value: string) => {
        if (value !== ACME_ID) throw new Error("organization not found");
        return create(OrganizationSchema, { metadata: { id: ACME_ID, slug: "acme" } });
      },
    },
  };
}

// What the stubbed resource fetch answers; an agent unless a test says otherwise.
let fetched: { schema: DescMessage; message: Message } | undefined;

vi.mock("../../resources/get.js", () => ({
  fetchResource: async () =>
    fetched ?? {
      schema: AgentSchema,
      message: create(AgentSchema, {
        metadata: { id: "agt_1", name: "Helper", slug: "helper", org: "stigmer" },
      }),
    },
}));

// The organization the stubbed run belongs to.
let executionOrg = "stigmer";

vi.mock("../../resources/runs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/runs.js")>();
  return {
    ...actual,
    getRun: async () => ({
      schema: AgentRunSchema,
      message: create(AgentRunSchema, {
        metadata: { id: "aex_1", name: "run", org: executionOrg },
      }),
    }),
  };
});

vi.mock("@stigmer/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/sdk")>();
  return {
    ...actual,
    ensureMyIdentityAccount: async () => ({
      created: false,
      account: create(IdentityAccountSchema, {
        metadata: { id: "ida_1", name: "alice@example.com" },
        spec: { email: "alice@example.com" },
      }),
    }),
  };
});

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

let savedOrg: string | undefined;

beforeEach(() => {
  singleOrg = false;
  fetched = undefined;
  stigmer = {};
  executionOrg = "stigmer";
  savedOrg = process.env.STIGMER_ORG;
  delete process.env.STIGMER_ORG;
});

afterEach(() => {
  if (savedOrg === undefined) delete process.env.STIGMER_ORG;
  else process.env.STIGMER_ORG = savedOrg;
});

describe("stigmer get", () => {
  it("prints the Org line on a server that holds several", async () => {
    expect(await runGet("agent", "acme/helper")).toMatch(/Org:\s+stigmer/);
  });

  it("names the organization by slug where the resource carries its id", async () => {
    stigmer = stigmerKnowingAcme();
    fetched = {
      schema: AgentSchema,
      message: create(AgentSchema, {
        metadata: { id: "agt_1", name: "Helper", slug: "helper", org: ACME_ID },
      }),
    };
    const out = await runGet("agent", "acme/helper");
    expect(out).toMatch(/Org:\s+acme\n/);
    expect(out).not.toContain(ACME_ID);
  });

  it("names a run's organization by slug where it carries the id", async () => {
    stigmer = stigmerKnowingAcme();
    executionOrg = ACME_ID;
    const out = await runGet("run", "aex_1");
    expect(out).toMatch(/Org:\s+acme\n/);
    expect(out).not.toContain(ACME_ID);
  });

  it("names an organization the caller cannot see by the id as given", async () => {
    stigmer = stigmerKnowingAcme();
    fetched = {
      schema: AgentSchema,
      message: create(AgentSchema, {
        metadata: { id: "agt_1", name: "Helper", slug: "helper", org: "org_01jbbbbbbbbbbbbbbbbbbbbbbb" },
      }),
    };
    expect(await runGet("agent", "helper")).toMatch(/Org:\s+org_01jbbbbbbbbbbbbbbbbbbbbbbb/);
  });

  it("prints the resource as the server answered for json output", async () => {
    stigmer = stigmerKnowingAcme();
    fetched = {
      schema: AgentSchema,
      message: create(AgentSchema, {
        metadata: { id: "agt_1", name: "Helper", slug: "helper", org: ACME_ID },
      }),
    };
    expect(JSON.parse(await runGet("agent", "acme/helper", "-o", "json"))).toMatchObject({
      metadata: { org: ACME_ID },
    });
  });

  it("prints none on a server that holds one", async () => {
    singleOrg = true;
    const out = await runGet("agent", "helper");
    expect(out).toMatch(/Slug:\s+helper/);
    expect(out).not.toMatch(/Org:/);
  });

  it("prints none for an organization, which belongs to none, on a server that holds several", async () => {
    fetched = {
      schema: OrganizationSchema,
      message: create(OrganizationSchema, {
        metadata: { id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa", name: "Acme", slug: "acme", org: "" },
      }),
    };
    const out = await runGet("organization", "acme");
    expect(out).toMatch(/Slug:\s+acme/);
    expect(out).not.toMatch(/Org:/);
  });

  it("prints none for a run on a server that holds one", async () => {
    singleOrg = true;
    const out = await runGet("run", "aex_1");
    expect(out).toMatch(/ID:\s+aex_1/);
    expect(out).not.toMatch(/Org:/);
  });
});

describe("stigmer auth whoami", () => {
  it("names no organization and hints nothing on a server that holds one", async () => {
    singleOrg = true;
    const result = await runWhoami();
    const keys = result.sections.flatMap((s) => s.fields.map((f) => f.key));
    expect(keys).not.toContain("Organization");
    expect(result.hints).toEqual([]);
  });

  it("hints how to set one on a server that holds several", async () => {
    const result = await runWhoami();
    expect(result.hints).toEqual([
      "No organization set. Use: stigmer config context set --org <slug>",
    ]);
  });
});
