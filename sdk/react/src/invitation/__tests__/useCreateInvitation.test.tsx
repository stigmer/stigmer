import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer, InvitationInput } from "@stigmer/sdk";
import { create } from "@bufbuild/protobuf";
import { InvitationSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationSpecSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { StigmerContext } from "../../context";
import { useCreateInvitation } from "../useCreateInvitation";

function createMockInvitation(input: InvitationInput) {
  return Object.assign(create(InvitationSchema), {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Invitation",
    metadata: Object.assign(create(ApiResourceMetadataSchema), {
      id: "inv-123",
      name: input.name,
      org: input.org,
    }),
    spec: Object.assign(create(InvitationSpecSchema), {
      role: input.role,
      expiresAt: timestampFromDate(
        input.expiresAt instanceof Date
          ? input.expiresAt
          : new Date(input.expiresAt),
      ),
      label: input.label ?? "",
    }),
    status: { token: "tok_abc123", state: 1, redemptionCount: 0, redemptions: [] },
  });
}

function createWrapper(mockCreate: typeof vi.fn) {
  const mockClient = {
    invitation: { create: mockCreate },
  } as unknown as Stigmer;

  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={mockClient}>
      {children}
    </StigmerContext.Provider>
  );
}

describe("useCreateInvitation", () => {
  it("delegates to stigmer.invitation.create with the provided input", async () => {
    const input: InvitationInput = {
      name: "eng-invite",
      org: "acme",
      role: IamRole.viewer,
      expiresAt: new Date("2026-06-19T00:00:00Z"),
      label: "Engineering invite",
    };

    const mockCreate = vi.fn().mockResolvedValue(createMockInvitation(input));
    const wrapper = createWrapper(mockCreate);

    const { result } = renderHook(() => useCreateInvitation(), { wrapper });

    let invitation: unknown;
    await act(async () => {
      invitation = await result.current.create(input);
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(input);
    expect(invitation).toBeDefined();
  });

  it("sets isCreating to true during the request", async () => {
    let resolvePromise: (value: unknown) => void;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const mockCreate = vi.fn().mockReturnValue(pendingPromise);
    const wrapper = createWrapper(mockCreate);

    const { result } = renderHook(() => useCreateInvitation(), { wrapper });

    expect(result.current.isCreating).toBe(false);

    let createPromise: Promise<unknown>;
    act(() => {
      createPromise = result.current.create({
        name: "test",
        org: "acme",
        role: IamRole.viewer,
        expiresAt: new Date(),
      });
    });

    expect(result.current.isCreating).toBe(true);

    const mockResult = createMockInvitation({
      name: "test",
      org: "acme",
      role: IamRole.viewer,
      expiresAt: new Date(),
    });

    await act(async () => {
      resolvePromise!(mockResult);
      await createPromise!;
    });

    expect(result.current.isCreating).toBe(false);
  });

  it("sets error state when creation fails", async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error("permission denied"));
    const wrapper = createWrapper(mockCreate);

    const { result } = renderHook(() => useCreateInvitation(), { wrapper });

    await act(async () => {
      try {
        await result.current.create({
          name: "fail-test",
          org: "acme",
          role: IamRole.admin,
          expiresAt: new Date(),
        });
      } catch {
        // expected
      }
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("permission denied");
  });

  it("clearError resets the error state", async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error("oops"));
    const wrapper = createWrapper(mockCreate);

    const { result } = renderHook(() => useCreateInvitation(), { wrapper });

    await act(async () => {
      try {
        await result.current.create({
          name: "err",
          org: "acme",
          role: IamRole.viewer,
          expiresAt: new Date(),
        });
      } catch {
        // expected
      }
    });

    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it("accepts expiresAt as a Date matching the UI daysFromNow pattern", async () => {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const input: InvitationInput = {
      name: "7day-link",
      org: "acme",
      role: IamRole.member,
      expiresAt: sevenDaysFromNow,
      maxRedemptions: 0,
    };

    const mockCreate = vi.fn().mockResolvedValue(createMockInvitation(input));
    const wrapper = createWrapper(mockCreate);

    const { result } = renderHook(() => useCreateInvitation(), { wrapper });

    await act(async () => {
      await result.current.create(input);
    });

    const passedInput = mockCreate.mock.calls[0][0] as InvitationInput;
    expect(passedInput.expiresAt).toBeInstanceOf(Date);
    expect((passedInput.expiresAt as Date).getTime()).toBe(sevenDaysFromNow.getTime());
  });
});
