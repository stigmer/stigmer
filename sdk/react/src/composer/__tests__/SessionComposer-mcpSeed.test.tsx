/**
 * A composer opened with `mcpServerUsages` (a session being continued, or a
 * page restoring its draft) re-attaches each server through the setup flow,
 * and reports it back as a usage that attaches the whole server: no tool
 * subset is restored, because which tools a session may call is the agent's
 * tool lists' decision.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { McpServerUsageInput, Stigmer } from "@stigmer/sdk";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { SessionComposer } from "../SessionComposer";

afterEach(cleanup);

const ZENDESK = { org: "acme", slug: "zendesk", kind: ApiResourceKind.mcp_server };

function clientWith(getByReference: () => Promise<unknown>): Stigmer {
  return {
    agentRun: { uploadAttachment: vi.fn() },
    environment: { getPersonal: vi.fn().mockResolvedValue(null) },
    mcpServer: { getByReference: vi.fn(getByReference) },
    baseUrl: "/",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: { baseUrl: "/", getAccessToken: vi.fn().mockResolvedValue("") },
  } as unknown as Stigmer;
}

function renderComposer(client: Stigmer, usages: McpServerUsageInput[]) {
  const onUsages = vi.fn<(usages: McpServerUsageInput[]) => void>();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <ModelRegistryContext.Provider
          value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}
        >
          {children}
        </ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  }
  render(
    <SessionComposer
      onSubmit={vi.fn()}
      org="acme"
      mcpServerUsages={usages}
      onMcpServerUsagesChange={onUsages}
    />,
    { wrapper: Wrapper },
  );
  return onUsages;
}

describe("SessionComposer seeds MCP servers from mcpServerUsages", () => {
  it("re-attaches a seeded server and reports it as a whole-server usage", async () => {
    const client = clientWith(async () =>
      samples.mcpServer({ name: "Zendesk", org: "acme", slug: "zendesk" }),
    );

    const onUsages = renderComposer(client, [{ mcpServerRef: ZENDESK }]);

    await waitFor(() =>
      expect(onUsages).toHaveBeenLastCalledWith([{ mcpServerRef: ZENDESK }]),
    );
    expect(client.mcpServer.getByReference).toHaveBeenCalledWith(ZENDESK);
  });
});
