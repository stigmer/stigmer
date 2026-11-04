/**
 * Moving the session page from one conversation to another starts the new
 * one from its own settings (stigmer/stigmer#2760). Hosts keep the viewer
 * mounted across conversations, so every choice the page holds for a
 * conversation (the agent, a dropped agent, the Plan/Agent override, "the
 * agent's default model", the auto-approve switch) must belong to the
 * conversation it was made in: the next one shows its own agent, and an
 * untouched follow-up there writes no session update, so it never rebinds
 * that conversation to the agent just left.
 *
 * Built on a stored client and the real conversation hook, with no fetch
 * cache mounted (an integrator's default) and once under one (the hosts'),
 * so the session read the page seeds from is the real one, render by render.
 *
 * Pinned:
 * - no render on B shows A's agent, and B's untouched follow-up sends no
 *   session update (with and without a fetch cache);
 * - an agent dropped in A sends no clear in B;
 * - a Plan/Agent override, "the agent's default model" and auto-approve
 *   chosen in A do not carry to B;
 * - returning to A seeds it fresh: A's earlier choices are not resurrected.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema, type Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCache, FetchCacheContext } from "@stigmer/react-core/internal";
import { useSessionPageFlow, type UseSessionPageFlowReturn } from "../useSessionPageFlow";
import { sessionEventStream } from "./session-event-stream";

// The agent each conversation runs names a model for its harness, so the
// page hands the composer the agent's defaults and "the agent's default
// model" is a choice the person can make.
vi.mock("../../agent/useRunAgentSpec", () => ({
  useRunAgentSpec: (ref: unknown) => ({
    agent: null,
    spec: ref ? { harness: Harness.STIGMER, runConfig: { modelName: "agent-model" } } : undefined,
    isLoading: false,
  }),
}));

const AGENT_KIND = 40;

function conversation(id: string, agentSlug: string): Session {
  return create(SessionSchema, {
    metadata: { id, org: "org_acme", name: id },
    spec: { agentRef: { org: "org_acme", slug: agentSlug, kind: AGENT_KIND }, harness: Harness.STIGMER },
  });
}

const A = conversation("session-a", "alpha");
const B = conversation("session-b", "beta");

/** A finished run of B's that asked for its own model. */
const B_RUN = create(RunSchema, {
  metadata: { id: "run_b1", org: "org_acme" },
  spec: { runConfig: { modelName: "model-b" } },
});

/** A client whose sessions and runs are stored; every update is recorded. */
function storedClient(runsBySession: Record<string, Run[]> = {}) {
  const held = new Map([A, B].map((session) => [session.metadata!.id, session]));
  const update = vi.fn(async (resource: Session) => held.get(resource.metadata!.id)!);
  const runSend = vi.fn().mockResolvedValue({ metadata: { id: "run_new" }, spec: {} });
  const client = {
    session: {
      get: vi.fn(async (id: string) => held.get(id)!),
      update,
      streamEvents: sessionEventStream().streamEvents,
    },
    run: {
      listBySession: vi.fn(async (input: { sessionId: string }) => ({
        entries: runsBySession[input.sessionId] ?? [],
        nextPageToken: "",
      })),
      sendMessage: async (input: unknown) => ({ run: await runSend(input) }),
      get: vi.fn(() => new Promise(() => {})),
    },
    agent: { getByReference: vi.fn().mockResolvedValue(null) },
    identityAccount: { whoAmI: vi.fn().mockRejectedValue(new Error("none")) },
  } as unknown as Stigmer;
  return { client, update, runSend };
}

function wrapperFor(client: Stigmer, cache: FetchCache | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={cache}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

/** Renders the page on A and logs the agent every render shows. */
async function onA(client: Stigmer, cache: FetchCache | null = null) {
  const renders: { sessionId: string; agent: string | null }[] = [];
  const hook = renderHook(
    ({ sessionId }: { sessionId: string }) => {
      const flow = useSessionPageFlow({ sessionId, org: "org_acme" });
      renders.push({ sessionId, agent: flow.agentRef?.slug ?? null });
      return flow;
    },
    { wrapper: wrapperFor(client, cache), initialProps: { sessionId: "session-a" } },
  );
  await waitFor(() => expect(hook.result.current.agentRef?.slug).toBe("alpha"));
  return { ...hook, renders };
}

async function moveTo(
  hook: { rerender: (props: { sessionId: string }) => void; result: { current: UseSessionPageFlowReturn } },
  sessionId: string,
  agent: string,
) {
  hook.rerender({ sessionId });
  await waitFor(() => expect(hook.result.current.conv.session?.metadata?.id).toBe(sessionId));
  await waitFor(() => expect(hook.result.current.agentRef?.slug).toBe(agent));
}

describe("useSessionPageFlow — a conversation switch starts from the new conversation's own settings", () => {
  it.each([
    ["with no fetch cache mounted", null],
    ["under a fetch cache", new FetchCache()],
  ] as const)("shows B's agent and sends B's untouched follow-up with no session update (%s)", async (_name, cache) => {
    const { client, update, runSend } = storedClient();
    const page = await onA(client, cache);

    const from = page.renders.length;
    await moveTo(page, "session-b", "beta");
    const onB = page.renders.slice(from).filter((render) => render.sessionId === "session-b");
    expect(onB.map((render) => render.agent)).not.toContain("alpha");

    await act(async () => {
      await page.result.current.handleSubmit("follow-up on B");
    });
    await waitFor(() => expect(runSend).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });

  it("sends no agent clear in B for an agent dropped in A", async () => {
    const { client, update, runSend } = storedClient();
    const page = await onA(client);
    act(() => page.result.current.clearAgent());
    expect(page.result.current.agentRef).toBeNull();

    await moveTo(page, "session-b", "beta");
    await act(async () => {
      await page.result.current.handleSubmit("follow-up on B");
    });
    await waitFor(() => expect(runSend).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });

  it("carries no Plan/Agent override, model-default pick or auto-approve from A to B", async () => {
    const { client } = storedClient({ "session-b": [B_RUN] });
    const page = await onA(client);
    act(() => {
      page.result.current.interactionMode[1]("plan");
      page.result.current.clearModelPick();
      page.result.current.setAutoApproveAll(true);
    });
    expect(page.result.current.interactionMode[0]).toBe("plan");
    expect(page.result.current.autoApproveAll).toBe(true);

    await moveTo(page, "session-b", "beta");
    await waitFor(() => expect(page.result.current.allRuns).toHaveLength(1));
    expect(page.result.current.interactionMode[0]).toBe("agent");
    expect(page.result.current.model[0]).toBe("model-b");
    expect(page.result.current.autoApproveAll).toBe(false);
  });

  it("seeds A fresh on return: its earlier choices are not resurrected", async () => {
    const { client, update, runSend } = storedClient();
    const page = await onA(client, new FetchCache());
    act(() => {
      page.result.current.setAgentRef({ org: "org_acme", slug: "gamma", kind: AGENT_KIND });
      page.result.current.setResolution({ mode: "direct" });
      page.result.current.interactionMode[1]("plan");
      page.result.current.setAutoApproveAll(true);
    });
    expect(page.result.current.agentRef?.slug).toBe("gamma");

    await moveTo(page, "session-b", "beta");
    await moveTo(page, "session-a", "alpha");
    expect(page.result.current.interactionMode[0]).toBe("agent");
    expect(page.result.current.autoApproveAll).toBe(false);

    await act(async () => {
      await page.result.current.handleSubmit("follow-up back on A");
    });
    await waitFor(() => expect(runSend).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });
});
