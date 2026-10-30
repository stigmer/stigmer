/**
 * A console follow-up writes only the session fields the person changed
 * (stigmer/stigmer#2028). An untouched follow-up sends the message alone,
 * so a repository pinned to a commit, with an explicit write-back mode,
 * keeps both; an edited workspace keeps every stored field of each entry
 * it keeps, and a stored folder keeps its name (its directory); an emptied
 * workspace is cleared. Once the server holds what the page shows, the
 * field is clean again; a refused write leaves it changed. The page loads
 * these fields for the conversation it shows, and moving to another
 * conversation never carries the previous one's along.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { clone, create } from "@bufbuild/protobuf";
import { SessionSchema, type Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { GitWriteBackMode } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { useSessionPageFlow } from "../useSessionPageFlow";
import { sessionEventStream } from "./session-event-stream";

const MARKER = "***REDACTED***";
const PINNED = "4f2a9c1e";

const STORED = create(SessionSchema, {
  metadata: { id: "session-1", org: "org_acme", name: "s" },
  spec: {
    resources: [
      {
        name: "backend",
        resource: {
          case: "gitRepository",
          value: {
            url: "https://github.com/acme/api.git",
            branch: "main",
            commit: PINNED,
            writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
            token: MARKER,
          },
        },
      },
      // Not the name the path derives ("projects/site"): the stored name is the folder's directory.
      { name: "site", resource: { case: "localPath", value: { path: "/Users/dev/projects/site" } } },
      { resource: { case: "file", value: { fileId: "file_brief", mountPath: "" } } },
    ],
    plugins: [{ org: "org_acme", slug: "linear" }],
    skillRefs: [{ org: "org_acme", slug: "triage" }],
  },
});

const OTHER = create(SessionSchema, {
  metadata: { id: "session-2", org: "org_acme", name: "t" },
  spec: {
    resources: [
      { name: "web", resource: { case: "gitRepository", value: { url: "https://github.com/acme/web.git", branch: "dev" } } },
    ],
  },
});

/** Update mask paths and the spec field each replaces. */
const SPEC_FIELDS: Record<string, "resources" | "plugins" | "skillRefs"> = {
  "spec.resources": "resources",
  "spec.plugins": "plugins",
  "spec.skill_refs": "skillRefs",
};

/**
 * A client whose sessions are stored: a read answers what is held, and an
 * update replaces the fields its paths name, as the server does. `refuse`
 * makes the next update fail.
 */
function storedClient(...sessions: Session[]) {
  const held = new Map(sessions.map((session) => [session.metadata!.id, session]));
  let refuseNext = false;
  const update = vi.fn(async (resource: Session, paths: string[]) => {
    if (refuseNext) {
      refuseNext = false;
      throw new Error("unavailable");
    }
    const id = resource.metadata!.id;
    const next = clone(SessionSchema, held.get(id)!);
    for (const path of paths) {
      const field = SPEC_FIELDS[path];
      if (field !== undefined) (next.spec![field] as unknown) = resource.spec![field];
    }
    held.set(id, next);
    return next;
  });
  const runSend = vi.fn().mockResolvedValue({ metadata: { id: "run_1" }, spec: {} });
  const client = {
    session: {
      get: vi.fn(async (id: string) => held.get(id)!),
      update,
      streamEvents: sessionEventStream().streamEvents,
    },
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
  return { wrapper, update, runSend, refuse: () => { refuseNext = true; } };
}

async function loaded(wrapper: (props: { children: ReactNode }) => ReactNode, audience?: "guest") {
  const hook = renderHook(
    () => useSessionPageFlow({ sessionId: "session-1", org: "org_acme", audience }),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.workspace.entries).toHaveLength(2));
  await waitFor(() => expect(hook.result.current.pluginRefs).toHaveLength(1));
  return hook;
}

