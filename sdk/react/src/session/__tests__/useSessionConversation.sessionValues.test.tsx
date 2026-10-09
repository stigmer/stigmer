/**
 * A follow-up's own secrets and vaults reach the conversation by a session
 * update before the run is created, never on the run: the update echoes the
 * stored secrets as their redaction markers (which the server reads as
 * "keep the stored value") and adds or replaces only the names sent; a
 * picked vault list replaces the stored one. Replacement workspace entries
 * keep a repository's stored token (its marker) when they keep the
 * repository by name and URL. A follow-up with neither leaves the session
 * alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useSessionConversation } from "../useSessionConversation";

const MARKER = "***REDACTED***";

const STORED = create(SessionSchema, {
  metadata: { id: "session-1", org: "org_acme", name: "s" },
  spec: {
    secrets: { CUSTOMER_API_KEY: MARKER },
    vaults: [{ org: "org_acme", slug: "support-tools", kind: 59 }],
  },
});

const WITH_REPOSITORY_TOKEN = create(SessionSchema, {
  metadata: { id: "session-1", org: "org_acme", name: "s" },
  spec: {
    workspaceEntries: [
      {
        name: "acme/api",
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

let stored = STORED;
let sessionUpdate: ReturnType<typeof vi.fn>;
let runCreate: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const client = {
    session: { get: vi.fn(() => Promise.resolve(stored)), update: sessionUpdate },
    run: {
      listBySession: vi.fn().mockResolvedValue({ entries: [] }),
      create: runCreate,
      subscribe: vi.fn(),
    },
    identityAccount: { whoAmI: vi.fn().mockRejectedValue(new Error("none")) },
  } as unknown as Stigmer;
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

async function loaded() {
  const hook = renderHook(() => useSessionConversation("session-1", "org_acme"), { wrapper });
  await waitFor(() => expect(hook.result.current.session).not.toBeNull());
  return hook;
}

describe("useSessionConversation — a follow-up's own values", () => {
  beforeEach(() => {
    stored = STORED;
    sessionUpdate = vi.fn().mockResolvedValue(STORED);
    runCreate = vi.fn().mockResolvedValue({ metadata: { id: "aex_1" }, spec: {} });
  });

  it("merges new secrets over the stored markers by a session update, not on the run", async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go", { secrets: { PLATFORM_TOKEN: "fresh" } });
    });

    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    expect(sessionUpdate.mock.calls[0][0].secrets).toEqual({
      CUSTOMER_API_KEY: MARKER,
      PLATFORM_TOKEN: "fresh",
    });
    const runInput = runCreate.mock.calls[0][0];
    expect(runInput).not.toHaveProperty("runtimeEnv");
    expect(runInput).not.toHaveProperty("secrets");
  });

  it("replaces the vault list when the person picked one", async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go", { vaults: [{ org: "org_acme", slug: "billing" }] });
    });

    expect(sessionUpdate.mock.calls[0][0].vaults).toEqual([{ org: "org_acme", slug: "billing" }]);
  });

  it("keeps a repository's stored token when the workspace sent omits it", async () => {
    stored = WITH_REPOSITORY_TOKEN;
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go", {
        workspaceEntries: [
          { name: "acme/api", source: { gitRepo: { url: "https://github.com/acme/api.git", branch: "main" } } },
          { name: "acme/web", source: { gitRepo: { url: "https://github.com/acme/web.git" } } },
        ],
      });
    });

    expect(sessionUpdate.mock.calls[0][0].workspaceEntries).toEqual([
      {
        name: "acme/api",
        source: { gitRepo: { url: "https://github.com/acme/api.git", branch: "main", token: MARKER } },
      },
      { name: "acme/web", source: { gitRepo: { url: "https://github.com/acme/web.git" } } },
    ]);
  });

  it("never carries a stored token to another URL, and a token sent wins", async () => {
    stored = WITH_REPOSITORY_TOKEN;
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go", {
        workspaceEntries: [
          { name: "acme/api", source: { gitRepo: { url: "https://git.example.com/acme/api.git" } } },
        ],
      });
    });
    await act(async () => {
      await result.current.sendFollowUp("again", {
        workspaceEntries: [
          { name: "acme/api", source: { gitRepo: { url: "https://github.com/acme/api.git", token: "fresh" } } },
        ],
      });
    });

    expect(sessionUpdate.mock.calls[0][0].workspaceEntries[0].source.gitRepo).not.toHaveProperty("token");
    expect(sessionUpdate.mock.calls[1][0].workspaceEntries[0].source.gitRepo.token).toBe("fresh");
  });

  it("leaves the session alone when a follow-up carries neither", async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go");
    });

    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(runCreate).toHaveBeenCalledTimes(1);
  });
});
