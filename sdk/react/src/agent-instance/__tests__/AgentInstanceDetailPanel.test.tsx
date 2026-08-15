import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentInstanceSchema,
  type AgentInstance,
} from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { AgentInstanceInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { AgentInstanceDetailPanel } from "../AgentInstanceDetailPanel";

/**
 * Regression suite for the full-spec-replace wipe bug: the environment
 * editor must spread `toAgentInstanceUpdateInput` and override only the
 * environment refs, so agent_id/description (and any future spec field)
 * survive an environments-only save.
 */

const INSTANCE: AgentInstance = create(AgentInstanceSchema, {
  metadata: {
    id: "inst-1",
    name: "Prod Support Bot",
    slug: "prod-support-bot",
    org: "acme",
  },
  spec: {
    agentId: "agent-1",
    description: "Production instance.",
    environmentRefs: [
      { org: "acme", slug: "prod", kind: ApiResourceKind.environment },
    ],
  },
});

function renderPanel(update: ReturnType<typeof vi.fn>) {
  const client = {
    agentInstance: { update },
    iamPolicy: {
      checkMyPermission: vi.fn(async () => ({ isAuthorized: true })),
    },
    environment: {
      list: vi.fn(async () => ({ items: [], totalCount: 0 })),
    },
  } as never;
  return render(
    <StigmerContext.Provider value={client}>
      <AgentInstanceDetailPanel instance={INSTANCE} org="acme" onClose={() => {}} />
    </StigmerContext.Provider>,
  );
}

afterEach(cleanup);

describe("AgentInstanceDetailPanel save payload", () => {
  it("round-trips agent_id and description on an environments-only save", async () => {
    const update = vi.fn(async (_input: AgentInstanceInput) => INSTANCE);
    renderPanel(update);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0]![0];

    // The wipe-bug guard: fields the environment editor does not render.
    expect(input.agentId).toBe("agent-1");
    expect(input.description).toBe("Production instance.");
    // The form-owned field.
    expect(input.environmentRefs).toEqual([{ org: "acme", slug: "prod" }]);
    // Addressing fields.
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("prod-support-bot");
  });
});
