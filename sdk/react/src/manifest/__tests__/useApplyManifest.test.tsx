import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { OrgProvider } from "../../organization/OrgProvider";
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

const CHANNEL_AND_APP_YAML = `
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
apiVersion: iam.stigmer.ai/v1
kind: OAuthApp
metadata:
  name: clinic-calendar
  org: rakeshreddi098
spec:
  provider: google
  client_id: clinic-client
  client_secret: "***REDACTED***"
  authorization_url: https://accounts.example.com/authorize
  token_url: https://accounts.example.com/token
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

  it("orders multi-document manifests by dependency (OAuthApp before AgentChannel)", async () => {
    const { result } = renderHook(() => useApplyManifest("rakeshreddi098"), {
      wrapper: wrapper(createMockStigmer()),
    });

    act(() => {
      result.current.setContent(CHANNEL_AND_APP_YAML);
    });
    await act(settleValidation);

    expect(
      result.current.entries!.map((e) => e.document.handler.yamlKind),
    ).toEqual(["OAuthApp", "AgentChannel"]);
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
      result.current.setContent(CHANNEL_AND_APP_YAML);
    });
    await act(settleValidation);

    let applied: readonly { status: string }[] = [];
    await act(async () => {
      applied = await result.current.applyAll();
    });

    expect(applied.map((e) => e.status)).toEqual(["applied", "applied"]);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(result.current.entries!.map((e) => e.status)).toEqual([
      "applied",
      "applied",
    ]);
  });

  it("stops at the first failure and marks the rest skipped", async () => {
    const apply = vi
      .fn()
      .mockRejectedValueOnce(new Error("oauth app rejected"))
      .mockResolvedValue({});
    const { result } = renderHook(() => useApplyManifest("rakeshreddi098"), {
      wrapper: wrapper(createMockStigmer({ apply })),
    });

    act(() => {
      result.current.setContent(CHANNEL_AND_APP_YAML);
    });
    await act(settleValidation);

    let applied: readonly { status: string }[] = [];
    await act(async () => {
      applied = await result.current.applyAll();
    });

    expect(applied.map((e) => e.status)).toEqual(["failed", "skipped"]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.entries!.map((e) => e.status)).toEqual([
      "failed",
      "skipped",
    ]);
    expect(result.current.entries![0].errorMessage).toBe("oauth app rejected");
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

describe("useApplyManifest's org-mismatch warning, inside the person's organizations", () => {
  const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function withOrganizations() {
    const client = {
      ...(createMockStigmer() as object),
      organization: {
        findMyOrganizations: vi.fn().mockResolvedValue({
          entries: [{ metadata: { id: ACME_ID, slug: "acme", name: "Acme" } }],
        }),
      },
    };
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <StigmerContext.Provider value={client as never}>
          <FetchCacheContext.Provider value={null}>
            <OrgProvider>{children}</OrgProvider>
          </FetchCacheContext.Provider>
        </StigmerContext.Provider>
      );
    };
  }

  async function warningFor(documentOrg: string): Promise<string | undefined> {
    const { result } = renderHook(() => useApplyManifest(ACME_ID), { wrapper: withOrganizations() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      result.current.setContent(AGENT_YAML.replace("  name: clinic-patient-assistant\n", `  name: clinic-patient-assistant\n  org: ${documentOrg}\n`));
    });
    await act(settleValidation);
    expect(result.current.entries).toHaveLength(1);
    return result.current.entries![0].document.warning;
  }

  it("stays quiet for a document naming the target by its slug while the target is its id", async () => {
    expect(await warningFor("acme")).toBeUndefined();
  });

  it("warns for a document naming another organization by slug, and names the target by its slug", async () => {
    const warning = await warningFor("globex");
    expect(warning).toContain('"globex"');
    expect(warning).toContain('target org "acme"');
  });
});
