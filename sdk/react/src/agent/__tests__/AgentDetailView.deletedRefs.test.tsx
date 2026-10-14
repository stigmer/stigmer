/**
 * AgentDetailView shows a skill whose target was deleted as "deleted skill":
 * the server answers its reference with the skill's id and no slug, so there
 * is no name to show and nothing to open. A live skill keeps its name and
 * its link, read-only and editable alike.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function agentWithSkills(): Agent {
  const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, {
    instructions: "help",
    skillRefs: [
      { org: ACME_ID, kind: ApiResourceKind.skill, id: "skl_live", slug: "refunds" },
      { org: ACME_ID, kind: ApiResourceKind.skill, id: "skl_gone", slug: "" },
    ],
  });
  return agent;
}

function renderView(props: { editable?: boolean; onSkillClick?: (ref: { org: string; slug: string }) => void }) {
  const agent = agentWithSkills();
  render(
    <AgentDetailView org="acme" slug="support-bot" editable={props.editable} onSkillClick={props.onSkillClick} />,
    {
      wrapper: orgWrapper(
        {
          agent: { getByReference: vi.fn(async () => agent), update: vi.fn(async () => agent) },
          platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
          grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
        },
        undefined,
        true,
      ),
    },
  );
}

describe("AgentDetailView with a skill deleted since it was attached", () => {
  it("reads it as a deleted skill beside the live one", async () => {
    renderView({});
    expect(await screen.findByText("deleted skill")).toBeTruthy();
    expect(screen.getByText("refunds")).toBeTruthy();
  });

  it("opens the live skill and never the deleted one in the editable list", async () => {
    const onSkillClick = vi.fn();
    renderView({ editable: true, onSkillClick });
    fireEvent.click(await screen.findByText("deleted skill"));
    expect(onSkillClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("refunds"));
    expect(onSkillClick).toHaveBeenCalledExactlyOnceWith({ org: ACME_ID, slug: "refunds" });
  });
});
