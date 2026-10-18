import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { EnvironmentSource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { SetupTab, type SetupTabProps } from "../SetupTab";
import { conversationEnvironment } from "../../conversation-environment";

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

// The Environment row: the conversation's own record when the server
// stamped one, else why none applies (conversationEnvironment), in the
// words every surface uses.
describe("SetupTab — the conversation's Environment", () => {
  const status = (slug: string, environmentSource: EnvironmentSource) => ({
    environment: create(ApiResourceReferenceSchema, { org: "org_acme", slug, id: "env_1" }),
    environmentSource,
  });

  it.each([
    [EnvironmentSource.SESSION, "data-science · chosen for this conversation"],
    [EnvironmentSource.ROUTINE, "data-science · set by the routine"],
    [EnvironmentSource.AGENT, "data-science · the agent's default"],
    [EnvironmentSource.ORGANIZATION, "data-science · the organization's default"],
  ])("names the Environment and whose choice it was (source %s)", (source, line) => {
    render(<SetupTab {...BASE_PROPS} environment={conversationEnvironment(status("data-science", source), undefined)} />);
    expect(screen.getByText("Environment")).toBeDefined();
    expect(screen.getByText(line)).toBeDefined();
  });

  it("says none applied, the server's standard sandbox", () => {
    render(
      <SetupTab
        {...BASE_PROPS}
        environment={conversationEnvironment({ environmentSource: EnvironmentSource.UNSPECIFIED }, undefined)}
      />,
    );
    expect(screen.getByText("No environment: the server's standard sandbox")).toBeDefined();
  });

  it("says why none applies on the person's own machine, and on a server that starts no sandbox", () => {
    const unset = { environmentSource: EnvironmentSource.UNSPECIFIED };
    const { rerender } = render(
      <SetupTab {...BASE_PROPS} environment={conversationEnvironment(unset, "own-machine")} />,
    );
    expect(screen.getByText("Environments don't apply here: this conversation runs on your own machine")).toBeDefined();
    rerender(<SetupTab {...BASE_PROPS} environment={conversationEnvironment(unset, "not-on-server")} />);
    expect(
      screen.getByText("Environments don't apply here: conversations on this server don't run in sandboxes it starts"),
    ).toBeDefined();
  });

  it("shows no row where no conversation exists yet", () => {
    render(<SetupTab {...BASE_PROPS} />);
    expect(screen.queryByText("Environment")).toBeNull();
  });
});

