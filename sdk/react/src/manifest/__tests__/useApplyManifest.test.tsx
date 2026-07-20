import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { useApplyManifest } from "../useApplyManifest";

// The hook runs the real manifest engine (parseManifest from @stigmer/sdk);
// only the network-facing manifest client is mocked.
function createMockStigmer(overrides: {
  apply?: (...args: unknown[]) => Promise<unknown>;
  getByReference?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    manifest: {
      apply:
        overrides.apply ??
        vi.fn().mockImplementation((doc: { handler: { yamlKind: string; displayName: string }; name: string; slug: string; org: string }) =>
          Promise.resolve({
            yamlKind: doc.handler.yamlKind,
            displayName: doc.handler.displayName,
            name: doc.name,
            slug: doc.slug,
            org: doc.org,
            id: "res_01",
          }),
        ),
      getByReference: overrides.getByReference ?? vi.fn().mockResolvedValue(null),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

const AGENT_YAML = `
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: clinic-patient-assistant
spec:
  instructions: Short messages.
`;

const CHANNEL_AND_ENV_YAML = `
apiVersion: agentic.stigmer.ai/v1
kind: AgentChannel
metadata:
  name: clinic-patient-whatsapp
  org: rakeshreddi098
spec:
  agent_ref:
    kind: agent
    org: rakeshreddi098
    slug: clinic-patient-assistant
  enabled: true
---
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: clinic-patient-db
  org: rakeshreddi098
spec:
  data:
    POSTGRES_CONNECTION_URL:
      value: "***REDACTED***"
      is_secret: true
`;

// Validation (parse + existence resolution) debounces across keystrokes.
const DEBOUNCE_MS = 500;

async function settleValidation() {
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
}

describe("useApplyManifest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("validates pasted content and injects the target org", async () => {
    const { result } = renderHook(() => useApplyManifest("acme"), {
      wrapper: wrapper(createMockStigmer()),
    });

    act(() => {
      result.current.setContent(AGENT_YAML);
    });
    expect(result.current.isValidating).toBe(true);

    await act(settleValidation);

    expect(result.current.validationError).toBeNull();
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries![0]).toMatchObject({
      action: "create",
      status: "pending",
    });
    expect(result.current.entries![0].document.org).toBe("acme");
  });

  it("surfaces parse errors with the schema complaint", async () => {
    const { result } = renderHook(() => useApplyManifest("acme"), {
      wrapper: wrapper(createMockStigmer()),
    });

    act(() => {
      result.current.setContent("kind: Agent\nmetadata:\n  name: x\nspec:\n  bogus_field: 1\n");
    });
    await act(settleValidation);

    expect(result.current.entries).toBeNull();
    expect(result.current.validationError).toContain("Invalid Agent");
  });

  it("orders multi-document manifests by dependency (Environment before AgentChannel)", async () => {
    const { result } = renderHook(() => useApplyManifest("rakeshreddi098"), {
      wrapper: wrapper(createMockStigmer()),
    });

    act(() => {
      result.current.setContent(CHANNEL_AND_ENV_YAML);
    });
    await act(settleValidation);

    expect(
      result.current.entries!.map((e) => e.document.handler.yamlKind),
    ).toEqual(["Environment", "AgentChannel"]);
    expect(result.current.hasRedactedSecrets).toBe(true);
  });

  it("marks existing resources as updates in the preview", async () => {
    const getByReference = vi.fn().mockResolvedValue({ metadata: {} });
    const { result } = renderHook(() => useApplyManifest("acme"), {
      wrapper: wrapper(createMockStigmer({ getByReference })),
    });

    act(() => {
      result.current.setContent(AGENT_YAML);
    });
    await act(settleValidation);

    expect(result.current.entries![0].action).toBe("update");
  });

  it("applies all documents sequentially and reports success", async () => {
    const apply = vi.fn().mockImplementation((doc: { handler: { yamlKind: string; displayName: string }; name: string; slug: string; org: string }) =>
      Promise.resolve({
        yamlKind: doc.handler.yamlKind,
        displayName: doc.handler.displayName,
        name: doc.name,
        slug: doc.slug,
        org: doc.org,
        id: "res_01",
      }),
    );
    const { result } = renderHook(() => useApplyManifest("rakeshreddi098"), {
      wrapper: wrapper(createMockStigmer({ apply })),
    });

    act(() => {
      result.current.setContent(CHANNEL_AND_ENV_YAML);
    });
    await act(settleValidation);

    let allApplied = false;
    await act(async () => {
      allApplied = await result.current.applyAll();
    });

    expect(allApplied).toBe(true);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(result.current.entries!.map((e) => e.status)).toEqual([
      "applied",
      "applied",
    ]);
  });

  it("stops at the first failure and marks the rest skipped", async () => {
    const apply = vi
      .fn()
      .mockRejectedValueOnce(new Error("environment rejected"))
      .mockResolvedValue({});
    const { result } = renderHook(() => useApplyManifest("rakeshreddi098"), {
      wrapper: wrapper(createMockStigmer({ apply })),
    });

    act(() => {
      result.current.setContent(CHANNEL_AND_ENV_YAML);
    });
    await act(settleValidation);

    let allApplied = true;
    await act(async () => {
      allApplied = await result.current.applyAll();
    });

    expect(allApplied).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.entries!.map((e) => e.status)).toEqual([
      "failed",
      "skipped",
    ]);
    expect(result.current.entries![0].errorMessage).toBe("environment rejected");
  });

  it("reset clears content, preview, and errors", async () => {
    const { result } = renderHook(() => useApplyManifest("acme"), {
      wrapper: wrapper(createMockStigmer()),
    });

    act(() => {
      result.current.setContent(AGENT_YAML);
    });
    await act(settleValidation);
    expect(result.current.entries).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.content).toBe("");
    expect(result.current.entries).toBeNull();
    expect(result.current.validationError).toBeNull();
  });
});
