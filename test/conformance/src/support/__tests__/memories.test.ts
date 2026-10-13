// Pins the memory execution suites' helpers (support/memories.ts): the two
// memory switches name that one field alone, and the organization helper
// creates the organization with memory on, prepares it through the hook a
// target passes before any memory is written (on the hosted edition a run in
// an organization with no provider key is refused before it reaches the
// behaviour the suites pin), and works unprepared where no hook is given. The clients are
// stubbed; nothing here starts a server.
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import { enableMyMemory, enableOrganizationMemory, provisionOrgWithConfirmedFacts } from "../memories";

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
  it("prepares the organization it creates by slug before any memory is written", async () => {
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

  it("leaves the organization unprepared where the target passes no hook", async () => {
    const steps: string[] = [];
    await provisionOrgWithConfirmedFacts(
      recordingClients(steps),
      new FixtureTracker(),
      1,
    );
    expect(steps).toEqual(["create org", "create memory"]);
  });
});

describe("the memory switches", () => {
  it("turn memory on for an organization and for the caller, naming the switch alone on each one's id", async () => {
    const sent: unknown[] = [];
    const clients = {
      organizationQuery: { get: async () => ({ metadata: { id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa" } }) },
      organizationCommand: {
        update: async (request: unknown) => {
          sent.push(request);
          return {};
        },
      },
      identityAccountQuery: { whoAmI: async () => ({ metadata: { id: "ida_ana" } }) },
      identityAccountCommand: {
        update: async (request: unknown) => {
          sent.push(request);
          return { metadata: { id: "ida_ana" } };
        },
      },
    } as unknown as ConformanceClients;

    await enableOrganizationMemory(clients, "retrorg");
    const me = await enableMyMemory(clients);

    expect(me.metadata?.id).toBe("ida_ana");
    expect(sent).toEqual([
      {
        resource: { metadata: { id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa" }, spec: { preferences: { memoryEnabled: true } } },
        updateMask: { paths: ["spec.preferences.memory_enabled"] },
      },
      {
        resource: { metadata: { id: "ida_ana" }, spec: { preferences: { memoryEnabled: true } } },
        updateMask: { paths: ["spec.preferences.memory_enabled"] },
      },
    ]);
  });
});
