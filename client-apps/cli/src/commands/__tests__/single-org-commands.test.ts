// Command-level contract for the commands that print an organization: on a
// server that holds one (client/single-org.ts says yes), `get` and
// `get <execution>` print no Org line and `auth whoami` names none and hints
// nothing; on a server that holds several they print it as before. The
// backend, the resource fetch and the account read are stubbed at their module
// seams; the commands, the renderers and the program are real.

import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
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

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer: {} }),
}));

vi.mock("../../resources/get.js", () => ({
  fetchResource: async () => ({
    schema: AgentSchema,
    message: create(AgentSchema, {
      metadata: { id: "agt_1", name: "Helper", slug: "helper", org: "stigmer" },
    }),
  }),
}));

vi.mock("../../resources/execution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/execution.js")>();
  return {
    ...actual,
    getExecution: async () => ({
      schema: AgentExecutionSchema,
      message: create(AgentExecutionSchema, {
        metadata: { id: "aex_1", name: "run", org: "stigmer" },
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

  it("prints none on a server that holds one", async () => {
    singleOrg = true;
    const out = await runGet("agent", "helper");
    expect(out).toMatch(/Slug:\s+helper/);
    expect(out).not.toMatch(/Org:/);
  });

  it("prints none for an execution on a server that holds one", async () => {
    singleOrg = true;
    const out = await runGet("execution", "aex_1");
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
