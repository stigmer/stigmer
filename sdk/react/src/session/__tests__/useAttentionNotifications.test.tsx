/**
 * Pins useAttentionNotifications (../useAttentionNotifications.ts): it
 * follows the organization's attention while enabled, and asks its host to
 * show one notice per attention, in the person's words, never for a
 * conversation the person is looking at; it follows nothing while disabled
 * or with no organization, and stops when it unmounts.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AttentionSchema, type Attention, type StreamAttentionRequest } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { noticeOf, useAttentionNotifications, type AttentionNotice } from "../useAttentionNotifications";

function attention(id: string, sessionId: string, reason: string, title = `title ${sessionId}`): Attention {
  return create(AttentionSchema, { id, sessionId, reason, title, cursor: `c-${id}` });
}

/** A client whose attention stream sends `sent`, then holds open until aborted. */
function client(sent: Attention[]) {
  const requests: StreamAttentionRequest[] = [];
  let aborted = false;
  const stigmer = {
    session: {
      async *streamAttention(input: StreamAttentionRequest, signal?: AbortSignal) {
        requests.push(input);
        yield* sent;
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
        aborted = true;
      },
    },
  } as unknown as Stigmer;
  return { stigmer, requests, wasAborted: () => aborted };
}

function wrapper(stigmer: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>;
  };
}

describe("useAttentionNotifications", () => {
  it("asks the host to show one notice per attention, in the person's words, but not for a conversation in view", async () => {
    const { stigmer, requests } = client([
      attention("a", "s1", "finished"),
      attention("b", "s2", "failed"),
      attention("c", "open", "needs_answer"),
      attention("d", "s3", "needs_answer", ""),
    ]);
    const shown: AttentionNotice[] = [];
    renderHook(
      () =>
        useAttentionNotifications({
          org: "acme",
          enabled: true,
          notify: (notice) => shown.push(notice),
          isShowing: (sessionId) => sessionId === "open",
        }),
      { wrapper: wrapper(stigmer) },
    );
    await waitFor(() => expect(shown).toHaveLength(3));
    expect(shown.map((notice) => [notice.sessionId, notice.title, notice.body])).toEqual([
      ["s1", "title s1", "Finished"],
      ["s2", "title s2", "Stopped with an error"],
      ["s3", "Conversation", "Waits for your answer"],
    ]);
    expect(requests[0]?.org).toBe("acme");
  });

  it("follows nothing while disabled or with no organization, and stops when it unmounts", async () => {
    const off = client([attention("a", "s1", "finished")]);
    const notify = vi.fn();
    renderHook(() => useAttentionNotifications({ org: "acme", enabled: false, notify }), { wrapper: wrapper(off.stigmer) });
    renderHook(() => useAttentionNotifications({ org: null, enabled: true, notify }), { wrapper: wrapper(off.stigmer) });
    expect(off.requests).toHaveLength(0);

    const on = client([]);
    const { unmount } = renderHook(() => useAttentionNotifications({ org: "acme", enabled: true, notify }), {
      wrapper: wrapper(on.stigmer),
    });
    await waitFor(() => expect(on.requests).toHaveLength(1));
    unmount();
    await waitFor(() => expect(on.wasAborted()).toBe(true));
    expect(notify).not.toHaveBeenCalled();
  });

  it("logs a follow that ends refused, and shows nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stigmer = {
      session: {
        // eslint-disable-next-line require-yield
        async *streamAttention() {
          throw new ConnectError("denied", Code.PermissionDenied);
        },
      },
    } as unknown as Stigmer;
    const notify = vi.fn();
    renderHook(() => useAttentionNotifications({ org: "acme", enabled: true, notify }), { wrapper: wrapper(stigmer) });
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(notify).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("makes no notice of a reason it does not know", () => {
    expect(noticeOf(attention("x", "s1", "something-new"))).toBeUndefined();
  });
});
