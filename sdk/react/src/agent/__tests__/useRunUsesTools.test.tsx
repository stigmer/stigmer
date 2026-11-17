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
 *   at its first render;
 * - a version other than none or "latest" (a channel's pin) is judged at
 *   that version, read by `getByReference` with the agent's id: its own
 *   tools, then its subagents' at their pins, whatever the head holds; the
 *   answer is `null` until it lands, and stays `null` when the version
 *   cannot be read;
 * - none and "latest" judge the head with no `getByReference`;
 * - a tag is read again on every mount, so a moved tag is seen, while a
 *   mount under the same cache shows the last answer until the fresh one
 *   lands.
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

/**
 * A client whose agents' pinned specs are `agents` by id, and whose agent
 * versions read by reference are `versions` by `id@version`; `getVersion`
 * and `getByReference` are spies. A version not listed is refused.
 */
function client(
  agents: Readonly<Record<string, MessageInitShape<typeof AgentSpecSchema>>>,
  versions: Record<string, MessageInitShape<typeof AgentSpecSchema>> = {},
) {
  const getVersion = vi.fn(async (input: { agentId: string; versionHash: string }) => {
    const found = agents[input.agentId];
    if (found === undefined) throw new Error(`no agent '${input.agentId}'`);
    return create(AgentVersionEntrySchema, {
      versionHash: input.versionHash,
      specSnapshot: create(AgentSpecSchema, found),
    });
  });
  const getByReference = vi.fn(async (ref: { org: string; slug: string; id?: string; version?: string }) => {
    const found = versions[`${ref.id ?? ""}@${ref.version ?? ""}`];
    if (found === undefined) throw new Error(`no version '${ref.version ?? ""}' of '${ref.id ?? ref.slug}'`);
    return create(AgentSchema, { metadata: { id: ref.id, org: ref.org, slug: "desk-old-name" }, spec: create(AgentSpecSchema, found) });
  });
  return { stigmer: { agent: { getVersion, getByReference } }, getVersion, getByReference, versions };
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

  describe("at a channel's pinned version", () => {
    it("judges the pinned version's own tools, whatever the head holds", async () => {
      const { stigmer, getByReference } = client({}, { "agt_desk@stable": { plugins: [{ slug: "github" }] }, "agt_desk@lean": {} });

      const toolsAtPin = renderHook(() => useRunUsesTools(agent({ instructions: "no tools now" }), "stable"), { wrapper: wrapper(stigmer) });
      const noneAtPin = renderHook(() => useRunUsesTools(agent({ plugins: [{ slug: "github" }] }), "lean"), { wrapper: wrapper(stigmer) });
      expect(toolsAtPin.result.current).toBeNull();
      expect(noneAtPin.result.current).toBeNull();

      await waitFor(() => expect(toolsAtPin.result.current).toBe(true));
      await waitFor(() => expect(noneAtPin.result.current).toBe(false));
      expect(getByReference).toHaveBeenCalledWith({ org: "acme", slug: "desk", id: "agt_desk", version: "stable" });
    });

    it("judges the pinned version's subagents at their pins", async () => {
      const { stigmer, getVersion } = client(
        { agt_gh: { plugins: [{ slug: "github" }] } },
        { [`agt_desk@${PIN}`]: { instructions: "route", subagents: [{ org: "acme", id: "agt_gh", version: NEXT_PIN }] } },
      );
      const { result } = renderHook(() => useRunUsesTools(agent({ instructions: "chat" }), PIN), { wrapper: wrapper(stigmer) });

      await waitFor(() => expect(result.current).toBe(true));
      expect(getVersion).toHaveBeenCalledWith({ agentId: "agt_gh", versionHash: NEXT_PIN });
    });

    it("judges the head with no read by reference for none or latest", () => {
      const { stigmer, getByReference } = client({});
      const none = renderHook(() => useRunUsesTools(agent({ plugins: [{ slug: "github" }] }), ""), { wrapper: wrapper(stigmer) });
      const latest = renderHook(() => useRunUsesTools(agent({ instructions: "chat" }), " latest "), { wrapper: wrapper(stigmer) });

      expect(none.result.current).toBe(true);
      expect(latest.result.current).toBe(false);
      expect(getByReference).not.toHaveBeenCalled();
    });

    it("stays null when the pinned version cannot be read", async () => {
      const { stigmer, getByReference } = client({});
      const { result } = renderHook(() => useRunUsesTools(agent({ plugins: [{ slug: "github" }] }), "gone"), { wrapper: wrapper(stigmer) });

      await waitFor(() => expect(getByReference).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(result.current).toBeNull();
    });

    it("reads a tag again on a later mount, showing the cached answer until the fresh one lands", async () => {
      const { stigmer, getByReference, versions } = client({}, { "agt_desk@stable": { plugins: [{ slug: "github" }] } });
      const cache = new FetchCache();
      const card = renderHook(() => useRunUsesTools(agent({ instructions: "chat" }), "stable"), { wrapper: wrapper(stigmer, cache) });
      await waitFor(() => expect(card.result.current).toBe(true));

      // The tag moves to a version with no tools.
      versions["agt_desk@stable"] = { instructions: "chat" };
      const seen: (boolean | null)[] = [];
      const dialog = renderHook(
        () => {
          const answer = useRunUsesTools(agent({ instructions: "chat" }), "stable");
          seen.push(answer);
          return answer;
        },
        { wrapper: wrapper(stigmer, cache) },
      );
      expect(seen[0]).toBe(true);
      await waitFor(() => expect(dialog.result.current).toBe(false));
      expect(getByReference).toHaveBeenCalledTimes(2);
    });
  });
});
