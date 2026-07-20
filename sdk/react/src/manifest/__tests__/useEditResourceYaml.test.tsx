import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { StigmerContext } from "../../context";
import { useEditResourceYaml } from "../useEditResourceYaml";

// The hooks run the real manifest engine (serializeManifest/parseManifest
// from @stigmer/sdk); only the network-facing manifest client is mocked.
function createMockStigmer(overrides: {
  apply?: (...args: unknown[]) => Promise<unknown>;
  getByReference?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    manifest: {
      apply:
        overrides.apply ??
        vi.fn().mockResolvedValue({
          yamlKind: "Agent",
          displayName: "Agent",
          name: "clinic-patient-assistant",
          slug: "clinic-patient-assistant",
          org: "rakeshreddi098",
          id: "agt_01",
        }),
      getByReference:
        overrides.getByReference ?? vi.fn().mockResolvedValue({ metadata: {} }),
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

const agent = create(AgentSchema, {
  metadata: {
    id: "agt_01",
    name: "clinic-patient-assistant",
    slug: "clinic-patient-assistant",
    org: "rakeshreddi098",
  },
  spec: { instructions: "Short messages." },
});

// The create-vs-update check debounces across keystrokes.
const DEBOUNCE_MS = 400;

describe("useEditResourceYaml", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds the editor from the serialized resource", () => {
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer()) },
    );

    expect(result.current.yaml).toContain("kind: Agent");
    expect(result.current.yaml).toContain("clinic-patient-assistant");
    expect(result.current.yaml).not.toContain("status:");
    expect(result.current.isDirty).toBe(false);
    expect(result.current.validation.status).toBe("valid");
  });

  it("reports schema violations inline as the user edits", () => {
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer()) },
    );

    act(() => {
      result.current.setYaml(
        result.current.yaml.replace("instructions:", "instrctions:"),
      );
    });

    expect(result.current.validation).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("Invalid Agent"),
    });
  });

  it("rejects a kind change, pointing at the Apply YAML flow instead", () => {
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer()) },
    );

    act(() => {
      // A structurally valid Environment — the schema accepts it, so the
      // kind guard (not the schema) must be what rejects it.
      result.current.setYaml(
        [
          "apiVersion: agentic.stigmer.ai/v1",
          "kind: Environment",
          "metadata:",
          "  name: clinic-patient-db",
          "  org: rakeshreddi098",
          "spec:",
          "  description: not an agent",
        ].join("\n"),
      );
    });

    expect(result.current.validation).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("kind changed from Agent to Environment"),
    });
  });

  it("resolves the target to 'update' when the reference exists", async () => {
    const getByReference = vi.fn().mockResolvedValue({ metadata: {} });
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer({ getByReference })) },
    );

    act(() => {
      result.current.setYaml(
        result.current.yaml.replace("Short messages.", "Long messages."),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    });

    expect(getByReference).toHaveBeenCalledWith(
      "Agent",
      "rakeshreddi098",
      "clinic-patient-assistant",
    );
    expect(result.current.target).toEqual({
      action: "update",
      slug: "clinic-patient-assistant",
    });
  });

  it("resolves the target to 'create' after a rename (honest preview)", async () => {
    const getByReference = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer({ getByReference })) },
    );

    act(() => {
      // Rename name AND slug — the slug is the apply routing key, so this
      // is the edit that would land as a brand-new resource.
      result.current.setYaml(
        result.current.yaml.replaceAll(
          "clinic-patient-assistant",
          "renamed-assistant",
        ),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    });

    expect(getByReference).toHaveBeenCalledWith(
      "Agent",
      "rakeshreddi098",
      "renamed-assistant",
    );
    expect(result.current.target).toEqual({
      action: "create",
      slug: "renamed-assistant",
    });
  });

  it("applies the edited document and clears the dirty flag", async () => {
    const apply = vi.fn().mockResolvedValue({
      yamlKind: "Agent",
      displayName: "Agent",
      name: "clinic-patient-assistant",
      slug: "clinic-patient-assistant",
      org: "rakeshreddi098",
      id: "agt_01",
    });
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer({ apply })) },
    );

    act(() => {
      result.current.setYaml(
        result.current.yaml.replace("Short messages.", "Long messages."),
      );
    });
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      const applied = await result.current.apply();
      expect(applied?.slug).toBe("clinic-patient-assistant");
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces apply failures as error state and re-throws", async () => {
    const apply = vi.fn().mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer({ apply })) },
    );

    act(() => {
      result.current.setYaml(
        result.current.yaml.replace("Short messages.", "Long messages."),
      );
    });

    await act(async () => {
      await expect(result.current.apply()).rejects.toThrow("permission denied");
    });

    expect(result.current.error?.message).toBe("permission denied");
  });

  it("flags redacted secret markers in the content", () => {
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer()) },
    );

    expect(result.current.hasRedactedSecrets).toBe(false);

    act(() => {
      result.current.setYaml(
        result.current.yaml.replace("Short messages.", "***REDACTED***"),
      );
    });

    expect(result.current.hasRedactedSecrets).toBe(true);
  });
});
