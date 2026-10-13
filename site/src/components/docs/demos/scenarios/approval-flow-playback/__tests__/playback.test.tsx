/**
 * The two playback tours on the docs pages: the approval flow and the tool
 * calls. Each player opens on its first frame, the typed prompt. Every step
 * renders its own frame: the approval flow's waiting step shows the real
 * inline gate until the demo's answer state says approved, then the
 * completed turn. That answer state approves on Approve and on Approve all,
 * stays waiting on a Deny (the demo has no denied ending), and returns to
 * waiting on a step change. The views need a `StigmerProvider` (the
 * preview provider gives one); fetches never settle, so nothing leaves the
 * test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, within } from "@testing-library/react";
import { StigmerPreviewProvider } from "../../../shared/StigmerPreviewProvider";
import { ApprovalFlowPlayback, renderStep, useApprovalAnswer } from "../index";
import { approvalFlowSteps } from "../steps";
import { ToolCallsPlayback, renderStep as renderToolCallsStep } from "../../tool-calls-playback/index";
import { toolCallsPlaybackSteps } from "../../tool-calls-playback/steps";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the players", () => {
  it("each opens on the typed prompt, ready to play", async () => {
    render(<ApprovalFlowPlayback />);
    expect(await screen.findByRole("button", { name: "Play demo" })).toBeTruthy();
    cleanup();
    render(<ToolCallsPlayback />);
    expect(await screen.findByRole("button", { name: "Play demo" })).toBeTruthy();
  });
});

describe("the approval flow's frames", () => {
  const noAnswer = () => {};

  it("renders every step, the waiting gate until approved and the completed turn after", async () => {
    for (const step of approvalFlowSteps) {
      const { unmount } = render(<StigmerPreviewProvider>{renderStep(step.data, false, noAnswer)}</StigmerPreviewProvider>);
      if (step.data.view === "approval-pending") {
        expect(await within(await screen.findByRole("log")).findByRole("button", { name: "Approve" })).toBeTruthy();
      }
      unmount();
    }
    const waiting = approvalFlowSteps.find((step) => step.data.view === "approval-pending")!;
    render(<StigmerPreviewProvider>{renderStep(waiting.data, true, noAnswer)}</StigmerPreviewProvider>);
    expect(within(await screen.findByRole("log")).queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("approves on Approve and Approve all, stays waiting on a Deny, and resets on a step change", () => {
    const { result } = renderHook(() => useApprovalAnswer());
    act(() => result.current.onAnswer("use_1", "deny"));
    expect(result.current.approved).toBe(false);
    act(() => result.current.onAnswer("use_1", "allow"));
    expect(result.current.approved).toBe(true);
    act(() => result.current.reset());
    expect(result.current.approved).toBe(false);
    act(() => result.current.onAnswer("use_1", "grant"));
    expect(result.current.approved).toBe(true);
  });
});

describe("the tool calls' frames", () => {
  it("renders every step, the conversation ones with the thread", async () => {
    for (const step of toolCallsPlaybackSteps) {
      const { unmount } = render(<StigmerPreviewProvider>{renderToolCallsStep(step.data)}</StigmerPreviewProvider>);
      if (step.data.view === "conversation") {
        expect(await screen.findByRole("log")).toBeTruthy();
      }
      unmount();
    }
  });
});
