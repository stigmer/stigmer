/**
 * useRenameOrganization sends the organization's id and the new slug to
 * `organization.rename`, resolves with the renamed resource, and keeps a
 * refusal as its error.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RenameInput } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { useRenameOrganization } from "../useRenameOrganization";

afterEach(cleanup);

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const RENAMED = { metadata: { id: ACME_ID, slug: "acme-labs" } } as Organization;

function renderRename(rename: (input: RenameInput) => Promise<Organization>) {
  const client = { organization: { rename: vi.fn(rename) } };
  const view = renderHook(() => useRenameOrganization(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
    ),
  });
  return { ...view, rename: client.organization.rename };
}

describe("useRenameOrganization", () => {
  it("renames by id and resolves with the renamed organization", async () => {
    const { result, rename } = renderRename(async () => RENAMED);

    let renamed: Organization | undefined;
    await act(async () => {
      renamed = await result.current.rename(ACME_ID, "acme-labs");
    });

    expect(renamed).toBe(RENAMED);
    const input = rename.mock.calls[0]![0];
    expect(input.resourceId).toBe(ACME_ID);
    expect(input.slug).toBe("acme-labs");
    expect(result.current.isRenaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps a refusal as its error and rethrows it", async () => {
    const { result } = renderRename(async () => {
      throw new Error("permission denied");
    });

    await act(async () => {
      await expect(result.current.rename(ACME_ID, "acme-labs")).rejects.toThrow(
        "permission denied",
      );
    });

    expect(result.current.error?.message).toBe("permission denied");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
