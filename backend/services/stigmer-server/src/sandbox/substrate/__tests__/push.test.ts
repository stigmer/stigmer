/**
 * Pins the attach push (push.ts): one POST through the router addressed by
 * `ate-target-actor`, carrying the queue and the secrets; a router that is
 * not ready yet (502, 503, 504, or no connection) retried within its
 * window; a waiter refusal returned at once with its code; a router that
 * never answers an error naming the actor.
 */
import { describe, expect, it } from "vitest";

import { pushAttach } from "../push.js";

const request = {
  routerUrl: "http://router.example:18200",
  atespace: "stigmer",
  actor: "sbx-ses-0123456789ab",
  taskQueue: "session:ses_1",
  secrets: { STIGMER_TOKEN: "tok" },
};

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe("pushAttach", () => {
  it("posts the queue and secrets to /attach, addressed to the actor", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const result = await pushAttach(request, {
      ...clock(),
      fetch: (async (url: string, init?: RequestInit) => {
        seen = { url, init };
        return new Response(
          JSON.stringify({ taskQueue: "session:ses_1", started: true }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    expect(result).toEqual({ ok: true, started: true });
    expect(seen?.url).toBe("http://router.example:18200/attach");
    expect(new Headers(seen?.init?.headers).get("ate-target-actor")).toBe(
      "stigmer/sbx-ses-0123456789ab",
    );
    expect(JSON.parse(String(seen?.init?.body))).toEqual({
      taskQueue: "session:ses_1",
      secrets: { STIGMER_TOKEN: "tok" },
    });
  });

  it("retries a router that is not ready, then succeeds", async () => {
    const answers = [503, 502, 504, 200];
    let calls = 0;
    const result = await pushAttach(request, {
      ...clock(),
      fetch: (async () => {
        const status = answers[calls] ?? 200;
        calls += 1;
        if (calls === 2) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ started: false }), { status });
      }) as typeof fetch,
    });
    expect(result).toEqual({ ok: true, started: false });
    expect(calls).toBe(4);
  });

  it("returns a waiter refusal at once, with its code", async () => {
    let calls = 0;
    const result = await pushAttach(request, {
      ...clock(),
      fetch: (async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ code: "secrets_changed", error: "X differs" }),
          { status: 409 },
        );
      }) as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      status: 409,
      code: "secrets_changed",
      error: "X differs",
    });
    expect(calls).toBe(1);
  });

  it("returns the last not-ready answer when the window closes, and throws when nothing ever answered", async () => {
    const unready = await pushAttach(request, {
      ...clock(),
      fetch: (async () =>
        new Response("upstream connect error", {
          status: 503,
        })) as typeof fetch,
    });
    expect(unready).toEqual({
      ok: false,
      status: 503,
      code: "",
      error: "upstream connect error",
    });
    await expect(
      pushAttach(request, {
        ...clock(),
        fetch: (async () => {
          throw new TypeError("fetch failed");
        }) as typeof fetch,
      }),
    ).rejects.toThrow(/could not reach the router: fetch failed/);
  });
});
