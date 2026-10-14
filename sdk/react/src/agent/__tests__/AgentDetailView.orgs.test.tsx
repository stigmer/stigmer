/**
 * AgentDetailView names a reference into another organization by that org's
 * slug (its plugins and skills), a reference into the
 * agent's own org by its slug alone, and still hands navigation the org id
 * the reference is stored by. The route may name the agent's org by slug
 * while the agent stores its org by id: the two are the same organization.
 * A click on a plugin or a skill, in the lists, the editable lists or the
 * dependency tree, hands navigation the stored id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, GLOBEX_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function agentWithCrossOrgRefs() {
  const agent = samples.agent({ name: "Reviewer", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, {
    instructions: "Review pull requests.",
    plugins: [
      { org: GLOBEX_ID, slug: "github" },
      { org: ACME_ID, slug: "jira" },
    ],
    skillRefs: [
      { org: GLOBEX_ID, slug: "shared-guide" },
      { org: ACME_ID, slug: "own-guide" },
    ],
  });
  return agent;
}

function renderView(props: { editable?: boolean; defaultTab?: string } = {}) {
  const onPluginClick = vi.fn();
  const onSkillClick = vi.fn();
  const getByReference = vi.fn(async () => agentWithCrossOrgRefs());
  render(
    <AgentDetailView
      org="acme"
      slug="reviewer"
      editable={props.editable}
      defaultTab={props.defaultTab}
      onPluginClick={onPluginClick}
      onSkillClick={onSkillClick}
    />,
    {
      wrapper: orgWrapper(
        {
          agent: { getByReference },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
        },
        undefined,
        true,
      ),
    },
  );
  return { onPluginClick, onSkillClick };
}

describe("AgentDetailView references across organizations", () => {
  it("labels another org's plugins and skills by its slug, own-org ones by slug alone", async () => {
    const { onPluginClick, onSkillClick } = renderView();

    expect(await screen.findByText("globex/github")).toBeTruthy();
    expect(screen.getByText("jira")).toBeTruthy();
    expect(screen.getByText("globex/shared-guide")).toBeTruthy();
    expect(screen.getByText("own-guide")).toBeTruthy();
    expect(screen.queryByText(new RegExp(GLOBEX_ID))).toBeNull();

    fireEvent.click(screen.getByText("globex/github"));
    expect(onPluginClick).toHaveBeenCalledWith({ org: GLOBEX_ID, slug: "github" });
    fireEvent.click(screen.getByText("globex/shared-guide"));
    expect(onSkillClick).toHaveBeenCalledWith({ org: GLOBEX_ID, slug: "shared-guide" });
  });

  it("labels the editable reference lists the same way", async () => {
    renderView({ editable: true });

    expect(await screen.findByText("globex/github")).toBeTruthy();
    expect(screen.getByText("jira")).toBeTruthy();
    expect(screen.getByText("globex/shared-guide")).toBeTruthy();
    expect(screen.getByText("own-guide")).toBeTruthy();
  });

  it("hands navigation the stored org id from the editable lists too", async () => {
    const { onPluginClick } = renderView({ editable: true });

    fireEvent.click(await screen.findByText("globex/github"));
    expect(onPluginClick).toHaveBeenCalledWith({ org: GLOBEX_ID, slug: "github" });
  });

  it("hands navigation the stored org id from the dependency tree's plugin and skill nodes", async () => {
    const { onPluginClick, onSkillClick } = renderView({ defaultTab: "dependencies" });

    const tree = await screen.findByRole("tree");
    const plugin = within(tree).getByRole("button", { name: /Plugin.*globex\/github/ });
    fireEvent.click(plugin);
    expect(onPluginClick).toHaveBeenCalledWith({ org: GLOBEX_ID, slug: "github" });

    fireEvent.click(within(tree).getByRole("button", { name: /Skill.*globex\/shared-guide/ }));
    expect(onSkillClick).toHaveBeenCalledWith({ org: GLOBEX_ID, slug: "shared-guide" });
  });
});
