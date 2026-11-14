// The desktop's wiring of the organization gate: with no organization yet it
// shows the onboarding form, and a newly created organization becomes the
// active one by its minted id (the gate refreshes targeting that id, not the
// slug the person typed); a failed organization load shows the reason and a
// "Try again" that re-runs the gate's retry. The gate derivation and the form are the SDK's,
// pinned by its own suite; here they are stubbed so each state holds still.

import { create } from "@bufbuild/protobuf";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgGate } from "../OrgGate";

const gate = vi.hoisted(() => ({
  status: "no-orgs" as string,
  message: "",
  retry: vi.fn<() => void>(),
  refresh: vi.fn<(target?: string) => void>(),
  onCreated: null as ((org: Organization) => void) | null,
}));

// The help line reads the server's answer; here it stands in, so the test
// holds where the gate places it.
vi.mock("@stigmer/react-sdk/console", () => ({
  HelpLink: () => <p>Stuck? Talk to us</p>,
}));

vi.mock("@stigmer/react-sdk", async () => {
  const kit = await vi.importActual<typeof import("@stigmer/react-sdk")>("@stigmer/react-sdk");
  return {
    Button: kit.Button,
    useOrgGate: () => ({
      state: { status: gate.status, message: gate.message },
      retry: gate.retry,
      refresh: gate.refresh,
    }),
    CreateOrganizationForm: ({ onCreated }: { onCreated: (org: Organization) => void }) => {
      gate.onCreated = onCreated;
      return <p>create organization form</p>;
    },
  };
});

vi.mock("../../shell/GateHeader", () => ({ GateHeader: () => null }));

function renderGate(): void {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <OrgGate>
        <p>the app</p>
      </OrgGate>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  gate.status = "no-orgs";
  gate.message = "";
  gate.retry.mockClear();
  gate.refresh.mockClear();
  gate.onCreated = null;
});

describe("desktop OrgGate", () => {
  it("renders the app once the person has an organization", () => {
    gate.status = "ready";
    renderGate();

    expect(screen.getByText("the app")).toBeTruthy();
  });

  it("onboards a person with no organization and activates the created one by id", () => {
    renderGate();

    expect(screen.getByText("Welcome to Stigmer")).toBeTruthy();
    expect(screen.getByText(/ask one of its admins to invite you/)).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();

    const created = create(OrganizationSchema, {
      metadata: { id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa", slug: "acme" },
    });
    act(() => gate.onCreated?.(created));

    expect(gate.refresh).toHaveBeenCalledWith("org_01jaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("shows why the organizations failed to load and retries on Try again", () => {
    gate.status = "error";
    gate.message = "The server could not be reached.";
    renderGate();

    expect(screen.getByText("Failed to load organizations")).toBeTruthy();
    expect(screen.getByText("The server could not be reached.")).toBeTruthy();
    // CON-13: under Try again, the server's help line.
    expect(screen.getByText("Stuck? Talk to us")).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(gate.retry).toHaveBeenCalledTimes(1);
  });
});