describe("useSessionPageFlow — a follow-up writes only what the person changed", () => {
  it("sends an untouched follow-up as the message alone", async () => {
    const { wrapper, update, runSend } = storedClient(STORED);
    const { result } = await loaded(wrapper);

    await act(async () => {
      await result.current.handleSubmit("go");
    });

    await waitFor(() => expect(runSend).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps every stored field of each entry an edited workspace keeps", async () => {
    const { wrapper, update } = storedClient(STORED);
    const { result } = await loaded(wrapper);
    expect(result.current.workspace.entries.map((entry) => entry.name)).toEqual(["backend", "site"]);

    act(() => result.current.workspace.addLocalPath("/Users/dev/projects/docs"));
    await act(async () => {
      await result.current.handleSubmit("go");
    });

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = sentUpdate<Session>(update);
    expect(sent.paths).toEqual(["spec.resources"]);
    const resources = sent.resource.spec?.resources ?? [];
    expect(resources.map((entry) => entry.name)).toEqual(["backend", "site", "projects/docs", ""]);
    expect(resources[0]?.resource).toMatchObject({
      case: "gitRepository",
      value: {
        url: "https://github.com/acme/api.git",
        branch: "main",
        commit: PINNED,
        writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
        token: MARKER,
      },
    });
    expect(resources[1]?.resource).toMatchObject({ case: "localPath", value: { path: "/Users/dev/projects/site" } });
    expect(resources[3]?.resource).toMatchObject({ case: "file", value: { fileId: "file_brief" } });
  });

  it("clears the workspace when every entry is removed, keeping the Files", async () => {
    const { wrapper, update } = storedClient(STORED);
    const { result } = await loaded(wrapper);

    for (const entry of result.current.workspace.entries) {
      act(() => result.current.workspace.remove(entry.id));
    }
    await act(async () => {
      await result.current.handleSubmit("go");
    });

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const resources = sentUpdate<Session>(update).resource.spec?.resources ?? [];
    expect(resources.map((entry) => entry.resource.case)).toEqual(["file"]);
  });

  it("writes an edit once: after the server holds it, the next follow-up sends none", async () => {
    const { wrapper, update, runSend } = storedClient(STORED);
    const { result } = await loaded(wrapper);

    act(() => result.current.workspace.addLocalPath("/Users/dev/projects/docs"));
    await act(async () => {
      await result.current.handleSubmit("go");
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runSend).toHaveBeenCalledTimes(1));

    // The refetch that follows the write: the page now matches the read.
    await waitFor(() => expect(result.current.conv.resources).toHaveLength(4));
    await act(async () => {
      await result.current.handleSubmit("again");
    });

    await waitFor(() => expect(runSend).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("writes an edit again when the write was refused", async () => {
    const { wrapper, update, runSend, refuse } = storedClient(STORED);
    const { result } = await loaded(wrapper);

    act(() => result.current.workspace.addLocalPath("/Users/dev/projects/docs"));
    refuse();
    await act(async () => {
      await result.current.handleSubmit("go");
    });
    await waitFor(() => expect(result.current.conv.sendError).not.toBeNull());
    expect(runSend).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleSubmit("go");
    });

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    const resources = sentUpdate<Session>(update, 1).resource.spec?.resources ?? [];
    expect(resources.map((entry) => entry.name)).toEqual(["backend", "site", "projects/docs", ""]);
  });

  it("loads the next conversation's fields when the page moves to it", async () => {
    const { wrapper, update, runSend } = storedClient(STORED, OTHER);
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionPageFlow({ sessionId, org: "org_acme" }),
      { wrapper, initialProps: { sessionId: "session-1" } },
    );
    await waitFor(() => expect(result.current.workspace.entries).toHaveLength(2));
    await waitFor(() => expect(result.current.pluginRefs).toHaveLength(1));

    rerender({ sessionId: "session-2" });

    await waitFor(() =>
      expect(result.current.workspace.entries.map((entry) => entry.name)).toEqual(["web"]),
    );
    expect(result.current.workspace.entries[0]).toMatchObject({ gitUrl: "https://github.com/acme/web.git", gitBranch: "dev" });
    expect(result.current.pluginRefs).toEqual([]);
    expect(result.current.skillRefs).toEqual([]);

    await act(async () => {
      await result.current.handleSubmit("go");
    });

    await waitFor(() => expect(runSend).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });

  it("sends a guest's follow-up with no session update", async () => {
    const { wrapper, update, runSend } = storedClient(STORED);
    const { result } = await loaded(wrapper, "guest");

    await act(async () => {
      await result.current.handleSubmit("go");
    });

    await waitFor(() => expect(runSend).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });
});
