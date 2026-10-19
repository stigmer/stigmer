/**
 * A follow-up's vault pick reaches the conversation by a session update
 * before the run is created, never on the run: a picked vault list and
 * `includeMyVault` replace the stored ones, and an update that changes
 * neither echoes the stored `includeMyVault` (the update replaces the whole
 * spec). Replacement resources keep a repository's stored token (its
 * redaction marker, which the server reads as "keep the stored value")
 * when they keep the repository by name and URL, and keep the
 * conversation's stored Files, which the workspace picker never holds. An
 * update that replaces the resources carries the etag of the read it was
 * built from: refused as stale, it is read and built again, a bounded number
 * of times, so a File another run added meanwhile is kept; any other update
 * carries no etag. The message's Files ride the run, and the originals are released only once
 * the run exists. A follow-up with none of these leaves the session alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { sentRefs, sentUpdate } from "../../internal/__tests__/sent-update";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { clone, create } from "@bufbuild/protobuf";
import { SessionSchema, type Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { useSessionConversation } from "../useSessionConversation";
import { sessionEventStream } from "./session-event-stream";

const MARKER = "***REDACTED***";

const STORED = create(SessionSchema, {
  metadata: { id: "session-1", org: "org_acme", name: "s", etag: "etag_1" },
  spec: {
    includeMyVault: true,
    vaults: [{ org: "org_acme", slug: "support-tools", kind: 59 }],
  },
});

const WITH_REPOSITORY_TOKEN = create(SessionSchema, {
  metadata: { id: "session-1", org: "org_acme", name: "s", etag: "etag_1" },
  spec: {
    resources: [
      {
        name: "acme/api",
        resource: {
          case: "gitRepository",
          value: { url: "https://github.com/acme/api.git", branch: "main", token: MARKER },
        },
      },
      { resource: { case: "file", value: { fileId: "file_brief", mountPath: "brief.pdf" } } },
    ],
  },
});

let stored = STORED;

/** The server's refusal of an update whose etag is not the stored one. */
function staleEtag(): ConnectError {
  return new ConnectError("Session 'org_acme/s' changed since you read it", Code.Aborted, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason: "ETAG_MISMATCH", metadata: {} } },
  ]);
}

/** `session` as another participant's run leaves it: one more File, and a new etag. */
function withFileAdded(session: Session, fileId: string, etag: string): Session {
  const changed = clone(SessionSchema, session);
  if (changed.metadata) changed.metadata.etag = etag;
  changed.spec?.resources.push(
    create(SessionResourceSchema, { resource: { case: "file", value: { fileId, mountPath: `${fileId}.txt` } } }),
  );
  return changed;
}

/** The git repositories a sent session's resources name, as plain values. */
function repositoriesOf(session: Session): Array<{ name: string; url: string; branch: string; token: string }> {
  return (session.spec?.resources ?? []).flatMap((entry) =>
    entry.resource.case === "gitRepository"
      ? [{ name: entry.name, url: entry.resource.value.url, branch: entry.resource.value.branch, token: entry.resource.value.token }]
      : [],
  );
}

