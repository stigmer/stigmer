/**
 * AgentDetailView's Hooks and Plugins sections. A plugin's hooks come with
 * the plugin, so the Hooks section shows only the hooks written in the
 * agent ("Written in this agent", every command each runs) and nothing for
 * an agent with none; the Plugins section lists the plugins the agent uses,
 * each a link through `onPluginClick`. Editing the Plugins section saves
 * `spec.plugins` as listed: removing one keeps the rest and every other
 * field (the inline hooks and the env included), adding one appends it,
 * and a refused save shows the server's sentence in the section.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { HookFormat, HookConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { samples } from "../../test/samples";
import { AgentDetailView } from "../AgentDetailView";
import { sentRefs, sentUpdate } from "../../internal/__tests__/sent-update";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const INLINE_HOOKS = create(HookConfigSchema, {
  format: HookFormat.CLAUDE_CODE,
  groups: [{ event: "PreToolUse", matcher: "Bash", handlers: [{ command: "./deny-push.sh" }] }],
});

function agentWith(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  const agent = samples.agent({ name: "Support Bot", org: ACME_ID });
  agent.spec = create(AgentSpecSchema, spec);
  return agent;
}

const inlineSource = { source: { case: "inline" as const, value: INLINE_HOOKS } };

function renderView(
  agent: Agent,
  props: { editable?: boolean; refuseUpdate?: boolean; refusal?: ConnectError } = {},
) {
  const update = vi.fn(async (resource: Agent, paths: string[]) => {
    if (props.refuseUpdate) throw new ConnectError("plugin 'acme/extra' is not installed", Code.InvalidArgument);
    if (props.refusal) throw props.refusal;
    void resource;
    void paths;
    return agent;
  });
  const onPluginClick = vi.fn();
  render(<AgentDetailView org="acme" slug="support-bot" editable={props.editable} onPluginClick={onPluginClick} />, {
    wrapper: orgWrapper(
      {
        agent: { getByReference: vi.fn(async () => agent), update },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        grant: { checkMyPermission: vi.fn(async () => ({ isAuthorized: false })) },
      },
      undefined,
      true,
    ),
  });
  return { update, onPluginClick };
}

describe("AgentDetailView hooks", () => {
  it("lists the hooks written in the agent with every command they run", async () => {
    renderView(agentWith({ instructions: "Answer tickets.", hooks: [inlineSource] }));

    const sources = await screen.findByRole("list", { name: "Hook sources" });
    expect(within(sources).getByText("Written in this agent")).toBeTruthy();
    expect(within(sources).getByText("./deny-push.sh")).toBeTruthy();
    expect(within(sources).getByText("Before a tool call")).toBeTruthy();
  });

  it("shows no Hooks section for an agent with none written in it", async () => {
    renderView(agentWith({ instructions: "Answer tickets." }), { editable: true });

    expect(await screen.findByText("Answer tickets.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Hook sources" })).toBeNull();
    expect(screen.queryByText("Hooks")).toBeNull();
  });
});

describe("AgentDetailView plugins", () => {
  it("lists the plugins the agent uses, each a link to its page", async () => {
    const { onPluginClick } = renderView(agentWith({ instructions: "Answer tickets.", plugins: [{ org: ACME_ID, slug: "linear" }] }));

    fireEvent.click(await screen.findByRole("button", { name: /linear/ }));
    expect(onPluginClick).toHaveBeenCalledWith({ org: ACME_ID, slug: "linear" });
  });

  it("removes a plugin, naming the plugins alone", async () => {
    const { update } = renderView(
      agentWith({
        instructions: "Answer tickets.",
        hooks: [inlineSource],
        env: { API_TOKEN: { isSecret: true } },
        plugins: [
          { org: ACME_ID, slug: "guard" },
          { org: ACME_ID, slug: "linear" },
        ],
      }),
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove guard" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // The save names the plugins alone: the hooks and the env keep their
    // stored values without being sent back.
    const sent = sentUpdate<Agent>(update);
    expect(sent.paths).toEqual(["spec.plugins"]);
    expect(sent.resource.spec?.plugins.map((ref) => ref.slug)).toEqual(["linear"]);
  });

  it("adds a plugin typed in, after the ones listed", async () => {
    const { update } = renderView(
      agentWith({ instructions: "Answer tickets.", plugins: [{ org: ACME_ID, slug: "guard" }] }),
      { editable: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
    const slug = screen.getByPlaceholderText("slug");
    fireEvent.change(slug, { target: { value: "linear" } });
    fireEvent.keyDown(slug, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentRefs(sentUpdate<Agent>(update).resource.spec?.plugins)).toEqual([
      { org: ACME_ID, slug: "guard" },
      { org: ACME_ID, slug: "linear" },
    ]);
  });

  it("shows the server's refusal in the section", async () => {
    renderView(agentWith({ instructions: "Answer tickets." }), { editable: true, refuseUpdate: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
    const slug = screen.getByPlaceholderText("slug");
    fireEvent.change(slug, { target: { value: "extra" } });
    fireEvent.keyDown(slug, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/is not installed/)).toBeTruthy();
  });

  it("sends the agent's id and the etag it was loaded at", async () => {
    const agent = agentWith({ instructions: "Answer tickets.", plugins: [{ org: ACME_ID, slug: "guard" }] });
    agent.metadata!.etag = "etag-at-load";
    const { update } = renderView(agent, { editable: true });

    fireEvent.click(await screen.findByRole("button", { name: "Edit plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove guard" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Agent>(update);
    expect(sent.id).toBe(agent.metadata?.id);
    expect(sent.etag).toBe("etag-at-load");
  });

  it("says to reload when the agent changed since it was opened, and keeps the edit", async () => {
    const changed = new ConnectError(
      "Agent 'acme/support-bot' changed since you read it; reload it and make your change again",
      Code.Aborted,
      undefined,
      [{ desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason: "ETAG_MISMATCH", metadata: {} } }],
    );
    renderView(agentWith({ instructions: "Answer tickets." }), { editable: true, refusal: changed });

    fireEvent.click(await screen.findByRole("button", { name: "Edit plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
    const slug = screen.getByPlaceholderText("slug");
    fireEvent.change(slug, { target: { value: "extra" } });
    fireEvent.keyDown(slug, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/This agent changed since you opened it/)).toBeTruthy();
    // The editor stays open with the unsaved plugin in it.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove extra" })).toBeTruthy();
  });
});
