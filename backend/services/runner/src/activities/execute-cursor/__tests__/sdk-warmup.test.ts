import { describe, it, expect, vi, beforeEach } from "vitest";
import { warmCursorSdkStateStores } from "../sdk-warmup.js";

const sdkMock = vi.hoisted(() => ({
  createAgentPlatform: vi.fn(),
}));

vi.mock("@cursor/sdk", () => ({
  createAgentPlatform: sdkMock.createAgentPlatform,
}));

describe("warmCursorSdkStateStores", () => {
  beforeEach(() => {
    sdkMock.createAgentPlatform.mockReset();
  });

  it("constructs a throwaway platform on a temp-dir state root", async () => {
    sdkMock.createAgentPlatform.mockResolvedValue({});

    const result = await warmCursorSdkStateStores();

    expect(result.warmed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(sdkMock.createAgentPlatform).toHaveBeenCalledTimes(1);
    const options = sdkMock.createAgentPlatform.mock.calls[0]![0] as {
      workspaceRef: string;
      stateRoot: string;
    };
    // The synthetic ref must never collide with real session platforms,
    // which are keyed `stigmer-session:{sessionId}`.
    expect(options.workspaceRef).toBe("stigmer-warm:boot");
    expect(options.stateRoot).toContain("cursor-sdk-warm-");
  });

  it("never throws — a failed warm-up reports instead of crashing the member", async () => {
    sdkMock.createAgentPlatform.mockRejectedValue(new Error("sqlite binding missing"));

    const result = await warmCursorSdkStateStores();

    expect(result.warmed).toBe(false);
    expect(result.error).toBe("sqlite binding missing");
  });
});
