import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { CreateLaunchTokenResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useLaunchLocalRunner } from "../useLaunchLocalRunner";

function buildMockClient(overrides: {
  createLaunchToken?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    runner: {
      createLaunchToken:
        overrides.createLaunchToken ?? vi.fn(),
    },
  } as unknown as Stigmer;
}

function makeWrapper(client: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>
      {children}
    </StigmerContext.Provider>
  );
}

describe("useLaunchLocalRunner", () => {
  const ORG = "test-org";

  let createLaunchToken: ReturnType<typeof vi.fn>;
  let client: Stigmer;

  beforeEach(() => {
    createLaunchToken = vi.fn();
    client = buildMockClient({ createLaunchToken });
  });

  it("creates a token and opens the stigmer:// URL on success", async () => {
    const response = create(CreateLaunchTokenResponseSchema, {
      token: "tok_abc123",
      expiresAt: timestampFromDate(new Date()),
    });
    createLaunchToken.mockResolvedValueOnce(response);

    const openUrl = vi.fn();
    const { result } = renderHook(
      () => useLaunchLocalRunner({ openUrl }),
      { wrapper: makeWrapper(client) },
    );

    expect(result.current.isLaunching).toBe(false);
    expect(result.current.error).toBeNull();

    let launchResult: Awaited<ReturnType<typeof result.current.launch>>;
    await act(async () => {
      launchResult = await result.current.launch({ org: ORG });
    });

    expect(createLaunchToken).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledWith(
      `stigmer://launch-runner?token=${encodeURIComponent("tok_abc123")}`,
    );

    expect(launchResult!.url).toBe(
      `stigmer://launch-runner?token=${encodeURIComponent("tok_abc123")}`,
    );
    expect(launchResult!.expiresAt).toBeInstanceOf(Date);

    expect(result.current.isLaunching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("URL-encodes tokens with special characters", async () => {
    const response = create(CreateLaunchTokenResponseSchema, {
      token: "tok/with+special=chars&more",
    });
    createLaunchToken.mockResolvedValueOnce(response);

    const openUrl = vi.fn();
    const { result } = renderHook(
      () => useLaunchLocalRunner({ openUrl }),
      { wrapper: makeWrapper(client) },
    );

    await act(async () => {
      await result.current.launch({ org: ORG });
    });

    const url = openUrl.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent("tok/with+special=chars&more"));
    expect(url).not.toContain("&more");
  });

  it("uses the custom openUrl callback", async () => {
    const response = create(CreateLaunchTokenResponseSchema, {
      token: "tok_custom",
    });
    createLaunchToken.mockResolvedValueOnce(response);

    const customOpen = vi.fn();
    const { result } = renderHook(
      () => useLaunchLocalRunner({ openUrl: customOpen }),
      { wrapper: makeWrapper(client) },
    );

    await act(async () => {
      await result.current.launch({ org: ORG });
    });

    expect(customOpen).toHaveBeenCalledOnce();
    expect(customOpen.mock.calls[0][0]).toMatch(/^stigmer:\/\//);
  });

  it("returns undefined expiresAt when the server omits it", async () => {
    const response = create(CreateLaunchTokenResponseSchema, {
      token: "tok_no_expiry",
    });
    createLaunchToken.mockResolvedValueOnce(response);

    const openUrl = vi.fn();
    const { result } = renderHook(
      () => useLaunchLocalRunner({ openUrl }),
      { wrapper: makeWrapper(client) },
    );

    let launchResult: Awaited<ReturnType<typeof result.current.launch>>;
    await act(async () => {
      launchResult = await result.current.launch({ org: ORG });
    });

    expect(launchResult!.expiresAt).toBeUndefined();
  });

  it("sets error and rethrows when createLaunchToken fails", async () => {
    const rpcError = new Error("token creation failed");
    createLaunchToken.mockRejectedValueOnce(rpcError);

    const openUrl = vi.fn();
    const { result } = renderHook(
      () => useLaunchLocalRunner({ openUrl }),
      { wrapper: makeWrapper(client) },
    );

    await act(async () => {
      await expect(
        result.current.launch({ org: ORG }),
      ).rejects.toThrow("token creation failed");
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("token creation failed");
    expect(result.current.isLaunching).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("handles non-Error rejection values", async () => {
    createLaunchToken.mockRejectedValueOnce("string error");

    const openUrl = vi.fn();
    const { result } = renderHook(
      () => useLaunchLocalRunner({ openUrl }),
      { wrapper: makeWrapper(client) },
    );

    await act(async () => {
      await expect(result.current.launch({ org: ORG })).rejects.toBe(
        "string error",
      );
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("string error");
  });

  it("clears error via clearError", async () => {
    createLaunchToken.mockRejectedValueOnce(new Error("fail"));

    const openUrl = vi.fn();
    const { result } = renderHook(
      () => useLaunchLocalRunner({ openUrl }),
      { wrapper: makeWrapper(client) },
    );

    await act(async () => {
      await result.current.launch({ org: ORG }).catch(() => {});
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it("resets previous error on a new successful launch", async () => {
    createLaunchToken.mockRejectedValueOnce(new Error("first fail"));

    const openUrl = vi.fn();
    const { result } = renderHook(
      () => useLaunchLocalRunner({ openUrl }),
      { wrapper: makeWrapper(client) },
    );

    await act(async () => {
      await result.current.launch({ org: ORG }).catch(() => {});
    });
    expect(result.current.error).not.toBeNull();

    const response = create(CreateLaunchTokenResponseSchema, {
      token: "tok_retry",
    });
    createLaunchToken.mockResolvedValueOnce(response);

    await act(async () => {
      await result.current.launch({ org: ORG });
    });
    expect(result.current.error).toBeNull();
  });
});
