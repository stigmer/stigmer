/**
 * A console follow-up never destroys a repository token an integrator set
 * on the conversation: the page loads each stored repository under its
 * stored name, and the follow-up's workspace rewrite echoes the stored
 * token's redaction marker for it, which the server reads as "keep the
 * stored value".
 */
import { describe, it, expect, vi } from "vitest";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useSessionPageFlow } from "../useSessionPageFlow";
import { sessionEventStream } from "./session-event-stream";

const MARKER = "***REDACTED***";

const STORED = create(SessionSchema, {
  metadata: { id: "session-1", org: "org_acme", name: "s" },
  spec: {
    workspaceEntries: [
      {
        name: "backend",
        source: {
          source: {
            case: "gitRepo",
            value: { url: "https://github.com/acme/api.git", branch: "main", token: MARKER },
          },
        },
      },
    ],
  },
});

describe("useSessionPageFlow — a stored repository token", () => {
  it("is kept by a follow-up: the entry keeps its name and echoes the marker", async () => {
    const sessionUpdate = vi.fn().mockResolvedValue(STORED);
    const client = {
      session: { get: vi.fn().mockResolvedValue(STORED), update: sessionUpdate, streamEvents: sessionEventStream().streamEvents },
      run: {
        listBySession: vi.fn().mockResolvedValue({ entries: [] }),
        create: vi.fn().mockResolvedValue({ metadata: { id: "aex_1" }, spec: {} }),
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
    await waitFor(() => expect(result.current.workspace.hasEntries).toBe(true));
    expect(result.current.workspace.entries[0]?.name).toBe("backend");

    await act(async () => {
      await result.current.handleSubmit("go");
    });

    await waitFor(() => expect(sessionUpdate).toHaveBeenCalledTimes(1));
    const entries = sentUpdate<Session>(sessionUpdate).resource.spec?.workspaceEntries ?? [];
    expect(entries.map((entry) => entry.name)).toEqual(["backend"]);
    expect(entries[0]?.source?.source).toMatchObject({
      case: "gitRepo",
      value: { url: "https://github.com/acme/api.git", branch: "main", token: MARKER },
    });
  });
});
