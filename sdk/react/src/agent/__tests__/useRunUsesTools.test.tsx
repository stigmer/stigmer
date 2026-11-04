/**
 * Whether a run of an agent uses tools, its subagents' included, as the
 * channel and chat-link screens ask it. Pinned:
 *
 * - an agent with tools of its own, or listing no subagent, is answered
 *   at once, with no request;
 * - otherwise the answer is `null` until each subagent is read at its pin,
 *   then whether any of them uses tools;
 * - the reading is keyed by the subagents' pins, so a rerender with equal
 *   pins (a new spec object) asks nothing again and a changed pin asks
 *   again;
 * - a mount under the same fetch cache with the same pins has the answer
 *   at its first render.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { type Agent, AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentVersionEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCache, FetchCacheContext } from "@stigmer/react-core/internal";
import { useRunUsesTools } from "../useRunUsesTools";

const PIN = "a".repeat(64);
const NEXT_PIN = "b".repeat(64);

function agent(spec: MessageInitShape<typeof AgentSpecSchema>): Agent {
  return create(AgentSchema, { metadata: { id: "agt_desk", org: "acme", slug: "desk" }, spec });
}

/** An agent with no tools of its own that lists `id` at `version`. */
function delegating(id: string, version = PIN): Agent {
  return agent({ instructions: "route", subagents: [{ org: "acme", id, version }] });
}

/** A client whose agents' pinned specs are `agents` by id; `getVersion` is a spy. */
function client(agents: Readonly<Record<string, MessageInitShape<typeof AgentSpecSchema>>>) {
  const getVersion = vi.fn(async (input: { agentId: string; versionHash: string }) => {
    const found = agents[input.agentId];
    if (found === undefined) throw new Error(`no agent '${input.agentId}'`);
    return create(AgentVersionEntrySchema, {
      versionHash: input.versionHash,
      specSnapshot: create(AgentSpecSchema, found),
    });
  });
  return { stigmer: { agent: { getVersion } }, getVersion };
}

function wrapper(stigmer: unknown, cache: FetchCache | null = null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={stigmer as never}>
        <FetchCacheContext.Provider value={cache}>{children}</FetchCacheContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

describe("useRunUsesTools", () => {
  it("answers without a request for an agent with tools of its own, or with no subagent", () => {
    const { stigmer, getVersion } = client({});
    const own = renderHook(() => useRunUsesTools(agent({ plugins: [{ slug: "github" }], subagents: [{ id: "agt_x", version: PIN }] })), {
      wrapper: wrapper(stigmer),
    });
    const none = renderHook(() => useRunUsesTools(agent({ instructions: "chat" })), { wrapper: wrapper(stigmer) });

    expect(own.result.current).toBe(true);
    expect(none.result.current).toBe(false);
    expect(getVersion).not.toHaveBeenCalled();
  });

  it("is null while the subagents are read, then whether any uses tools", async () => {
    const { stigmer } = client({ agt_gh: { plugins: [{ slug: "github" }] }, agt_plain: {} });

    const withTools = renderHook(() => useRunUsesTools(delegating("agt_gh")), { wrapper: wrapper(stigmer) });
    const without = renderHook(() => useRunUsesTools(delegating("agt_plain")), { wrapper: wrapper(stigmer) });
    expect(withTools.result.current).toBeNull();
    expect(without.result.current).toBeNull();

    await waitFor(() => expect(withTools.result.current).toBe(true));
    await waitFor(() => expect(without.result.current).toBe(false));
  });

  it("reads again only when a pin changes, not for a new spec with equal pins", async () => {
    const { stigmer, getVersion } = client({ agt_gh: { plugins: [{ slug: "github" }] } });
    const { result, rerender } = renderHook(({ version }: { version: string }) => useRunUsesTools(delegating("agt_gh", version)), {
      wrapper: wrapper(stigmer),
      initialProps: { version: PIN },
    });
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ version: PIN });
    expect(result.current).toBe(true);
    expect(getVersion).toHaveBeenCalledTimes(1);

    rerender({ version: NEXT_PIN });
    await waitFor(() => expect(getVersion).toHaveBeenCalledTimes(2));
    expect(getVersion).toHaveBeenLastCalledWith({ agentId: "agt_gh", versionHash: NEXT_PIN });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("has the answer at first render for a mount sharing the cache and the pins", async () => {
    const { stigmer } = client({ agt_gh: { plugins: [{ slug: "github" }] } });
    const cache = new FetchCache();
    const card = renderHook(() => useRunUsesTools(delegating("agt_gh")), { wrapper: wrapper(stigmer, cache) });
    await waitFor(() => expect(card.result.current).toBe(true));

    const seen: (boolean | null)[] = [];
    renderHook(
      () => {
        const answer = useRunUsesTools(delegating("agt_gh"));
        seen.push(answer);
        return answer;
      },
      { wrapper: wrapper(stigmer, cache) },
    );
    expect(seen[0]).toBe(true);
  });
});
