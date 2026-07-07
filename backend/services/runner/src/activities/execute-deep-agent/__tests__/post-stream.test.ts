import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { processPostStream } from "../post-stream.js";
import type { InlinePublisher } from "../inline-publisher.js";
import type { WriteBackCoordinator } from "../../../shared/workspace/writeback-coordinator.js";

function mockInlinePublisher(): InlinePublisher {
  return {
    publishedPaths: new Set(),
    publish: vi.fn(),
  } as any;
}

function mockWritebackCoordinator(): WriteBackCoordinator & { finalizeCalls: number } {
  let finalizeCalls = 0;
  return {
    get finalizeCalls() { return finalizeCalls; },
    hasEligibleEntries: true,
    onFileModified: vi.fn(),
    finalize: vi.fn(async () => { finalizeCalls++; }),
  } as any;
}

describe("processPostStream", () => {
  it("drains pending publish and writeback promises", async () => {
    let publishResolved = false;
    let writebackResolved = false;

    await processPostStream({
      status: create(AgentExecutionStatusSchema, {}),
      inlinePublisher: mockInlinePublisher(),
      writebackCoordinator: mockWritebackCoordinator(),
      pendingPublishPromises: [
        new Promise<void>(resolve => { publishResolved = true; resolve(); }),
      ],
      pendingWritebackPromises: [
        new Promise<void>(resolve => { writebackResolved = true; resolve(); }),
      ],
      executionId: "exec-test",
    });

    expect(publishResolved).toBe(true);
    expect(writebackResolved).toBe(true);
  });

  it("calls writeback finalize", async () => {
    const coordinator = mockWritebackCoordinator();

    await processPostStream({
      status: create(AgentExecutionStatusSchema, {}),
      inlinePublisher: mockInlinePublisher(),
      writebackCoordinator: coordinator,
      pendingPublishPromises: [],
      pendingWritebackPromises: [],
      executionId: "exec-test",
    });

    expect(coordinator.finalize).toHaveBeenCalledOnce();
  });

  it("skips writeback finalize when coordinator is null", async () => {
    await processPostStream({
      status: create(AgentExecutionStatusSchema, {}),
      inlinePublisher: mockInlinePublisher(),
      writebackCoordinator: null,
      pendingPublishPromises: [],
      pendingWritebackPromises: [],
      executionId: "exec-test",
    });

    // no error thrown
  });

  it("continues even when pending promise rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const coordinator = mockWritebackCoordinator();

    await processPostStream({
      status: create(AgentExecutionStatusSchema, {}),
      inlinePublisher: mockInlinePublisher(),
      writebackCoordinator: coordinator,
      pendingPublishPromises: [Promise.reject(new Error("publish boom"))],
      pendingWritebackPromises: [],
      executionId: "exec-test",
    });

    expect(coordinator.finalize).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("continues even when writeback finalize throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const coordinator = mockWritebackCoordinator();
    (coordinator.finalize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("finalize boom"),
    );

    await processPostStream({
      status: create(AgentExecutionStatusSchema, {}),
      inlinePublisher: mockInlinePublisher(),
      writebackCoordinator: coordinator,
      pendingPublishPromises: [],
      pendingWritebackPromises: [],
      executionId: "exec-test",
    });

    // no error thrown, just warned
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
