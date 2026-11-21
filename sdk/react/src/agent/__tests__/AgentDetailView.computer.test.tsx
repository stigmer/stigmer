/**
 * AgentDetailView's "Computer" section and what it changes beside it.
 * - the switch reads the agent's setting: on for a computer, and for an
 *   agent saved before the setting (unset); off for COMPUTER_NONE;
 * - flipping it saves `spec.computer` alone, at once, with COMPUTER_NONE or
 *   COMPUTER_REQUIRED;
 * - a server refusal springs the switch back to the stored value and shows
 *   the server's sentence under it;
 * - on the Claude harness the switch is locked on, saying why;
 * - a reader sees the switch disabled;
 * - with no computer, the Environment section says it doesn't apply and
 *   offers no edit, and the run defaults' harness choice offers Stigmer
 *   alone, saying why.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { Computer, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { samples } from "@stigmer/react-core/test";
import { AgentDetailView } from "../AgentDetailView";
import { COMPUTER_COPY, claudeNotOfferedCopy } from "../computer";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function agentWith(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  const agent = samples.agent({ name: "Support desk", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, spec);
  return agent;
}

function renderAgent(
  agent: Agent,
  opts: { update?: (resource: Agent, paths: string[]) => Promise<Agent>; editable?: boolean } = {},
) {
  render(<AgentDetailView org="acme" slug="support-desk" editable={opts.editable ?? true} />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update: opts.update ?? vi.fn(async () => agent) },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        grant: { checkMyPermission: vi.fn(async (input: { relation: string }) => ({ isAuthorized: input.relation === "can_edit" })) },
        environment: { list: vi.fn(async () => ({ entries: [], nextPageToken: "" })) },
        organization: { get: vi.fn(async () => ({ metadata: { id: ACME_ID }, spec: { preferences: {} } })) },
      },
      undefined,
      true,
    ),
  });
}

const theSwitch = () => screen.findByRole("switch", { name: COMPUTER_COPY.label });

describe("AgentDetailView computer", () => {
  it("reads on for a computer and for an agent saved before the setting, off for none", async () => {
    for (const [computer, on] of [
      [Computer.REQUIRED, true],
      [Computer.UNSPECIFIED, true],
      [Computer.NONE, false],
    ] as const) {
      renderAgent(agentWith({ computer }));
      const control = await theSwitch();
      expect(control.getAttribute("aria-checked"), Computer[computer]).toBe(String(on));
      expect(screen.getByText(on ? COMPUTER_COPY.on : COMPUTER_COPY.off)).toBeTruthy();
      cleanup();
    }
  });

  it("saves spec.computer alone, at once, both ways", async () => {
    for (const [stored, sent] of [
      [Computer.REQUIRED, Computer.NONE],
      [Computer.NONE, Computer.REQUIRED],
    ] as const) {
      const agent = agentWith({ computer: stored });
      const update = vi.fn(async (resource: Agent, paths: string[]) => {
        void paths;
        return resource;
      });
      renderAgent(agent, { update });
      await waitFor(async () => expect((await theSwitch()).hasAttribute("disabled")).toBe(false));
      fireEvent.click(await theSwitch());
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const { resource, paths } = sentUpdate<Agent>(update);
      expect(paths).toEqual(["spec.computer"]);
      expect(resource.spec?.computer).toBe(sent);
      cleanup();
    }
  });

  it("springs back and shows the server's sentence when the save is refused", async () => {
    const refusal =
      "this agent has no computer, so it can't run its own hooks; remove its hooks, or give the agent a computer";
    const agent = agentWith({ computer: Computer.REQUIRED });
    const update = vi.fn(async () => {
      throw new ConnectError(refusal, Code.InvalidArgument);
    });
    renderAgent(agent, { update });
    await waitFor(async () => expect((await theSwitch()).hasAttribute("disabled")).toBe(false));
    fireEvent.click(await theSwitch());

    const section = screen.getByRole("heading", { name: "Computer" }).closest("section")! as HTMLElement;
    expect((await within(section).findByRole("alert")).textContent).toContain(refusal);
    await waitFor(async () => expect((await theSwitch()).getAttribute("aria-checked")).toBe("true"));
  });

  it("locks the switch on for the Claude harness, saying why", async () => {
    renderAgent(agentWith({ harness: Harness.CLAUDE, computer: Computer.REQUIRED }));
    const control = await theSwitch();
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(control.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(COMPUTER_COPY.lockedBadge)).toBeTruthy();
    expect(screen.getByText(COMPUTER_COPY.locked)).toBeTruthy();
  });

  it("shows a reader the switch disabled", async () => {
    renderAgent(agentWith({ computer: Computer.NONE }), { editable: false });
    const control = await theSwitch();
    expect(control.hasAttribute("disabled")).toBe(true);
    expect(control.getAttribute("aria-checked")).toBe("false");
  });

  it("without a computer, the Environment doesn't apply and the harness choice offers Stigmer alone", async () => {
    renderAgent(agentWith({ computer: Computer.NONE, harness: Harness.STIGMER }));
    expect(await screen.findByText(COMPUTER_COPY.environmentNotApplying)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit environment" })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Edit run defaults" }));
    const harnesses = await screen.findByRole("radiogroup", { name: "Harness" });
    expect(within(harnesses).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Stigmer"]);
    expect(screen.getByText(claudeNotOfferedCopy())).toBeTruthy();
  });
});
