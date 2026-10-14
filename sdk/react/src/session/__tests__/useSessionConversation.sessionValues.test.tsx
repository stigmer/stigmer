/**
 * A follow-up's vault pick reaches the conversation by a session update
 * before the run is created, never on the run: a picked vault list and
 * `includeMyVault` replace the stored ones, and an update that changes
 * neither echoes the stored `includeMyVault` (the update replaces the whole
 * spec). Replacement workspace entries keep a repository's stored token
 * (its redaction marker, which the server reads as "keep the stored
 * value") when they keep the repository by name and URL. A follow-up with
 * none of these leaves the session alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sentRefs, sentUpdate } from "../../internal/__tests__/sent-update";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useSessionConversation } from "../useSessionConversation";
import { sessionEventStream } from "./session-event-stream";

const MARKER = "***REDACTED***";

const STORED = create(SessionSchema, {
  metadata: { id: "session-1", org: "org_acme", name: "s" },
  spec: {
    includeMyVault: true,
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

/** The git repositories a sent session's workspace names, as plain values. */
function repositoriesOf(session: Session): Array<{ name: string; url: string; branch: string; token: string }> {
  return (session.spec?.workspaceEntries ?? []).flatMap((entry) =>
    entry.source?.source.case === "gitRepo"
      ? [{ name: entry.name, url: entry.source.source.value.url, branch: entry.source.source.value.branch, token: entry.source.source.value.token }]
      : [],
  );
}
let sessionUpdate: ReturnType<typeof vi.fn>;
let runCreate: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const client = {
    session: { get: vi.fn(() => Promise.resolve(stored)), update: sessionUpdate, streamEvents: sessionEventStream().streamEvents },
    run: {
      listBySession: vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
      // The sent turn's run, read while it is live; never answered here.
      get: vi.fn(() => new Promise(() => {})),
      create: runCreate,
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

describe("useSessionConversation — a follow-up's vault pick and repository tokens", () => {
  beforeEach(() => {
    stored = STORED;
    sessionUpdate = vi.fn().mockResolvedValue(STORED);
    runCreate = vi.fn().mockResolvedValue({ metadata: { id: "aex_1" }, spec: {} });
  });

  it("writes the person's pick by a session update, not on the run", async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go", { includeMyVault: false, vaults: [] });
    });

    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    const sent = sentUpdate<Session>(sessionUpdate);
    expect(sent.paths).toEqual(["spec.vaults", "spec.include_my_vault"]);
    expect(sent.resource.spec?.includeMyVault).toBe(false);
    expect(sent.resource.spec?.vaults).toEqual([]);
    const runInput = runCreate.mock.calls[0][0];
    expect(runInput).not.toHaveProperty("runtimeEnv");
    expect(runInput).not.toHaveProperty("vaults");
  });

  it("replaces the vault list when the person picked one, keeping the stored My vault tick", async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go", { vaults: [{ org: "org_acme", slug: "billing" }] });
    });

    // The vaults alone: the stored My vault tick is not named, so it stays.
    const sent = sentUpdate<Session>(sessionUpdate);
    expect(sent.paths).toEqual(["spec.vaults"]);
    expect(sentRefs(sent.resource.spec?.vaults)).toEqual([{ org: "org_acme", slug: "billing" }]);
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

    const sent = sentUpdate<Session>(sessionUpdate);
    expect(sent.paths).toEqual(["spec.workspace_entries"]);
    expect(repositoriesOf(sent.resource)).toEqual([
      { name: "acme/api", url: "https://github.com/acme/api.git", branch: "main", token: MARKER },
      { name: "acme/web", url: "https://github.com/acme/web.git", branch: "", token: "" },
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

    expect(repositoriesOf(sentUpdate<Session>(sessionUpdate).resource)[0]?.token).toBe("");
    expect(repositoriesOf(sentUpdate<Session>(sessionUpdate, 1).resource)[0]?.token).toBe("fresh");
  });

  it("leaves the session alone when a follow-up carries none of them", async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go");
    });

    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(runCreate).toHaveBeenCalledTimes(1);
  });
});
