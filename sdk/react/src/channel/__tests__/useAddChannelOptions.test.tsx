// useAddChannelOptions: the behaviour behind an agent's Add channel
// affordance. Pins every branch: a loading (null) agent and a viewer who
// fails the create bar get every type unavailable with the permission
// reason; on cloud every type is added in-surface; on local and enterprise
// a chat link still is while Slack and WhatsApp need Stigmer Cloud; and a
// host's external hand-off carries Slack (a redirect install) on any
// edition, never WhatsApp (a direct install).

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DeploymentMode } from "@stigmer/client";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { DeploymentModeContext } from "@stigmer/react-core";
import {
  ADD_CHANNEL_NEEDS_CLOUD,
  ADD_CHANNEL_NEEDS_PERMISSION,
  useAddChannelOptions,
  type UseAddChannelOptionsReturn,
} from "../useAddChannelOptions";

function createMockStigmer(answers: Record<string, boolean> = {}) {
  return {
    grant: {
      checkMyPermission: vi.fn(async (input: { relation: string }) => ({
        isAuthorized: answers[input.relation] ?? true,
      })),
    },
  } as never;
}

function wrapper(client: unknown, mode: DeploymentMode) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <DeploymentModeContext.Provider value={mode}>
          <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
        </DeploymentModeContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

const AGENT = {
  metadata: { id: "agt_1", org: "acme", slug: "support-agent", name: "Support Agent" },
  spec: {},
} as unknown as Agent;

/** The options as `[type id, available, via, reason]` rows, in display order. */
function rows(result: UseAddChannelOptionsReturn) {
  return result.options.map((o) => [o.type.id, o.available, o.via, o.reason]);
}

function renderOptions(
  mode: DeploymentMode,
  options: { agent?: Agent | null; external?: boolean; answers?: Record<string, boolean> } = {},
) {
  const client = createMockStigmer(options.answers);
  const onConnectExternal = options.external ? vi.fn() : undefined;
  const agent = options.agent === undefined ? AGENT : options.agent;
  const rendered = renderHook(() => useAddChannelOptions(agent, { onConnectExternal }), {
    wrapper: wrapper(client, mode),
  });
  return { ...rendered, client };
}

describe("useAddChannelOptions", () => {
  it("keeps every type unavailable while the agent loads, asking no bar", () => {
    const { result, client } = renderOptions("cloud", { agent: null });

    expect(result.current.canAdd).toBe(false);
    expect(rows(result.current)).toEqual([
      ["web", false, null, ADD_CHANNEL_NEEDS_PERMISSION],
      ["slack", false, null, ADD_CHANNEL_NEEDS_PERMISSION],
      ["whatsapp", false, null, ADD_CHANNEL_NEEDS_PERMISSION],
    ]);
    expect(
      (client as { grant: { checkMyPermission: ReturnType<typeof vi.fn> } }).grant.checkMyPermission,
    ).not.toHaveBeenCalled();
  });

  it("makes every type unavailable with the permission reason when the viewer fails the create bar", async () => {
    const { result } = renderOptions("cloud", { answers: { can_create_channel: false } });

    await waitFor(() => expect(result.current.canAdd).toBe(false));
    expect(rows(result.current)).toEqual([
      ["web", false, null, ADD_CHANNEL_NEEDS_PERMISSION],
      ["slack", false, null, ADD_CHANNEL_NEEDS_PERMISSION],
      ["whatsapp", false, null, ADD_CHANNEL_NEEDS_PERMISSION],
    ]);
  });

  it("adds every type in-surface on cloud", async () => {
    const { result } = renderOptions("cloud");

    await waitFor(() => expect(result.current.canAdd).toBe(true));
    expect(rows(result.current)).toEqual([
      ["web", true, "dialog", null],
      ["slack", true, "dialog", null],
      ["whatsapp", true, "dialog", null],
    ]);
  });

  it("hands Slack to the host's delegate on cloud too, and keeps WhatsApp in-surface", async () => {
    const { result } = renderOptions("cloud", { external: true });

    await waitFor(() => expect(result.current.canAdd).toBe(true));
    expect(rows(result.current)).toEqual([
      ["web", true, "dialog", null],
      ["slack", true, "external", null],
      ["whatsapp", true, "dialog", null],
    ]);
  });

  it("adds only a chat link on local; Slack and WhatsApp need Stigmer Cloud", async () => {
    const { result } = renderOptions("local");

    await waitFor(() => expect(result.current.canAdd).toBe(true));
    expect(rows(result.current)).toEqual([
      ["web", true, "dialog", null],
      ["slack", false, null, ADD_CHANNEL_NEEDS_CLOUD],
      ["whatsapp", false, null, ADD_CHANNEL_NEEDS_CLOUD],
    ]);
  });

  it("hands Slack to the host's delegate on local, while WhatsApp still needs Stigmer Cloud", async () => {
    const { result } = renderOptions("local", { external: true });

    await waitFor(() => expect(result.current.canAdd).toBe(true));
    expect(rows(result.current)).toEqual([
      ["web", true, "dialog", null],
      ["slack", true, "external", null],
      ["whatsapp", false, null, ADD_CHANNEL_NEEDS_CLOUD],
    ]);
  });

  it("treats enterprise like local: vendor installs need Stigmer Cloud", async () => {
    const { result } = renderOptions("enterprise");

    await waitFor(() => expect(result.current.canAdd).toBe(true));
    expect(rows(result.current)).toEqual([
      ["web", true, "dialog", null],
      ["slack", false, null, ADD_CHANNEL_NEEDS_CLOUD],
      ["whatsapp", false, null, ADD_CHANNEL_NEEDS_CLOUD],
    ]);
  });
});
