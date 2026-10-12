// Pins CloudTarget.keyTenancy's saves: the target's own caller saves the
// fixture Anthropic and OpenAI keys on the organization, as an admin pastes
// them, and the real Cursor key from CURSOR_API_KEY beside them when the
// shell supplies one, which is also what admits the Cursor arms
// (cursorRunsAdmitted); and the execution target keys every tenancy it
// provisions, through the same call, and none it hands out keyless. The client
// accessors are stubbed and the environment is stubbed per test; nothing
// here starts a server.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConformanceClients } from "../../harness/clients";
import { CloudTarget, CONFORMANCE_PROVIDER_KEYS, conformanceCursorKey, CURSOR_KEY_ENV } from "../cloud";
import { CloudExecutionTarget } from "../cloud-execution";

function recordingTarget(saved: unknown[]): CloudTarget {
  const target = new CloudTarget();
  vi.spyOn(target, "clients").mockReturnValue({
    providerKeyCommand: { set: async (input: unknown) => (saved.push(input), {}) },
  } as unknown as ConformanceClients);
  return target;
}

describe("CloudTarget.keyTenancy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("saves the fixture key for each provider on the organization", async () => {
    vi.stubEnv(CURSOR_KEY_ENV, "");
    const saved: unknown[] = [];
    const target = recordingTarget(saved);

    await target.keyTenancy("acme");

    expect(saved).toEqual([
      { org: "acme", provider: "anthropic", apiKey: CONFORMANCE_PROVIDER_KEYS.anthropic },
      { org: "acme", provider: "openai", apiKey: CONFORMANCE_PROVIDER_KEYS.openai },
    ]);
    expect(target.capabilities.cursorRunsAdmitted, "no Cursor key, no Cursor run on the cloud").toBe(false);
  });

  it("saves the shell's Cursor key as the organization's Cursor key, with no base URL, and admits Cursor runs", async () => {
    vi.stubEnv(CURSOR_KEY_ENV, " crsr_conformance_key ");
    const saved: unknown[] = [];
    const target = recordingTarget(saved);

    await target.keyTenancy("acme");

    expect(saved).toEqual([
      { org: "acme", provider: "anthropic", apiKey: CONFORMANCE_PROVIDER_KEYS.anthropic },
      { org: "acme", provider: "openai", apiKey: CONFORMANCE_PROVIDER_KEYS.openai },
      { org: "acme", provider: "cursor", apiKey: "crsr_conformance_key" },
    ]);
    expect(target.capabilities.cursorRunsAdmitted).toBe(true);
    expect(new CloudExecutionTarget().capabilities.cursorRunsAdmitted, "the execution target delegates the flag").toBe(true);
  });
});

describe("conformanceCursorKey", () => {
  it("reads CURSOR_API_KEY, trimmed, and treats blank as absent", () => {
    expect(conformanceCursorKey({ [CURSOR_KEY_ENV]: "crsr_x" })).toBe("crsr_x");
    expect(conformanceCursorKey({ [CURSOR_KEY_ENV]: "   " })).toBeUndefined();
    expect(conformanceCursorKey({})).toBeUndefined();
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
