/**
 * useUpdateVisibility sends a shared vault's visibility change through the
 * vault service's `updateVisibility`, naming the vault by id, and keeps a
 * refused change as its error. The other kinds take the same path through
 * their own services; the selector's gating is pinned in
 * `ResourceVisibilityControl.test.tsx`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { StigmerContext } from "../../context";
import { useUpdateVisibility } from "../useUpdateVisibility";

afterEach(cleanup);

function wrapperFor(calls: string[], refuse: boolean) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(VaultCommandController, {
        updateVisibility: (req) => {
          if (refuse) throw new ConnectError("not the owner", Code.PermissionDenied);
          calls.push(`${req.resourceId}:${ApiResourceVisibility[req.visibility]}`);
          return create(VaultSchema, {});
        },
      });
    }),
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  };
}

describe("useUpdateVisibility for a shared vault", () => {
  it("names the vault by id on the vault service", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() => useUpdateVisibility("vault", "vlt_team"), {
      wrapper: wrapperFor(calls, false),
    });
    await act(() => result.current.updateVisibility(ApiResourceVisibility.visibility_org));
    expect(calls).toEqual(["vlt_team:visibility_org"]);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps a refused change as its error", async () => {
    const { result } = renderHook(() => useUpdateVisibility("vault", "vlt_team"), {
      wrapper: wrapperFor([], true),
    });
    await act(async () => {
      await expect(
        result.current.updateVisibility(ApiResourceVisibility.visibility_org),
      ).rejects.toThrow(/not the owner/);
    });
    expect(result.current.error?.message).toMatch(/not the owner/);
  });
});
