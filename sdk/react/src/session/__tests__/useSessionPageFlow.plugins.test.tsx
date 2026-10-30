/**
 * A conversation's plugins survive the page: the page loads the plugins
 * (and the skills) a stored conversation lists into its picks, an
 * untouched console follow-up leaves them as stored, and a follow-up after
 * the last plugin is removed clears them, so a follow-up never drops a
 * plugin the person kept, nor keeps one they removed.
 */
import { describe, it, expect, vi } from "vitest";
import { sentRefs, sentUpdate } from "../../internal/__tests__/sent-update";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema, type Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { useSessionPageFlow } from "../useSessionPageFlow";
import { sessionEventStream } from "./session-event-stream";

const STORED = create(SessionSchema, {
  metadata: { id: "session-1", org: "org_acme", name: "s" },
  spec: { plugins: [{ org: "org_acme", slug: "linear" }], skillRefs: [{ org: "org_acme", slug: "triage" }] },
});

async function loaded() {
  const sessionUpdate = vi.fn().mockResolvedValue(STORED);
  const runSend = vi.fn().mockResolvedValue({ metadata: { id: "run_1" }, spec: {} });
  const client = {
    session: { get: vi.fn().mockResolvedValue(STORED), update: sessionUpdate, streamEvents: sessionEventStream().streamEvents },
    run: {
      listBySession: vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
      sendMessage: async (input: unknown) => ({ run: await runSend(input) }),
      // The sent turn's run, read while it is live; never answered here.
      get: vi.fn(() => new Promise(() => {})),
    },
    agent: { getByReference: vi.fn().mockResolvedValue(null) },
    identityAccount: { whoAmI: vi.fn().mockRejectedValue(new Error("none")) },
  } as unknown as Stigmer;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );

  const { result } = renderHook(
    () => useSessionPageFlow({ sessionId: "session-1", org: "org_acme" }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.pluginRefs).toHaveLength(1));
  return { result, sessionUpdate, runSend };
}

describe("useSessionPageFlow — a stored conversation's plugins", () => {
  it("are loaded into the picks and left as stored by an untouched follow-up", async () => {
    const { result, sessionUpdate, runSend } = await loaded();
    expect(result.current.pluginRefs[0]).toMatchObject({ org: "org_acme", slug: "linear" });
    expect(result.current.skillRefs[0]).toMatchObject({ org: "org_acme", slug: "triage" });

    await act(async () => {
      await result.current.handleSubmit("go");
    });

    await waitFor(() => expect(runSend).toHaveBeenCalledTimes(1));
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it("are cleared by a follow-up after the last plugin is removed", async () => {
    const { result, sessionUpdate } = await loaded();

    act(() => result.current.setPluginRefs([]));
    await act(async () => {
      await result.current.handleSubmit("go");
    });

    await waitFor(() => expect(sessionUpdate).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Session>(sessionUpdate);
    expect(sent.paths).toEqual(["spec.plugins"]);
    expect(sentRefs(sent.resource.spec?.plugins)).toEqual([]);
  });
});
