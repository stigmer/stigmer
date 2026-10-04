// Command-level contract for an agent's versions through `stigmer get`:
// `--version-history` prints the history table from the agent's listVersions,
// and `--version <hashOrTag>` prints the agent as that version stored it,
// read through the reference ladder, in the format asked for. The backend and
// the single-organization probe are stubbed at their module seams; the
// command, the resource layer, the renderers and the program are real.

import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { Config } from "../../config/index.js";
import { buildProgram } from "../../program.js";

vi.mock("../../client/single-org.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/single-org.js")>();
  return {
    ...actual,
    holdsOneOrganization: async () => true,
    omitsOrganization: async () => true,
  };
});

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const listVersions = vi.fn();
const getByReference = vi.fn();

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer: { agent: { listVersions, getByReference } } }),
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

let savedOrg: string | undefined;

beforeEach(() => {
  listVersions.mockReset();
  getByReference.mockReset();
  savedOrg = process.env.STIGMER_ORG;
  delete process.env.STIGMER_ORG;
});

afterEach(() => {
  if (savedOrg === undefined) delete process.env.STIGMER_ORG;
  else process.env.STIGMER_ORG = savedOrg;
});

describe("stigmer get agent --version-history / --version", () => {
  it("prints the agent's version history", async () => {
    listVersions.mockResolvedValue({
      versions: [create(AgentVersionEntrySchema, { versionHash: "c".repeat(64), isCurrent: true, tag: "stable" })],
      totalCount: 1,
    });

    const out = await runGet("agent", "acme/reviewer", "--version-history");

    expect(listVersions).toHaveBeenCalledWith(expect.objectContaining({ org: "acme", slug: "reviewer" }));
    expect(out).toContain("Version History (1 total)");
    expect(out).toMatch(/cccccccccccc +stable/);
  });

  it("prints the agent as a tagged version stored it, in the format asked for", async () => {
    getByReference.mockResolvedValue(
      create(AgentSchema, {
        metadata: { id: "agt_1", name: "Reviewer", slug: "reviewer", org: "acme" },
        spec: { instructions: "The stable instructions." },
      }),
    );

    const out = await runGet("agent", "acme/reviewer", "--version", "stable", "-o", "json");

    expect(getByReference).toHaveBeenCalledWith({ org: "acme", slug: "reviewer", version: "stable" });
    expect(JSON.parse(out)).toMatchObject({ spec: { instructions: "The stable instructions." } });
    expect(listVersions).not.toHaveBeenCalled();
  });
});
