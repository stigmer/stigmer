import { describe, it, expect, vi } from "vitest";
import {
  createRunnerAdapter,
  type RunnerWorkerHost,
} from "../runner-adapter";

function createMockHost(): RunnerWorkerHost & {
  addSession: ReturnType<typeof vi.fn>;
  removeSession: ReturnType<typeof vi.fn>;
  addWorkflowExecution: ReturnType<typeof vi.fn>;
  removeWorkflowExecution: ReturnType<typeof vi.fn>;
} {
  return {
    addSession: vi.fn().mockResolvedValue(undefined),
    removeSession: vi.fn().mockResolvedValue(undefined),
    addWorkflowExecution: vi.fn().mockResolvedValue(undefined),
    removeWorkflowExecution: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createRunnerAdapter", () => {
  it("returns an adapter with all four lifecycle methods", () => {
    const adapter = createRunnerAdapter(createMockHost());

    expect(adapter.onSessionOpened).toBeInstanceOf(Function);
    expect(adapter.onSessionClosed).toBeInstanceOf(Function);
    expect(adapter.onWorkflowExecutionCreated).toBeInstanceOf(Function);
    expect(adapter.onWorkflowExecutionTerminated).toBeInstanceOf(Function);
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

  it("maps onWorkflowExecutionCreated to host.addWorkflowExecution with the execution id", async () => {
    const host = createMockHost();
    const adapter = createRunnerAdapter(host);

    await adapter.onWorkflowExecutionCreated("wfexec-456");

    expect(host.addWorkflowExecution).toHaveBeenCalledTimes(1);
    expect(host.addWorkflowExecution).toHaveBeenCalledWith("wfexec-456");
    expect(host.removeWorkflowExecution).not.toHaveBeenCalled();
  });

  it("maps onWorkflowExecutionTerminated to host.removeWorkflowExecution with the execution id", async () => {
    const host = createMockHost();
    const adapter = createRunnerAdapter(host);

    await adapter.onWorkflowExecutionTerminated("wfexec-456");

    expect(host.removeWorkflowExecution).toHaveBeenCalledTimes(1);
    expect(host.removeWorkflowExecution).toHaveBeenCalledWith("wfexec-456");
    expect(host.addWorkflowExecution).not.toHaveBeenCalled();
  });

  it("resolves to undefined regardless of the host's return value", async () => {
    // The host's add methods return a task queue string; the adapter contract
    // is Promise<void>, so the value must be swallowed.
    const host = createMockHost();
    host.addSession.mockResolvedValue("session:ses-123");
    host.addWorkflowExecution.mockResolvedValue("wfexec:wfexec-456");
    const adapter = createRunnerAdapter(host);

    await expect(adapter.onSessionOpened("ses-123")).resolves.toBeUndefined();
    await expect(
      adapter.onWorkflowExecutionCreated("wfexec-456"),
    ).resolves.toBeUndefined();
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
