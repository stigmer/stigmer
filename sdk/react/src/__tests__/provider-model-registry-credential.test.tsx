// Tests for the provider's model list when the host's sign-in comes late:
// a host whose user signs in after the page loads gets the list once a
// credential appears, without a reload (the provider keeps asking the host's
// token provider while the list was refused for lack of one), and a stack
// with no sign-in, whose tokenless read succeeds, never starts that wait.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "../provider";
import { useModelRegistry } from "../models/useModelRegistry";

const DOCUMENT = {
  models: [{ id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", provider: "anthropic", harness: "stigmer", costTier: "standard" }],
};

/** A client whose registry read answers 401 without a bearer, and the document with one. */
function makeClient(credential: () => string | null, opts: { tokenlessOk?: boolean } = {}) {
  const getAuthCredential = vi.fn(async () => credential());
  const fetch = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
    const authorized = init?.headers?.["Authorization"] !== undefined;
    if (!authorized && !opts.tokenlessOk) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => DOCUMENT };
  });
  const client = { baseUrl: "https://example.test", getAuthCredential, fetch } as unknown as Stigmer;
  return { client, getAuthCredential, fetch };
}

const seen: { count: number; error: Error | null }[] = [];

function Probe() {
  const { models, error } = useModelRegistry();
  seen.push({ count: models.length, error });
  return null;
}

/** Advance fake time in steps, letting each step's promises settle. */
async function elapse(ms: number, step = 250) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
  }
}

beforeEach(() => {
  seen.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StigmerProvider model list and a late sign-in", () => {
  it("fills the list once a credential appears after the first wait gave up", async () => {
    let token: string | null = null;
    const { client } = makeClient(() => token);
    render(
      <StigmerProvider client={client}>
        <Probe />
      </StigmerProvider>,
    );

    // Past the provider's first wait for a credential and its retries.
    await elapse(60_000);
    expect(seen.at(-1)?.count).toBe(0);
    expect(seen.at(-1)?.error).not.toBeNull();

    token = "host-user-token";
    await elapse(5_000);
    expect(seen.at(-1)?.count).toBe(1);
    expect(seen.at(-1)?.error).toBeNull();
  });

  it("keeps waiting through a token provider that throws, and reads once it hands a credential", async () => {
    let mode: "none" | "throw" | "token" = "none";
    const { client } = makeClient(() => {
      if (mode === "throw") throw new Error("host sign-in not ready");
      return mode === "token" ? "host-user-token" : null;
    });
    render(
      <StigmerProvider client={client}>
        <Probe />
      </StigmerProvider>,
    );

    await elapse(60_000);
    mode = "throw";
    await elapse(5_000);
    expect(seen.at(-1)?.count).toBe(0);

    mode = "token";
    await elapse(5_000);
    expect(seen.at(-1)?.count).toBe(1);
  });

  it("stops asking for a credential once the provider unmounts, even mid-ask", async () => {
    let answer: ((token: string | null) => void) | null = null;
    let deferred = false;
    const { client, getAuthCredential, fetch } = makeClient(() => null);
    getAuthCredential.mockImplementation(async () => (deferred ? new Promise<string | null>((resolve) => (answer = resolve)) : null));
    const view = render(
      <StigmerProvider client={client}>
        <Probe />
      </StigmerProvider>,
    );
    await elapse(60_000);

    // One ask is in flight when the provider unmounts; its late answer starts no read.
    deferred = true;
    await elapse(3_000);
    expect(answer).not.toBeNull();
    const reads = fetch.mock.calls.length;
    view.unmount();
    await act(async () => {
      answer?.("host-user-token");
    });
    const asked = getAuthCredential.mock.calls.length;
    await elapse(10_000);
    expect(fetch.mock.calls.length).toBe(reads);
    expect(getAuthCredential.mock.calls.length).toBe(asked);
  });

  it("stops asking for a credential once the provider unmounts between asks", async () => {
    const { client, getAuthCredential } = makeClient(() => null);
    const view = render(
      <StigmerProvider client={client}>
        <Probe />
      </StigmerProvider>,
    );
    await elapse(60_000);
    view.unmount();
    const asked = getAuthCredential.mock.calls.length;
    await elapse(10_000);
    expect(getAuthCredential.mock.calls.length).toBe(asked);
  });

  it("never waits for a credential when the tokenless read succeeds", async () => {
    const { client, getAuthCredential } = makeClient(() => null, { tokenlessOk: true });
    render(
      <StigmerProvider client={client}>
        <Probe />
      </StigmerProvider>,
    );

    await elapse(12_000);
    expect(seen.at(-1)?.count).toBe(1);
    const asked = getAuthCredential.mock.calls.length;
    await elapse(20_000);
    expect(getAuthCredential.mock.calls.length).toBe(asked);
  });

  it("never sends a refused credential again, and reads once the host hands a new one", async () => {
    let token = "expired-token";
    const getAuthCredential = vi.fn(async () => token);
    const sentWith: string[] = [];
    const fetch = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      const bearer = init?.headers?.["Authorization"] ?? "";
      sentWith.push(bearer);
      if (bearer !== "Bearer fresh-token") return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => DOCUMENT };
    });
    const client = { baseUrl: "https://example.test", getAuthCredential, fetch } as unknown as Stigmer;
    render(
      <StigmerProvider client={client}>
        <Probe />
      </StigmerProvider>,
    );

    // The host keeps handing the refused token: it is sent once, never again.
    await elapse(30_000);
    expect(sentWith.filter((bearer) => bearer === "Bearer expired-token")).toHaveLength(1);
    expect(seen.at(-1)?.count).toBe(0);
    expect(getAuthCredential.mock.calls.length).toBeGreaterThan(5);

    token = "fresh-token";
    await elapse(5_000);
    expect(seen.at(-1)?.count).toBe(1);
    expect(sentWith.at(-1)).toBe("Bearer fresh-token");
  });
});

