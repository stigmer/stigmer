// Pins CloudTarget.keyTenancy's saves: the target's own caller saves the
// fixture Anthropic and OpenAI keys on the organization, as an admin pastes
// them; and the execution target keys every tenancy it provisions, through
// the same call, and none it hands out keyless. The client accessors are
// stubbed; nothing here starts a server.
import { describe, expect, it, vi } from "vitest";

import type { ConformanceClients } from "../../harness/clients";
import { CloudTarget, CONFORMANCE_PROVIDER_KEYS } from "../cloud";
import { CloudExecutionTarget } from "../cloud-execution";

function recordingTarget(saved: unknown[]): CloudTarget {
  const target = new CloudTarget();
  vi.spyOn(target, "clients").mockReturnValue({
    providerKeyCommand: { set: async (input: unknown) => (saved.push(input), {}) },
  } as unknown as ConformanceClients);
  return target;
}

describe("CloudTarget.keyTenancy", () => {
  it("saves the fixture key for each provider on the organization", async () => {
    const saved: unknown[] = [];
    const target = recordingTarget(saved);

    await target.keyTenancy("acme");

    expect(saved).toEqual([
      { org: "acme", provider: "anthropic", apiKey: CONFORMANCE_PROVIDER_KEYS.anthropic },
      { org: "acme", provider: "openai", apiKey: CONFORMANCE_PROVIDER_KEYS.openai },
    ]);
  });
});

describe("CloudExecutionTarget tenancies", () => {
  it("keys every tenancy it provisions", async () => {
    const target = new CloudExecutionTarget();
    const cloud = (target as unknown as { cloud: CloudTarget }).cloud;
    vi.spyOn(cloud, "provisionTenancy").mockResolvedValue({ org: "org_1" });
    const keyed = vi.spyOn(cloud, "keyTenancy").mockResolvedValue();

    expect(await target.provisionTenancy()).toEqual({ org: "org_1" });
    await target.keyTenancy("org_2");

    expect(keyed.mock.calls).toEqual([["org_1"], ["org_2"]]);
  });

  it("hands the run-admission suite a keyless tenancy, and keys nothing", async () => {
    const target = new CloudExecutionTarget();
    const cloud = (target as unknown as { cloud: CloudTarget }).cloud;
    vi.spyOn(cloud, "provisionKeylessTenancy").mockResolvedValue({ org: "org_3" });
    const keyed = vi.spyOn(cloud, "keyTenancy").mockResolvedValue();

    expect(await target.provisionKeylessTenancy()).toEqual({ org: "org_3" });

    expect(keyed).not.toHaveBeenCalled();
  });
});