/** The Files a sent session's resources name, as plain values. */
function filesOf(session: Session): Array<{ fileId: string; mountPath: string }> {
  return (session.spec?.resources ?? []).flatMap((entry) =>
    entry.resource.case === "file"
      ? [{ fileId: entry.resource.value.fileId, mountPath: entry.resource.value.mountPath }]
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
    // No resources are written back, so a subject written since must not refuse it.
    expect(sent.etag).toBe("");
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
        resources: [
          { name: "acme/api", gitRepository: { url: "https://github.com/acme/api.git", branch: "main" } },
          { name: "acme/web", gitRepository: { url: "https://github.com/acme/web.git" } },
        ],
      });
    });

    const sent = sentUpdate<Session>(sessionUpdate);
    expect(sent.paths).toEqual(["spec.resources"]);
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
        resources: [
          { name: "acme/api", gitRepository: { url: "https://git.example.com/acme/api.git" } },
        ],
      });
    });
    await act(async () => {
      await result.current.sendFollowUp("again", {
        resources: [
          { name: "acme/api", gitRepository: { url: "https://github.com/acme/api.git", token: "fresh" } },
        ],
      });
    });

    expect(repositoriesOf(sentUpdate<Session>(sessionUpdate).resource)[0]?.token).toBe("");
    expect(repositoriesOf(sentUpdate<Session>(sessionUpdate, 1).resource)[0]?.token).toBe("fresh");
  });

  it("keeps the conversation's stored Files when the workspace is rewritten", async () => {
    stored = WITH_REPOSITORY_TOKEN;
    const { result } = await loaded();

    await act(async () => {
      await result.current.sendFollowUp("go", {
        resources: [{ name: "acme/web", gitRepository: { url: "https://github.com/acme/web.git" } }],
      });
    });

    const sent = sentUpdate<Session>(sessionUpdate);
    expect(sent.etag).toBe("etag_1");
    expect(repositoriesOf(sent.resource).map((r) => r.name)).toEqual(["acme/web"]);
    expect(filesOf(sent.resource)).toEqual([{ fileId: "file_brief", mountPath: "brief.pdf" }]);
  });

  it("reads again and keeps a File another run added when the update is refused as stale", async () => {
    stored = WITH_REPOSITORY_TOKEN;
    const { result } = await loaded();
    // Between this send's read and its update, another participant's run
    // adds a File; the update built from the older read is refused.
    sessionUpdate.mockImplementationOnce(() => {
      stored = withFileAdded(stored, "file_other", "etag_2");
      return Promise.reject(staleEtag());
    });

    await act(async () => {
      await result.current.sendFollowUp("go", {
        resources: [{ name: "acme/web", gitRepository: { url: "https://github.com/acme/web.git" } }],
      });
    });

    expect(sessionUpdate).toHaveBeenCalledTimes(2);
    expect(sentUpdate<Session>(sessionUpdate, 0).etag).toBe("etag_1");
    const retried = sentUpdate<Session>(sessionUpdate, 1);
    expect(retried.etag).toBe("etag_2");
    expect(filesOf(retried.resource)).toEqual([
      { fileId: "file_brief", mountPath: "brief.pdf" },
      { fileId: "file_other", mountPath: "file_other.txt" },
    ]);
    expect(result.current.sendError).toBeNull();
    expect(runCreate).toHaveBeenCalledTimes(1);
  });

  it("fails the send after three stale refusals, and creates no run", async () => {
    stored = WITH_REPOSITORY_TOKEN;
    const { result } = await loaded();
    sessionUpdate.mockRejectedValue(staleEtag());

    await act(async () => {
      await result.current.sendFollowUp("go", {
        resources: [{ name: "acme/web", gitRepository: { url: "https://github.com/acme/web.git" } }],
      });
    });

    expect(sessionUpdate).toHaveBeenCalledTimes(3);
    expect(result.current.sendError?.message).toMatch(/changed since you read it/);
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("does not retry an update refused for another reason", async () => {
    stored = WITH_REPOSITORY_TOKEN;
    const { result } = await loaded();
    sessionUpdate.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied));

    await act(async () => {
      await result.current.sendFollowUp("go", {
        resources: [{ name: "acme/web", gitRepository: { url: "https://github.com/acme/web.git" } }],
      });
    });

    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("names the message's Files on the run and releases them once it exists, never after a failed send", async () => {
    const { result } = await loaded();
    const releaseFiles = vi.fn().mockResolvedValue(undefined);
    const attachments = [{ fileId: "file_1", filename: "shot.png", kind: "image" as const }];

    runCreate.mockRejectedValueOnce(new Error("refused"));
    await act(async () => {
      await result.current.sendFollowUp("look", { fileIds: ["file_1"], attachments, releaseFiles });
    });
    expect(releaseFiles).not.toHaveBeenCalled();
    // The failed bubble keeps its chips: they are what Retry re-sends.
    expect(result.current.pendingAttachments).toEqual(attachments);

    await act(async () => {
      await result.current.sendFollowUp("look", { fileIds: ["file_1"], attachments, releaseFiles });
    });
    expect(runCreate.mock.calls[1][0].fileIds).toEqual(["file_1"]);
    expect(releaseFiles).toHaveBeenCalledTimes(1);
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
