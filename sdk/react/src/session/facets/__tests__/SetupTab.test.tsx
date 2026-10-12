import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SetupTab, type SetupTabProps } from "../SetupTab";

// ---------------------------------------------------------------------------
// The Config facet's access section: a host-injected slot with no chrome of
// its own — the injected control (e.g. the Console's ManageAccessButton) owns
// its visibility, so the facet must render nothing extra when the slot is
// absent or the control gates itself away.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const BASE_PROPS: SetupTabProps = {
  agentRef: null,
  pluginRefs: [],
  skillRefs: [],
  harness: "native",
  executionTarget: undefined,
  modelId: undefined,
};

describe("SetupTab — access slot", () => {
  it("renders the injected access control", () => {
    render(
      <SetupTab
        {...BASE_PROPS}
        accessSlot={<button type="button">Manage access</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Manage access" }),
    ).toBeDefined();
  });

  it("renders no access section when the slot is absent", () => {
    const { container } = render(<SetupTab {...BASE_PROPS} />);
    expect(screen.queryByRole("button", { name: "Manage access" })).toBeNull();
    // Only the four always-on sections (run config, agent, plugins, skills).
    expect(container.querySelectorAll("section")).toHaveLength(4);
  });
});

// A target deleted since it was attached comes back with no slug: its row
// says "deleted <kind>" and keeps its remove action.
describe("SetupTab — deleted references", () => {
  it("names a deleted agent, plugin and skill as deleted, each still removable", () => {
    render(
      <SetupTab
        {...BASE_PROPS}
        agentRef={{ org: "org_acme", slug: "" }}
        pluginRefs={[{ org: "org_acme", slug: "" }, { org: "org_acme", slug: "linear" }]}
        skillRefs={[{ org: "org_acme", slug: "" }]}
        mutations={{ onRemoveAgent: () => {}, onRemovePlugin: () => {}, onRemoveSkill: () => {} }}
      />,
    );
    expect(screen.getByText("deleted agent")).toBeDefined();
    expect(screen.getByText("deleted plugin")).toBeDefined();
    expect(screen.getByText("linear")).toBeDefined();
    expect(screen.getByText("deleted skill")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove plugin deleted plugin" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove skill deleted skill" })).toBeDefined();
  });
});
