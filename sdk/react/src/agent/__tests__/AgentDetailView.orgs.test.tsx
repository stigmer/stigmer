/**
 * AgentDetailView names a reference into another organization by that org's
 * slug (its plugins, skills and sub-agents' skills), a reference into the
 * agent's own org by its slug alone, and still hands navigation the org id
 * the reference is stored by. The route may name the agent's org by slug
 * while the agent stores its org by id: the two are the same organization.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
    subAgents: [
      {
        name: "researcher",
        description: "Digs up context",
        skillRefs: [{ org: GLOBEX_ID, slug: "research-guide" }],
      },
    ],
  });
  return agent;
}

function renderView(props: { editable?: boolean } = {}) {
  const onPluginClick = vi.fn();
  const onSkillClick = vi.fn();
  const getByReference = vi.fn(async () => agentWithCrossOrgRefs());
  render(
    <AgentDetailView
      org="acme"
      slug="reviewer"
      editable={props.editable}
      onPluginClick={onPluginClick}
      onSkillClick={onSkillClick}
    />,
    {
      wrapper: orgWrapper(
        {
          agent: { getByReference },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          iamPolicy: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
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

  it("labels a sub-agent's skill in another org by that org's slug", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: /researcher/ }));

    expect(screen.getByText("globex/research-guide")).toBeTruthy();
  });

  it("labels the editable reference lists the same way", async () => {
    renderView({ editable: true });

    expect(await screen.findByText("globex/github")).toBeTruthy();
    expect(screen.getByText("jira")).toBeTruthy();
    expect(screen.getByText("globex/shared-guide")).toBeTruthy();
    expect(screen.getByText("own-guide")).toBeTruthy();
  });
});
