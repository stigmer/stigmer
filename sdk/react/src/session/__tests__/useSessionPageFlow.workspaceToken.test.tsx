/**
 * A console follow-up never destroys what the conversation holds: the page
 * loads each stored repository under its stored name (and no File as a
 * workspace entry), and a follow-up that rewrites the edited workspace
 * echoes the stored token's redaction marker, which the server reads as
 * "keep the stored value", and keeps the stored Files. The composer's Files
 * ride the run, released once it exists.
 */
import { describe, it, expect, vi } from "vitest";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema, type Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { useSessionPageFlow } from "../useSessionPageFlow";
import { sessionEventStream } from "./session-event-stream";

const MARKER = "***REDACTED***";

const STORED = create(SessionSchema, {
  metadata: { id: "session-1", org: "org_acme", name: "s" },
  spec: {
    resources: [
      {
        name: "backend",
        resource: {
          case: "gitRepository",
          value: { url: "https://github.com/acme/api.git", branch: "main", token: MARKER },
        },
      },
      { resource: { case: "file", value: { fileId: "file_brief", mountPath: "" } } },
    ],
  },
});

describe("useSessionPageFlow — a stored repository token", () => {
  it("is kept by a follow-up that edits the workspace: the entry keeps its name and echoes the marker", async () => {
    const sessionUpdate = vi.fn().mockResolvedValue(STORED);
    const runSend = vi.fn().mockResolvedValue({ metadata: { id: "run_1" }, spec: {} });
    const releaseFiles = vi.fn().mockResolvedValue(undefined);
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
    await waitFor(() => expect(result.current.workspace.hasEntries).toBe(true));
    expect(result.current.workspace.entries.map((entry) => entry.name)).toEqual(["backend"]);

    act(() => result.current.workspace.addLocalPath("/Users/dev/site"));
    await act(async () => {
      await result.current.handleSubmit("go", undefined, { fileIds: ["file_new"], releaseFiles });
    });

    await waitFor(() => expect(sessionUpdate).toHaveBeenCalledTimes(1));
    const resources = sentUpdate<Session>(sessionUpdate).resource.spec?.resources ?? [];
    expect(resources.map((entry) => entry.resource.case)).toEqual(["gitRepository", "localPath", "file"]);
    expect(resources[0]?.name).toBe("backend");
    expect(resources[0]?.resource).toMatchObject({
      case: "gitRepository",
      value: { url: "https://github.com/acme/api.git", branch: "main", token: MARKER },
    });
    expect(resources[2]?.resource).toMatchObject({ case: "file", value: { fileId: "file_brief" } });
    expect(runSend.mock.calls[0][0].fileIds).toEqual(["file_new"]);
    expect(releaseFiles).toHaveBeenCalledTimes(1);
  });

  it("loads a stored folder as a local workspace entry", async () => {
    const withFolder = create(SessionSchema, {
      metadata: { id: "session-1", org: "org_acme", name: "s" },
      spec: {
        resources: [{ name: "dev/site", resource: { case: "localPath", value: { path: "/Users/dev/site" } } }],
      },
    });
    const client = {
      session: { get: vi.fn().mockResolvedValue(withFolder), update: vi.fn(), streamEvents: sessionEventStream().streamEvents },
      run: { listBySession: vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }) },
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
    expect(result.current.workspace.entries[0]).toMatchObject({ type: "local", localPath: "/Users/dev/site" });
  });
});
