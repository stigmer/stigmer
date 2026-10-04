import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  SessionSchema,
  type Session,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useSessionConversation } from "../useSessionConversation";

// ---------------------------------------------------------------------------
// The session writes that touch the agent version a conversation runs.
//
// The server pins the version on the session and moves it only when a write
// says so: `version: "latest"` moves it to the agent's current version, and an
// unchanged agent with no version keeps the pin. So the one explicit act,
// moveToCurrentAgentVersion, writes `latest`; every other rewrite of the
// session (workspace, tools) echoes the agent without a stored `latest`, or a
// later edit would silently move the conversation to whatever the author
// saved last. Pinned here because both directions change what a person's
// conversation runs.
// ---------------------------------------------------------------------------

function sessionOnAgent(version: string): Session {
  return create(SessionSchema, {
    metadata: { id: "session-1", org: "org_acme", name: "s" },
    spec: {
      agentRef: { org: "org_acme", slug: "reviewer", version, kind: 40 },
    },
    status: { agentId: "agt_1", agentVersionHash: "h_old" },
  });
}

let sessionGet: ReturnType<typeof vi.fn>;
let sessionUpdate: ReturnType<typeof vi.fn>;
let executionCreate: ReturnType<typeof vi.fn>;

function client(): Stigmer {
  return {
    session: { get: sessionGet, update: sessionUpdate },
    agentExecution: {
      listBySession: vi.fn().mockResolvedValue({ entries: [] }),
      create: executionCreate,
      subscribe: vi.fn(),
    },
    identityAccount: { whoAmI: vi.fn().mockRejectedValue(new Error("none")) },
  } as unknown as Stigmer;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StigmerContext.Provider value={client()}>
      {children}
    </StigmerContext.Provider>
  );
}

async function loaded() {
  const hook = renderHook(
    () => useSessionConversation("session-1", "org_acme"),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.session).not.toBeNull());
  return hook;
}

describe("useSessionConversation — the agent version a session runs", () => {
  beforeEach(() => {
    sessionGet = vi.fn().mockResolvedValue(sessionOnAgent(""));
    sessionUpdate = vi.fn().mockImplementation(async () => sessionOnAgent(""));
    executionCreate = vi
      .fn()
      .mockResolvedValue({ metadata: { id: "aex_1" }, spec: {} });
  });

  it("moveToCurrentAgentVersion writes the session's agent back with version latest and reads it again", async () => {
    const { result } = await loaded();
    const readsBefore = sessionGet.mock.calls.length;

    await act(async () => {
      await result.current.moveToCurrentAgentVersion();
    });

    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    const input = sessionUpdate.mock.calls[0][0];
    expect(input.agentRef).toMatchObject({
      org: "org_acme",
      slug: "reviewer",
      version: "latest",
    });
    // Nothing but the version moves: the rest of the spec is the stored one.
    expect(input.org).toBe("org_acme");
    // The fresh read before the write, and the reload after it.
    await waitFor(() =>
      expect(sessionGet.mock.calls.length).toBeGreaterThanOrEqual(
        readsBefore + 2,
      ),
    );
  });

  it("moveToCurrentAgentVersion does nothing for a session that names no agent", async () => {
    sessionGet.mockResolvedValue(
      create(SessionSchema, { metadata: { id: "session-1" }, spec: {} }),
    );
    const { result } = await loaded();

    await act(async () => {
      await result.current.moveToCurrentAgentVersion();
    });

    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it("moveToCurrentAgentVersion reads and writes nothing without a session", async () => {
    const { result } = renderHook(
      () => useSessionConversation(null, "org_acme"),
      { wrapper },
    );

    await act(async () => {
      await result.current.moveToCurrentAgentVersion();
    });

    expect(sessionGet).not.toHaveBeenCalled();
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it("a follow-up that rewrites the session echoes a stored latest without its version, keeping the pin", async () => {
    sessionGet.mockResolvedValue(sessionOnAgent("latest"));
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go on", {
        skillRefs: [{ org: "org_acme", slug: "triage" }],
      });
    });

    const input = sessionUpdate.mock.calls[0][0];
    expect(input.agentRef).toEqual({
      org: "org_acme",
      slug: "reviewer",
      kind: 40,
    });
  });

  it("a follow-up echoes a stored tag as stored", async () => {
    sessionGet.mockResolvedValue(sessionOnAgent("v2"));
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go on", {
        skillRefs: [{ org: "org_acme", slug: "triage" }],
      });
    });

    expect(sessionUpdate.mock.calls[0][0].agentRef).toMatchObject({
      version: "v2",
    });
  });

  it("a follow-up that moves to another agent names it, and null clears the agent", async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("switch", {
        agentRef: { org: "org_acme", slug: "other" },
      });
    });
    expect(sessionUpdate.mock.calls[0][0].agentRef).toEqual({
      org: "org_acme",
      slug: "other",
    });

    await act(async () => {
      await result.current.sendFollowUp("drop", { agentRef: null });
    });
    expect(sessionUpdate.mock.calls[1][0].agentRef).toBeUndefined();
  });

  it("a plain follow-up writes nothing to the session", async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("hello");
    });

    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(executionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", org: "org_acme" }),
    );
  });
});
