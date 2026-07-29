// Tests for the Datastores section on AgentDetailView (stigmer/stigmer#319):
// read-mode rendering and navigation, the inline-edit save payload (which
// must round-trip the full spec through agentToInput), and the DD-006
// surfacing of the backend's datastore exposure guard refusal.

import { describe, it, expect, vi, beforeAll, afterEach, beforeEach, type Mock } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { AgentInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { AgentDetailView } from "../AgentDetailView";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => cleanup());
beforeEach(() => vi.restoreAllMocks());

function makeAgent() {
  return create(AgentSchema, {
    metadata: {
      id: "agt_1",
      name: "Clinic Assistant",
      slug: "clinic-assistant",
      org: "acme",
    },
    spec: {
      instructions: "You are a careful clinic assistant.",
      datastoreUsages: [
        {
          datastoreRef: {
            org: "acme",
            slug: "clinic-records",
            kind: ApiResourceKind.datastore,
          },
        },
        {
          datastoreRef: {
            org: "partner",
            slug: "shared-records",
            kind: ApiResourceKind.datastore,
          },
        },
      ],
    },
  });
}

function renderView(overrides: {
  update?: Mock;
  onDatastoreClick?: (ref: { org: string; slug: string }) => void;
  editable?: boolean;
}) {
  const agent = makeAgent();
  const update = overrides.update ?? vi.fn().mockResolvedValue(agent);
  const stigmer = {
    agent: {
      getByReference: vi.fn().mockResolvedValue(agent),
      update,
    },
    iamPolicy: {
      checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: false }),
    },
  };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={stigmer as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }

  const result = render(
    <AgentDetailView
      org="acme"
      slug="clinic-assistant"
      editable={overrides.editable}
      onDatastoreClick={overrides.onDatastoreClick}
    />,
    { wrapper: Wrapper },
  );
  return { ...result, update };
}

describe("AgentDetailView — Datastores section (read mode)", () => {
  it("renders attached datastores with org-qualified labels for cross-org refs", async () => {
    renderView({});

    expect(await screen.findByText("Datastores")).toBeTruthy();
    expect(screen.getByText("clinic-records")).toBeTruthy();
    expect(screen.getByText("partner/shared-records")).toBeTruthy();
  });

  it("fires onDatastoreClick with the resolved org and slug", async () => {
    const user = userEvent.setup();
    const onDatastoreClick = vi.fn();
    renderView({ onDatastoreClick });

    await user.click(await screen.findByText("clinic-records"));
    expect(onDatastoreClick).toHaveBeenCalledWith({
      org: "acme",
      slug: "clinic-records",
    });

    await user.click(screen.getByText("partner/shared-records"));
    expect(onDatastoreClick).toHaveBeenCalledWith({
      org: "partner",
      slug: "shared-records",
    });
  });
});

describe("AgentDetailView — Datastores section (inline edit)", () => {
  it("saves the full reconstructed input with correctly-shaped datastoreUsages", async () => {
    const user = userEvent.setup();
    const { update } = renderView({ editable: true });

    await user.click(await screen.findByLabelText("Edit datastores"));
    await user.click(screen.getByLabelText("Remove partner/shared-records"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = update.mock.calls[0][0] as AgentInput;

    expect(input.datastoreUsages).toEqual([
      { datastoreRef: { org: "acme", slug: "clinic-records" } },
    ]);
    // The rest of the spec must ride along — a section save is a full
    // spec replacement reconstructed via agentToInput().
    expect(input.instructions).toBe("You are a careful clinic assistant.");
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("clinic-assistant");
  });

  it("surfaces the backend's exposure-guard refusal in the section editor (DD-006)", async () => {
    const user = userEvent.setup();
    const guardMessage =
      'agent "clinic-assistant" cannot be public while it uses datastores ' +
      "(clinic-records): multi-tenant datastore sharing is not supported — " +
      "keep the agent private or org-visible, or remove its datastore_usages";
    renderView({
      editable: true,
      update: vi.fn().mockRejectedValue(new Error(guardMessage)),
    });

    await user.click(await screen.findByLabelText("Edit datastores"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(guardMessage);
  });
});
