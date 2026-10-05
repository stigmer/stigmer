// Pins the memory execution suites' organization helper (support/memories.ts):
// it creates the organization with memory on, funds it through the hook a
// credit-gating target passes before any memory is written (a run in an
// unfunded organization is refused before it reaches the behaviour the
// suites pin), and works unfunded where no hook is given. The clients are
// stubbed; nothing here starts a server.
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import { provisionOrgWithConfirmedFacts } from "../memories";

function recordingClients(steps: string[]): ConformanceClients {
  let memories = 0;
  return {
    organizationCommand: {
      create: async () => {
        steps.push("create org");
        return {
          metadata: { id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa", slug: "retrorg" },
        };
      },
      delete: async () => ({}),
    },
    memoryCommand: {
      create: async () => {
        memories += 1;
        steps.push("create memory");
        return { metadata: { id: `mem_${memories}` } };
      },
      confirm: async () => ({}),
      delete: async () => ({}),
    },
  } as unknown as ConformanceClients;
}

describe("provisionOrgWithConfirmedFacts", () => {
  it("funds the organization it creates by slug before any memory is written", async () => {
    const steps: string[] = [];
    const funded: string[] = [];
    const result = await provisionOrgWithConfirmedFacts(
      recordingClients(steps),
      new FixtureTracker(),
      2,
      async (org) => {
        funded.push(org);
        steps.push("fund");
      },
    );
    expect(funded).toEqual(["retrorg"]);
    expect(steps).toEqual([
      "create org",
      "fund",
      "create memory",
      "create memory",
    ]);
    expect(result).toEqual({ org: "retrorg", memoryIds: ["mem_1", "mem_2"] });
  });

  it("leaves the organization unfunded where the target passes no hook", async () => {
    const steps: string[] = [];
    await provisionOrgWithConfirmedFacts(
      recordingClients(steps),
      new FixtureTracker(),
      1,
    );
    expect(steps).toEqual(["create org", "create memory"]);
  });
});
