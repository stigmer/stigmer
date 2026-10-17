import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ManifestClient } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { useEditResourceYaml } from "../useEditResourceYaml";

// The hooks run the real manifest engine (serializeManifest/parseManifest
// from @stigmer/client) and the real target resolution
// (ManifestClient.resolveTarget) over an in-memory agent query service:
// `getByReference` answers each read, or null for not-found. Only apply is
// mocked.
function createMockStigmer(overrides: {
  apply?: (...args: unknown[]) => Promise<unknown>;
  getByReference?: (ref: ApiResourceReference) => Promise<unknown>;
} = {}) {
  const read = overrides.getByReference ?? (() => Promise.resolve(agent));
  const engine = new ManifestClient(
    createRouterTransport(({ service }) => {
      service(AgentQueryController, {
        getByReference: async (ref) => {
          const found = await read(ref);
          if (found === null) throw new ConnectError("not found", Code.NotFound);
          return found as typeof agent;
        },
      });
    }),
  );
  return {
    manifest: {
      resolveTarget: engine.resolveTarget.bind(engine),
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

// The target check debounces across keystrokes.
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
      // A structurally valid Routine — the schema accepts it, so the
      // kind guard (not the schema) must be what rejects it.
      result.current.setYaml(
        [
          "apiVersion: agentic.stigmer.ai/v1",
          "kind: Routine",
          "metadata:",
          "  name: nightly-report",
          "  org: rakeshreddi098",
          "spec:",
          "  cron: \"0 2 * * *\"",
          "  timeZone: UTC",
          "  agent:",
          "    agentRef:",
          "      slug: reporter",
        ].join("\n"),
      );
    });

    expect(result.current.validation).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("kind changed from Agent to Routine"),
    });
  });

  it("resolves the target to 'update' when the id finds the resource under its slug", async () => {
    const getByReference = vi.fn((_ref: ApiResourceReference) => Promise.resolve(agent));
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

    expect(getByReference.mock.calls[0][0]).toMatchObject({ id: "agt_01" });
    expect(result.current.target).toEqual({
      action: "update",
      slug: "clinic-patient-assistant",
      slugKept: false,
    });
  });

  it("resolves the target to 'rename' when the slug is edited and the id kept", async () => {
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer()) },
    );

    act(() => {
      // The seeded document keeps metadata.id, so the apply finds the agent
      // by it and renames it to the edited slug.
      result.current.setYaml(
        result.current.yaml.replace(
          "slug: clinic-patient-assistant",
          "slug: renamed-assistant",
        ),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    });

    expect(result.current.target).toEqual({
      action: "rename",
      from: "clinic-patient-assistant",
      slug: "renamed-assistant",
    });
  });

  it("resolves the target to 'create' when the id is removed and the slug is new", async () => {
    const getByReference = vi.fn((_ref: ApiResourceReference) => Promise.resolve(null));
    const { result } = renderHook(
      () => useEditResourceYaml({ resource: agent }),
      { wrapper: wrapper(createMockStigmer({ getByReference })) },
    );

    act(() => {
      result.current.setYaml(
        result.current.yaml
          .replace("  id: agt_01\n", "")
          .replaceAll("clinic-patient-assistant", "second-assistant"),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    });

    expect(getByReference.mock.calls.map(([ref]) => ref.slug)).toEqual(["second-assistant"]);
    expect(result.current.target).toEqual({
      action: "create",
      slug: "second-assistant",
    });
  });

  it("degrades the target to 'unknown' when the lookup fails", async () => {
    const getByReference = vi.fn((_ref: ApiResourceReference) =>
      Promise.reject(new ConnectError("offline", Code.Unavailable)),
    );
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

    expect(result.current.target).toEqual({
      action: "unknown",
      slug: "clinic-patient-assistant",
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
