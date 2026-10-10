/**
 * The "Add to an agent" dialog over a plugin. The agent picker is stubbed
 * to one pick each; the agent client is an in-memory fake. Pins: the
 * dialog names the plugin and says the agent gets it whole; Add saves once
 * with the plugin appended to the agent's `plugins` and says it was added;
 * an agent that already lists it is told so and nothing is saved; an agent
 * whose tool list leaves the plugin's servers out is told before Add; an
 * agent a plugin installed is refused before Add is offered; "Open agent"
 * hands the host the updated agent's reference.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { type Agent, AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { AgentInput, ResourceRef } from "@stigmer/sdk";

vi.mock("../../agent/AgentPicker.js", () => ({
  AgentPicker: ({ onChange, disabled }: { onChange: (ref: ResourceRef | null) => void; disabled?: boolean }) => (
    <span>
      {["reviewer", "assistant", "listing", "limited"].map((slug) => (
        <button key={slug} type="button" disabled={disabled} onClick={() => onChange({ org: "acme", slug })}>
          Pick {slug}
        </button>
      ))}
    </span>
  ),
}));

import { StigmerContext } from "../../context.js";
import { AddPluginToAgentDialog } from "../AddPluginToAgentDialog.js";
import type { PluginOffer } from "../useAddPluginToAgent.js";

afterEach(cleanup);

const OFFER: PluginOffer = { plugin: { org: "acme", slug: "linear" }, name: "linear", servers: ["linear"] };

function agent(slug: string, extra: { labels?: Record<string, string>; plugins?: string[]; tools?: string[] } = {}): Agent {
  return create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: `agt_${slug}`,
      org: "acme",
      slug,
      name: slug === "reviewer" ? "Reviewer" : slug,
      labels: extra.labels ?? {},
    }),
    spec: create(AgentSpecSchema, {
      instructions: "Review.",
      plugins: (extra.plugins ?? []).map((plugin) => ({ org: "acme", slug: plugin })),
      tools: extra.tools ?? [],
    }),
  });
}

const AGENTS: Record<string, Agent> = {
  reviewer: agent("reviewer"),
  assistant: agent("assistant", { labels: { "stigmer.ai/plugin": "plg_1" } }),
  listing: agent("listing", { plugins: ["linear"] }),
  limited: agent("limited", { tools: ["Read"] }),
};

function renderDialog(onAgentClick = vi.fn()) {
  const update = vi.fn(async (input: AgentInput) => {
    const found = AGENTS[input.slug ?? ""];
    if (!found) throw new Error("no agent");
    return found;
  });
  const client = {
    agent: {
      getByReference: vi.fn(async (ref: ResourceRef) => {
        const found = AGENTS[ref.slug];
        if (!found) throw new Error("no agent");
        return found;
      }),
      update,
    },
  };
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
  render(<AddPluginToAgentDialog org="acme" offer={OFFER} open onClose={vi.fn()} onAgentClick={onAgentClick} />, { wrapper });
  return { update };
}

describe("AddPluginToAgentDialog", () => {
  it("names the plugin and says the agent gets it whole", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Add linear to an agent" })).toBeTruthy();
    expect(screen.getByText(/gets the whole plugin/)).toBeTruthy();
  });

  it("adds the plugin to the picked agent once and says so, then opens it", async () => {
    const onAgentClick = vi.fn();
    const { update } = renderDialog(onAgentClick);
    fireEvent.click(screen.getByRole("button", { name: "Pick reviewer" }));
    const add = await screen.findByRole("button", { name: "Add" });
    await waitFor(() => expect(add).toHaveProperty("disabled", false));
    fireEvent.click(add);

    expect(await screen.findByText("Added linear to Reviewer.")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0].plugins).toEqual([{ org: "acme", slug: "linear" }]);
    fireEvent.click(screen.getByRole("button", { name: "Open agent" }));
    expect(onAgentClick).toHaveBeenCalledWith({ org: "acme", slug: "reviewer" });
  });

  it("tells an agent that already lists the plugin so, and saves nothing", async () => {
    const { update } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Pick listing" }));
    expect(await screen.findByText("listing already uses this plugin.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("listing already uses linear.")).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("says before Add when the agent's tool list leaves the plugin's servers out", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Pick limited" }));
    expect(await screen.findByText(/its list leaves this plugin's servers out/)).toBeTruthy();
  });

  it("refuses an agent a plugin installed before Add is offered", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Pick assistant" }));
    expect(await screen.findByText(/was installed by a plugin/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
  });
});
