/**
 * The "Add to an agent" dialog over a plugin's offer. The agent picker is
 * stubbed to one pick; the agent client is an in-memory fake. Pins: the
 * offer is listed (each server, and the plugin's hooks in their summary
 * line); once an agent is picked, the variables its hooks read are named
 * with the sentence that the agent will ask for them when a session starts;
 * Add saves once and says what was added; an agent a plugin installed is
 * refused before Add is offered; "Create a new agent with these tools"
 * shows only when the plugin brings servers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { type Agent, AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookConfigSchema, HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { AgentInput, ResourceRef } from "@stigmer/sdk";

vi.mock("../../agent/AgentPicker.js", () => ({
  AgentPicker: ({ onChange, disabled }: { onChange: (ref: ResourceRef | null) => void; disabled?: boolean }) => (
    <span>
      <button type="button" disabled={disabled} onClick={() => onChange({ org: "acme", slug: "reviewer" })}>
        Pick reviewer
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange({ org: "acme", slug: "assistant" })}>
        Pick assistant
      </button>
    </span>
  ),
}));

import { StigmerContext } from "../../context.js";
import { AddPluginToAgentDialog } from "../AddPluginToAgentDialog.js";
import type { PluginOffer } from "../useAddPluginToAgent.js";

afterEach(cleanup);

const HOOKS = create(HookConfigSchema, {
  format: HookFormat.CLAUDE_CODE,
  groups: [{ event: "PreToolUse", handlers: [{ command: "python3", args: ["guard.py", "${user_config.API_TOKEN}"] }] }],
});

function agent(slug: string, labels: Record<string, string> = {}): Agent {
  return create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `agt_${slug}`, org: "acme", slug, name: slug === "reviewer" ? "Reviewer" : slug, labels }),
    spec: create(AgentSpecSchema, { instructions: "Review." }),
  });
}

function renderDialog(offer: PluginOffer, onCreateAgent?: () => void) {
  const agents: Record<string, Agent> = { reviewer: agent("reviewer"), assistant: agent("assistant", { "stigmer.ai/plugin": "plg_1" }) };
  const update = vi.fn(async (input: AgentInput) => {
    void input;
    return agents.reviewer!;
  });
  const client = { agent: { getByReference: vi.fn(async (ref: ResourceRef) => agents[ref.slug]!), update } };
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
  render(<AddPluginToAgentDialog org="acme" offer={offer} open onClose={() => {}} onCreateAgent={onCreateAgent} />, { wrapper });
  return { update };
}

describe("AddPluginToAgentDialog", () => {
  it("lists the servers and the hooks, names the variables once an agent is picked, and saves once", async () => {
    const { update } = renderDialog(
      { servers: [{ ref: { org: "acme", slug: "linear" }, name: "Linear" }], hooks: { plugin: { org: "acme", slug: "guard" }, config: HOOKS } },
      () => {},
    );

    const dialog = await screen.findByRole("dialog", { name: "Add to an agent" });
    const offer = within(dialog).getByRole("list", { name: "What the agent gets" });
    expect(offer.textContent).toContain("Linear");
    expect(offer.textContent).toContain("This plugin's hooks");
    expect(offer.textContent).toContain("Claude Code format: PreToolUse 1");
    expect(within(dialog).getByRole("button", { name: "Create a new agent with these tools" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Pick reviewer" }));
    expect(await within(dialog).findByText(/The hooks read API_TOKEN\. The agent will ask for it when a session starts\./)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByText("Added 1 server and this plugin's hooks to Reviewer. It will ask for API_TOKEN when a session starts.")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
    const input = update.mock.calls[0]![0];
    expect(input.mcpServerUsages?.map((usage) => usage.mcpServerRef.slug)).toEqual(["linear"]);
    expect(input.hooks).toEqual([{ plugin: { org: "acme", slug: "guard" } }]);
    expect(input.env?.["API_TOKEN"]).toEqual({ isSecret: true });
  });

  it("refuses an agent a plugin installed before Add is offered, and offers no new agent for hooks alone", async () => {
    const { update } = renderDialog({ servers: [], hooks: { plugin: { org: "acme", slug: "guard" }, config: HOOKS } }, () => {});

    const dialog = await screen.findByRole("dialog", { name: "Add to an agent" });
    expect(within(dialog).queryByRole("button", { name: "Create a new agent with these tools" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Pick assistant" }));
    expect(await within(dialog).findByText(/was installed by a plugin/)).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Add" })).toHaveProperty("disabled", true));
    expect(update).not.toHaveBeenCalled();
  });
});
