// Pins createRunnerAdapter: each session lifecycle event reaches the matching
// host worker call, the host's return value is swallowed, and the adapter
// awaits and propagates the host.

import { describe, it, expect, vi } from "vitest";
import {
  createRunnerAdapter,
  type RunnerWorkerHost,
} from "../runner-adapter";

function createMockHost(): RunnerWorkerHost & {
  addSession: ReturnType<typeof vi.fn>;
  removeSession: ReturnType<typeof vi.fn>;
} {
  return {
    addSession: vi.fn().mockResolvedValue(undefined),
    removeSession: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createRunnerAdapter", () => {
  it("returns an adapter with both session lifecycle methods", () => {
    const adapter = createRunnerAdapter(createMockHost());

    expect(adapter.onSessionOpened).toBeInstanceOf(Function);
    expect(adapter.onSessionClosed).toBeInstanceOf(Function);
  });

  it("maps onSessionOpened to host.addSession with the session id", async () => {
    const host = createMockHost();
    const adapter = createRunnerAdapter(host);

    await adapter.onSessionOpened("ses-123");

    expect(host.addSession).toHaveBeenCalledTimes(1);
    expect(host.addSession).toHaveBeenCalledWith("ses-123");
    // The asymmetric mapping is the footgun this factory exists to prevent:
    // closing/removing must not fire on open.
    expect(host.removeSession).not.toHaveBeenCalled();
  });

  it("maps onSessionClosed to host.removeSession with the session id", async () => {
    const host = createMockHost();
    const adapter = createRunnerAdapter(host);

    await adapter.onSessionClosed("ses-123");

    expect(host.removeSession).toHaveBeenCalledTimes(1);
    expect(host.removeSession).toHaveBeenCalledWith("ses-123");
    expect(host.addSession).not.toHaveBeenCalled();
  });

  it("resolves to undefined regardless of the host's return value", async () => {
    // The host's add method returns a task queue string; the adapter contract
    // is Promise<void>, so the value must be swallowed.
    const host = createMockHost();
    host.addSession.mockResolvedValue("session:ses-123");
    const adapter = createRunnerAdapter(host);

    await expect(adapter.onSessionOpened("ses-123")).resolves.toBeUndefined();
  });

  it("awaits the host: it does not resolve before the host settles", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = createMockHost();
    host.addSession.mockReturnValue(gate);
    const adapter = createRunnerAdapter(host);

    let settled = false;
    const pending = adapter.onSessionOpened("ses-123").then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await pending;
    expect(settled).toBe(true);
  });

  it("propagates a host rejection", async () => {
    const host = createMockHost();
    host.removeSession.mockRejectedValue(new Error("worker teardown failed"));
    const adapter = createRunnerAdapter(host);

    await expect(adapter.onSessionClosed("ses-123")).rejects.toThrow(
      "worker teardown failed",
    );
  });
});
